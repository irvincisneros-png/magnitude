/**
 * Figure2: the person on the beach — the Microsoft Rocketbox avatar Male_Adult_01 (MIT, see
 * CREDITS.md), posed and baked offline into static geometry by tools/build-figure.py, photo
 * textures by tools/build-figure-tex.py (public/assets/human/figure/).
 *
 * Object frame: the anchor point on the back of the right hand (held out level in front of him,
 * palm down, while he looks at it) is the origin, its surface normal is exactly +Y, 1 unit = 1.7 m
 * and he is 1.7 m tall standing. The ground is at info.groundY (≈ −0.59). He faces +Z; turn him with
 * setYaw() (about the vertical through the origin, so the anchor stays put).
 *
 * Shading is self-contained (sun, sky hemisphere, sand bounce, baked AO, a self-shadow depth map
 * rendered from the Sun in object space). Output is linear HDR. Integration hooks: Figure2Options.
 */
import * as THREE from 'three';
import { F2_COMMON, F2_FRAG, F2_SHADOW_FRAG, F2_SHADOW_VERT, F2_VERT } from './shaders';

export type Figure2Tier = 'low' | 'medium' | 'high';

export interface Figure2Options {
  /** GLSL pasted after Figure2's own uniforms in both stages (e.g. the scene's COMMON + varyings). */
  prelude?: string;
  /** GLSL run at the end of the vertex shader; has `vec4 mv` (view space) and `vec3 wp` (world). */
  vertexOutro?: string;
  /** GLSL run before the colour is written; may modify `vec3 col`; has `wp` (world) and `op` (object). */
  fragmentOutro?: string;
  /** GLSL run after gl_FragColor is written (e.g. a depth write). */
  fragmentEnd?: string;
  /** Extra uniforms referenced by the hooks (shared objects are fine). */
  uniforms?: Record<string, THREE.IUniform>;
  defines?: Record<string, string>;
}

export interface Figure2Anchor {
  position: [number, number, number];
  normal: [number, number, number];
  /** unit tangent along the fingers (object frame, before yaw) */
  tangentFingers: [number, number, number];
  /** unit tangent across the knuckles, = normal × tangentFingers */
  tangentAcross: [number, number, number];
  /** principal radii of curvature of the skin at the anchor, metres (convex) */
  radiiM: { alongFingers: number; acrossKnuckles: number };
}

export interface Figure2Info {
  /** per foot [centreX, centreZ, dirX, dirZ] on the ground (object units), L then R */
  feet: number[];
  groundY: number;
  anchor: Figure2Anchor;
  bounds: THREE.Box3;
  headTop: THREE.Vector3;
  /** horizontal direction the body faces (object frame) */
  gaze: THREE.Vector3;
  manifest: Manifest;
}

type PartName = 'body' | 'head' | 'hair';
const PARTS: PartName[] = ['body', 'head', 'hair'];
interface GeoDesc { vertexCount: number; indexCount: number; indexType: 'uint16' | 'uint32'; position: number; normal: number; uv: number; aux: number; index: number }
interface TierDesc { file: string; bytes: number; quant: { offset: number[]; scale: number[] }; geometries: Record<PartName, GeoDesc> }
interface Manifest {
  tiers: { high: TierDesc; low: TierDesc };
  groundY: number; feet: number[];
  anchor: { normal: number[]; tangentFingers: number[]; tangentAcross: number[] };
  anchorRadii: { alongFingersM: number; acrossKnucklesM: number; principalAngleDeg: number };
  headTop: number[]; headCentre: number[];
  gaze: number[];
  bounds: { min: number[]; max: number[] };
}
type GeoKey = 'high' | 'low';
type TexKey = 'h' | 'l';
interface TexSet { col: Record<PartName, THREE.Texture>; nrm: Record<'body' | 'head', THREE.Texture> }

const SHADOW_RES = 2048;
const DEFAULT_SUN = new THREE.Vector3(0.882, 0.375, -0.287).normalize();

export class Figure2 {
  readonly group = new THREE.Group();
  info: Figure2Info | null = null;
  private manifest: Manifest | null = null;
  private assetUrl: (p: string) => string = (p) => p;
  private tier: Figure2Tier = 'high';
  private geos = new Map<GeoKey, { parts: Record<PartName, THREE.BufferGeometry>; quant: TierDesc['quant'] }>();
  private geoLoading = new Map<GeoKey, Promise<void>>();
  private texs = new Map<TexKey, TexSet>();
  private texLoading = new Map<TexKey, Promise<void>>();
  private mask: THREE.Texture | null = null;
  private meshes: THREE.Mesh[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private readonly u: Record<string, THREE.IUniform>;
  private sunWorld = DEFAULT_SUN.clone();
  private shadowDirty = true;
  private lastSunObj = new THREE.Vector3();
  private shadowRT: THREE.WebGLRenderTarget;
  private shadowScene = new THREE.Scene();
  private shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  private shadowMats: THREE.ShaderMaterial[] = [];
  private shadowReady = false;
  private casterKey: GeoKey | null = null;
  private disposed = false;
  private readonly tmpM4 = new THREE.Matrix4();
  private readonly tmpM3 = new THREE.Matrix3();
  private readonly tmpV = new THREE.Vector3();

  constructor(private opts: Figure2Options = {}) {
    this.shadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, { depthBuffer: true });
    this.shadowRT.depthTexture = new THREE.DepthTexture(SHADOW_RES, SHADOW_RES, THREE.UnsignedIntType);
    this.shadowRT.depthTexture.minFilter = THREE.NearestFilter;
    this.shadowRT.depthTexture.magFilter = THREE.NearestFilter;
    this.u = {
      uF2QO: { value: new THREE.Vector3() }, uF2QS: { value: new THREE.Vector3(1, 1, 1) },
      uF2Time: { value: 0 },
      uF2M2O: { value: 1 / 1.7 },
      uF2Sun: { value: DEFAULT_SUN.clone() },
      uF2SunCol: { value: new THREE.Vector3(1.0, 0.84, 0.66).multiplyScalar(2.6) },
      // the scene's sky irradiance (glsl.ts skyIrr: zenith (0.16, 0.25, 0.42)) and the sunlit sand's bounce
      uF2SkyZen: { value: new THREE.Vector3(0.16, 0.25, 0.42) },
      uF2SkyHor: { value: new THREE.Vector3(0.24, 0.27, 0.32) },
      uF2Bounce: { value: new THREE.Vector3(0.3, 0.25, 0.18) },
      uF2SunObj: { value: DEFAULT_SUN.clone() },
      uF2Hole: { value: new THREE.Vector4(0, 0, 0, 0) },
      uF2Shadow: { value: this.shadowRT.depthTexture }, uF2ShadowMat: { value: new THREE.Matrix4() }, uF2ShadowOn: { value: 0 },
      uF2ShadowTexel: { value: 0.002 }, uF2ShadowR: { value: 1 },
      uF2Rot: { value: new THREE.Matrix3() },
      uF2SkinTone: { value: 1.0 },
      uF2HeadC: { value: new THREE.Vector3() }, uF2HeadUp: { value: new THREE.Vector3(0, 1, 0) },
      uF2HandX: { value: new THREE.Vector3(1, 0, 0) }, uF2HandZ: { value: new THREE.Vector3(0, 0, 1) },
    };
    this.group.name = 'figure2';
  }

  /** Load the manifest, the current tier's mesh and textures. assetUrl maps 'human/figure/x' to a URL. */
  async load(assetUrl: (p: string) => string): Promise<Figure2Info> {
    this.assetUrl = assetUrl;
    const m = (await (await fetch(assetUrl('human/figure/figure.json'))).json()) as Manifest;
    this.manifest = m;
    const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
    const t = (a: number[]) => [a[0], a[1], a[2]] as [number, number, number];
    this.info = {
      feet: m.feet.slice(), groundY: m.groundY,
      anchor: {
        position: [0, 0, 0], normal: t(m.anchor.normal), tangentFingers: t(m.anchor.tangentFingers), tangentAcross: t(m.anchor.tangentAcross),
        radiiM: { alongFingers: m.anchorRadii.alongFingersM, acrossKnuckles: m.anchorRadii.acrossKnucklesM },
      },
      bounds: new THREE.Box3(v3(m.bounds.min), v3(m.bounds.max)),
      headTop: v3(m.headTop), gaze: v3(m.gaze),
      manifest: m,
    };
    // the hair volume (centre, up through the crown) and the skin close-up's hand frame (as pose.ts HAND_FRAME, unturned)
    (this.u.uF2HeadC.value as THREE.Vector3).fromArray(m.headCentre);
    (this.u.uF2HeadUp.value as THREE.Vector3).fromArray(m.headTop).sub(this.u.uF2HeadC.value as THREE.Vector3).normalize();
    {
      const a = (-m.anchorRadii.principalAngleDeg * Math.PI) / 180;
      const tf = m.anchor.tangentFingers, ta = m.anchor.tangentAcross;
      const hx = (this.u.uF2HandX.value as THREE.Vector3).set(tf[0] * Math.cos(a) - ta[0] * Math.sin(a), 0, tf[2] * Math.cos(a) - ta[2] * Math.sin(a)).normalize();
      (this.u.uF2HandZ.value as THREE.Vector3).set(-hx.z, 0, hx.x);
    }
    await Promise.all([this.ensureGeo(this.geoKey()), this.ensureTex(this.texKey()), this.ensureMask()]);
    if (this.disposed) return this.info;
    this.apply();
    return this.info;
  }

  private geoKey(q = this.tier): GeoKey { return q === 'low' ? 'low' : 'high'; }
  private texKey(q = this.tier): TexKey { return q === 'high' ? 'h' : 'l'; }

  private ensureGeo(k: GeoKey): Promise<void> {
    if (this.geos.has(k)) return Promise.resolve();
    let p = this.geoLoading.get(k);
    if (p) return p;
    p = (async () => {
      const d = this.manifest!.tiers[k];
      const buf = await (await fetch(this.assetUrl(`human/figure/${d.file}`))).arrayBuffer();
      const mk = (g: GeoDesc) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Int16Array(buf, g.position, g.vertexCount * 3), 3, true));
        geo.setAttribute('aNrm', new THREE.BufferAttribute(new Int16Array(buf, g.normal, g.vertexCount * 2), 2, true));
        geo.setAttribute('aUv', new THREE.BufferAttribute(new Uint16Array(buf, g.uv, g.vertexCount * 2), 2, true));
        geo.setAttribute('aAux', new THREE.BufferAttribute(new Uint8Array(buf, g.aux, g.vertexCount * 4), 4, true));
        const idx = g.indexType === 'uint32' ? new Uint32Array(buf, g.index, g.indexCount) : new Uint16Array(buf, g.index, g.indexCount);
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        const b = this.info!.bounds;
        geo.boundingBox = b.clone();
        geo.boundingSphere = b.getBoundingSphere(new THREE.Sphere());
        return geo;
      };
      const parts = {} as Record<PartName, THREE.BufferGeometry>;
      for (const n of PARTS) parts[n] = mk(d.geometries[n]);
      if (this.disposed) { for (const g of Object.values(parts)) g.dispose(); return; }
      this.geos.set(k, { parts, quant: d.quant });
    })();
    this.geoLoading.set(k, p);
    return p;
  }

  private loadTex(file: string, srgb: boolean) {
    return new THREE.TextureLoader().loadAsync(this.assetUrl(`human/figure/${file}`)).then((tx) => {
      tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tx.flipY = false;
      tx.anisotropy = 4;
      tx.generateMipmaps = true;
      tx.minFilter = THREE.LinearMipmapLinearFilter;
      tx.needsUpdate = true;
      return tx;
    });
  }

  private ensureTex(k: TexKey): Promise<void> {
    if (this.texs.has(k)) return Promise.resolve();
    let p = this.texLoading.get(k);
    if (p) return p;
    p = (async () => {
      const [body, head, hair, bn, hn] = await Promise.all([
        this.loadTex(`body_${k}.jpg`, true), this.loadTex(`head_${k}.jpg`, true), this.loadTex(`hairc_${k}.webp`, true),
        this.loadTex(`bodyn_${k}.jpg`, false), this.loadTex(`headn_${k}.jpg`, false),
      ]);
      const set: TexSet = { col: { body, head, hair }, nrm: { body: bn, head: hn } };
      if (this.disposed) { for (const t of [body, head, hair, bn, hn]) t.dispose(); return; }
      this.texs.set(k, set);
    })();
    this.texLoading.set(k, p);
    return p;
  }

  private ensureMask(): Promise<void> {
    if (this.mask) return Promise.resolve();
    return this.loadTex('mask.png', false).then((t) => { if (this.disposed) t.dispose(); else this.mask = t; });
  }

  private makeMat(part: number, tex: TexSet, low: boolean, pass: 'opaque' | 'blend' | 'solid') {
    const o = this.opts;
    const defines: Record<string, string | number> = { ...(o.defines ?? {}), PART: part, NRM_STR: low ? '0.7' : '1.0' };
    if (low) defines.F2_LOW = '';
    if (pass === 'opaque' || pass === 'solid') defines.OPAQUE_PASS = '';
    const name = PARTS[part];
    const m = new THREE.ShaderMaterial({
      vertexShader: F2_COMMON + (o.prelude ?? '') + F2_VERT.replace('VERT_OUTRO', o.vertexOutro ?? ''),
      fragmentShader: F2_COMMON + (o.prelude ?? '') + F2_FRAG.replace('FRAG_OUTRO', o.fragmentOutro ?? '').replace(/}\s*$/, `${o.fragmentEnd ?? ''}\n}`),
      uniforms: {
        ...this.u, ...(o.uniforms ?? {}),
        tF2Col: { value: tex.col[name] },
        tF2Nrm: { value: name === 'hair' ? tex.nrm.head : tex.nrm[name] },
        tF2Mask: { value: this.mask },
      },
      defines,
      side: part === 2 ? THREE.DoubleSide : THREE.FrontSide,
      transparent: pass === 'blend',
      depthWrite: pass !== 'blend',
      // the hair cards' strands: alpha-to-coverage gives soft, depth-correct edges under MSAA
      alphaToCoverage: part === 2 && pass === 'opaque',
    });
    if (part === 2) {
      // never change the target's alpha (the compositor reads it as the layer's coverage): the A2C
      // pass replaces colour on its covered samples, the soft ends blend colour only
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = pass === 'blend' ? THREE.SrcAlphaFactor : THREE.OneFactor;
      m.blendDst = pass === 'blend' ? THREE.OneMinusSrcAlphaFactor : THREE.ZeroFactor;
      m.blendEquationAlpha = THREE.AddEquation;
      m.blendSrcAlpha = THREE.ZeroFactor;
      m.blendDstAlpha = THREE.OneFactor;
    }
    return m;
  }

  private apply() {
    const g = this.geos.get(this.geoKey());
    const tex = this.texs.get(this.texKey());
    if (!g || !tex || !this.mask) return;
    for (const mesh of this.meshes) this.group.remove(mesh);
    for (const m of this.mats) m.dispose();
    this.meshes = []; this.mats = [];
    const low = this.tier === 'low';
    (this.u.uF2QO.value as THREE.Vector3).fromArray(g.quant.offset);
    (this.u.uF2QS.value as THREE.Vector3).fromArray(g.quant.scale);
    const add = (part: number, pass: 'opaque' | 'blend' | 'solid', order: number) => {
      const mesh = new THREE.Mesh(g.parts[PARTS[part]], this.makeMat(part, tex, low, pass));
      mesh.renderOrder = order;
      this.meshes.push(mesh); this.mats.push(mesh.material as THREE.ShaderMaterial); this.group.add(mesh);
    };
    add(0, 'solid', 0);
    add(1, 'solid', 0);
    add(2, 'opaque', 1);
    // soft ends of the hair strands: blended over the head after everything opaque (no sorting needed:
    // the cards' solid parts already wrote depth, these fringes don't)
    add(2, 'blend', 9);
    this.buildShadowCaster();
  }

  /**
   * The sun depth map's caster: the same geometry as drawn (the low mesh's control cage lies outside
   * the subdivided surface and would shadow it in blotches). Re-rendered only when the light moves.
   */
  private buildShadowCaster() {
    const k = this.geoKey();
    if (this.casterKey === k) return;
    const g = this.geos.get(k), tex = this.texs.get(this.texKey());
    if (!g || !tex) return;
    this.shadowScene.clear();
    for (const m of this.shadowMats) m.dispose();
    this.shadowMats = [];
    for (const part of [0, 1, 2]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: F2_SHADOW_VERT, fragmentShader: F2_SHADOW_FRAG,
        uniforms: {
          uF2QO: { value: new THREE.Vector3().fromArray(g.quant.offset) }, uF2QS: { value: new THREE.Vector3().fromArray(g.quant.scale) },
          tF2Col: { value: tex.col.hair }, uAlphaTest: { value: part === 2 ? 0.5 : 0 },
        },
        side: THREE.DoubleSide, colorWrite: false,
      });
      this.shadowMats.push(mat);
      const mesh = new THREE.Mesh(g.parts[PARTS[part]], mat);
      mesh.frustumCulled = false;
      this.shadowScene.add(mesh);
    }
    this.casterKey = k;
    this.shadowReady = true;
    this.shadowDirty = true;
  }

  setTier(q: Figure2Tier) {
    if (q === this.tier) return;
    this.tier = q;
    if (!this.manifest) return;
    void Promise.all([this.ensureGeo(this.geoKey(q)), this.ensureTex(this.texKey(q))]).then(() => { if (!this.disposed && this.tier === q) this.apply(); });
  }

  /** Toggle a shader define on all current and future materials (e.g. the scene's NO_LOGZ). */
  setDefine(key: string, on: boolean) {
    const d = (this.opts.defines ??= {});
    if (on === key in d) return;
    if (on) d[key] = ''; else delete d[key];
    for (const m of this.mats) { if (on) m.defines[key] = ''; else delete m.defines[key]; m.needsUpdate = true; }
  }

  /** Turn the figure about the vertical through the origin (the anchor). yaw 0 faces +Z. */
  setYaw(yaw: number) { this.group.rotation.y = yaw; this.shadowDirty = true; }

  /** World direction towards the Sun (normalised) and optionally its radiance colour. */
  setSun(dir: THREE.Vector3, color?: THREE.Vector3) {
    this.sunWorld.copy(dir).normalize();
    (this.u.uF2Sun.value as THREE.Vector3).copy(this.sunWorld);
    if (color) (this.u.uF2SunCol.value as THREE.Vector3).copy(color);
    this.shadowDirty = true;
  }

  /** Sky zenith / horizon irradiance and the ground bounce colour (linear). */
  setSky(zenith: THREE.Vector3, horizon: THREE.Vector3, bounce: THREE.Vector3) {
    (this.u.uF2SkyZen.value as THREE.Vector3).copy(zenith);
    (this.u.uF2SkyHor.value as THREE.Vector3).copy(horizon);
    (this.u.uF2Bounce.value as THREE.Vector3).copy(bounce);
  }

  /** Albedo scale of the bare skin (to match a close-up skin layer). */
  setSkinTone(k: number) { this.u.uF2SkinTone.value = k; }

  /** Discard the figure's own surface within r (object units) of p (default the origin), for a close-up patch. */
  setHole(r: number, p?: THREE.Vector3) { const h = this.u.uF2Hole.value as THREE.Vector4; h.set(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0, r); }

  /** The self-shadow map, usable by receivers (object-space position → uF2ShadowMat → depth). */
  get shadow() { return { texture: this.shadowRT.depthTexture, matrix: this.u.uF2ShadowMat.value as THREE.Matrix4, on: this.u.uF2ShadowOn }; }

  /**
   * time: seconds. renderer: pass it so the self-shadow map is (re)rendered when the Sun or yaw has
   * changed (cheap; usually only once). (wind is accepted for interface compatibility; the baked
   * figure does not move.)
   */
  update(time: number, renderer?: THREE.WebGLRenderer, _wind?: number) {
    this.u.uF2Time.value = time;
    this.group.updateWorldMatrix(true, false);
    const rot = (this.u.uF2Rot.value as THREE.Matrix3).setFromMatrix4(this.tmpM4.extractRotation(this.group.matrixWorld));
    const inv = this.tmpM3.copy(rot).invert();
    const sunObj = this.tmpV.copy(this.sunWorld).applyMatrix3(inv).normalize();
    (this.u.uF2SunObj.value as THREE.Vector3).copy(sunObj);
    if (sunObj.distanceToSquared(this.lastSunObj) > 1e-8) this.shadowDirty = true;
    if (renderer && this.shadowDirty && this.shadowReady && this.info) this.renderShadow(renderer, sunObj);
  }

  private renderShadow(renderer: THREE.WebGLRenderer, sunObj: THREE.Vector3) {
    this.shadowDirty = false;
    this.lastSunObj.copy(sunObj);
    const b = this.info!.bounds;
    const c = b.getCenter(new THREE.Vector3());
    const r = b.getBoundingSphere(new THREE.Sphere()).radius * 1.02;
    const cam = this.shadowCam;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.01; cam.far = r * 2 + 0.02;
    cam.position.copy(c).addScaledVector(sunObj, r + 0.01);
    cam.up.set(0, 1, 0);
    if (Math.abs(sunObj.y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    (this.u.uF2ShadowMat.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.u.uF2ShadowTexel.value = (2 * r) / SHADOW_RES;
    this.u.uF2ShadowR.value = r;
    const prev = renderer.getRenderTarget();
    const ac = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.shadowRT);
    renderer.clear(true, true, false);
    renderer.render(this.shadowScene, cam);
    renderer.setRenderTarget(prev);
    renderer.autoClear = ac;
    this.u.uF2ShadowOn.value = 1;
  }

  dispose() {
    this.disposed = true;
    for (const m of this.mats) m.dispose();
    for (const m of this.shadowMats) m.dispose();
    for (const g of this.geos.values()) for (const p of Object.values(g.parts)) p.dispose();
    for (const t of this.texs.values()) { for (const x of Object.values(t.col)) x.dispose(); for (const x of Object.values(t.nrm)) x.dispose(); }
    this.mask?.dispose();
    this.shadowRT.dispose();
    this.shadowScene.clear();
    this.group.clear();
    this.meshes = []; this.mats = []; this.shadowMats = [];
    this.geos.clear(); this.texs.clear();
  }
}
