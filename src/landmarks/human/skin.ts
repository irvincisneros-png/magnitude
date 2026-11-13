/**
 * Skin close-up: a displaced patch that follows the exact palm surface around the origin (true
 * relief of dead-cell plates, furrows and pores, visible in silhouette under raking sunlight),
 * and the hairs on the back of the hand and forearm (instanced, tapering, view-facing ribbons
 * shaded as cylinders, rooted in the same follicles the skin shader draws).
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON, type Shared } from './glsl';
import { SKIN } from './skinGlsl';
import { PALM } from './pose';
import { acquireSkinTextures, releaseSkinTextures } from './skinTex';

const ELL = /* glsl */ `
const vec3 PALM_R = vec3(${PALM.map((v) => v.toFixed(5)).join(', ')});
float palmY(vec2 xz) {
  float q = 1.0 - (xz.x * xz.x) / (PALM_R.x * PALM_R.x) - (xz.y * xz.y) / (PALM_R.z * PALM_R.z);
  return -PALM_R.y + PALM_R.y * sqrt(max(q, 0.0));
}
vec3 palmN(vec3 p) { return normalize(vec3(p.x / (PALM_R.x * PALM_R.x), (p.y + PALM_R.y) / (PALM_R.y * PALM_R.y), p.z / (PALM_R.z * PALM_R.z))); }
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
`;

const patchVert = /* glsl */ `
${COMMON}
${SKIN}
${ELL}
uniform float uRmin; uniform float uRmax; uniform float uRings;
varying vec3 vP; varying vec3 vPH; varying float vR;
LOGZ_VARY
void main() {
  float i = position.x, a = position.y;
  float rho = i < 0.5 ? 0.0 : uRmin * pow(uRmax / uRmin, (i - 1.0) / (uRings - 1.0));
  vec2 xz = rho * vec2(cos(a), sin(a));
  float y = palmY(xz);
  float spacing = max(rho * 0.045, uRmin);
  gMacro = 0.0;
  SkinS s = skin(xz, spacing * 1.5);
  float fade = 1.0 - smoothstep(0.4, 0.64, rho / uRmax);
  vec3 p = vec3(xz.x, y, xz.y) + palmN(vec3(xz.x, y, xz.y)) * s.h * fade; // hand frame
  vPH = p; vR = rho / uRmax;
  p = uFigRot * p;
  vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const patchFrag = /* glsl */ `
${COMMON}
${SKIN}
${ELL}
varying vec3 vP; varying vec3 vPH; varying float vR;
LOGZ_VARY
void main() {
  vec3 p = vP;
  vec3 ph = vPH;
  vec3 v = normalize(uCamM - p);
  float fp = max(length(dFdx(p)), length(dFdy(p)));
  SkinS s = skin(ph.xz, fp);
  vec3 n = uFigRot * normalize(palmN(ph) - vec3(s.g.x, 0.0, s.g.y));
  vec3 col;
  if (gl_FrontFacing) {
    vec3 alb = skinAlbedo(ph.xz, s, fp);
    // lifted flakes are thin, so light passes through their edges
    float ao = 1.0 - s.cav * 0.35;
    col = skinShade(alb, n, v, 1.0, ao, s.flake * 0.5, s.cav, 1.0);
    col += vec3(0.9, 0.75, 0.6) * uSunCol * s.flake * 0.06 * pow(max(dot(v, -uSun) * 0.5 + 0.5, 1e-6), 2.0);
  } else {
    // seen from inside the skin: daylight scattering through the epidermis
    float g = 0.5 + 0.5 * sin(p.x * 9000.0 + vnoise(p.xz * 3000.0) * 3.0) * sin(p.z * 8000.0);
    col = vec3(0.36, 0.1, 0.065) * uSunCol * (0.12 + 0.05 * g + 0.06 * (1.0 - s.cav));
  }
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

const hairVert = /* glsl */ `
${COMMON}
attribute vec3 aRoot; attribute vec3 aN; attribute vec3 aDir; attribute vec2 aLS;
varying vec3 vP; varying vec3 vT; varying vec3 vS; varying vec3 vB; varying float vSide; varying float vU; varying float vA;
LOGZ_VARY
void main() {
  float t = position.x, side = position.y;
  float L = aLS.x, seed = aLS.y;
  vec3 n = aN, d = aDir, b = normalize(cross(n, d));
  float curl = (fract(seed * 7.13) - 0.5) * 0.7;
  float rise = 0.26 + 0.12 * fract(seed * 3.7);
  float ex = exp(-2.6 * t);
  vec3 c = aRoot - n * 25e-6 + d * L * t + n * L * rise * (1.0 - ex) + b * L * curl * t * t;
  vec3 tang = d * L + n * L * rise * 2.6 * ex + b * L * curl * 2.0 * t;
  // the breeze lifts and sways the tips
  float sw = sin(uTime * 2.1 + seed * 40.0 + aRoot.x * 300.0) * 0.5 + sin(uTime * 3.7 + seed * 13.0) * 0.3;
  c += (n * 0.5 + b * 0.8) * L * 0.07 * t * t * sw * (0.5 + uWind);
  vec3 T = normalize(tang);
  vec3 vd = normalize(uCamM - c);
  vec3 S = normalize(cross(T, vd));
  float w = 72e-6 * (0.72 + 0.56 * fract(seed * 5.3)) * mix(1.0, 0.22, pow(max(t, 1e-6), 1.6));
  float px = length(uCamM - c) * uPx;
  float wEff = max(w, px * 1.25);
  c += S * side * wEff * 0.5;
  vA = w / wEff;
  vP = c; vT = T; vS = S; vB = normalize(cross(S, T)); vSide = side; vU = t;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const hairFrag = /* glsl */ `
${COMMON}
uniform float uFade;
varying vec3 vP; varying vec3 vT; varying vec3 vS; varying vec3 vB; varying float vSide; varying float vU; varying float vA;
LOGZ_VARY
void main() {
  float sd = vSide;
  vec3 n = normalize(vS * sd + vB * sqrt(max(1.0 - sd * sd, 0.0)));
  if (dot(n, uCamM - vP) < 0.0) n = -n;
  vec3 v = normalize(uCamM - vP);
  vec3 L = uSun;
  vec3 T = normalize(vT);
  // cuticle scales: tiny steps along the shaft, visible only very close
  float cut = fract(dot(vP, T) / 9e-6 + sd * 0.3);
  vec3 alb = mix(vec3(0.05, 0.03, 0.019), vec3(0.11, 0.075, 0.05), smoothstep(0.4, 1.0, vU));
  float ndl = dot(n, L);
  vec3 col = alb * uSunCol * clamp(ndl * 0.6 + 0.4, 0.0, 1.0) + alb * skyIrr(n) * 1.2;
  vec3 h = normalize(L + v);
  float th = dot(T, h);
  float s1 = pow(sqrt(max(1.0 - th * th, 1e-12)), 70.0);
  vec3 T2 = normalize(T + n * 0.15);
  float th2 = dot(T2, h);
  float s2 = pow(sqrt(max(1.0 - th2 * th2, 1e-12)), 18.0);
  col += uSunCol * (s1 * 0.22 * (0.85 + 0.3 * cut) + s2 * vec3(0.45, 0.25, 0.12) * 0.25);
  // sunlight through the shaft when backlit: the classic golden rim on hairs
  col += uSunCol * vec3(0.8, 0.45, 0.2) * pow(max(dot(v, -L), 1e-6), 4.0) * 0.14;
  col = aerial(col, vP);
  float edge = 1.0 - smoothstep(0.75, 1.0, abs(sd));
  float a = vA * mix(1.0, edge, vA) * uFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  LOGZ_FRAG
}`;

const TIER = {
  low: { rings: 80, segs: 80, hairStep: 3 },
  medium: { rings: 120, segs: 120, hairStep: 2 },
  high: { rings: 140, segs: 140, hairStep: 1 },
};

export class Skin {
  readonly group = new THREE.Group();
  private patchMat: THREE.ShaderMaterial;
  private hairMat: THREE.ShaderMaterial;
  private patch?: THREE.Mesh;
  private hairs?: THREE.Mesh;
  private hairData: Float32Array | null = null;
  private tier: Quality = 'high';

  private tex = acquireSkinTextures();

  constructor(shared: Shared) {
    this.patchMat = new THREE.ShaderMaterial({
      vertexShader: patchVert, fragmentShader: patchFrag, side: THREE.DoubleSide,
      uniforms: { ...shared, uRmin: { value: 1e-6 }, uRmax: { value: 0.01 }, uRings: { value: 100 }, tCells: { value: this.tex.cells }, tPlat: { value: this.tex.plat } },
    });
    this.hairMat = new THREE.ShaderMaterial({
      vertexShader: hairVert, fragmentShader: hairFrag, side: THREE.DoubleSide,
      transparent: true, depthWrite: false,
      uniforms: { ...shared, uFade: { value: 1 } },
    });
  }

  setHairs(data: Float32Array) { this.hairData = data; this.build(this.tier); }

  build(q: Quality) {
    this.tier = q;
    const cfg = TIER[q];
    if (this.patch) { this.group.remove(this.patch); this.patch.geometry.dispose(); }
    // polar grid: ring index (x) and angle (y); the vertex shader places the rings exponentially
    const pos: number[] = [];
    const idx: number[] = [];
    pos.push(0, 0, 0);
    for (let i = 1; i <= cfg.rings; i++) for (let j = 0; j < cfg.segs; j++) pos.push(i, (j / cfg.segs) * Math.PI * 2, 0);
    for (let j = 0; j < cfg.segs; j++) idx.push(0, 1 + ((j + 1) % cfg.segs), 1 + j);
    for (let i = 1; i < cfg.rings; i++) for (let j = 0; j < cfg.segs; j++) {
      const a = 1 + (i - 1) * cfg.segs + j, b = 1 + (i - 1) * cfg.segs + ((j + 1) % cfg.segs);
      const c = a + cfg.segs, d = b + cfg.segs;
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.patch = new THREE.Mesh(g, this.patchMat);
    this.patch.frustumCulled = false;
    this.patch.renderOrder = 2; // nearest: drawn first so the hand behind it is depth-rejected
    this.patchMat.uniforms.uRings.value = cfg.rings;
    this.group.add(this.patch);

    if (this.hairs) { this.group.remove(this.hairs); this.hairs.geometry.dispose(); this.hairs = undefined; }
    if (!this.hairData) return;
    const SEG = 10;
    const base: number[] = [];
    const bi: number[] = [];
    for (let i = 0; i <= SEG; i++) base.push(i / SEG, -1, 0, i / SEG, 1, 0);
    for (let i = 0; i < SEG; i++) { const a = i * 2; bi.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const hg = new THREE.InstancedBufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
    hg.setIndex(bi);
    const n = Math.floor(this.hairData.length / 11 / cfg.hairStep);
    const R = new Float32Array(n * 3), N = new Float32Array(n * 3), D = new Float32Array(n * 3), LS = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const o = k * cfg.hairStep * 11;
      const h = this.hairData;
      R.set([h[o], h[o + 1], h[o + 2]], k * 3);
      N.set([h[o + 3], h[o + 4], h[o + 5]], k * 3);
      D.set([h[o + 6], h[o + 7], h[o + 8]], k * 3);
      LS.set([h[o + 9], h[o + 10]], k * 2);
    }
    hg.setAttribute('aRoot', new THREE.InstancedBufferAttribute(R, 3));
    hg.setAttribute('aN', new THREE.InstancedBufferAttribute(N, 3));
    hg.setAttribute('aDir', new THREE.InstancedBufferAttribute(D, 3));
    hg.setAttribute('aLS', new THREE.InstancedBufferAttribute(LS, 2));
    hg.instanceCount = n;
    this.hairs = new THREE.Mesh(hg, this.hairMat);
    this.hairs.frustumCulled = false;
    this.hairs.renderOrder = 6;
    this.group.add(this.hairs);
  }

  setLogDepth(on: boolean) {
    for (const m of [this.patchMat, this.hairMat]) {
      if (on === !('NO_LOGZ' in m.defines)) continue;
      if (on) delete m.defines.NO_LOGZ; else m.defines.NO_LOGZ = '';
      m.needsUpdate = true;
    }
  }

  /** viewM: view height in metres. Returns the patch radius (0 when hidden) for the hand mesh. */
  update(zoom: number, viewM: number): number {
    const on = zoom < -1.8;
    let R = 0;
    if (this.patch) {
      this.patch.visible = on;
      if (on) {
        R = Math.min(0.012, viewM * 12);
        this.patchMat.uniforms.uRmax.value = R;
        this.patchMat.uniforms.uRmin.value = Math.min(viewM * 0.0025, R * 0.01);
      }
    }
    if (this.hairs) {
      const f = 1 - THREE.MathUtils.smoothstep(zoom, -1.15, -0.6);
      this.hairMat.uniforms.uFade.value = f;
      this.hairs.visible = f > 0.002;
    }
    return R;
  }

  dispose() {
    this.patch?.geometry.dispose();
    this.hairs?.geometry.dispose();
    this.patchMat.dispose();
    this.hairMat.dispose();
    releaseSkinTextures();
  }
}
