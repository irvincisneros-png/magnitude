/**
 * Trees and shrubs placed from OpenStreetMap land cover (tools/build-woonona.mjs): garden and street
 * trees between the houses, eucalypts in the reserves, low coastal scrub on the foredune, and the
 * Norfolk Island pines that line Illawarra foreshore parks. Two instanced draw calls: rounded crowns
 * (with a short trunk) and pines (a trunk with tiers of level branches).
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON, FRAME, MAP_O, type Shared } from './glsl';
import { siteHeight, type SiteData } from './siteData';

const crownVert = /* glsl */ `
${COMMON}
attribute vec4 aT;   // x, y (ground), z, height
attribute vec3 aR;   // radius, kind, seed
attribute float aPart; // 0 crown, 1 trunk
attribute vec3 aCen;   // centre of the foliage clump (template space)
uniform float uShow;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying float vKind; varying float vSeed; varying float vPart; varying float vH;
LOGZ_VARY
void main() {
  float H = aT.w * uShow, R = aR.x, kind = aR.y, seed = aR.z;
  vec3 l = position;
  vec3 p, n;
  if (aPart > 0.5) {
    // trunk: a thin prism from the ground into the crown
    float tr = kind > 2.5 ? 0.18 + H * 0.012 : 0.12 + H * 0.01;
    p = vec3(l.x * tr, l.y * H * 0.6, l.z * tr);
    n = normalize(vec3(l.x, 0.0, l.z));
  } else {
    // crown: a lumpy ellipsoid; eucalypts open and irregular, shrubs low domes, garden trees round
    float base = kind < 1.5 && kind > 0.5 ? 0.0 : kind > 2.5 ? 0.45 : 0.3;
    float cy = mix(base, 1.0, 0.5) * H;
    float ry = (1.0 - base) * 0.5 * H;
    float lump = 0.75 + 0.5 * vnoise3(l * 1.7 + seed * 31.0) + (kind > 2.5 ? 0.25 * (vnoise3(l * 3.1 + seed * 7.0) - 0.5) : 0.0);
    p = vec3(l.x * R * lump, cy + l.y * ry * lump, l.z * R * lump);
    n = normalize((l - aCen * 0.6) / vec3(R, ry, R));
  }
  float a = seed * 6.2832;
  float c = cos(a), s = sin(a);
  p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  n = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  // sway in the onshore breeze
  p.xz += vec2(-0.05, 0.015) * sin(uTime * 0.9 + seed * 40.0) * p.y * 0.05;
  vL = position; vKind = kind; vSeed = seed; vPart = aPart; vH = p.y / max(H, 0.01);
  p += aT.xyz;
  vP = p; vN = n;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const pineVert = /* glsl */ `
${COMMON}
attribute vec4 aT; attribute vec3 aR;
attribute vec3 aPine; // tier index (−1 trunk), radial fraction (0 centre … 1 tip), angle
uniform float uShow;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying float vKind; varying float vSeed; varying float vPart; varying float vH;
LOGZ_VARY
void main() {
  float H = aT.w * uShow, R = aR.x, seed = aR.z;
  float tier = aPine.x, f = aPine.y, ang = aPine.z + seed * 6.2832;
  vec3 p, n;
  if (tier < 0.0) {
    float tr = 0.25 + H * 0.012;
    p = vec3(cos(ang) * tr * (1.0 - 0.8 * position.y), position.y * H, sin(ang) * tr * (1.0 - 0.8 * position.y));
    n = vec3(cos(ang), 0.0, sin(ang));
    vPart = 1.0;
  } else {
    // level tiers of branches, getting shorter towards the top; a bare lower trunk
    float NT = 11.0;
    float t = tier / NT;
    float y0 = mix(0.28, 0.98, t) * H;
    float r = R * pow(1.0 - t, 0.85) * (0.75 + 0.5 * fract(seed * 17.0 + tier * 0.37)) + 0.3;
    float droop = f * f * 0.12 * r - f * 0.05 * r;
    p = vec3(cos(ang) * r * f, y0 - droop + 0.35 * (1.0 - f) * r * 0.25, sin(ang) * r * f);
    n = normalize(vec3(cos(ang) * 0.35, 1.0, sin(ang) * 0.35));
    vPart = 0.0;
  }
  p.xz += vec2(-0.05, 0.015) * sin(uTime * 0.7 + seed * 40.0) * p.y * 0.02;
  vL = vec3(aPine.y, aPine.x, aPine.z); vKind = 2.0; vSeed = seed; vH = p.y / max(H, 0.01);
  p += aT.xyz;
  vP = p; vN = n;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const treeFrag = /* glsl */ `
${COMMON}
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying float vKind; varying float vSeed; varying float vPart; varying float vH;
LOGZ_VARY
void main() {
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float k = fract(vSeed * 11.3);
  vec3 alb;
  if (vPart > 0.5) alb = vKind > 2.5 ? vec3(0.32, 0.29, 0.25) : vec3(0.07, 0.055, 0.04); // pale gum bark / dark bark
  else if (vKind < 0.5) alb = mix(vec3(0.035, 0.065, 0.022), vec3(0.07, 0.09, 0.03), k);       // garden and street trees
  else if (vKind < 1.5) alb = mix(vec3(0.03, 0.045, 0.02), vec3(0.06, 0.065, 0.032), k);       // coastal scrub (tea-tree, banksia)
  else if (vKind < 2.5) alb = vec3(0.018, 0.04, 0.022);                                         // Norfolk Island pine
  else alb = mix(vec3(0.05, 0.06, 0.04), vec3(0.075, 0.08, 0.05), k);                          // eucalypt: grey-olive
  float leaf = vPart > 0.5 ? 0.0 : 1.0;
  float fp = max(length(dFdx(p)), length(dFdy(p)));
  // leaves and twigs: small bright and dark flecks once they are big enough to see
  float lv = (1.0 - smoothstep(0.03, 0.12, fp)) * leaf;
  float lf = lv > 0.0 ? vnoise3(p * 9.0 + vSeed * 3.0) : 0.5;
  alb *= mix(1.0, 0.45 + 1.1 * lf, lv);
  // clumps of foliage: noisy normals and gaps of shade inside the crown
  float cl = vnoise3(p * (vKind > 1.5 && vKind < 2.5 ? 1.6 : 0.9) + vSeed * 9.0);
  // clumped foliage normals: tilt by the gradient of the clump noise (screen-space, cheap)
  vec3 dpx = dFdx(p), dpy = dFdy(p);
  float hl = cl * 0.5 + lf * 0.12 * lv;
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-12) n = normalize(n - leaf * 1.6 * sign(det) * (dFdx(hl) * r1 + dFdy(hl) * r2) / abs(det) * length(dpx));
  alb *= mix(1.0, 0.65 + 0.6 * cl, leaf);
  float ao = mix(1.0, mix(0.45, 1.0, smoothstep(0.1, 0.9, vH)), leaf);
  float ndl = dot(n, uSun);
  vec3 col = alb * uSunCol * clamp((ndl + 0.3 * leaf) / (1.0 + 0.3 * leaf), 0.0, 1.0) * ao;
  col += alb * skyIrr(n) * 1.2 * ao;
  col += vec3(0.06, 0.12, 0.02) * uSunCol * pow(max(dot(v, -uSun), 1e-6), 4.0) * 0.25 * leaf * smoothstep(0.3, 0.8, cl);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

/** Crown template: one lumpy sphere (far) or a cluster of foliage clumps (near the person). */
function crownTemplate(detail: number, clumps = 1) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const ip = ico.attributes.position as THREE.BufferAttribute;
  const pos: number[] = []; const idx: number[] = []; const part: number[] = []; const cen: number[] = [];
  // clump centres and radii inside the unit crown (first one central)
  const C: number[][] = [[0, 0, 0, clumps > 1 ? 0.62 : 1]];
  for (let c = 1; c < clumps; c++) {
    const a = c * 2.39996, y = ((c % 3) - 1) * 0.42, r = 0.5;
    C.push([Math.cos(a) * r, y, Math.sin(a) * r, 0.46 + 0.1 * ((c * 7) % 3) / 2]);
  }
  for (const [cx, cy, cz, cr] of C) {
    // weld (IcosahedronGeometry is non-indexed)
    const map = new Map<string, number>();
    for (let i = 0; i < ip.count; i++) {
      const key = `${ip.getX(i).toFixed(4)},${ip.getY(i).toFixed(4)},${ip.getZ(i).toFixed(4)}`;
      let k = map.get(key);
      if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(cx + ip.getX(i) * cr, cy + ip.getY(i) * cr, cz + ip.getZ(i) * cr); part.push(0); cen.push(cx, cy, cz); }
      idx.push(k);
    }
  }
  ico.dispose();
  // trunk: a 5-sided prism (y 0 … 1)
  const o = pos.length / 3;
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; pos.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), 1, Math.sin(a)); part.push(1, 1); cen.push(0, 0, 0, 0, 0, 0); }
  for (let i = 0; i < 5; i++) { const a = o + i * 2, b = o + ((i + 1) % 5) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aCen', new THREE.Float32BufferAttribute(cen, 3));
  g.setIndex(idx);
  return g;
}
function pineTemplate() {
  const pine: number[] = [], pos: number[] = [], idx: number[] = [];
  const S = 7;
  // trunk
  for (let i = 0; i <= S; i++) { const a = (i / S) * Math.PI * 2; pine.push(-1, 0, a, -1, 0, a); pos.push(0, 0, 0, 0, 1, 0); }
  for (let i = 0; i < S; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
  // 12 tiers, each a fan of branches: centre + 2 rings (half, tip) of S points
  for (let t = 0; t < 12; t++) {
    const c = pos.length / 3;
    pine.push(t, 0, 0); pos.push(0, 0, 0);
    for (let r = 1; r <= 2; r++) for (let i = 0; i < S; i++) { pine.push(t, r / 2, (i / S) * Math.PI * 2 + t * 0.7); pos.push(0, 0, 0); }
    for (let i = 0; i < S; i++) {
      const a = c + 1 + i, b = c + 1 + ((i + 1) % S), a2 = a + S, b2 = b + S;
      idx.push(c, b, a, a, b, b2, a, b2, a2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPine', new THREE.Float32BufferAttribute(pine, 3));
  g.setIndex(idx);
  return g;
}

const TIER = { low: { detail: 0, keep: 0.55, clumps: 4 }, medium: { detail: 0, keep: 0.7, clumps: 4 }, high: { detail: 0, keep: 0.8, clumps: 4 } };
/** Plants within this distance of the person (m) use the clumped crown. */
const NEAR_R = 60;

export class Trees {
  readonly group = new THREE.Group();
  private crownMat: THREE.ShaderMaterial;
  private pineMat: THREE.ShaderMaterial;
  private meshes: THREE.Mesh[] = [];
  private uShow = { value: 1 };

  constructor(shared: Shared, private D: SiteData) {
    this.crownMat = new THREE.ShaderMaterial({ vertexShader: crownVert, fragmentShader: treeFrag, side: THREE.DoubleSide, uniforms: { ...shared, uShow: this.uShow } });
    this.pineMat = new THREE.ShaderMaterial({ vertexShader: pineVert, fragmentShader: treeFrag, side: THREE.DoubleSide, uniforms: { ...shared, uShow: this.uShow } });
  }

  build(q: Quality) {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const cfg = TIER[q], T = this.D.trees, n = T.length / 5;
    const crowns: number[][] = [], near: number[][] = [], pines: number[][] = [];
    for (let i = 0; i < n; i++) {
      const x = T[i * 5], z = T[i * 5 + 1], h = T[i * 5 + 2], r = T[i * 5 + 3], kind = T[i * 5 + 4];
      const seed = (Math.sin(i * 12.9898 + x * 0.0137) * 43758.5453) % 1;
      const s = Math.abs(seed);
      // thin out the smallest, most distant plants on lower tiers (never the pines)
      if (kind !== 2 && s > cfg.keep && Math.hypot(x, z) > 60) continue;
      const y = siteHeight(this.D, x, z) + FRAME.sea - 0.2;
      (kind === 2 ? pines : Math.hypot(x, z) < NEAR_R ? near : crowns).push([x + MAP_O[0], y, z + MAP_O[1], h, r, kind, s]);
    }
    const make = (list: number[][], g: THREE.InstancedBufferGeometry, mat: THREE.ShaderMaterial) => {
      const aT = new Float32Array(list.length * 4), aR = new Float32Array(list.length * 3);
      list.forEach((t, i) => { aT.set([t[0], t[1], t[2], t[3]], i * 4); aR.set([t[4], t[5], t[6]], i * 3); });
      g.setAttribute('aT', new THREE.InstancedBufferAttribute(aT, 4));
      g.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 3));
      g.instanceCount = list.length;
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false; m.renderOrder = 1;
      this.meshes.push(m); this.group.add(m);
    };
    make(crowns, crownTemplate(cfg.detail), this.crownMat);
    make(near, crownTemplate(1, cfg.clumps), this.crownMat);
    make(pines, pineTemplate(), this.pineMat);
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.crownMat.dispose(); this.pineMat.dispose();
  }
}
