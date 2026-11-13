/**
 * Procedural T4 geometry, all in the phage's own frame: feet (membrane contact) at y = 0, tail
 * axis on x = z = 0, 1 unit = 200 nm. Every protein part is an instanced lumpy ellipsoid ("blob");
 * the builder returns flat instance arrays so a whole virus is one draw call.
 */
import * as THREE from 'three';

export const EDGE = 0.235;         // icosahedron edge before elongation (47 nm)
export const SQUASH = 0.85;        // vertical squash of the elongated head
export const HEAD_HALF = 0.275;    // half height of the head polyhedron after squash

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ head polyhedron
export interface Poly { v: THREE.Vector3[]; f: [number, number, number][]; n: THREE.Vector3[]; apexBottom: number }

/** Elongated icosahedron (one extra antiprism ring), centred on 0, 5-fold axis along Y, then squashed. */
export function headPoly(): Poly {
  const a = EDGE;
  const Rr = a / (2 * Math.sin(Math.PI / 5));
  const hA = Math.sqrt(a * a - Rr * Rr);
  const c = 2 * Rr * Math.sin(Math.PI / 10);
  const h = Math.sqrt(a * a - c * c);
  const v: THREE.Vector3[] = [];
  const ring = (y: number, off: number) => {
    const s = v.length;
    for (let k = 0; k < 5; k++) { const t = off + (k * 2 * Math.PI) / 5; v.push(new THREE.Vector3(Rr * Math.sin(t), y, Rr * Math.cos(t))); }
    return s;
  };
  v.push(new THREE.Vector3(0, h + hA, 0));
  const U = ring(h, 0), M = ring(0, Math.PI / 5), L = ring(-h, 0);
  v.push(new THREE.Vector3(0, -h - hA, 0));
  const T = 0, B = v.length - 1;
  const f: [number, number, number][] = [];
  for (let k = 0; k < 5; k++) {
    const k1 = (k + 1) % 5;
    f.push([T, U + k, U + k1]);
    f.push([U + k, M + k, U + k1]);
    f.push([M + k, M + k1, U + k1]);
    f.push([M + k, L + k1, M + k1]);
    f.push([L + k, L + k1, M + k]);
    f.push([B, L + k1, L + k]);
  }
  for (const p of v) p.y *= SQUASH;
  const n: THREE.Vector3[] = [];
  for (const fc of f) {
    const [p0, p1, p2] = fc.map((i) => v[i]);
    const nn = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
    const cen = p0.clone().add(p1).add(p2);
    if (nn.dot(cen) < 0) { nn.negate(); const t = fc[1]; fc[1] = fc[2]; fc[2] = t; }
    n.push(nn);
  }
  return { v, f, n, apexBottom: B };
}

/** Signed distance-ish: max over faces of plane distance (negative inside). */
export function polyDist(P: Poly, p: THREE.Vector3) {
  let m = -1e9;
  for (let i = 0; i < P.f.length; i++) m = Math.max(m, P.n[i].dot(p) - P.n[i].dot(P.v[P.f[i][0]]));
  return m;
}

// ------------------------------------------------------------------ instance buffers
export class Blobs {
  off: number[] = []; quat: number[] = []; scl: number[] = []; col: number[] = [];
  misc: number[] = []; flex: number[] = [];
  get count() { return this.off.length / 3; }
  /** misc: seed, ao strength, cuttable, emissive. flex: phase, weight. */
  add(p: THREE.Vector3, q: THREE.Quaternion, s: [number, number, number], c: THREE.Color, seed: number, ao = 0, cut = 0, emis = 0, fph = 0, fw = 0) {
    this.off.push(p.x, p.y, p.z); this.quat.push(q.x, q.y, q.z, q.w); this.scl.push(...s);
    this.col.push(c.r, c.g, c.b); this.misc.push(seed, ao, cut, emis); this.flex.push(fph, fw);
  }
  /** Apply a rigid transform to all instances added since index `from`. */
  transform(from: number, m: THREE.Matrix4) {
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const p = new THREE.Vector3(), qi = new THREE.Quaternion();
    for (let i = from; i < this.count; i++) {
      p.fromArray(this.off, i * 3).applyMatrix4(m); p.toArray(this.off, i * 3);
      qi.fromArray(this.quat, i * 4).premultiply(q); qi.toArray(this.quat, i * 4);
    }
  }
}

const tmpM = new THREE.Matrix4();
/** Quaternion whose local z = n and local x ≈ t (orthonormalised). */
export function frameQuat(n: THREE.Vector3, t: THREE.Vector3, out = new THREE.Quaternion()) {
  const z = n.clone().normalize();
  const x = t.clone().addScaledVector(z, -t.dot(z));
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0).addScaledVector(z, -z.x);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  tmpM.makeBasis(x, y, z);
  return out.setFromRotationMatrix(tmpM);
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
export const PAL = {
  lobe: C(0.34, 0.47, 0.76), penta: C(0.52, 0.42, 0.78), hoc: C(0.46, 0.58, 0.82), soc: C(0.26, 0.36, 0.62),
  portal: C(0.55, 0.62, 0.8),
  sheath: C(0.33, 0.66, 0.58), sheathB: C(0.27, 0.56, 0.52), tube: C(0.14, 0.24, 0.24),
  base: C(0.86, 0.6, 0.38), baseB: C(0.72, 0.5, 0.34),
  fibre: C(0.93, 0.66, 0.36), tip: C(1.0, 0.8, 0.5), whisker: C(0.8, 0.72, 0.56),
};

function jitterCol(c: THREE.Color, r: () => number, amt: number) {
  const k = 1 + (r() - 0.5) * amt;
  return c.clone().multiplyScalar(k);
}

// ------------------------------------------------------------------ the phage
export interface PhageCfg {
  contracted: boolean;
  /** 'landed': fibres splayed onto the membrane; 'free': fibres hanging, searching. */
  pose: 'landed' | 'free';
  seed: number;
  cut: boolean;      // capsid parts may be cut away (main phage only)
}

export interface PhageInfo { headY: number; poly: Poly; feet: THREE.Vector3[]; tubeTip: THREE.Vector3 }

/** Bead chain along a quadratic Bézier; returns the end. */
function chain(B: Blobs, r: () => number, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, rad0: number, rad1: number,
  col0: THREE.Color, col1: THREE.Color, fph: number, w0: number, w1: number, step = 1.25) {
  const pt = new THREE.Vector3(), tg = new THREE.Vector3(), q = new THREE.Quaternion();
  const len = p0.distanceTo(p1) + p1.distanceTo(p2);
  const n = Math.max(3, Math.round(len / (((rad0 + rad1) / 2) * step)));
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pt.set(0, 0, 0).addScaledVector(p0, u * u).addScaledVector(p1, 2 * u * t).addScaledVector(p2, t * t);
    tg.set(0, 0, 0).addScaledVector(p0, -2 * u).addScaledVector(p1, 2 * (u - t)).addScaledVector(p2, 2 * t).normalize();
    const rad = rad0 + (rad1 - rad0) * t;
    const wob = 1 + 0.18 * Math.sin(i * 2.3 + fph);
    frameQuat(tg, Math.abs(tg.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up, q);
    B.add(pt, q, [rad * wob, rad * wob, rad * 1.5], col0.clone().lerp(col1, t).multiplyScalar(0.92 + r() * 0.16), r(), 0, 0, 0, fph, w0 + (w1 - w0) * t);
  }
}

export function buildPhage(B: Blobs, cfg: PhageCfg): PhageInfo {
  const r = rng(cfg.seed);
  const Y = new THREE.Vector3(0, 1, 0);
  const id = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const cutF = cfg.cut ? 1 : 0;

  const baseTop = 0.09;
  const sheathLen = cfg.contracted ? 0.21 : 0.48;
  const neckY = baseTop + sheathLen;
  const headBottom = neckY + 0.025;
  const headY = headBottom + HEAD_HALF;

  // ---------------- capsid lattice
  const P = headPoly();
  const HC = new THREE.Vector3(0, headY, 0);
  const nSub = 3;
  type LP = { p: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; vert: number };
  const pts = new Map<string, LP>();
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 2000)},${Math.round(v.y * 2000)},${Math.round(v.z * 2000)}`;
  const socs: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  P.f.forEach((fc, fi) => {
    const [a, b, c] = fc.map((i) => P.v[i]);
    const e1 = new THREE.Vector3().subVectors(b, a), e2 = new THREE.Vector3().subVectors(c, a);
    const at = (i: number, j: number) => a.clone().addScaledVector(e1, i / nSub).addScaledVector(e2, j / nSub);
    for (let i = 0; i <= nSub; i++) for (let j = 0; j <= nSub - i; j++) {
      const v = at(i, j);
      const k = key(v);
      let vert = -1;
      if (i === 0 && j === 0) vert = fc[0]; else if (i === nSub) vert = fc[1]; else if (j === nSub) vert = fc[2];
      const e = pts.get(k);
      if (e) e.n.add(P.n[fi]);
      else pts.set(k, { p: v, n: P.n[fi].clone(), t: e1.clone(), vert });
    }
    for (let i = 0; i < nSub; i++) for (let j = 0; j < nSub - i; j++) {
      socs.push({ p: at(i, j).add(at(i + 1, j)).add(at(i, j + 1)).multiplyScalar(1 / 3), n: P.n[fi] });
      if (i + j < nSub - 1) socs.push({ p: at(i + 1, j).add(at(i, j + 1)).add(at(i + 1, j + 1)).multiplyScalar(1 / 3), n: P.n[fi] });
    }
  });
  const sp = EDGE / nSub;
  const valence = new Array(P.v.length).fill(0);
  for (const fc of P.f) for (const i of fc) valence[i]++;
  const tmpT = new THREE.Vector3(), rad = new THREE.Vector3(), tan = new THREE.Vector3(), bvec = new THREE.Vector3();
  for (const lp of pts.values()) {
    if (lp.vert === P.apexBottom) continue;   // portal sits here
    const n = lp.n.normalize();
    const penta = lp.vert >= 0 && valence[lp.vert] === 5;
    const base = lp.p.clone().add(HC);
    tmpT.copy(lp.t).addScaledVector(n, -lp.t.dot(n)).normalize();
    bvec.crossVectors(n, tmpT);
    const nl = penta ? 5 : 6;
    const capCol = jitterCol(penta ? PAL.penta : PAL.lobe, r, 0.14);
    const rl = sp * (penta ? 0.22 : 0.245);
    for (let i = 0; i < nl; i++) {
      const th = (i / nl) * Math.PI * 2 + Math.PI / 6;
      rad.copy(tmpT).multiplyScalar(Math.cos(th)).addScaledVector(bvec, Math.sin(th));
      p.copy(base).addScaledVector(rad, rl).addScaledVector(n, sp * 0.05);
      tan.crossVectors(n, rad);
      // lobes lean slightly inward, like the petals of a ring
      const nz = n.clone().addScaledVector(rad, -0.25).normalize();
      frameQuat(nz, rad, q);
      B.add(p, q, [sp * 0.15, sp * 0.165, sp * 0.11], jitterCol(capCol, r, 0.08), r(), 0.85, cutF);
    }
    if (!penta) {
      // Hoc: a knob sticking out of the middle of each hexamer
      p.copy(base).addScaledVector(n, sp * 0.16);
      frameQuat(n, tmpT, q);
      B.add(p, q, [sp * 0.07, sp * 0.07, sp * 0.13], jitterCol(PAL.hoc, r, 0.1), r(), 0.6, cutF);
    }
  }
  for (const s of socs) {
    p.copy(s.p).add(HC).addScaledVector(s.n, sp * 0.03);
    frameQuat(s.n, Y, q);
    B.add(p, q, [sp * 0.1, sp * 0.1, sp * 0.06], jitterCol(PAL.soc, r, 0.12), r(), 0.6, cutF);
  }

  // ---------------- portal, neck, collar, whiskers
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    p.set(Math.cos(t) * 0.028, headBottom + 0.004, Math.sin(t) * 0.028);
    B.add(p, id, [0.013, 0.011, 0.013], jitterCol(PAL.portal, r, 0.1), r(), 0, cutF);
  }
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    p.set(Math.cos(t) * 0.026, neckY + 0.012, Math.sin(t) * 0.026);
    B.add(p, id, [0.016, 0.014, 0.016], jitterCol(PAL.portal, r, 0.1), r(), 0);
    p.set(Math.cos(t + 0.5) * 0.052, neckY + 0.006, Math.sin(t + 0.5) * 0.052);
    B.add(p, id, [0.026, 0.009, 0.026], jitterCol(PAL.whisker, r, 0.1), r(), 0);
  }
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.5 + (r() - 0.5) * 0.2;
    const dir = new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
    const p0 = dir.clone().multiplyScalar(0.07).setY(neckY + 0.006);
    const p2 = dir.clone().multiplyScalar(0.25).setY(neckY - 0.07 - r() * 0.03);
    const p1 = dir.clone().multiplyScalar(0.17).setY(neckY - 0.005);
    chain(B, r, p0, p1, p2, 0.0042, 0.0038, PAL.whisker, PAL.whisker, r() * 6, 0, 1.4);
  }

  // ---------------- sheath + tube
  const rings = 24;
  const ringH = sheathLen / rings;
  const sR = cfg.contracted ? 0.06 : 0.041;
  const twist = cfg.contracted ? (32.5 * Math.PI) / 180 : (17.2 * Math.PI) / 180;
  for (let k = 0; k < rings; k++) {
    const y = baseTop + (k + 0.5) * ringH;
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2 + k * twist;
      const rd = new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
      p.copy(rd).multiplyScalar(sR).setY(y);
      // subunit long axis tilted along the helix: gives the sheath its slanted striations
      const along = new THREE.Vector3(-Math.sin(t), cfg.contracted ? 0.18 : 0.42, Math.cos(t)).normalize();
      frameQuat(rd, along, q);
      const col = (k % 2 ? PAL.sheath : PAL.sheathB);
      const s: [number, number, number] = cfg.contracted ? [0.034, 0.0075, 0.026] : [0.028, 0.0115, 0.02];
      B.add(p, q, s, jitterCol(col, r, 0.1), r(), 0.45);
    }
  }
  // termination ring at the top of the sheath
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.3;
    p.set(Math.cos(t) * sR * 0.85, neckY - 0.002, Math.sin(t) * sR * 0.85);
    B.add(p, id, [0.02, 0.008, 0.02], jitterCol(PAL.sheathB, r, 0.1), r(), 0);
  }
  p.set(0, baseTop + sheathLen / 2, 0);
  B.add(p, id, [sR * 0.75, sheathLen * 0.5, sR * 0.75], PAL.tube, r(), 0);
  const tubeTip = new THREE.Vector3(0, cfg.contracted ? -0.07 : 0.03, 0);
  if (cfg.contracted) {
    p.set(0, -0.01, 0);
    B.add(p, id, [0.016, 0.07, 0.016], PAL.sheathB.clone().multiplyScalar(0.8), r(), 0);
  }

  // ---------------- baseplate
  const bk = cfg.contracted ? 1.3 : 1;
  const bY = cfg.contracted ? -0.006 : 0;
  p.set(0, 0.068 + bY, 0);
  B.add(p, id, [0.05 * bk, 0.022, 0.05 * bk], PAL.baseB, r(), 0);
  const corners: THREE.Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    const t = (k / 6) * Math.PI * 2;
    const rd = new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
    for (const [rr, yy, sx] of [[0.045, 0.07, 0.026], [0.078, 0.064, 0.022]] as const) {
      p.copy(rd).multiplyScalar(rr * bk).setY(yy + bY);
      frameQuat(Y, rd, q);
      B.add(p, q, [sx * bk, 0.022, 0.017], jitterCol(PAL.base, r, 0.1), r(), 0.3);
    }
    p.copy(rd).multiplyScalar(0.108 * bk).setY(0.06 + bY);
    B.add(p, id, [0.022, 0.02, 0.022], jitterCol(PAL.base, r, 0.1), r(), 0);
    corners.push(p.clone());
    const t2 = t + Math.PI / 6;
    p.set(Math.cos(t2) * 0.05, 0.09 + bY, Math.sin(t2) * 0.05);
    B.add(p, id, [0.018, 0.012, 0.018], jitterCol(PAL.baseB, r, 0.1), r(), 0);
  }
  // short tail fibres (gp12), reaching down to the membrane
  for (const c0 of corners) {
    const dir = c0.clone().setY(0).normalize();
    const pEnd = dir.clone().multiplyScalar(cfg.pose === 'landed' ? 0.15 * bk : 0.12).setY(cfg.pose === 'landed' ? 0.004 : 0.02);
    const pMid = c0.clone().lerp(pEnd, 0.5).addScaledVector(dir, 0.01);
    chain(B, r, c0.clone().setY(c0.y - 0.01), pMid, pEnd, 0.0055, 0.006, PAL.base, PAL.tip, r() * 6, 0, 0.4, 1.3);
  }
  // long tail fibres, kinked at the knee
  const feet: THREE.Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    const t = (k / 6) * Math.PI * 2 + Math.PI / 6 + (r() - 0.5) * 0.3;
    const rd = new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
    const sd = new THREE.Vector3(-rd.z, 0, rd.x).multiplyScalar((r() - 0.5) * 0.08);
    const S = rd.clone().multiplyScalar(0.1).setY(0.078);
    let K: THREE.Vector3, Tp: THREE.Vector3;
    if (cfg.pose === 'landed') {
      K = rd.clone().multiplyScalar(0.36 + r() * 0.05).setY(0.27 + r() * 0.04).add(sd);
      Tp = rd.clone().multiplyScalar(0.55 + r() * 0.06).setY(0.006).addScaledVector(sd, 2.2);
    } else {
      K = rd.clone().multiplyScalar(0.27 + r() * 0.04).setY(-0.02 - r() * 0.05).add(sd);
      Tp = rd.clone().multiplyScalar(0.3 + r() * 0.08).setY(-0.32 - r() * 0.06).addScaledVector(sd, 2);
    }
    const ph = r() * 6.28;
    const m1 = S.clone().lerp(K, 0.5).add(new THREE.Vector3(0, 0.025, 0));
    chain(B, r, S, m1, K, 0.0068, 0.0064, PAL.fibre, PAL.fibre, ph, 0, 1);
    B.add(K, id, [0.0115, 0.0115, 0.0115], PAL.tip.clone().multiplyScalar(0.9), r(), 0, 0, 0.05, ph, 1);
    const m2 = K.clone().lerp(Tp, 0.5).addScaledVector(rd, 0.02).add(new THREE.Vector3(0, 0.02, 0));
    chain(B, r, K, m2, Tp, 0.0062, 0.0052, PAL.fibre, PAL.tip, ph, 1, 0);
    B.add(Tp, id, [0.009, 0.008, 0.009], PAL.tip, r(), 0, 0, 0.15, ph, 0);
    feet.push(Tp.clone());
  }
  return { headY, poly: P, feet, tubeTip };
}

// ------------------------------------------------------------------ the packed genome
/** Spacing between neighbouring DNA strands in the packed head: 2.5 nm. */
export const LAYER = 0.0125;
