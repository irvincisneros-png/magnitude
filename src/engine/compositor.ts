/**
 * Layer compositor. Each active layer is rendered with its own camera into a linear HDR render
 * target (transparent clear, so depth is cleared between layers), then blended largest-first into
 * an accumulation buffer, which `Post` tone-maps to the screen.
 *
 * Opacity rule (no dip to black): a layer stays fully opaque while the next-smaller layer drawn
 * on top of it is still fading in, and only lets its own presence show once that upper layer is
 * nearly complete:  opacity = 1 − (1 − presence) · smoothstep(0.6, 1, presenceAbove).
 * It is continuous, and the topmost (smallest) layer simply uses its presence.
 *
 * Cost control (no visible change):
 * - A layer whose opacity is below MIN_OPACITY is not rendered at all.
 * - Coverage: after a layer is rendered, a tiny pass records the minimum alpha of each screen block
 *   (COV_W × COV_H blocks); it is read back asynchronously (a frame or two late). From the opacities
 *   and coverages of the layers drawn above it, each layer gets an upper bound on how much of it can
 *   reach the screen anywhere. A layer that can contribute at most LOW_VIS (for example the stack
 *   under an opaque layer that is 93 % faded in, or a layer that is only just fading in) is rendered
 *   at half resolution: at that weight the softer image is invisible, and it costs a quarter.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { Post, type PostHints } from './post';
import { FOV_DEG, cameraDistance, smoothstep } from './scale';
import type { LandmarkMeta, Quality } from './types';

export interface CompositeLayer {
  key: string;
  /** Characteristic size in metres; layers are drawn largest first. */
  sortSize: number;
  presence: number;
  scene: THREE.Scene;
  camera: THREE.Camera;
  post?: LandmarkMeta['post'];
}

export const DEFAULT_BLOOM = 0.4;
export const MIN_PITCH = (-80 * Math.PI) / 180;
export const MAX_PITCH = (80 * Math.PI) / 180;
/** Layers fainter than this are skipped (their contribution is below one 8-bit step of the output). */
export const MIN_OPACITY = 0.004;
/** Coverage grid (blocks across × down) and the visibility below which a layer is drawn at half resolution. */
const COV_W = 32, COV_H = 20, COV_SLOTS = 6;
const LOW_VIS = 0.1, LOW_VIS_OFF = 0.14; // hysteresis
/** Coverage older than this many frames is ignored (treated as "covers nothing"). */
const COV_MAX_AGE = 8;

/** Per-layer camera: shared yaw/pitch orbit around the local origin at cameraDistance(s, size). */
export function placeCamera(cam: THREE.PerspectiveCamera, s: number, sizeMeters: number, yaw: number, pitch: number, aspect: number) {
  const d = cameraDistance(s, sizeMeters);
  const cp = Math.cos(pitch);
  cam.fov = FOV_DEG;
  cam.aspect = aspect;
  cam.near = d / 200;
  cam.far = d * 2000 + 50;
  cam.position.set(d * cp * Math.sin(yaw), d * Math.sin(pitch), d * cp * Math.cos(yaw));
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

/** Opacities for layers already sorted largest → smallest. */
export function layerOpacities(presences: number[]): number[] {
  return presences.map((p, i) => (i === presences.length - 1 ? p : 1 - (1 - p) * smoothstep(0.6, 1, presences[i + 1])));
}

/**
 * Upper bound, per layer (sorted largest → smallest), of the weight with which it can reach the
 * screen anywhere: max over blocks of opacity · Π over layers above (1 − opacity · coverage).
 * `cov[i]` is that layer's per-block minimum alpha (0..255), or null when unknown (= covers nothing).
 */
export function layerVisibility(ops: number[], cov: (Uint8Array | null)[], blocks: number): number[] {
  const n = ops.length;
  const out = new Array<number>(n).fill(0);
  const pass = new Float32Array(blocks).fill(1); // transmittance of everything above, per block
  for (let i = n - 1; i >= 0; i--) {
    let m = 0;
    for (let b = 0; b < blocks; b++) if (pass[b] > m) m = pass[b];
    out[i] = ops[i] * m;
    const c = cov[i];
    if (c) for (let b = 0; b < blocks; b++) pass[b] *= 1 - ops[i] * (c[b] / 255);
  }
  return out;
}

const compositeFrag = /* glsl */ `
  uniform sampler2D tLayer; uniform float uOpacity; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tLayer, vUv);           // premultiplied (rendered over transparent black)
    c.a = clamp(c.a, 0.0, 1.0);
    gl_FragColor = vec4(max(c.rgb, 0.0), c.a) * uOpacity;
  }`;

// minimum alpha over a 6 × 6 grid of taps in each block (holes narrower than the tap spacing,
// ~1/200 of the width, are ignored: they could only matter at a weight far below LOW_VIS)
const coverageFrag = /* glsl */ `
  uniform sampler2D tLayer; uniform vec2 uBlocks; uniform vec2 uOrigin;
  void main() {
    vec2 blk = floor(gl_FragCoord.xy - uOrigin);
    float a = 1.0;
    for (int j = 0; j < 6; j++) for (int i = 0; i < 6; i++) {
      vec2 uv = (blk + (vec2(float(i), float(j)) + 0.5) / 6.0) / uBlocks;
      a = min(a, clamp(texture2D(tLayer, uv).a, 0.0, 1.0));
    }
    gl_FragColor = vec4(a, a, a, 1.0);
  }`;

const quadVert = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Compositor {
  readonly post: Post;
  /** Debug / test readout: the resolution scale each layer was drawn at in the last frame (0 = skipped). */
  readonly scales = new Map<string, number>();
  private layerRT: THREE.WebGLRenderTarget;
  private halfRT: THREE.WebGLRenderTarget;
  private accumRT: THREE.WebGLRenderTarget;
  private covRT: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  private covMat: THREE.ShaderMaterial;
  private covQuad: FullScreenQuad;
  private clear = new THREE.Color(0, 0, 0);
  private frame = 0;
  /** Latest coverage per layer key, with the frame it was rendered in. */
  private cov = new Map<string, { data: Uint8Array; frame: number }>();
  private covBusy = false;
  private covBuf = new Uint8Array(COV_W * COV_H * COV_SLOTS * 4);
  private half = new Set<string>();
  private disposed = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true } as const;
    this.layerRT = new THREE.WebGLRenderTarget(2, 2, { ...opts, samples: 4 });
    this.halfRT = new THREE.WebGLRenderTarget(1, 1, { ...opts, samples: 4 });
    this.accumRT = new THREE.WebGLRenderTarget(2, 2, { ...opts, depthBuffer: false });
    this.covRT = new THREE.WebGLRenderTarget(COV_W, COV_H * COV_SLOTS, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: compositeFrag,
      uniforms: { tLayer: { value: this.layerRT.texture }, uOpacity: { value: 1 } },
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.covMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: coverageFrag,
      uniforms: { tLayer: { value: null }, uBlocks: { value: new THREE.Vector2(COV_W, COV_H) }, uOrigin: { value: new THREE.Vector2() } },
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.covQuad = new FullScreenQuad(this.covMat);
    this.post = new Post(renderer);
  }

  setTier(q: Quality) {
    for (const rt of [this.layerRT, this.halfRT]) {
      rt.samples = q === 'low' ? 0 : 4;
      rt.dispose(); // re-create with the new sample count on next use
    }
    this.post.setTier(q);
  }

  /** Drawing-buffer size in device pixels. */
  setSize(w: number, h: number) {
    this.layerRT.setSize(w, h);
    this.halfRT.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.accumRT.setSize(w, h);
    this.post.setSize(w, h);
  }

  /** Renders the frame to the screen. Returns opacity per layer key. */
  render(layers: CompositeLayer[], time: number): Map<string, number> {
    const r = this.renderer;
    this.frame++;
    const sorted = layers.filter((l) => l.presence > 0.0005).sort((a, b) => b.sortSize - a.sortSize);
    const ops = layerOpacities(sorted.map((l) => l.presence));
    const covs = sorted.map((l) => {
      const c = this.cov.get(l.key);
      return c && this.frame - c.frame <= COV_MAX_AGE ? c.data : null;
    });
    const vis = layerVisibility(ops, covs, COV_W * COV_H);
    const out = new Map<string, number>();
    this.scales.clear();

    r.setClearColor(this.clear, 1);
    r.setRenderTarget(this.accumRT);
    r.clear(true, false, false);

    let wSum = 0;
    let slot = 0;
    const slotKeys: string[] = [];
    const hints: PostHints = { bloom: 0, exposure: 0 };
    sorted.forEach((layer, i) => {
      const op = ops[i];
      out.set(layer.key, op);
      // post hints follow presence exactly as before, whether or not the layer is drawn below
      if (op >= 0.002) {
        const w = layer.presence;
        wSum += w;
        hints.bloom += w * (layer.post?.bloom ?? DEFAULT_BLOOM);
        hints.exposure += w * (layer.post?.exposure ?? 1);
      }
      // nothing of it can reach the screen (faded out, or under opaque layers): skip it entirely
      if (op < MIN_OPACITY || vis[i] < MIN_OPACITY) { this.scales.set(layer.key, 0); this.half.delete(layer.key); return; }

      // half resolution while this layer can reach the screen only faintly (hysteresis on the bound)
      const wasHalf = this.half.has(layer.key);
      const half = vis[i] < (wasHalf ? LOW_VIS_OFF : LOW_VIS);
      if (half) this.half.add(layer.key); else this.half.delete(layer.key);
      const rt = half ? this.halfRT : this.layerRT;
      this.scales.set(layer.key, half ? 0.5 : 1);

      r.setClearColor(this.clear, 0);
      r.setRenderTarget(rt);
      r.autoClear = true;
      r.render(layer.scene, layer.camera);

      r.autoClear = false;
      this.mat.uniforms.tLayer.value = rt.texture;
      this.mat.uniforms.uOpacity.value = op;
      r.setRenderTarget(this.accumRT);
      this.quad.render(r);

      // coverage is only useful for layers that have something drawn below them
      if (i > 0 && slot < COV_SLOTS) {
        this.covMat.uniforms.tLayer.value = rt.texture;
        this.covMat.uniforms.uOrigin.value.set(0, slot * COV_H);
        this.covRT.viewport.set(0, slot * COV_H, COV_W, COV_H);
        r.setRenderTarget(this.covRT);
        this.covQuad.render(r);
        slotKeys.push(layer.key);
        slot++;
      }
      r.autoClear = true;
    });
    if (wSum > 0) { hints.bloom /= wSum; hints.exposure /= wSum; } else { hints.bloom = DEFAULT_BLOOM; hints.exposure = 1; }
    if (slot > 0) this.readCoverage(slotKeys);

    this.post.render(this.accumRT, hints, time);
    return out;
  }

  /** Asynchronous read-back of this frame's coverage (one request in flight at a time). */
  private readCoverage(keys: string[]) {
    if (this.covBusy) return;
    this.covBusy = true;
    const frame = this.frame;
    const rows = keys.length * COV_H;
    const buf = this.covBuf.subarray(0, COV_W * rows * 4);
    this.renderer.readRenderTargetPixelsAsync(this.covRT, 0, 0, COV_W, rows, buf)
      .then(() => {
        if (this.disposed) return;
        keys.forEach((k, s) => {
          const data = this.cov.get(k)?.data ?? new Uint8Array(COV_W * COV_H);
          for (let b = 0; b < COV_W * COV_H; b++) data[b] = buf[(s * COV_W * COV_H + b) * 4];
          this.cov.set(k, { data, frame });
        });
      })
      .catch(() => { /* context lost or similar: coverage just stays unknown */ })
      .finally(() => { this.covBusy = false; });
  }

  dispose() {
    this.disposed = true;
    this.layerRT.dispose(); this.halfRT.dispose(); this.accumRT.dispose(); this.covRT.dispose();
    this.mat.dispose(); this.quad.dispose(); this.covMat.dispose(); this.covQuad.dispose(); this.post.dispose();
  }
}
