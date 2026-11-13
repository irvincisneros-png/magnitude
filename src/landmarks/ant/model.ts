/**
 * The black garden ant (Lasius niger worker) as signed-distance fields, one rigid part each
 * (head, mesosoma + petiole + coxae, gaster, mandible, scape, funiculus and the femur, tibia and
 * tarsus of each leg pair). Pure maths, no Three.js, so it can run in a worker.
 *
 * Units here are MILLIMETRES. World frame = the landmark frame × 4 (1 unit = 4 mm): the skin of
 * the back of the hand passes through the origin with +Y up; the ant stands on the −X side facing
 * +X (towards the sand grain at the origin). +Z is the ant's right; left parts are mirror copies.
 *
 * Dimensions follow a ~4 mm worker: head ~0.9 mm, scape ~0.78 mm, funiculus (11 segments)
 * ~1.04 mm, mesosoma ~1.3 mm, petiole with an upright scale, gaster ~1.45 mm with four tergites,
 * legs with coxa, trochanter + femur, tibia (fore tibia with its grooming spur) and a five-segment
 * tarsus ending in two claws and an arolium.
 */

import { SUN_DIR } from './light';

export type V3 = [number, number, number];
export type SDF = (x: number, y: number, z: number) => number;

// ------------------------------------------------------------------ vector helpers
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3) => Math.sqrt(dot(a, a));
export const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const mirror = (a: V3): V3 => [a[0], a[1], -a[2]];

/** Orthonormal frame: p_world = o + x·px + y·py + z·pz. */
export interface Basis { o: V3; x: V3; y: V3; z: V3 }
export const toWorld = (b: Basis, p: V3): V3 => [
  b.o[0] + b.x[0] * p[0] + b.y[0] * p[1] + b.z[0] * p[2],
  b.o[1] + b.x[1] * p[0] + b.y[1] * p[1] + b.z[1] * p[2],
  b.o[2] + b.x[2] * p[0] + b.y[2] * p[1] + b.z[2] * p[2],
];
export const dirToWorld = (b: Basis, v: V3): V3 => sub(toWorld(b, v), b.o);
export const dirToLocal = (b: Basis, v: V3): V3 => [dot(v, b.x), dot(v, b.y), dot(v, b.z)];
/** Frame with x along `dir` and y as close as possible to `up`. */
export function aim(o: V3, dir: V3, up: V3): Basis {
  const x = norm(dir);
  const y = norm(sub(up, mul(x, dot(up, x))));
  return { o, x, y, z: cross(x, y) };
}
const rotZ = (v: V3, a: number): V3 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];

// ------------------------------------------------------------------ SDF primitives
export const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Exact round cone (Quilez) from a (radius r1) to b (radius r2). */
export function roundCone(a: V3, b: V3, r1: number, r2: number): SDF {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const srr = Math.sign(rr) * rr * rr;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const yy = px * bx + py * by + pz * bz;
    const zz = yy - l2;
    const qx = px * l2 - bx * yy, qy = py * l2 - by * yy, qz = pz * l2 - bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = srr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}
/** Axis-aligned ellipsoid (approximate distance, exact zero set). */
export function ell(c: V3, r: V3): SDF {
  const [a, b, cc] = r;
  return (x, y, z) => {
    const px = (x - c[0]) / a, py = (y - c[1]) / b, pz = (z - c[2]) / cc;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const k1 = Math.sqrt(px * px / (a * a) + py * py / (b * b) + pz * pz / (cc * cc));
    return k1 < 1e-12 ? -Math.min(a, b, cc) : (k0 * (k0 - 1)) / k1;
  };
}
export const sphere = (c: V3, r: number): SDF => (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
const capsuleD = (p: V3, a: V3, b: V3, r: number) => {
  const pa = sub(p, a), ba = sub(b, a);
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  return len(sub(pa, mul(ba, h))) - r;
};
/** Mirror-symmetric in z: evaluate a right-side SDF at |z|. */
const sym = (f: SDF): SDF => (x, y, z) => f(x, y, Math.abs(z));

// ------------------------------------------------------------------ value noise (deterministic)
function ih(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = ih(ix, iy, iz), b = ih(ix + 1, iy, iz), c = ih(ix, iy + 1, iz), d = ih(ix + 1, iy + 1, iz);
  const e = ih(ix, iy, iz + 1), f = ih(ix + 1, iy, iz + 1), g = ih(ix, iy + 1, iz + 1), h = ih(ix + 1, iy + 1, iz + 1);
  const l1 = a + (b - a) * fx, l2 = c + (d - c) * fx, l3 = e + (f - e) * fx, l4 = g + (h - g) * fx;
  const m1 = l1 + (l2 - l1) * fy, m2 = l3 + (l4 - l3) * fy;
  return m1 + (m2 - m1) * fz;
}

// ------------------------------------------------------------------ the place
/** 1 landmark unit in mm. */
export const UNIT_MM = 4;
/** Sun direction (see light.ts). */
export const SUN: V3 = SUN_DIR;
/** The back of the hand: the human scene's palm ellipsoid (metres) turned by the figure's yaw. */
const PALM: V3 = [0.049, 0.0135, 0.041];
const FIG_YAW = (80 * Math.PI) / 180;
/** Height of the skin (mm) under world point (x, z) in mm. */
export function groundY(x: number, z: number) {
  const xm = x * 1e-3, zm = z * 1e-3;
  const c = Math.cos(FIG_YAW), s = Math.sin(FIG_YAW);
  const hx = xm * c - zm * s, hz = xm * s + zm * c;
  const q = 1 - (hx * hx) / (PALM[0] * PALM[0]) - (hz * hz) / (PALM[2] * PALM[2]);
  return (-PALM[1] + PALM[1] * Math.sqrt(Math.max(q, 0))) * 1e3;
}
export const GROUND_GLSL = `
float groundYmm(vec2 xz) {
  vec2 m = xz * 1e-3;
  float c = ${Math.cos(FIG_YAW).toFixed(6)}, s = ${Math.sin(FIG_YAW).toFixed(6)};
  float hx = m.x * c - m.y * s, hz = m.x * s + m.y * c;
  float q = 1.0 - hx * hx / ${(PALM[0] * PALM[0]).toExponential(6)} - hz * hz / ${(PALM[2] * PALM[2]).toExponential(6)};
  return (-${PALM[1]} + ${PALM[1]} * sqrt(max(q, 0.0))) * 1e3;
}`;

// ------------------------------------------------------------------ rest pose (world mm, right side z > 0)
/** Trunk (mesosoma) pivot. */
export const TRUNK_O: V3 = [-3.0, 0.62, 0];
/** Neck joint and gaster joint in trunk-local mm. */
export const NECK: V3 = [0.82, 0.07, 0];
export const GASTER_J: V3 = [-0.86, -0.12, 0];
/** The head is carried nose-down by this angle (rotation about +Z). */
export const HEAD_PITCH = -0.42;
/** Head-local: antennal socket, mandible hinge, eye centre / radii (right side). */
export const SOCKET: V3 = [0.64, 0.13, 0.17];
export const HINGE: V3 = [0.8, -0.05, 0.18];
export const EYE_C: V3 = [0.44, 0.05, 0.352];
export const EYE_R: V3 = [0.115, 0.078, 0.07];
export const SCAPE_L = 0.78;
export const FUNI_SEG = [0.13, 0.085, 0.08, 0.08, 0.08, 0.08, 0.085, 0.085, 0.09, 0.09, 0.15];
export const FUNI_L = FUNI_SEG.reduce((a, b) => a + b, 0);
/** Rest directions (world) of the right scape and funiculus. */
export const SCAPE_DIR: V3 = norm([0.46, 0.56, 0.71]);
export const FUNI_DIR: V3 = norm([0.54, -0.62, 0.56]);
/** Mandible rest: pitched down relative to the head, opened slightly. */
export const MAND_PITCH = -0.32;
export const MAND_OPEN = -0.08; // negative = swung outwards (open)

export interface LegSpec {
  name: 'fore' | 'mid' | 'hind';
  coxaA: V3; coxaB: V3; ra: number; rb: number;
  /** Trochanter + femur, tibia and tarsus lengths. */
  Lf: number; Lt: number; Ltar: number;
  /** Ankle (tibia–tarsus joint) xz in world mm, and the direction the tarsus points. */
  foot: [number, number]; tarDir: V3;
  pole: V3;
}
export const LEGS: LegSpec[] = [
  { name: 'fore', coxaA: [0.38, -0.15, 0.13], coxaB: [0.44, -0.46, 0.19], ra: 0.1, rb: 0.065, Lf: 0.84, Lt: 0.66, Ltar: 0.7, foot: [-1.85, 0.95], tarDir: norm([0.55, 0, 0.83]), pole: norm([0.25, 1, 0.5]) },
  { name: 'mid', coxaA: [0.0, -0.2, 0.15], coxaB: [0.02, -0.42, 0.24], ra: 0.075, rb: 0.055, Lf: 0.88, Lt: 0.72, Ltar: 0.75, foot: [-2.85, 1.15], tarDir: norm([0.12, 0, 1]), pole: norm([0, 1, 0.55]) },
  { name: 'hind', coxaA: [-0.3, -0.2, 0.15], coxaB: [-0.36, -0.42, 0.26], ra: 0.075, rb: 0.055, Lf: 1.05, Lt: 0.88, Ltar: 0.92, foot: [-4.15, 1.05], tarDir: norm([-0.62, 0, 0.78]), pole: norm([-0.3, 0.8, 0.6]) },
];
/** Height of the ankle above the skin. */
export const ANKLE_H = 0.085;

/** Knee from a two-bone IK (hip T, ankle A, lengths, pole direction). */
export function solveKnee(T: V3, A: V3, L1: number, L2: number, pole: V3): V3 {
  const d = sub(A, T);
  const D = Math.min(len(d), L1 + L2 - 1e-4);
  const u = norm(d);
  const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const pv = norm(sub(pole, mul(u, dot(pole, u))));
  return add(add(T, mul(u, a)), mul(pv, h));
}

export interface Rest {
  trunk: Basis; head: Basis; gaster: Basis; mandible: Basis; scape: Basis; funiculus: Basis;
  legs: { femur: Basis; tibia: Basis; tarsus: Basis; T: V3; K: V3; A: V3 }[];
}
const I3 = (o: V3): Basis => ({ o, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });

/** Rest frames of the right-side parts in world mm. */
export function restPose(): Rest {
  const trunk = I3(TRUNK_O);
  const neckW = add(TRUNK_O, NECK);
  const head: Basis = { o: neckW, x: rotZ([1, 0, 0], HEAD_PITCH), y: rotZ([0, 1, 0], HEAD_PITCH), z: [0, 0, 1] };
  const gaster = I3(add(TRUNK_O, GASTER_J));
  const hingeW = toWorld(head, HINGE);
  const mdir = dirToWorld(head, rotY(rotZ([1, 0, 0], MAND_PITCH), MAND_OPEN));
  const mandible = aim(hingeW, mdir, dirToWorld(head, [0, 1, 0]));
  const sockW = toWorld(head, SOCKET);
  const scape = aim(sockW, SCAPE_DIR, [0, 1, 0]);
  const elbow = add(sockW, mul(SCAPE_DIR, SCAPE_L));
  const funiculus = aim(elbow, FUNI_DIR, [0, 1, 0]);
  const legs = LEGS.map((L) => {
    const T = add(TRUNK_O, L.coxaB);
    const A: V3 = [L.foot[0], groundY(L.foot[0], L.foot[1]) + ANKLE_H, L.foot[1]];
    const K = solveKnee(T, A, L.Lf, L.Lt, L.pole);
    return {
      femur: aim(T, sub(K, T), L.pole), tibia: aim(K, sub(A, K), L.pole),
      tarsus: aim(A, L.tarDir, [0, 1, 0]), T, K, A,
    };
  });
  return { trunk, head, gaster, mandible, scape, funiculus, legs };
}
function rotY(v: V3, a: number): V3 { return [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)]; }

/** Capsules (world mm) approximating the whole rest pose, both sides: for baked occlusion. */
export function restProxy(rest: Rest): SDF {
  const caps: [V3, V3, number][] = [];
  const headA = toWorld(rest.head, [0.25, 0.0, 0]), headB = toWorld(rest.head, [0.7, 0.0, 0]);
  const push = (a: V3, b: V3, r: number) => { caps.push([a, b, r]); if (Math.abs(a[2]) > 1e-6 || Math.abs(b[2]) > 1e-6) caps.push([mirror(a), mirror(b), r]); };
  caps.push([toWorld(rest.trunk, [0.5, 0.02, 0]), toWorld(rest.trunk, [-0.05, 0.02, 0]), 0.24]);
  caps.push([toWorld(rest.trunk, [-0.1, 0.0, 0]), toWorld(rest.trunk, [-0.45, 0.0, 0]), 0.19]);
  caps.push([toWorld(rest.gaster, [-0.45, 0.04, 0]), toWorld(rest.gaster, [-0.92, 0.04, 0]), 0.41]);
  for (const L of LEGS) push(add(TRUNK_O, L.coxaA), add(TRUNK_O, L.coxaB), L.rb);
  rest.legs.forEach((l, i) => {
    push(l.T, l.K, 0.05); push(l.K, l.A, 0.038);
    push(l.A, add(l.A, mul(LEGS[i].tarDir, LEGS[i].Ltar)), 0.022);
  });
  push(rest.scape.o, rest.funiculus.o, 0.032);
  push(rest.funiculus.o, add(rest.funiculus.o, mul(FUNI_DIR, FUNI_L)), 0.035);
  const hd = ell([0, 0, 0], [0.45, 0.21, 0.4]);
  return (x, y, z) => {
    const p: V3 = [x, y, z];
    let d = y - groundY(x, z);
    for (const [a, b, r] of caps) d = Math.min(d, capsuleD(p, a, b, r));
    // the head as an ellipsoid in its own frame
    const q = sub(p, rest.head.o);
    const lq = dirToLocal(rest.head, q);
    d = Math.min(d, hd(lq[0] - 0.45, lq[1], lq[2]));
    void headA; void headB;
    return d;
  };
}

// ------------------------------------------------------------------ part SDFs (local mm)
export interface PartSpec {
  name: string;
  sdf: SDF;
  lo: V3; hi: V3; h: number;
  /** 0 hard cuticle … 1 soft pale joint membrane. */
  mem?: (x: number, y: number, z: number) => number;
  /** Hairs per mm² (appressed pubescence, erect setae) and the local "backwards" flow. */
  hair: { app: number; erect: number; appLen: [number, number]; erectLen: [number, number]; flow: (p: V3, n: V3) => V3; erectWhere?: (p: V3, n: V3) => number };
  /** Which rest frame this part uses (for occlusion against the whole body). */
  frame: (r: Rest) => Basis;
}

const back = (): V3 => [-1, 0, 0];
const distal = (): V3 => [1, 0, 0];

function headSdf(): SDF {
  const capsule = ell([0.44, 0, 0], [0.45, 0.205, 0.385]);
  const lobes = sym(ell([0.25, 0.015, 0.15], [0.25, 0.19, 0.22]));
  const clyp = ell([0.76, 0.055, 0], [0.17, 0.115, 0.215]);
  const carina = ell([0.75, 0.155, 0], [0.13, 0.02, 0.012]);
  const frontal = sym(ell([0.6, 0.15, 0.09], [0.11, 0.022, 0.02]));
  const eye = sym(ell(EYE_C, EYE_R));
  const labrum = ell([0.92, -0.045, 0], [0.05, 0.03, 0.1]);
  const sock: V3 = SOCKET;
  // maxillary (long, 6-segmented) and labial palps, folded under the head
  const mp: V3[] = [[0.76, -0.12, 0.13], [0.84, -0.22, 0.155], [0.8, -0.32, 0.165], [0.71, -0.39, 0.155], [0.62, -0.42, 0.14]];
  const lp: V3[] = [[0.8, -0.12, 0.05], [0.87, -0.2, 0.06], [0.85, -0.28, 0.065]];
  const palps: SDF[] = [];
  for (let i = 0; i < mp.length - 1; i++) palps.push(sym(roundCone(mp[i], mp[i + 1], 0.021 - i * 0.002, 0.017 - i * 0.002)));
  for (let i = 0; i < lp.length - 1; i++) palps.push(sym(roundCone(lp[i], lp[i + 1], 0.017, 0.014)));
  const occ = sphere([-0.07, 0.1, 0], 0.11);
  return (x, y, z) => {
    // narrower towards the mouth
    const zz = z * (1 + 0.16 * smoothstep(0.35, 0.9, x));
    let d = smin(capsule(x, y, zz), lobes(x, y, zz), 0.1);
    d = smax(d, -occ(x, y, z), 0.06);
    d = smin(d, clyp(x, y, z), 0.06);
    d = smin(d, carina(x, y, z), 0.025);
    d = smin(d, frontal(x, y, z), 0.025);
    d = smin(d, eye(x, y, z), 0.018);
    d = smin(d, labrum(x, y, z), 0.025);
    // toruli: raised rims round the antennal sockets, with the socket pit
    const az = Math.abs(z);
    const rq = Math.hypot(x - sock[0], az - sock[2]);
    const torus = Math.hypot(rq - 0.045, y - sock[1]) - 0.02;
    d = smin(d, torus, 0.015);
    d = smax(d, -(Math.hypot(x - sock[0], y - sock[1] - 0.035, az - sock[2]) - 0.038), 0.01);
    // the neck opening (occipital foramen) behind
    d = smax(d, -(ell([-0.05, -0.03, 0], [0.09, 0.1, 0.12])(x, y, z)), 0.03);
    for (const p of palps) d = Math.min(d, p(x, y, z));
    // fine relief: a hint of the reticulate microsculpture at mesh scale
    d += 0.003 * (vnoise(x * 40, y * 40, z * 40) - 0.5);
    return d;
  };
}

function trunkSdf(): SDF {
  const pron = ell([0.42, 0.04, 0], [0.3, 0.25, 0.27]);
  const collar = roundCone([0.6, 0.06, 0], [0.92, 0.07, 0], 0.13, 0.085);
  const meson = ell([0.06, 0.1, 0], [0.28, 0.19, 0.195]);
  const pleur = ell([0.06, -0.08, 0], [0.31, 0.2, 0.215]);
  const metan = ell([-0.2, -0.02, 0], [0.12, 0.16, 0.16]);
  const prop = ell([-0.41, 0.0, 0], [0.21, 0.22, 0.19]);
  const stalkA = roundCone([-0.54, -0.1, 0], [-0.7, -0.12, 0], 0.07, 0.062);
  const scale = ell([-0.7, 0.05, 0], [0.05, 0.22, 0.15]);
  const stalkB = roundCone([-0.72, -0.12, 0], [-0.94, -0.12, 0], 0.062, 0.05);
  const coxae = LEGS.map((L) => sym(roundCone(L.coxaA, L.coxaB, L.ra, L.rb)));
  const spir: V3 = [-0.45, 0.06, 0.175];
  return (x, y, z) => {
    let d = smin(pron(x, y, z), meson(x, y, z), 0.12);
    d = smin(d, pleur(x, y, z), 0.1);
    d = smin(d, metan(x, y, z), 0.12);
    d = smin(d, prop(x, y, z), 0.1);
    // the metanotal groove: a dip between mesonotum and propodeum
    d = smax(d, -(ell([-0.2, 0.27, 0], [0.07, 0.1, 0.25])(x, y, z)), 0.06);
    d = smin(d, collar(x, y, z), 0.08);
    d = smin(d, stalkA(x, y, z), 0.06);
    d = smin(d, scale(x, y, z), 0.04);
    d = smin(d, stalkB(x, y, z), 0.03);
    for (const c of coxae) d = smin(d, c(x, y, z), 0.05);
    // propodeal spiracle: a small rimmed pore
    const az = Math.abs(z);
    const sp = Math.hypot(x - spir[0], y - spir[1], az - spir[2]);
    d = smin(d, sp - 0.028, 0.015);
    d = smax(d, -(Math.hypot(x - spir[0], y - spir[1], az - spir[2] - 0.022) - 0.016), 0.006);
    d += 0.003 * (vnoise(x * 36, y * 36, z * 36) - 0.5);
    return d;
  };
}
const trunkMem = (x: number, y: number, z: number) => {
  void z;
  // the neck membrane, and the joints at the petiole and coxae
  return Math.max(smoothstep(0.7, 0.8, x), smoothstep(-0.86, -0.92, x) * 0.8, smoothstep(-0.36, -0.44, y) * 0.5);
};

/** Gaster: tergites (with their overlapping hind margins) and the acidopore. */
export const TERGITES = [-0.5, -0.86, -1.1, -1.27];
function gasterSdf(): SDF {
  const main = ell([-0.69, 0.05, 0], [0.71, 0.4, 0.47]);
  const joint = roundCone([0.03, 0, 0], [-0.16, 0.0, 0], 0.055, 0.16);
  const acid = roundCone([-1.34, 0.02, 0], [-1.43, 0.0, 0], 0.045, 0.026);
  return (x, y, z) => {
    let d = main(x, y, z);
    // each tergite swells a little towards its hind margin, then steps down onto the next
    let lip = 0;
    let prev = 0.0;
    for (const xb of TERGITES) {
      if (x <= prev && x > xb - 0.012) { lip = smoothstep(prev, xb, x) * (1 - smoothstep(xb + 0.004, xb - 0.012, x)); break; }
      prev = xb;
    }
    d -= 0.022 * lip;
    d = smin(d, joint(x, y, z), 0.09);
    d = smin(d, acid(x, y, z), 0.05);
    d = smax(d, -(Math.hypot(x + 1.445, y, z) - 0.018), 0.008);
    d += 0.002 * (vnoise(x * 30, y * 30, z * 30) - 0.5);
    return d;
  };
}
const gasterMem = (x: number) => {
  let m = smoothstep(0.0, 0.04, x) * 0.8;
  for (const xb of TERGITES) m = Math.max(m, Math.exp(-(((x - xb + 0.025) / 0.012) ** 2)) * 0.5);
  return m;
};

/** Right mandible: a triangular blade with a toothed chewing margin facing the midline. */
function mandibleSdf(): SDF {
  // 2-D outline in the (x, z) plane: hinge at the origin, apex forward and inward
  const P: [number, number][] = [[0.0, 0.05], [0.2, 0.03], [0.33, -0.06], [0.37, -0.17], [0.12, -0.17], [0.0, -0.06]];
  const nE = P.length;
  const teeth = [0.335, 0.295, 0.26, 0.225, 0.19, 0.16, 0.13];
  return (x, y, z) => {
    // camber: the blade curves down and is thinner at the margins
    const yc = y + 0.35 * x * x;
    let d2 = -1e9;
    for (let i = 0; i < nE; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % nE];
      const ex = bx - ax, ez = bz - az, el = Math.hypot(ex, ez);
      // outward normal of a counter-clockwise polygon in (x, z)
      const nx = ez / el, nz = -ex / el;
      d2 = Math.max(d2, (x - ax) * nx + (z - az) * nz);
    }
    // the outer margin is curved: round it off
    d2 = smax(d2, Math.hypot(x - 0.06, z + 0.32) - 0.42, 0.04);
    // teeth along the chewing margin (z = -0.17): notches between them
    for (let i = 0; i < teeth.length - 1; i++) {
      const nxp = (teeth[i] + teeth[i + 1]) * 0.5;
      d2 = smax(d2, -(Math.hypot(x - nxp, z + 0.183) - 0.017 * (1 - i * 0.06)), 0.004);
    }
    // apical tooth hooks inward
    d2 = smin(d2, Math.hypot(x - 0.37, z + 0.185) - 0.022, 0.02);
    const th = 0.075 * (1 - smoothstep(0.0, 0.38, x) * 0.55) * (0.55 + 0.45 * smoothstep(-0.2, 0.0, z));
    const dy = Math.abs(yc) - th * 0.5;
    const r = 0.01;
    const dd = Math.min(Math.max(d2, dy), 0) + Math.hypot(Math.max(d2 + r, 0), Math.max(dy + r, 0)) - r;
    // condyle at the hinge
    return smin(dd, Math.hypot(x, y, z - 0.0) - 0.05, 0.03);
  };
}

/** Scape: bulb-like radicle, then a long shaft bowing slightly and thickening to the elbow. */
function scapeSdf(): SDF {
  const rad = sphere([0.02, 0, 0], 0.042);
  const neck = roundCone([0.03, 0, 0], [0.08, 0, 0], 0.024, 0.023);
  const shaft = roundCone([0.09, 0, 0], [SCAPE_L - 0.02, 0, 0], 0.027, 0.037);
  return (x, y, z) => {
    const bow = 0.035 * Math.sin((Math.PI * clamp(x, 0, SCAPE_L)) / SCAPE_L);
    const yb = y - bow;
    let d = smin(rad(x, y, z), neck(x, y, z), 0.012);
    d = smin(d, shaft(x, yb, z), 0.02);
    d = Math.min(d, Math.hypot(x - SCAPE_L, y, z) - 0.034);
    return d;
  };
}
const scapeMem = (x: number) => Math.max(smoothstep(0.035, 0.07, x) * (1 - smoothstep(0.07, 0.1, x)), smoothstep(SCAPE_L - 0.03, SCAPE_L, x) * 0.6);

/** Funiculus: pedicel and ten flagellomeres thickening slightly to the tip. */
function funiSdf(): SDF {
  const segs: SDF[] = [];
  let x0 = 0;
  FUNI_SEG.forEach((L, i) => {
    const ra = 0.026 + 0.017 * (i / (FUNI_SEG.length - 1));
    const last = i === FUNI_SEG.length - 1;
    const a: V3 = [x0 + 0.008, 0, 0], b: V3 = [x0 + L - (last ? 0.03 : 0.012), 0, 0];
    segs.push(roundCone(a, b, ra * (i === 0 ? 0.62 : 0.78), ra * (last ? 0.85 : 1)));
    x0 += L;
  });
  return (x, y, z) => {
    let d = 1e9;
    for (const s of segs) d = smin(d, s(x, y, z), 0.009);
    return d;
  };
}
const funiMem = (x: number) => {
  let x0 = 0, m = 0;
  for (const L of FUNI_SEG) { m = Math.max(m, Math.exp(-(((x - x0) / 0.008) ** 2))); x0 += L; }
  return m * 0.7;
};

function femurSdf(L: LegSpec): SDF {
  const tro = L.name === 'fore' ? 0.12 : 0.1;
  const a = roundCone([0.0, 0, 0], [tro - 0.02, 0, 0], 0.046, 0.04);
  const b = roundCone([tro + 0.01, 0, 0], [tro + 0.3 * (L.Lf - tro), 0.004, 0], 0.036, L.name === 'fore' ? 0.062 : 0.056);
  const c = roundCone([tro + 0.3 * (L.Lf - tro), 0.004, 0], [L.Lf - 0.03, 0, 0], L.name === 'fore' ? 0.062 : 0.056, 0.042);
  const knee = sphere([L.Lf, 0, 0], 0.036);
  return (x, y, z) => {
    const zz = z / 0.82; // femora are a little flattened
    let d = smin(a(x, y, zz) * 0.82, b(x, y, zz) * 0.82, 0.012);
    d = smin(d, c(x, y, zz) * 0.82, 0.02);
    d = smin(d, knee(x, y, z), 0.02);
    return d;
  };
}
const femurMem = (L: LegSpec) => {
  const tro = L.name === 'fore' ? 0.12 : 0.1;
  return (x: number) => Math.max(Math.exp(-(((x - tro + 0.005) / 0.014) ** 2)), smoothstep(L.Lf - 0.04, L.Lf, x) * 0.8);
};

function tibiaSdf(L: LegSpec): SDF {
  const shaft = roundCone([0.02, 0, 0], [L.Lt * 0.88, 0, 0], 0.029, 0.04);
  const end = roundCone([L.Lt * 0.88, 0, 0], [L.Lt - 0.012, 0, 0], 0.04, 0.034);
  // spurs at the tip: the fore tibia's curved, comb-edged calcar (used to clean the antennae);
  // a single slim spur on the mid and hind tibiae
  const spur: SDF[] = [];
  if (L.name === 'fore') {
    const p0: V3 = [L.Lt - 0.03, -0.03, -0.012], p1: V3 = [L.Lt + 0.02, -0.06, -0.02], p2: V3 = [L.Lt + 0.07, -0.06, -0.012];
    spur.push(roundCone(p0, p1, 0.013, 0.009), roundCone(p1, p2, 0.009, 0.003));
    for (let i = 0; i < 6; i++) {
      const t = 0.2 + i * 0.13;
      const q: V3 = [p0[0] + (p2[0] - p0[0]) * t, -0.06 + (t < 0.5 ? 0.02 * (0.5 - t) : 0), -0.016];
      spur.push(roundCone(q, add(q, [0.004, -0.02, -0.004]), 0.0035, 0.0012));
    }
  } else {
    spur.push(roundCone([L.Lt - 0.03, -0.03, 0], [L.Lt + 0.06, -0.05, 0], 0.009, 0.0025));
  }
  return (x, y, z) => {
    let d = smin(shaft(x, y, z), end(x, y, z), 0.02);
    d = smin(d, Math.hypot(x, y, z) - 0.03, 0.015);
    for (const s of spur) d = Math.min(d, s(x, y, z));
    return d;
  };
}

/** Tarsus: basitarsus sloping down to the skin, four short segments along it, claws and arolium. */
export function tarsusPts(L: LegSpec): V3[] {
  const f = [0.42, 0.15, 0.12, 0.1, 0.21];
  const pts: V3[] = [[0, 0, 0]];
  let x = 0;
  f.forEach((fi, i) => {
    x += fi * L.Ltar;
    pts.push([x, i === 0 ? -0.06 : -0.066, 0]);
  });
  return pts;
}
function tarsusSdf(L: LegSpec): SDF {
  const P = tarsusPts(L);
  const segs: SDF[] = [];
  const rs = [0.023, 0.02, 0.019, 0.018, 0.017];
  for (let i = 0; i < 5; i++) {
    const a = add(P[i], mul(norm(sub(P[i + 1], P[i])), 0.008)), b = sub(P[i + 1], mul(norm(sub(P[i + 1], P[i])), 0.006));
    segs.push(roundCone(a, b, rs[i] * 0.72, rs[i]));
  }
  const tip = P[5];
  const claws: SDF[] = [];
  for (const s of [-1, 1]) {
    const c0: V3 = [tip[0] + 0.005, tip[1] - 0.004, 0.011 * s], c1: V3 = [tip[0] + 0.03, tip[1] - 0.006, 0.016 * s], c2: V3 = [tip[0] + 0.05, tip[1] - 0.025, 0.017 * s];
    claws.push(roundCone(c0, c1, 0.0075, 0.005), roundCone(c1, c2, 0.005, 0.0018));
  }
  const arol = ell([tip[0] + 0.018, tip[1] - 0.012, 0], [0.018, 0.011, 0.014]);
  // the strigil: a comb of short stiff bristles on the fore basitarsus
  const comb: SDF[] = [];
  if (L.name === 'fore') {
    for (let i = 0; i < 9; i++) {
      const t = 0.08 + i * 0.09;
      const q = add(P[0], mul(sub(P[1], P[0]), t));
      comb.push(roundCone(add(q, [0, -0.012, -0.012]), add(q, [0.012, -0.03, -0.024]), 0.004, 0.0012));
    }
  }
  return (x, y, z) => {
    let d = 1e9;
    for (const s of segs) d = smin(d, s(x, y, z), 0.008);
    for (const c of claws) d = Math.min(d, c(x, y, z));
    d = smin(d, arol(x, y, z), 0.006);
    for (const c of comb) d = Math.min(d, c(x, y, z));
    return d;
  };
}
const tarsusMem = (L: LegSpec) => {
  const P = tarsusPts(L);
  return (x: number, y: number) => {
    let m = 0;
    for (let i = 1; i < 5; i++) m = Math.max(m, Math.exp(-(((x - P[i][0]) / 0.008) ** 2)) * 0.6);
    // the arolium is a soft pad
    m = Math.max(m, smoothstep(P[5][0] + 0.002, P[5][0] + 0.012, x) * smoothstep(P[5][1] - 0.006, P[5][1] - 0.014, y));
    return m;
  };
};

export function parts(): PartSpec[] {
  const H = (o: Partial<PartSpec['hair']>): PartSpec['hair'] => ({ app: 0, erect: 0, appLen: [0.03, 0.045], erectLen: [0.08, 0.13], flow: back, ...o });
  const out: PartSpec[] = [
    {
      name: 'head', sdf: headSdf(), lo: [-0.14, -0.48, -0.46], hi: [1.0, 0.25, 0.46], h: 0.011,
      hair: H({
        app: 380, erect: 16, appLen: [0.025, 0.04], erectLen: [0.06, 0.11],
        flow: (p) => (p[0] > 0.62 ? [1, 0, 0] : [-1, 0, 0]),
        erectWhere: (p, n) => (n[1] > 0.2 || n[1] < -0.5 ? 1 : 0.15) * (Math.hypot(p[0] - EYE_C[0], p[1] - EYE_C[1], Math.abs(p[2]) - EYE_C[2]) < 0.14 ? 0 : 1),
      }),
      frame: (r) => r.head,
    },
    {
      name: 'trunk', sdf: trunkSdf(), lo: [-1.0, -0.56, -0.4], hi: [0.96, 0.4, 0.4], h: 0.0135, mem: trunkMem,
      hair: H({ app: 300, erect: 14, erectLen: [0.08, 0.14], erectWhere: (p, n) => (n[1] > 0.45 && p[0] < 0.75 ? 1 : 0) }),
      frame: (r) => r.trunk,
    },
    {
      name: 'gaster', sdf: gasterSdf(), lo: [-1.5, -0.42, -0.5], hi: [0.1, 0.5, 0.5], h: 0.013, mem: (x) => gasterMem(x),
      hair: H({
        app: 950, erect: 30, appLen: [0.035, 0.05], erectLen: [0.1, 0.16],
        // erect setae stand in rows near the hind margins of the tergites
        erectWhere: (p, n) => {
          let m = 0;
          for (const xb of TERGITES) m = Math.max(m, Math.exp(-(((p[0] - xb - 0.07) / 0.05) ** 2)));
          return (n[1] > -0.2 ? 1 : 0.3) * (0.15 + 0.85 * m);
        },
      }),
      frame: (r) => r.gaster,
    },
    {
      name: 'mandible', sdf: mandibleSdf(), lo: [-0.07, -0.1, -0.24], hi: [0.42, 0.08, 0.1], h: 0.0045,
      hair: H({ app: 0, erect: 30, erectLen: [0.04, 0.08], flow: distal, erectWhere: (_p, n) => (n[1] > 0.3 ? 1 : 0) }),
      frame: (r) => r.mandible,
    },
    {
      name: 'scape', sdf: scapeSdf(), lo: [-0.04, -0.05, -0.05], hi: [SCAPE_L + 0.05, 0.09, 0.05], h: 0.0055, mem: scapeMem,
      hair: H({ app: 700, erect: 70, appLen: [0.025, 0.035], erectLen: [0.05, 0.08], flow: distal, erectWhere: (p) => (p[0] > 0.12 ? 1 : 0) }),
      frame: (r) => r.scape,
    },
    {
      name: 'funiculus', sdf: funiSdf(), lo: [-0.03, -0.05, -0.05], hi: [FUNI_L + 0.02, 0.05, 0.05], h: 0.0052, mem: funiMem,
      hair: H({ app: 1500, erect: 0, appLen: [0.018, 0.028], flow: distal }),
      frame: (r) => r.funiculus,
    },
  ];
  LEGS.forEach((L, i) => {
    out.push({
      name: `femur-${L.name}`, sdf: femurSdf(L), lo: [-0.06, -0.075, -0.065], hi: [L.Lf + 0.05, 0.075, 0.065], h: 0.0075, mem: femurMem(L),
      hair: H({ app: 320, erect: 8, appLen: [0.025, 0.04], flow: distal }),
      frame: (r) => r.legs[i].femur,
    });
    out.push({
      name: `tibia-${L.name}`, sdf: tibiaSdf(L), lo: [-0.04, -0.09, -0.06], hi: [L.Lt + 0.09, 0.055, 0.055], h: 0.0065,
      // Lasius niger: many standing hairs on the tibiae
      hair: H({ app: 420, erect: 45, appLen: [0.025, 0.04], erectLen: [0.05, 0.09], flow: distal }),
      frame: (r) => r.legs[i].tibia,
    });
    out.push({
      name: `tarsus-${L.name}`, sdf: tarsusSdf(L), lo: [-0.035, -0.12, -0.05], hi: [L.Ltar + 0.07, 0.035, 0.05], h: 0.004, mem: tarsusMem(L),
      hair: H({ app: 300, erect: 30, appLen: [0.02, 0.03], erectLen: [0.03, 0.05], flow: distal, erectWhere: (_p, n) => (n[1] < 0 ? 1 : 0.2) }),
      frame: (r) => r.legs[i].tarsus,
    });
  });
  return out;
}
