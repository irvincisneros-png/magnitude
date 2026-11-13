/**
 * Figure2: the person on the headland, baked offline from the CC0 MakeHuman base mesh
 * (tools/build-figure.mjs → public/assets/human/figure/). See CREDITS.md.
 *
 * Object frame: the anchor point on the back of the right hand (which rests flat on top of the hat)
 * is the origin, its surface normal is exactly +Y, 1 unit = 1.7 m and the person is 1 unit tall, so
 * the feet are ≈ 1.04 units below the origin. The figure faces +Z; turn it with setYaw() (about the
 * vertical through the origin, so the anchor stays put).
 *
 * Shading is self-contained (sun, sky hemisphere, ground bounce, baked AO, a self-shadow depth map
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
  hatCentre: THREE.Vector3;
  hatBrimRadius: number;
  gaze: THREE.Vector3;
  manifest: Manifest;
}

interface GeoDesc { vertexCount: number; indexCount: number; indexType: 'uint16' | 'uint32'; position: number; normal: number; attr: number; aux: number; index: number }
interface TierDesc { file: string; bytes: number; quant: { offset: number[]; scale: number[] }; geometries: { front: GeoDesc; double: GeoDesc } }
interface Manifest {
  tiers: { high: TierDesc; low: TierDesc };
  groundY: number; feet: number[];
  anchor: { normal: number[]; tangentFingers: number[]; tangentAcross: number[] };
  anchorRadii: { alongFingersM: number; acrossKnucklesM: number };
  headTop: number[]; headCentre: number[];
  hat: { centre: number[]; axis: number[]; brimRadius: number; crownHeight: number };
  gaze: number[];
  bounds: { min: number[]; max: number[] };
  metresToObjectScale: number;
}

const SHADOW_RES = 2048;
const DEFAULT_SUN = new THREE.Vector3(0.882, 0.375, -0.287).normalize();

export class Figure2 {
  readonly group = new THREE.Group();
  info: Figure2Info | null = null;
  private manifest: Manifest | null = null;
  private assetUrl: (p: string) => string = (p) => p;
  private tier: Figure2Tier = 'high';
  private loaded = new Map<'high' | 'low', { front: THREE.BufferGeometry; double: THREE.BufferGeometry; quant: TierDesc['quant'] }>();
  private loading = new Map<'high' | 'low', Promise<void>>();
  private meshes: THREE.Mesh[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private readonly u: Record<string, THREE.IUniform>;
  private sunWorld = DEFAULT_SUN.clone();
  private shadowDirty = true;
  private lastSunObj = new THREE.Vector3();
  private shadowRT: THREE.WebGLRenderTarget;
  private shadowScene = new THREE.Scene();
  private shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  private shadowMat: THREE.ShaderMaterial;
  private shadowMesh: THREE.Mesh | null = null;
  private disposed = false;

  constructor(private opts: Figure2Options = {}) {
    this.shadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, { depthBuffer: true });
    this.shadowRT.depthTexture = new THREE.DepthTexture(SHADOW_RES, SHADOW_RES, THREE.UnsignedIntType);
    this.shadowRT.depthTexture.minFilter = THREE.NearestFilter;
    this.shadowRT.depthTexture.magFilter = THREE.NearestFilter;
    this.u = {
      uF2QO: { value: new THREE.Vector3() }, uF2QS: { value: new THREE.Vector3(1, 1, 1) },
      uF2Time: { value: 0 }, uF2Wind: { value: 0.5 }, uF2Breath: { value: 0 },
      uF2M2O: { value: 1 / 1.7 },
      uF2Sun: { value: DEFAULT_SUN.clone() },
      uF2SunCol: { value: new THREE.Vector3(1.0, 0.84, 0.66).multiplyScalar(2.6) },
      uF2SkyZen: { value: new THREE.Vector3(0.11, 0.21, 0.42) },
      uF2SkyHor: { value: new THREE.Vector3(0.38, 0.43, 0.5) },
      uF2Bounce: { value: new THREE.Vector3(0.3, 0.24, 0.17) },
      uF2SunObj: { value: DEFAULT_SUN.clone() },
      uF2WindObj: { value: new THREE.Vector3(-1, 0, 0) },
      uF2Hole: { value: new THREE.Vector4(0, 0, 0, 0) },
      uF2HatC: { value: new THREE.Vector3() }, uF2HatA: { value: new THREE.Vector3(0, 1, 0) }, uF2HeadTop: { value: new THREE.Vector3() },
      uF2Shadow: { value: this.shadowRT.depthTexture }, uF2ShadowMat: { value: new THREE.Matrix4() }, uF2ShadowOn: { value: 0 },
      uF2ShadowTexel: { value: 0.002 }, uF2ShadowR: { value: 1 },
      uF2Rot: { value: new THREE.Matrix3() },
    };
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: F2_SHADOW_VERT, fragmentShader: F2_SHADOW_FRAG,
      uniforms: { uF2QO: { value: new THREE.Vector3() }, uF2QS: { value: new THREE.Vector3(1, 1, 1) } },
      side: THREE.DoubleSide, colorWrite: false,
    });
    this.group.name = 'figure2';
  }

  /** Load the manifest and the current tier's mesh. assetUrl maps 'human/figure/x' to a URL. */
  async load(assetUrl: (p: string) => string): Promise<Figure2Info> {
    this.assetUrl = assetUrl;
    const m = (await (await fetch(assetUrl('human/figure/figure.json'))).json()) as Manifest;
    this.manifest = m;
    const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
    this.u.uF2M2O.value = m.metresToObjectScale;
    (this.u.uF2HatC.value as THREE.Vector3).copy(v3(m.hat.centre));
    (this.u.uF2HatA.value as THREE.Vector3).copy(v3(m.hat.axis));
    (this.u.uF2HeadTop.value as THREE.Vector3).copy(v3(m.headCentre)).add(new THREE.Vector3(0, 0.03, 0));
    const t = (a: number[]) => [a[0], a[1], a[2]] as [number, number, number];
    this.info = {
      feet: m.feet.slice(), groundY: m.groundY,
      anchor: {
        position: [0, 0, 0], normal: t(m.anchor.normal), tangentFingers: t(m.anchor.tangentFingers), tangentAcross: t(m.anchor.tangentAcross),
        radiiM: { alongFingers: m.anchorRadii.alongFingersM, acrossKnuckles: m.anchorRadii.acrossKnucklesM },
      },
      bounds: new THREE.Box3(v3(m.bounds.min), v3(m.bounds.max)),
      headTop: v3(m.headTop), hatCentre: v3(m.hat.centre), hatBrimRadius: m.hat.brimRadius, gaze: v3(m.gaze),
      manifest: m,
    };
    await this.ensure(this.tier === 'low' ? 'low' : 'high');
    if (this.disposed) return this.info;
    this.apply();
    return this.info;
  }

  private ensure(k: 'high' | 'low'): Promise<void> {
    if (this.loaded.has(k)) return Promise.resolve();
    let p = this.loading.get(k);
    if (p) return p;
    p = (async () => {
      const d = this.manifest!.tiers[k];
      const buf = await (await fetch(this.assetUrl(`human/figure/${d.file}`))).arrayBuffer();
      const mk = (g: GeoDesc) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Int16Array(buf, g.position, g.vertexCount * 3), 3, true));
        geo.setAttribute('aNrm', new THREE.BufferAttribute(new Int16Array(buf, g.normal, g.vertexCount * 2), 2, true));
        geo.setAttribute('aAttr', new THREE.BufferAttribute(new Uint8Array(buf, g.attr, g.vertexCount * 4), 4, true));
        geo.setAttribute('aAux', new THREE.BufferAttribute(new Uint8Array(buf, g.aux, g.vertexCount * 4), 4, true));
        const idx = g.indexType === 'uint32' ? new Uint32Array(buf, g.index, g.indexCount) : new Uint16Array(buf, g.index, g.indexCount);
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        const b = this.info!.bounds;
        geo.boundingBox = b.clone();
        geo.boundingSphere = b.getBoundingSphere(new THREE.Sphere());
        return geo;
      };
      this.loaded.set(k, { front: mk(d.geometries.front), double: mk(d.geometries.double), quant: d.quant });
    })();
    this.loading.set(k, p);
    return p;
  }

  private makeMat(side: THREE.Side, low: boolean) {
    const o = this.opts;
    const defines: Record<string, string> = { ...(o.defines ?? {}) };
    if (low) defines.F2_LOW = '';
    const m = new THREE.ShaderMaterial({
      vertexShader: F2_COMMON + (o.prelude ?? '') + F2_VERT.replace('VERT_OUTRO', o.vertexOutro ?? ''),
      fragmentShader: F2_COMMON + (o.prelude ?? '') + F2_FRAG.replace('FRAG_OUTRO', o.fragmentOutro ?? ''),
      uniforms: { ...this.u, ...(o.uniforms ?? {}) },
      defines, side,
    });
    return m;
  }

  private apply() {
    const k = this.tier === 'low' ? 'low' : 'high';
    const t = this.loaded.get(k);
    if (!t) return;
    for (const mesh of this.meshes) this.group.remove(mesh);
    for (const m of this.mats) m.dispose();
    this.meshes = []; this.mats = [];
    const low = this.tier === 'low';
    (this.u.uF2QO.value as THREE.Vector3).fromArray(t.quant.offset);
    (this.u.uF2QS.value as THREE.Vector3).fromArray(t.quant.scale);
    const front = new THREE.Mesh(t.front, this.makeMat(THREE.FrontSide, low));
    const dbl = new THREE.Mesh(t.double, this.makeMat(THREE.DoubleSide, low));
    for (const mesh of [front, dbl]) { mesh.frustumCulled = true; this.meshes.push(mesh); this.mats.push(mesh.material as THREE.ShaderMaterial); this.group.add(mesh); }
    // the shadow caster is always the low mesh (cheap; the map is only re-rendered when the light moves)
    void this.ensure('low').then(() => {
      if (this.disposed) return;
      const lo = this.loaded.get('low')!;
      (this.shadowMat.uniforms.uF2QO.value as THREE.Vector3).fromArray(lo.quant.offset);
      (this.shadowMat.uniforms.uF2QS.value as THREE.Vector3).fromArray(lo.quant.scale);
      if (!this.shadowMesh) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(lo.front, this.shadowMat), new THREE.Mesh(lo.double, this.shadowMat));
        for (const c of g.children) c.frustumCulled = false;
        this.shadowScene.add(g);
        this.shadowMesh = g.children[0] as THREE.Mesh;
      }
      this.shadowDirty = true;
    });
  }

  setTier(q: Figure2Tier) {
    if (q === this.tier) return;
    this.tier = q;
    if (!this.manifest) return;
    void this.ensure(q === 'low' ? 'low' : 'high').then(() => { if (!this.disposed && this.tier === q) this.apply(); });
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

  /** Discard the figure's own surface within r (object units) of p (default the origin), for a close-up patch. */
  setHole(r: number, p?: THREE.Vector3) { const h = this.u.uF2Hole.value as THREE.Vector4; h.set(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0, r); }

  /** The self-shadow map, usable by receivers (object-space position → uF2ShadowMat → depth). */
  get shadow() { return { texture: this.shadowRT.depthTexture, matrix: this.u.uF2ShadowMat.value as THREE.Matrix4, on: this.u.uF2ShadowOn }; }

  /**
   * time: seconds. renderer: pass it so the self-shadow map is (re)rendered when the Sun or yaw has
   * changed (cheap; usually only once). wind: 0..1 breeze strength; windDir: world direction it blows to.
   */
  update(time: number, renderer?: THREE.WebGLRenderer, wind = 0.5 + 0.5 * Math.sin(time * 0.13) * Math.sin(time * 0.071 + 1.3), windDir?: THREE.Vector3) {
    this.u.uF2Time.value = time;
    this.u.uF2Wind.value = wind;
    this.u.uF2Breath.value = Math.sin((time * 2 * Math.PI) / 4.3) * 0.5 + 0.5;
    this.group.updateWorldMatrix(true, false);
    const rot = (this.u.uF2Rot.value as THREE.Matrix3).setFromMatrix4(new THREE.Matrix4().extractRotation(this.group.matrixWorld));
    const inv = rot.clone().invert();
    const sunObj = this.sunWorld.clone().applyMatrix3(inv).normalize();
    (this.u.uF2SunObj.value as THREE.Vector3).copy(sunObj);
    const wd = (windDir ?? new THREE.Vector3(-this.sunWorld.x, 0, -this.sunWorld.z)).clone().applyMatrix3(inv);
    wd.y = 0;
    (this.u.uF2WindObj.value as THREE.Vector3).copy(wd.lengthSq() > 1e-8 ? wd.normalize() : new THREE.Vector3(-1, 0, 0));
    if (sunObj.distanceToSquared(this.lastSunObj) > 1e-8) this.shadowDirty = true;
    if (renderer && this.shadowDirty && this.shadowMesh && this.info) this.renderShadow(renderer, sunObj);
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
    for (const t of this.loaded.values()) { t.front.dispose(); t.double.dispose(); }
    this.shadowMat.dispose();
    this.shadowRT.dispose();
    this.group.clear();
  }
}
