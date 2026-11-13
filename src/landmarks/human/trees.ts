/**
 * Vegetation placed from OpenStreetMap land cover (tools/build-woonona.mjs and the cover maps):
 * coastal dune scrub (coastal wattle, banksia, tea-tree) on the foredune, garden and street trees
 * between the houses, eucalypts in the reserves, spinifex / marram tussocks along the ragged edge
 * where the scrub meets the sand, and the Norfolk Island pines that line Illawarra foreshore parks.
 *
 * Crowns are clusters of camera-facing leaf cards, alpha-tested with mipmapped noise, so the
 * silhouettes are broken and leafy; each card carries a volumetric normal and an ambient-occlusion
 * term from its depth inside the crown, and the crowns lean away from the onshore wind. Pines are a
 * tapered trunk with whorls of upswept branches, each branch two crossed foliage cards. Soft contact
 * shadows under the plants nearest the person are multiplied onto the ground. All instanced:
 * crowns (far and near templates), pines, tussocks and shadows are one draw call each.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON, FRAME, MAP_O, NOISE_T, type Shared } from './glsl';
import { coverAt, siteHeight, type SiteData } from './siteData';
import type { SiteTextures } from './siteTex';

// ------------------------------------------------------------------ crowns (leaf-card clusters)
const crownVert = /* glsl */ `
${COMMON}
attribute vec4 aT;    // x, y (ground), z, height
attribute vec3 aR;    // radius, kind (0 garden tree, 1 dune shrub, 3 eucalypt), seed
attribute vec4 aCard; // card centre in the unit crown (x, y, z ∈ [−1, 1]), size; size < 0 → trunk
attribute vec3 aCorner; // corner u, v (±1), card seed
uniform float uShow;
varying vec3 vP; varying vec3 vN; varying vec2 vUV; varying float vKind; varying float vSeed; varying float vAO; varying float vTop; varying float vTrunk;
LOGZ_VARY
void main() {
  float H = aT.w * uShow, R = aR.x, kind = aR.y, seed = aR.z;
  vec3 cc = aCard.xyz;
  // crown envelope per kind: dune shrubs are low, wide and sheared landward by the onshore wind
  float base = kind > 0.5 && kind < 1.5 ? 0.05 : kind > 2.5 ? 0.42 : 0.22;
  float ry = (1.0 - base) * 0.5 * H;
  float a = seed * 6.2832, ca = cos(a), sa = sin(a);
  vec3 lc = vec3(cc.x * R, (base * H + ry) + cc.y * ry, cc.z * R);
  lc.xz = vec2(lc.x * ca - lc.z * sa, lc.x * sa + lc.z * ca);
  float shear = kind > 0.5 && kind < 1.5 ? 0.35 : 0.08;
  lc.x -= shear * R * (cc.y * 0.5 + 0.5); // leaning west, away from the sea
  vec3 c = aT.xyz + lc;
  // wind: tops sway more
  float sw = sin(uTime * 1.3 + seed * 40.0 + aCorner.z * 6.0) * 0.5 + sin(uTime * 2.3 + seed * 13.0) * 0.25;
  c.xz += vec2(-0.6, 0.2) * sw * 0.025 * R * (cc.y * 0.5 + 0.7) * (0.6 + uWind);
  vec3 vd = normalize(uCamM - c);
  vec3 p, n;
  if (aCard.w < 0.0) {
    // trunk: a thin camera-facing strip from the ground into the crown
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), vd));
    float tr = kind > 2.5 ? 0.16 + H * 0.012 : 0.1 + H * 0.008;
    p = aT.xyz + vec3(0.0, (aCorner.y * 0.5 + 0.5) * (base * H + ry * 0.6), 0.0) + rt * aCorner.x * tr;
    n = normalize(rt * aCorner.x + vd * 0.6);
    vAO = 0.5; vTop = 0.0; vTrunk = 1.0;
  } else {
    float s = R * aCard.w;
    float ang = aCorner.z * 6.2832;
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), vd));
    vec3 up = cross(vd, rt);
    vec2 uv = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * aCorner.xy;
    p = c + (rt * uv.x + up * uv.y * 0.85) * s;
    // volumetric normal: outwards from the crown's centre, bent a little towards the card corner
    vec3 rad = vec3(cc.x, cc.y * 0.9 + 0.25, cc.z);
    rad.xz = vec2(rad.x * ca - rad.z * sa, rad.x * sa + rad.z * ca);
    n = normalize(rad + (rt * uv.x + up * uv.y) * 0.45 + vec3(0.0, 0.15, 0.0));
    float depth = length(cc);
    vAO = mix(0.35, 1.0, smoothstep(0.2, 0.95, depth)) * mix(0.75, 1.0, cc.y * 0.5 + 0.5);
    vTop = cc.y * 0.5 + 0.5; vTrunk = 0.0;
  }
  vUV = aCorner.xy; vKind = kind; vSeed = fract(seed * 7.31 + aCorner.z);
  vP = p; vN = n;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const crownFrag = /* glsl */ `
${COMMON}
${NOISE_T}
varying vec3 vP; varying vec3 vN; varying vec2 vUV; varying float vKind; varying float vSeed; varying float vAO; varying float vTop; varying float vTrunk;
LOGZ_VARY
void main() {
  vec3 alb;
  float leafN = 0.5;
  if (vTrunk > 0.5) {
    alb = vKind > 2.5 ? vec3(0.3, 0.27, 0.23) : vec3(0.08, 0.065, 0.05);
  } else {
    // broken, leafy silhouette: lobes, leaf clusters and twig-scale holes from mipmapped noise
    vec2 o = vec2(vSeed * 37.0, vSeed * 91.0);
    float lobes = vnoiseT(vUV * 2.4 + o);
    leafN = vnoiseT(vUV * 11.0 + o * 1.7);
    float twig = vnoiseT(vUV * 26.0 + o * 0.3);
    float r2 = dot(vUV, vUV);
    float a = 1.05 - r2 + (lobes - 0.5) * 0.9 + (leafN - 0.5) * 0.6 + (twig - 0.5) * 0.45;
    if (a < 0.42) discard;
    float k = vSeed;
    if (vKind > 0.5 && vKind < 1.5) {
      // dune scrub: olive coastal wattle, grey-green banksia and tea-tree, a few dry tips
      alb = mix(vec3(0.03, 0.045, 0.018), vec3(0.065, 0.075, 0.045), smoothstep(0.3, 0.8, k));
      alb = mix(alb, vec3(0.022, 0.035, 0.015), smoothstep(0.75, 0.95, fract(k * 5.3)));
      alb = mix(alb, vec3(0.14, 0.12, 0.065), smoothstep(0.7, 0.85, twig) * vTop * vTop * 0.5);
    } else if (vKind > 2.5) {
      alb = mix(vec3(0.045, 0.055, 0.035), vec3(0.075, 0.08, 0.055), k); // eucalypt: grey-olive
    } else {
      alb = mix(vec3(0.03, 0.055, 0.02), vec3(0.065, 0.085, 0.03), k); // garden and street trees
    }
    // each leaf cluster lit on its upper side, shaded underneath
    alb *= 0.55 + 0.9 * leafN * (0.6 + 0.4 * twig);
  }
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  vec3 n = normalize(vN);
  float ao = vAO * (0.7 + 0.6 * leafN);
  float ndl = dot(n, uSun);
  vec3 col = alb * uSunCol * clamp((ndl + 0.15) / 1.15, 0.0, 1.0) * ao * ao;
  col += alb * skyIrr(n) * 1.15 * ao;
  // sunlight through the leaves at the crown's edge
  col += vec3(0.07, 0.11, 0.02) * uSunCol * pow(max(dot(v, -uSun), 1e-6), 4.0) * 0.35 * (1.0 - vTrunk) * smoothstep(0.4, 0.8, leafN);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

/** Unit crown: `cards` leaf cards spread through an ellipsoid (denser near the surface) + a trunk strip. */
function crownTemplate(cards: number) {
  const card: number[] = [], corner: number[] = [], idx: number[] = [];
  let seed = 1234;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const quad = (cx: number, cy: number, cz: number, size: number, cs: number) => {
    const o = card.length / 4;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { card.push(cx, cy, cz, size); corner.push(u, v, cs); }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  for (let i = 0; i < cards; i++) {
    // golden-spiral directions, pushed towards the surface
    const t = (i + 0.5) / cards, y = 1 - 2 * t, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const d = cards <= 6 ? 0.45 + 0.2 * rnd() : 0.55 + 0.4 * Math.sqrt(rnd());
    quad(Math.cos(a) * r * d, y * d * 0.9, Math.sin(a) * r * d, cards <= 6 ? 0.85 + 0.25 * rnd() : 0.55 + 0.3 * rnd(), rnd());
  }
  quad(0, 0, 0, -1, 0); // trunk
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((card.length / 4) * 3), 3));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(card, 4));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ Norfolk Island pines
const pineVert = /* glsl */ `
${COMMON}
attribute vec4 aT; attribute vec3 aR;
attribute vec4 aPine; // whorl t (−1 trunk), branch angle, card (0 flat, 1 hanging), length jitter
attribute vec2 aUV;   // along the branch 0..1, across −1..1 (trunk: angle, height)
uniform float uShow;
varying vec3 vP; varying vec3 vN; varying vec2 vUV; varying float vT; varying float vTrunk; varying float vSeed;
LOGZ_VARY
void main() {
  float H = aT.w * uShow, R = aR.x, seed = aR.z;
  vec3 p, n;
  float rot = seed * 6.2832;
  if (aPine.x < 0.0) {
    float y = aUV.y;
    float tr = (0.22 + H * 0.009) * (1.0 - 0.85 * y);
    float a = aUV.x + rot;
    p = vec3(cos(a) * tr, y * H, sin(a) * tr);
    n = vec3(cos(a), 0.0, sin(a));
    vTrunk = 1.0; vT = y;
  } else {
    float t = aPine.x;
    float a = aPine.y + rot + t * 3.0;
    float y0 = mix(0.3, 0.985, t) * H;
    // branches: long and nearly level below, short and upswept near the top; lower whorls sparse
    float L = (R * pow(1.0 - t, 0.75) * 0.92 + 0.35) * aPine.w;
    vec3 dir = normalize(vec3(cos(a), 0.12 + 0.55 * t, sin(a)));
    float u = aUV.x, v = aUV.y;
    vec3 side = normalize(vec3(-sin(a), 0.0, cos(a)));
    float w = (0.55 + 0.5 * (1.0 - t)) * (1.0 - 0.55 * u);
    vec3 axis = vec3(0.0, y0, 0.0) + dir * (0.15 + u * L) + vec3(0.0, u * u * L * 0.12, 0.0); // tips turn up
    if (aPine.z < 0.5) { p = axis + side * v * w; n = normalize(vec3(0.0, 1.0, 0.0) + dir * 0.5); }
    else { p = axis + vec3(0.0, -1.0, 0.0) * (v * 0.5 + 0.5) * w * 0.9; n = normalize(side * sign(v + 0.001) * 0.3 + dir * 0.6 + vec3(0.0, 0.5, 0.0)); }
    // the breeze moves the branch tips
    p += vec3(-0.6, 0.0, 0.2) * sin(uTime * 1.1 + seed * 30.0 + t * 7.0) * 0.06 * u * u;
    vTrunk = 0.0; vT = t;
  }
  vUV = aUV; vSeed = fract(seed * 13.1 + aPine.y);
  p += aT.xyz;
  vP = p; vN = n;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;
const pineFrag = /* glsl */ `
${COMMON}
${NOISE_T}
varying vec3 vP; varying vec3 vN; varying vec2 vUV; varying float vT; varying float vTrunk; varying float vSeed;
LOGZ_VARY
void main() {
  vec3 alb; float leafN = 0.5;
  if (vTrunk > 0.5) {
    alb = vec3(0.12, 0.1, 0.085) * (0.8 + 0.4 * vnoiseT(vec2(vUV.x * 3.0, vUV.y * 40.0)));
  } else {
    // cord-like branchlets: dense along the branch, ragged at the edges and the tip
    float u = vUV.x, v = vUV.y;
    leafN = vnoiseT(vec2(u * 9.0 + vSeed * 30.0, v * 2.2));
    float strands = vnoiseT(vec2(u * 26.0 + vSeed * 50.0, v * 0.6 + vSeed * 9.0));
    float a = 1.0 - v * v * 0.8 - smoothstep(0.75, 1.0, u) * 0.7 + (leafN - 0.5) * 0.8 + (strands - 0.5) * 0.6;
    if (a < 0.45) discard;
    alb = mix(vec3(0.03, 0.06, 0.03), vec3(0.06, 0.1, 0.045), leafN) * (0.75 + 0.5 * strands);
    alb = mix(alb, vec3(0.08, 0.12, 0.05), smoothstep(0.6, 1.0, u) * 0.6); // fresh growth at the tips
  }
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  vec3 n = normalize(vN);
  float ao = vTrunk > 0.5 ? 0.6 : mix(0.45, 1.0, smoothstep(0.0, 0.7, vUV.x)) * (0.8 + 0.4 * leafN);
  float ndl = dot(n, uSun);
  vec3 col = alb * uSunCol * clamp((ndl + 0.4) / 1.4, 0.0, 1.0) * ao;
  col += alb * skyIrr(n) * 1.3 * ao;
  col += vec3(0.05, 0.1, 0.02) * uSunCol * pow(max(dot(v, -uSun), 1e-6), 4.0) * 0.3 * (1.0 - vTrunk);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;
function pineTemplate(whorls: number, perWhorl: number) {
  const pine: number[] = [], uv: number[] = [], idx: number[] = [];
  const S = 6;
  for (let i = 0; i <= S; i++) { const a = (i / S) * Math.PI * 2; pine.push(-1, 0, 0, 0, -1, 0, 0, 0); uv.push(a, 0, a, 0.99); }
  for (let i = 0; i < S; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
  let seed = 77;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    for (let b = 0; b < perWhorl; b++) {
      // the lowest whorls of an old pine have lost branches
      if (t < 0.2 && rnd() < 0.35) continue;
      const a = (b / perWhorl) * Math.PI * 2 + rnd() * 0.4;
      const jit = 0.85 + 0.3 * rnd();
      for (let card = 0; card < 2; card++) {
        const o = pine.length / 4;
        for (let s = 0; s < 3; s++) for (const v of [-1, 1]) { pine.push(t, a, card, jit); uv.push(s / 2, v); }
        for (let s = 0; s < 2; s++) { const k = o + s * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((pine.length / 4) * 3), 3));
  g.setAttribute('aPine', new THREE.Float32BufferAttribute(pine, 4));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ spinifex / marram tussocks
const tussVert = /* glsl */ `
${COMMON}
attribute vec4 aT;   // x, y, z, height
attribute vec2 aW;   // width, seed
attribute vec3 aQ;   // card angle, u, v (0..1 up)
uniform float uShow;
varying vec3 vP; varying vec2 vUV; varying float vSeed; varying vec3 vN;
LOGZ_VARY
void main() {
  float H = aT.w * uShow, W = aW.x, seed = aW.y;
  float a = aQ.x + seed * 6.2832;
  vec3 side = vec3(cos(a), 0.0, sin(a));
  float v = aQ.z;
  vec3 p = aT.xyz + side * (aQ.y - 0.5) * W * (1.0 + 0.6 * v) + vec3(0.0, v * H, 0.0);
  // the onshore breeze combs the blades landward
  p.xz += vec2(-0.7, 0.2) * v * v * H * (0.25 + 0.12 * sin(uTime * 2.2 + seed * 30.0 + aT.x * 0.7)) * (0.6 + uWind);
  vUV = vec2(aQ.y, v); vSeed = seed; vP = p;
  vN = normalize(vec3(-side.z, 0.8, side.x));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;
const tussFrag = /* glsl */ `
${COMMON}
${NOISE_T}
varying vec3 vP; varying vec2 vUV; varying float vSeed; varying vec3 vN;
LOGZ_VARY
void main() {
  // blades: tapering stripes of uneven height
  float x = vUV.x * 9.0 + vSeed * 17.0;
  float id = floor(x);
  float hb = 0.45 + 0.55 * fract(sin(id * 12.9898 + vSeed * 78.2) * 43758.5);
  float w = (1.0 - vUV.y / hb) * 0.42;
  if (vUV.y > hb || abs(fract(x) - 0.5) > w) discard;
  float dry = smoothstep(0.55, 0.9, vUV.y / hb) * 0.7 + 0.3 * fract(id * 0.618 + vSeed * 3.0);
  vec3 alb = mix(vec3(0.09, 0.11, 0.07), vec3(0.24, 0.21, 0.13), dry); // silvery spinifex, straw tips
  alb *= 0.55 + 0.45 * smoothstep(0.0, 0.5, vUV.y);
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  vec3 n = normalize(vN);
  if (dot(n, v) < 0.0) n = -n;
  vec3 col = alb * uSunCol * clamp(dot(n, uSun) * 0.6 + 0.4, 0.0, 1.0) * figureShadow(p) + alb * skyIrr(n) * 1.2;
  col += vec3(0.1, 0.1, 0.04) * uSunCol * pow(max(dot(v, -uSun), 1e-6), 3.0) * 0.4 * vUV.y;
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;
function tussTemplate() {
  const q: number[] = [], idx: number[] = [];
  for (let c = 0; c < 3; c++) {
    const o = q.length / 3, a = (c / 3) * Math.PI;
    for (const v of [0, 0.5, 1]) for (const u of [0, 1]) q.push(a, u, v);
    for (let s = 0; s < 2; s++) { const k = o + s * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((q.length / 3) * 3), 3));
  g.setAttribute('aQ', new THREE.Float32BufferAttribute(q, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ soft contact shadows on the ground
const shadowVert = /* glsl */ `
${COMMON}
attribute vec4 aT; // x, y, z, radius
attribute vec2 aC; // corner
varying vec2 vC; varying vec3 vP;
LOGZ_VARY
void main() {
  vec2 off = -normalize(uSun.xz) * aT.w * 0.45; // pushed away from the Sun
  vec3 p = aT.xyz + vec3(aC.x * aT.w * 1.25 + off.x, 0.06, aC.y * aT.w * 1.25 + off.y);
  vC = aC; vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;
const shadowFrag = /* glsl */ `
${COMMON}
varying vec2 vC; varying vec3 vP;
LOGZ_VARY
void main() {
  float r = length(vC);
  float s = (1.0 - smoothstep(0.25, 1.0, r)) * 0.5;
  gl_FragColor = vec4(vec3(1.0 - s), 1.0);
  LOGZ_FRAG
}`;

const TIER = {
  low: { keep: 0.55, far: 5, near: 12, whorls: 12, perWhorl: 5, tuss: 2500 },
  medium: { keep: 0.7, far: 5, near: 14, whorls: 14, perWhorl: 5, tuss: 4000 },
  high: { keep: 0.8, far: 6, near: 16, whorls: 15, perWhorl: 6, tuss: 6000 },
};
/** Plants within this distance of the person (m) use the denser crown. */
const NEAR_R = 70;

export class Trees {
  readonly group = new THREE.Group();
  private crownMat: THREE.ShaderMaterial;
  private pineMat: THREE.ShaderMaterial;
  private tussMat: THREE.ShaderMaterial;
  private shadowMat: THREE.ShaderMaterial;
  private meshes: THREE.Mesh[] = [];
  private uShow = { value: 1 };

  constructor(shared: Shared, private D: SiteData, tex: SiteTextures) {
    const u = { ...shared, uShow: this.uShow, tNoise: tex.uniforms.tNoise };
    this.crownMat = new THREE.ShaderMaterial({ vertexShader: crownVert, fragmentShader: crownFrag, side: THREE.DoubleSide, uniforms: u });
    this.pineMat = new THREE.ShaderMaterial({ vertexShader: pineVert, fragmentShader: pineFrag, side: THREE.DoubleSide, uniforms: u });
    this.tussMat = new THREE.ShaderMaterial({ vertexShader: tussVert, fragmentShader: tussFrag, side: THREE.DoubleSide, uniforms: u });
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: shadowVert, fragmentShader: shadowFrag, uniforms: u, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
  }

  build(q: Quality) {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const cfg = TIER[q], D = this.D, T = D.trees, n = T.length / 5;
    const far: number[][] = [], near: number[][] = [], pines: number[][] = [], shadows: number[][] = [];
    for (let i = 0; i < n; i++) {
      const x = T[i * 5], z = T[i * 5 + 1], h = T[i * 5 + 2], r = T[i * 5 + 3], kind = T[i * 5 + 4];
      const s = Math.abs((Math.sin(i * 12.9898 + x * 0.0137) * 43758.5453) % 1);
      const d = Math.hypot(x, z);
      // thin out the smallest, most distant plants on lower tiers (never the pines)
      if (kind !== 2 && s > cfg.keep && d > 60) continue;
      const y = siteHeight(D, x, z) + FRAME.sea - 0.15;
      const rec = [x + MAP_O[0], y, z + MAP_O[1], h, r, kind, s];
      (kind === 2 ? pines : d < NEAR_R ? near : far).push(rec);
      if (d < 160 && siteHeight(D, x, z) > 0.6) shadows.push([rec[0], y + 0.15, rec[2], r * (kind === 2 ? 1.1 : 0.9)]);
    }
    const inst = (g: THREE.InstancedBufferGeometry, list: number[][], mat: THREE.ShaderMaterial, layout: [string, number][]) => {
      let off = 0;
      for (const [name, size] of layout) {
        const a = new Float32Array(list.length * size);
        list.forEach((t, i) => { for (let k = 0; k < size; k++) a[i * size + k] = t[off + k]; });
        g.setAttribute(name, new THREE.InstancedBufferAttribute(a, size));
        off += size;
      }
      g.instanceCount = list.length;
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false; m.renderOrder = mat === this.shadowMat ? 2 : 1;
      this.meshes.push(m); this.group.add(m);
    };
    const TR: [string, number][] = [['aT', 4], ['aR', 3]];
    inst(crownTemplate(cfg.far), far, this.crownMat, TR);
    inst(crownTemplate(cfg.near), near, this.crownMat, TR);
    inst(pineTemplate(cfg.whorls, cfg.perWhorl), pines, this.pineMat, TR);
    // spinifex and marram: along the ragged edge where the dune scrub meets the sand, and runners
    // out onto the dry sand at the dune's foot (from the land-cover maps, near the person only)
    {
      const list: number[][] = [];
      let seed = 4711;
      const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let k = 0; k < cfg.tuss * 12 && list.length < cfg.tuss; k++) {
        const rr = 380 * Math.pow(rnd(), 0.6), a = rnd() * Math.PI * 2;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (rr < 2.5) continue;
        const sand = coverAt(D, 0, x, z), sc = coverAt(D, 1, x, z);
        const hs = siteHeight(D, x, z);
        const edge = sc > 0.04 && sc < 0.75 && sand > 0.08;
        const runner = sand > 0.5 && sc < 0.05 && hs > 1.75 && hs < 3.2 && rnd() < 0.35;
        if (!edge && !runner) continue;
        if (sand > 0.75 && sc > 0.35) continue; // the access tracks stay open
        const big = rnd();
        list.push([x + MAP_O[0], hs + FRAME.sea - 0.05, z + MAP_O[1], (runner ? 0.25 : 0.35) + big * 0.45, 0.5 + big * 0.7, rnd()]);
      }
      inst(tussTemplate(), list, this.tussMat, [['aT', 4], ['aW', 2]]);
    }
    {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
      g.setAttribute('aC', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      inst(g, shadows, this.shadowMat, [['aT', 4]]);
    }
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.crownMat.dispose(); this.pineMat.dispose(); this.tussMat.dispose(); this.shadowMat.dispose();
  }
}
