/**
 * The built foreshore and suburb, from OpenStreetMap: every mapped building (simplified to its
 * minimum-area rectangle) plus houses generated along the residential streets where the suburb's
 * buildings are not mapped (tools/build-woonona.mjs), as instanced walls + hipped / gabled / flat
 * roofs in one draw call. Also the ocean rock pools (concrete walls, still pale water) and backyard
 * pools.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON, FRAME, MAP_O, type Shared } from './glsl';
import { siteHeight, type SiteData } from './siteData';

const bldVert = /* glsl */ `
${COMMON}
attribute vec4 aSlot;           // template: sx, sz (±1), kind (0 wall, 1 eave, 2 ridge), top (walls)
attribute vec3 aNrm;            // wall normal in the template
attribute vec4 aB0;             // x, y, z, angle
attribute vec4 aB1;             // w (long side), d, wall height, roof (0 flat, 1 hip, 2 gable)
attribute float aSeed;
uniform float uShow;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying float vSeed; varying float vKind; varying float vRoof;
LOGZ_VARY
void main() {
  float w = aB1.x, d = aB1.y, H = aB1.z * uShow, roof = aB1.w;
  vec3 l;
  if (aSlot.z < 0.5) {
    l = vec3(aSlot.x * w * 0.5, mix(-1.5, H, aSlot.w), aSlot.y * d * 0.5);
  } else {
    float ov = roof > 0.5 ? 0.45 : 0.15;
    float rise = roof > 0.5 ? min(d * 0.5 * 0.42, 3.2) : 0.35;
    if (aSlot.z < 1.5) l = vec3(aSlot.x * (w * 0.5 + ov), H, aSlot.y * (d * 0.5 + ov));
    else {
      float rx = (roof > 0.5 && roof < 1.5) ? max(w * 0.5 - d * 0.5, 0.0) : w * 0.5 + ov;
      l = vec3(aSlot.x * rx, H + rise * uShow, 0.0);
    }
  }
  float c = cos(aB0.w), s = sin(aB0.w);
  vec3 p = vec3(aB0.x + l.x * c - l.z * s, aB0.y + l.y, aB0.z + l.x * s + l.z * c);
  vN = vec3(aNrm.x * c - aNrm.z * s, aNrm.y, aNrm.x * s + aNrm.z * c);
  vL = vec3(abs(aNrm.x) > 0.5 ? l.z : l.x, l.y, 0.0);
  vP = p; vSeed = aSeed; vKind = aSlot.z; vRoof = roof;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const bldFrag = /* glsl */ `
${COMMON}
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying float vSeed; varying float vKind; varying float vRoof;
LOGZ_VARY
vec3 roofCol(float k) {
  // Illawarra roofs: terracotta and brown tiles, and Colorbond steel (charcoal, grey, off-white)
  if (k < 0.24) return vec3(0.30, 0.10, 0.055);
  if (k < 0.36) return vec3(0.17, 0.09, 0.06);
  if (k < 0.58) return vec3(0.045, 0.047, 0.05);
  if (k < 0.74) return vec3(0.17, 0.18, 0.18);
  if (k < 0.86) return vec3(0.5, 0.5, 0.47);
  return vec3(0.09, 0.1, 0.09);
}
vec3 wallCol(float k) {
  // rendered cream, red-brown and blonde brick, white and grey weatherboard
  if (k < 0.3) return vec3(0.4, 0.35, 0.27);
  if (k < 0.5) return vec3(0.2, 0.085, 0.05);
  if (k < 0.62) return vec3(0.34, 0.26, 0.16);
  if (k < 0.85) return vec3(0.44, 0.44, 0.42);
  return vec3(0.26, 0.27, 0.26);
}
void main() {
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  float dist = length(uCamM - p);
  float fp = max(max(length(dFdx(p)), length(dFdy(p))), dist * uPx);
  vec3 n = vKind < 0.5 ? normalize(vN) : normalize(cross(dFdx(p), dFdy(p)));
  if (dot(n, v) < 0.0) n = -n;
  float k1 = fract(vSeed * 7.13), k2 = fract(vSeed * 13.7);
  vec3 alb;
  if (vKind < 0.5) {
    alb = wallCol(k2);
    // windows and doors once they are big enough to see
    float wv = 1.0 - smoothstep(0.15, 0.5, fp);
    if (wv > 0.0) {
      float u = fract(vL.x / 3.2 + vSeed * 3.0);
      float floorY = mod(vL.y, 2.9);
      float win = step(0.25, u) * step(u, 0.72) * step(0.9, floorY) * step(floorY, 2.2) * step(0.0, vL.y);
      alb = mix(alb, skyCol(reflect(-v, n)) * 0.5 + vec3(0.01), win * wv * 0.85);
    }
    alb *= mix(0.55, 1.0, smoothstep(-0.2, 0.8, vL.y)); // grime and garden shade at the foot
  } else {
    alb = roofCol(k1);
    alb *= 0.85 + 0.3 * vnoise(p.xz * 0.9);
    if (vRoof < 0.5) alb = mix(vec3(0.3, 0.3, 0.29), alb, 0.5); // flat roofs: pale membrane / steel
  }
  float ndl = dot(n, uSun);
  vec3 col = alb * uSunCol * max(ndl, 0.0) + alb * skyIrr(n) * 1.15;
  // sheen on steel roofs
  vec3 h = normalize(uSun + v);
  col += uSunCol * pow(max(dot(n, h), 1e-6), 60.0) * 0.06 * step(0.36, k1) * step(0.5, vKind) * max(ndl, 0.0);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

const poolVert = /* glsl */ `
${COMMON}
attribute float aKind;
varying vec3 vP; varying float vKind;
LOGZ_VARY
void main() {
  vP = position; vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;
const poolFrag = /* glsl */ `
${COMMON}
varying vec3 vP; varying float vKind;
LOGZ_VARY
void main() {
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(n, v) < 0.0) n = -n;
  vec3 col;
  if (vKind < 0.5) {
    // still, clear pool water over a pale painted floor
    vec2 g = vec2(vnoise(p.xz * 1.3 + uTime * 0.2) - 0.5, vnoise(p.zx * 1.1 - uTime * 0.17) - 0.5) * 0.06;
    vec3 nw = normalize(vec3(g.x, 1.0, g.y));
    float F = 0.02 + 0.98 * pow(max(1.0 - max(dot(nw, v), 0.0), 1e-6), 5.0);
    vec3 body = vec3(0.06, 0.24, 0.24) * (uSunCol * uSun.y * 0.6 + skyIrr(vec3(0, 1, 0)));
    col = mix(body, skyCol(reflect(-v, nw)), F);
    vec3 h = normalize(uSun + v);
    col += uSunCol * pow(max(dot(nw, h), 1e-6), 400.0) * 3.0;
  } else {
    vec3 alb = vec3(0.32, 0.31, 0.28) * (0.75 + 0.35 * vnoise(p.xz * 3.0));
    alb = mix(alb, alb * 0.45, smoothstep(0.9, 0.2, p.y - SEA_Y)); // wet, weedy below the high-tide line
    col = alb * uSunCol * max(dot(n, uSun), 0.0) + alb * skyIrr(n) * 1.1;
  }
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

/** Unit template: 4 walls (16 vertices with face normals), then 4 eaves + 2 ridge ends. */
function template() {
  const slot: number[] = [], nrm: number[] = [], idx: number[] = [];
  const faces: [number, number, number, number, number][] = [ // corner a (sx, sz), corner b, normal (x, z)
    [-1, -1, 1, -1, 0], [1, -1, 1, 1, 1], [1, 1, -1, 1, 2], [-1, 1, -1, -1, 3],
  ];
  const fn = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [ax, az, bx, bz, f] of faces) {
    const o = slot.length / 4;
    slot.push(ax, az, 0, 0, bx, bz, 0, 0, bx, bz, 0, 1, ax, az, 0, 1);
    for (let i = 0; i < 4; i++) nrm.push(fn[f][0], 0, fn[f][1]);
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  const e = slot.length / 4; // eaves: (−,−) (+,−) (+,+) (−,+); ridge: (−) (+)
  slot.push(-1, -1, 1, 0, 1, -1, 1, 0, 1, 1, 1, 0, -1, 1, 1, 0, -1, -1, 2, 0, 1, 1, 2, 0);
  for (let i = 0; i < 6; i++) nrm.push(0, 1, 0);
  const E0 = e, E1 = e + 1, E2 = e + 2, E3 = e + 3, R0 = e + 4, R1 = e + 5;
  idx.push(E0, R1, E1, E0, R0, R1, E2, R0, E3, E2, R1, R0, E3, R0, E0, E1, R1, E2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aSlot', new THREE.Float32BufferAttribute(slot, 4));
  g.setAttribute('aNrm', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(slot.length / 4 * 3), 3));
  g.setIndex(idx);
  return g;
}

export class Built {
  readonly group = new THREE.Group();
  private bldMat: THREE.ShaderMaterial;
  private poolMat: THREE.ShaderMaterial;
  private meshes: THREE.Mesh[] = [];
  private uShow = { value: 1 };

  constructor(shared: Shared, private D: SiteData) {
    this.bldMat = new THREE.ShaderMaterial({ vertexShader: bldVert, fragmentShader: bldFrag, side: THREE.DoubleSide, uniforms: { ...shared, uShow: this.uShow } });
    this.poolMat = new THREE.ShaderMaterial({ vertexShader: poolVert, fragmentShader: poolFrag, side: THREE.DoubleSide, uniforms: { ...shared } });
  }

  build(_q: Quality) {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const D = this.D, B = D.bld, n = B.length / 8;
    const g = template();
    const b0 = new Float32Array(n * 4), b1 = new Float32Array(n * 4), sd = new Float32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      let [x, z, w, d, a, h, roof, seed] = B.subarray(i * 8, i * 8 + 8);
      if (d > w) { const t = w; w = d; d = t; a += Math.PI / 2; }
      // sit on the lowest corner so nothing floats on a slope
      const c = Math.cos(a), s = Math.sin(a);
      let y = Infinity;
      for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]]) y = Math.min(y, siteHeight(D, x + u * w * c - v * d * s, z + u * w * s + v * d * c));
      b0.set([x + MAP_O[0], y + FRAME.sea, z + MAP_O[1], a], k * 4);
      b1.set([w, d, roof > 0.5 ? Math.min(h, 7) : h, roof], k * 4);
      sd[k] = seed; k++;
    }
    g.setAttribute('aB0', new THREE.InstancedBufferAttribute(b0.subarray(0, k * 4), 4));
    g.setAttribute('aB1', new THREE.InstancedBufferAttribute(b1.subarray(0, k * 4), 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd.subarray(0, k), 1));
    g.instanceCount = k;
    const m = new THREE.Mesh(g, this.bldMat);
    m.frustumCulled = false; m.renderOrder = 1;
    this.meshes.push(m);
    // ---- pools
    {
      const pos: number[] = [], kind: number[] = [], idx: number[] = [];
      const quad = (pts: number[][], kd: number) => {
        const o = pos.length / 3;
        for (const p of pts) pos.push(p[0], p[1], p[2]);
        for (let i = 0; i < 4; i++) kind.push(kd);
        idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      };
      for (const [x, z, w, d, a, rock] of D.pools) {
        const c = Math.cos(a), s = Math.sin(a);
        const at = (u: number, v: number, y: number) => [x + u * c - v * s + MAP_O[0], y, z + u * s + v * c + MAP_O[1]];
        if (rock) {
          const water = FRAME.sea + 1.0, top = FRAME.sea + 1.25, bot = FRAME.sea - 0.8, t = 0.6;
          quad([at(-w / 2, -d / 2, water), at(w / 2, -d / 2, water), at(w / 2, d / 2, water), at(-w / 2, d / 2, water)], 0);
          // four walls: top, outer and inner faces
          for (const [u0, v0, u1, v1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
            const A = [u0 * w / 2, v0 * d / 2], Bp = [u1 * w / 2, v1 * d / 2];
            const ox = Math.sign(u0 + u1) * t, oz = Math.sign(v0 + v1) * t; // outward offset
            const Ao = [A[0] + ox + (u0 === u1 ? 0 : u0 * t), A[1] + oz + (v0 === v1 ? 0 : v0 * t)];
            const Bo = [Bp[0] + ox + (u0 === u1 ? 0 : u1 * t), Bp[1] + oz + (v0 === v1 ? 0 : v1 * t)];
            quad([at(A[0], A[1], top), at(Bp[0], Bp[1], top), at(Bo[0], Bo[1], top), at(Ao[0], Ao[1], top)], 1);
            quad([at(Ao[0], Ao[1], top), at(Bo[0], Bo[1], top), at(Bo[0], Bo[1], bot), at(Ao[0], Ao[1], bot)], 1);
            quad([at(A[0], A[1], top), at(Bp[0], Bp[1], top), at(Bp[0], Bp[1], water - 0.1), at(A[0], A[1], water - 0.1)], 1);
          }
        } else {
          const y = siteHeight(D, x, z) + FRAME.sea + 0.12;
          quad([at(-w / 2, -d / 2, y), at(w / 2, -d / 2, y), at(w / 2, d / 2, y), at(-w / 2, d / 2, y)], 0);
        }
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      pg.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
      pg.setIndex(idx);
      const pm = new THREE.Mesh(pg, this.poolMat);
      pm.frustumCulled = false; pm.renderOrder = 1;
      this.meshes.push(pm);
    }
    for (const mm of this.meshes) this.group.add(mm);
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.bldMat.dispose(); this.poolMat.dispose();
  }
}
