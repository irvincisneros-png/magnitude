/**
 * Layer compositor. Each active layer is rendered with its own camera into a linear HDR render
 * target (transparent clear, so depth is cleared between layers), then blended largest-first into
 * an accumulation buffer, which `Post` tone-maps to the screen.
 *
 * Opacity rule (no dip to black): a layer stays fully opaque while the next-smaller layer drawn
 * on top of it is still fading in, and only lets its own presence show once that upper layer is
 * nearly complete:  opacity = 1 − (1 − presence) · smoothstep(0.6, 1, presenceAbove).
 * It is continuous, and the topmost (smallest) layer simply uses its presence.
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

const compositeFrag = /* glsl */ `
  uniform sampler2D tLayer; uniform float uOpacity; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tLayer, vUv);           // premultiplied (rendered over transparent black)
    c.a = clamp(c.a, 0.0, 1.0);
    gl_FragColor = vec4(max(c.rgb, 0.0), c.a) * uOpacity;
  }`;

export class Compositor {
  readonly post: Post;
  private layerRT: THREE.WebGLRenderTarget;
  private accumRT: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  private clear = new THREE.Color(0, 0, 0);

  constructor(private renderer: THREE.WebGLRenderer) {
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true } as const;
    this.layerRT = new THREE.WebGLRenderTarget(2, 2, { ...opts, samples: 4 });
    this.accumRT = new THREE.WebGLRenderTarget(2, 2, { ...opts, depthBuffer: false });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
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
    this.post = new Post(renderer);
  }

  setTier(q: Quality) {
    this.layerRT.samples = q === 'low' ? 0 : 4;
    this.layerRT.dispose(); // re-create with the new sample count on next use
    this.post.setTier(q);
  }

  /** Drawing-buffer size in device pixels. */
  setSize(w: number, h: number) {
    this.layerRT.setSize(w, h);
    this.accumRT.setSize(w, h);
    this.post.setSize(w, h);
  }

  /** Renders the frame to the screen. Returns opacity per layer key. */
  render(layers: CompositeLayer[], time: number): Map<string, number> {
    const r = this.renderer;
    const sorted = layers.filter((l) => l.presence > 0.0005).sort((a, b) => b.sortSize - a.sortSize);
    const ops = layerOpacities(sorted.map((l) => l.presence));
    const out = new Map<string, number>();

    r.setClearColor(this.clear, 1);
    r.setRenderTarget(this.accumRT);
    r.clear(true, false, false);

    let wSum = 0;
    const hints: PostHints = { bloom: 0, exposure: 0 };
    sorted.forEach((layer, i) => {
      const op = ops[i];
      out.set(layer.key, op);
      if (op < 0.002) return;
      r.setClearColor(this.clear, 0);
      r.setRenderTarget(this.layerRT);
      r.autoClear = true;
      r.render(layer.scene, layer.camera);

      r.autoClear = false;
      this.mat.uniforms.uOpacity.value = op;
      r.setRenderTarget(this.accumRT);
      this.quad.render(r);
      r.autoClear = true;

      const w = layer.presence;
      wSum += w;
      hints.bloom += w * (layer.post?.bloom ?? DEFAULT_BLOOM);
      hints.exposure += w * (layer.post?.exposure ?? 1);
    });
    if (wSum > 0) { hints.bloom /= wSum; hints.exposure /= wSum; } else { hints.bloom = DEFAULT_BLOOM; hints.exposure = 1; }

    this.post.render(this.accumRT, hints, time);
    return out;
  }

  dispose() {
    this.layerRT.dispose(); this.accumRT.dispose(); this.mat.dispose(); this.quad.dispose(); this.post.dispose();
  }
}
