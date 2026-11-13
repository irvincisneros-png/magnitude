/**
 * The person, as a signed-distance field sculpted from smoothly blended forms, meshed once at
 * init with surface nets (vertices projected back onto the exact surface, normals from the SDF
 * gradient, ambient occlusion and thickness baked from the field). Pure maths, no Three.js, so it
 * can run in a worker.
 *
 * Body frame (metres): feet on the ground at y = 0, facing +X (east, out to sea), +Z = their right.
 * Everything is returned relative to H, the point on the skin of the back of the right hand, which
 * is the landmark origin. The right palm is a true ellipsoid around H (axes X/Y/Z), so the skin
 * close-up patch can follow the very same surface analytically.
 */

export type V3 = [number, number, number];
export interface MeshOut { pos: Float32Array; nrm: Float32Array; attr: Float32Array; mat: Float32Array; index: Uint32Array }
export interface FigureOut {
  meshes: { body: MeshOut; head: MeshOut; handR: MeshOut; handL: MeshOut };
  /** per hair: root xyz, normal xyz, flow dir xyz, length, seed (11 floats), H frame. */
  hairs: Float32Array;
  /** 16 capsules: a.xyz, ra, b.xyz, rb (H frame) for soft shadows. */
  capsules: Float32Array;
  /** H in the body frame (metres). */
  H: V3;
  /** Shoe footprints (H frame): cx, cz, fx, fz (unit forward), for each foot. */
  feet: Float32Array;
  /** A few useful anchors (H frame): head top, chest, a hair near the origin. */
  anchors: { headTop: V3; chest: V3; hairMid: V3; brim: V3 };
  ms: number;
}

// ------------------------------------------------------------------ vector helpers
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Combination of basis vectors: o + x·X + y·Y + z·Z. */
const comb = (o: V3, X: V3, x: number, Y: V3, y: number, Z: V3, z: number): V3 => [
  o[0] + X[0] * x + Y[0] * y + Z[0] * z, o[1] + X[1] * x + Y[1] * y + Z[1] * z, o[2] + X[2] * x + Y[2] * y + Z[2] * z,
];

type SDF = (x: number, y: number, z: number) => number;

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** Exact round cone (Quilez) between a (radius r1) and b (radius r2). */
function roundCone(a: V3, b: V3, r1: number, r2: number): SDF {
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

/** Ellipsoid with centre c, orthonormal axes X, Y, Z and semi-axes r (approximate distance, exact zero set). */
function ellipsoid(c: V3, X: V3, Y: V3, Z: V3, r: V3): SDF {
  const [r0, r1, r2] = r;
  const i0 = 1 / r0, i1 = 1 / r1, i2 = 1 / r2, j0 = i0 * i0, j1 = i1 * i1, j2 = i2 * i2;
  return (x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2];
    const lx = px * X[0] + py * X[1] + pz * X[2];
    const ly = px * Y[0] + py * Y[1] + pz * Y[2];
    const lz = px * Z[0] + py * Z[1] + pz * Z[2];
    const k0 = Math.sqrt(lx * lx * i0 * i0 + ly * ly * i1 * i1 + lz * lz * i2 * i2);
    const k1 = Math.sqrt(lx * lx * j0 * j0 + ly * ly * j1 * j1 + lz * lz * j2 * j2);
    return k1 < 1e-12 ? -Math.min(r0, r1, r2) : (k0 * (k0 - 1)) / k1;
  };
}
const AX: V3 = [1, 0, 0], AY: V3 = [0, 1, 0], AZ: V3 = [0, 0, 1];
const ellA = (c: V3, r: V3) => ellipsoid(c, AX, AY, AZ, r);
const sphere = (c: V3, r: number): SDF => (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;

/** Cheap bounding: far from the bounding sphere, return the (lower-bound) sphere distance. */
function bounded(f: SDF, c: V3, R: number, margin = 0.03): SDF {
  return (x, y, z) => {
    const dc = Math.hypot(x - c[0], y - c[1], z - c[2]) - R;
    return dc > margin ? dc : f(x, y, z);
  };
}

// ------------------------------------------------------------------ noise (value noise, deterministic)
function ih(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = ih(ix, iy, iz), b = ih(ix + 1, iy, iz), c = ih(ix, iy + 1, iz), d = ih(ix + 1, iy + 1, iz);
  const e = ih(ix, iy, iz + 1), f = ih(ix + 1, iy, iz + 1), g = ih(ix, iy + 1, iz + 1), h = ih(ix + 1, iy + 1, iz + 1);
  const l1 = a + (b - a) * fx, l2 = c + (d - c) * fx, l3 = e + (f - e) * fx, l4 = g + (h - g) * fx;
  const m1 = l1 + (l2 - l1) * fy, m2 = l3 + (l4 - l3) * fy;
  return m1 + (m2 - m1) * fz;
}

/** PCG-style 2D integer hash, identical to the GLSL `pcg2d` in shaders (used for hair follicles). */
export function pcg2d(x: number, y: number): [number, number] {
  let vx = (x >>> 0), vy = (y >>> 0);
  vx = (Math.imul(vx, 1664525) + 1013904223) >>> 0;
  vy = (Math.imul(vy, 1664525) + 1013904223) >>> 0;
  vx = (vx + Math.imul(vy, 1664525)) >>> 0;
  vy = (vy + Math.imul(vx, 1664525)) >>> 0;
  vx = (vx ^ (vx >>> 16)) >>> 0;
  vy = (vy ^ (vy >>> 16)) >>> 0;
  vx = (vx + Math.imul(vy, 1664525)) >>> 0;
  vy = (vy + Math.imul(vx, 1664525)) >>> 0;
  vx = (vx ^ (vx >>> 16)) >>> 0;
  vy = (vy ^ (vy >>> 16)) >>> 0;
  return [vx / 4294967296, vy / 4294967296];
}
/** Follicle grid spacing on the back of the hand (metres). Must match FOLLICLE in skin GLSL. */
export const FOLLICLE = 0.0021;

// ------------------------------------------------------------------ materials
export const MAT = { skin: 0, nail: 1, hair: 2, shirt: 3, trousers: 4, shoe: 5, sole: 6, lip: 7 } as const;

// ------------------------------------------------------------------ hand
interface HandSpec {
  Pc: V3; f: V3; n: V3; t: V3; // palm centre; fingers; back-of-hand normal; towards the thumb
  flex: number; spread: number; thumbIn: number;
}
interface Part { d: SDF; mat: (x: number, y: number, z: number) => number }

/** Semi-axes of the palm ellipsoid (along the fingers, thickness, across). */
export const PALM: V3 = [0.049, 0.0135, 0.041];
const WRIST_R: V3 = [0.45, 1.385, 0.37];
/** H: the skin point on the back of the right hand (body frame), i.e. the landmark origin. */
export const HAND_H: V3 = [WRIST_R[0] + 0.052, WRIST_R[1] + PALM[1], WRIST_R[2]];
/** The figure is authored facing +X and then turned by this angle about the vertical through H:
 *  it faces north-north-east (out over the bay to the sea), seen three-quarter from behind by the
 *  default camera. Rotation: x' = x cos + z sin, z' = −x sin + z cos. */
export const FIG_YAW = (80 * Math.PI) / 180;
const FC = Math.cos(FIG_YAW), FS = Math.sin(FIG_YAW);
export const rotY = (v: V3): V3 => [v[0] * FC + v[2] * FS, v[1], -v[0] * FS + v[2] * FC];
function rotArr(a: Float32Array, stride: number) {
  for (let i = 0; i < a.length; i += stride) {
    const x = a[i], z = a[i + 2];
    a[i] = x * FC + z * FS; a[i + 2] = -x * FS + z * FC;
  }
}
/** Where the feet stand (the body-frame origin) in H metres, after turning. */
export const FEET_H: V3 = rotY([-HAND_H[0], -HAND_H[1], -HAND_H[2]]);

function group(prims: SDF[], nail: SDF, pts: V3[]) {
  const c = mul(pts.reduce((a, b) => add(a, b), [0, 0, 0] as V3), 1 / pts.length);
  const R = Math.max(...pts.map((p) => len(sub(p, c)))) + 0.016;
  return { c, R, prims: prims.slice(), nail };
}

function makeHand(s: HandSpec): Part & { tips: V3[] } {
  const { Pc, f, n, t } = s;
  const pinky = mul(t, -1);
  const prims: SDF[] = [];
  const nails: SDF[] = [];
  const groups: { c: V3; R: number; prims: SDF[]; nail: SDF }[] = [];
  const pts: V3[] = [];
  const tips: V3[] = [];
  const palm = ellipsoid(Pc, f, n, t, PALM);
  // squarer outline and fuller palm underside (kept well below the back-of-hand surface near H)
  const slab = ellipsoid(comb(Pc, f, 0.002, n, -0.0035, t, 0), f, n, t, [0.05, 0.0098, 0.046]);
  const thenar = ellipsoid(comb(Pc, f, -0.014, n, -0.0085, t, 0.023), f, n, t, [0.033, 0.0135, 0.019]);
  const hypo = ellipsoid(comb(Pc, f, -0.008, n, -0.006, pinky, 0.027), f, n, pinky, [0.036, 0.0105, 0.014]);
  const knuckles: SDF[] = [];
  // fingers: index → pinky (index is on the thumb side)
  const side = [0.027, 0.0092, -0.0088, -0.0262];
  const fwd = [0.041, 0.0445, 0.042, 0.0345];
  const L = [[0.043, 0.025, 0.021], [0.048, 0.0295, 0.022], [0.045, 0.0275, 0.0215], [0.034, 0.0205, 0.019]];
  const R0 = [0.0098, 0.0101, 0.0095, 0.0083];
  const yaw = [0.09, 0.025, -0.04, -0.12].map((v) => v * s.spread);
  const flex = [[0.16, 0.26, 0.2], [0.13, 0.25, 0.2], [0.16, 0.28, 0.22], [0.2, 0.3, 0.24]];
  for (let i = 0; i < 4; i++) {
    const base = comb(Pc, f, fwd[i], n, 0.0015, t, side[i]);
    knuckles.push(sphere(comb(base, f, -0.006, n, 0.0035, t, 0), R0[i] * 1.06));
    const dy = norm(add(mul(f, Math.cos(yaw[i])), mul(t, Math.sin(yaw[i]))));
    let phi = 0.04;
    let J = base;
    let r = R0[i];
    prims.length = 0; nails.length = 0; pts.length = 0; pts.push(base);
    for (let k = 0; k < 3; k++) {
      phi += flex[i][k] * s.flex;
      const d = norm(add(mul(dy, Math.cos(phi)), mul(n, -Math.sin(phi))));
      const up = norm(add(mul(n, Math.cos(phi)), mul(dy, Math.sin(phi))));
      const r2 = k === 2 ? r * 0.86 : r * 0.9;
      const J2 = add(J, mul(d, L[i][k]));
      prims.push(roundCone(J, J2, r, r2));
      if (k === 2) {
        const sd = norm(cross(d, up));
        const nc = comb(J, d, L[i][k] * 0.62, up, r2 * 0.62, sd, 0);
        nails.push(ellipsoid(nc, d, up, sd, [L[i][k] * 0.44, r2 * 0.32, r2 * 0.8]));
        tips.push(J2);
      }
      J = J2; r = r2; pts.push(J2);
    }
    groups.push(group(prims, nails[0], pts));
  }
  // thumb
  const cmc = comb(Pc, f, -0.03, n, -0.006, t, 0.03);
  const mcp = add(cmc, norm(comb([0, 0, 0], f, 0.03, n, -0.012, t, 0.02 * s.thumbIn)) .map((v) => v * 0.04) as V3);
  const ipd = norm(comb([0, 0, 0], f, 0.8, n, -0.38, t, 0.08 * s.thumbIn));
  const ip = add(mcp, mul(ipd, 0.032));
  const tipd = norm(comb([0, 0, 0], f, 0.86, n, -0.42, t, -0.06));
  const tip = add(ip, mul(tipd, 0.027));
  prims.length = 0; nails.length = 0;
  prims.push(roundCone(cmc, mcp, 0.0135, 0.0112), roundCone(mcp, ip, 0.0112, 0.0102), roundCone(ip, tip, 0.0102, 0.0088));
  {
    const up = norm(cross(cross(tipd, n), tipd));
    const upn: V3 = dot(up, n) < 0 ? mul(up, -1) : up;
    const sd = norm(cross(tipd, upn));
    nails.push(ellipsoid(comb(ip, tipd, 0.017, upn, 0.0058, sd, 0), tipd, upn, sd, [0.0115, 0.003, 0.0072]));
    tips.push(tip);
    groups.push(group(prims, nails[0], [cmc, mcp, ip, tip]));
  }
  // wrist bump (ulnar styloid)
  const styloid = sphere(comb(Pc, f, -0.056, n, 0.006, pinky, 0.022), 0.0075);

  const fingersD: SDF = (x, y, z) => {
    let d = 1e9;
    for (const g of groups) {
      const b = Math.hypot(x - g.c[0], y - g.c[1], z - g.c[2]) - g.R;
      if (b > 0.012) { d = Math.min(d, b); continue; }
      let e = 1e9;
      for (const p of g.prims) e = smin(e, p(x, y, z), 0.0035);
      d = smin(d, smin(e, g.nail(x, y, z) + 0.0004, 0.0016), 0.003);
    }
    return d;
  };
  const nailD: SDF = (x, y, z) => {
    let d = 1e9;
    for (const g of groups) {
      const b = Math.hypot(x - g.c[0], y - g.c[1], z - g.c[2]) - g.R;
      d = Math.min(d, b > 0.004 ? b : g.nail(x, y, z));
    }
    return d;
  };
  const d: SDF = (x, y, z) => {
    let h = smin(palm(x, y, z), slab(x, y, z), 0.006);
    h = smin(h, thenar(x, y, z), 0.012);
    h = smin(h, hypo(x, y, z), 0.01);
    for (const k of knuckles) h = smin(h, k(x, y, z), 0.008);
    h = smin(h, styloid(x, y, z), 0.006);
    return smin(h, fingersD(x, y, z), 0.011);
  };
  const mat = (x: number, y: number, z: number) => (nailD(x, y, z) < 0.0006 ? MAT.nail : MAT.skin);
  return { d, mat, tips };
}

// ------------------------------------------------------------------ surface nets
const AO_T = [0.006, 0.018, 0.05];
interface MeshOpts { lo: V3; hi: V3; h: number; sdf: SDF; mat: (x: number, y: number, z: number) => number; ao: SDF; extra?: (p: V3, out: Float32Array, o: number) => void }

function meshSDF(o: MeshOpts, H: V3): MeshOut {
  const { lo, hi, h } = o;
  const sdf = o.sdf;
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  // three-level narrow band: coarse (8h) → medium (2h) → fine, evaluating only near the surface
  const C = 8, M = 2;
  const cnx = Math.floor((nx - 1) / C) + 2, cny = Math.floor((ny - 1) / C) + 2, cnz = Math.floor((nz - 1) / C) + 2;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++)
    coarse[i + cnx * (j + cny * k)] = sdf(lo[0] + (i + 0.5) * C * h, lo[1] + (j + 0.5) * C * h, lo[2] + (k + 0.5) * C * h);
  const mnx = Math.floor((nx - 1) / M) + 2, mny = Math.floor((ny - 1) / M) + 2, mnz = Math.floor((nz - 1) / M) + 2;
  const med = new Float32Array(mnx * mny * mnz).fill(NaN);
  const marginC = 1.25 * C * h, marginM = 1.3 * M * h;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = lo[2] + k * h, ck = Math.min(cnz - 1, Math.floor(k / C)), mk = Math.floor(k / M);
    for (let j = 0; j < ny; j++) {
      const y = lo[1] + j * h, cj = Math.min(cny - 1, Math.floor(j / C)), mj = Math.floor(j / M);
      for (let i = 0; i < nx; i++) {
        const dc = coarse[Math.min(cnx - 1, Math.floor(i / C)) + cnx * (cj + cny * ck)];
        if (Math.abs(dc) > marginC) { field[i + nx * (j + ny * k)] = dc; continue; }
        const mi = Math.floor(i / M), mIdx = mi + mnx * (mj + mny * mk);
        let dm = med[mIdx];
        if (dm !== dm) { dm = sdf(lo[0] + (mi + 0.5) * M * h, lo[1] + (mj + 0.5) * M * h, lo[2] + (mk + 0.5) * M * h); med[mIdx] = dm; }
        field[i + nx * (j + ny * k)] = Math.abs(dm) > marginM ? dm : sdf(lo[0] + i * h, y, z);
      }
    }
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellV = new Int32Array(cx * cy * cz).fill(-1);
  const P: number[] = [];
  const corner = new Float32Array(8);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cOff = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = field[(i + cOff[c][0]) + nx * ((j + cOff[c][1]) + ny * (k + cOff[c][2]))];
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of E) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += cOff[a][0] + (cOff[b][0] - cOff[a][0]) * t;
      sy += cOff[a][1] + (cOff[b][1] - cOff[a][1]) * t;
      sz += cOff[a][2] + (cOff[b][2] - cOff[a][2]) * t;
      m++;
    }
    cellV[i + cx * (j + cy * k)] = P.length / 3;
    P.push(lo[0] + (i + sx / m) * h, lo[1] + (j + sy / m) * h, lo[2] + (k + sz / m) * h);
  }
  const I: number[] = [];
  const cell = (i: number, j: number, k: number) => cellV[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    I.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const v0 = field[i + nx * (j + ny * k)];
    if (j > 0 && k > 0) {
      const v1 = field[i + 1 + nx * (j + ny * k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k));
    }
    if (i > 0 && k > 0) {
      const v1 = field[i + nx * (j + 1 + ny * k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k));
    }
    if (i > 0 && j > 0) {
      const v1 = field[i + nx * (j + ny * (k + 1))];
      if ((v0 < 0) !== (v1 < 0)) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k));
    }
  }
  // project onto the surface, normals from the gradient
  const nv = P.length / 3;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), attr = new Float32Array(nv * 4), mat = new Float32Array(nv);
  const e = h * 0.25;
  const grad = (x: number, y: number, z: number, out: number[]) => {
    // tetrahedral gradient
    const a = sdf(x + e, y - e, z - e), b = sdf(x - e, y - e, z + e), c = sdf(x - e, y + e, z - e), d = sdf(x + e, y + e, z + e);
    out[0] = a - b - c + d; out[1] = -a - b + c + d; out[2] = -a + b - c + d;
    return (a + b + c + d) * 0.25;
  };
  const g = [0, 0, 0];
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const iters = Math.hypot(x - H[0], y - H[1], z - H[2]) < 0.03 ? 3 : 1;
    for (let it = 0; it < iters; it++) {
      const d = grad(x, y, z, g);
      const gl2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gl2 < 1e-20) break;
      const gl = Math.sqrt(gl2);
      let step = (d * 4 * e) / gl; // Newton step along the unit normal (g = 4e·∇f)
      step = Math.max(-h, Math.min(h, step));
      x -= (g[0] / gl) * step; y -= (g[1] / gl) * step; z -= (g[2] / gl) * step;
    }
    const gl = Math.hypot(g[0], g[1], g[2]) || 1;
    const Nx = g[0] / gl, Ny = g[1] / gl, Nz = g[2] / gl;
    pos[v * 3] = x - H[0]; pos[v * 3 + 1] = y - H[1]; pos[v * 3 + 2] = z - H[2];
    nrm[v * 3] = Nx; nrm[v * 3 + 1] = Ny; nrm[v * 3 + 2] = Nz;
    // ambient occlusion from the whole figure
    let occ = 0, w = 1;
    for (const t of AO_T) {
      const dd = t < 0.01 ? sdf(x + Nx * t, y + Ny * t, z + Nz * t) : o.ao(x + Nx * t, y + Ny * t, z + Nz * t);
      occ += w * Math.max(0, t - dd) / t;
      w *= 0.62;
    }
    attr[v * 4] = Math.max(0, 1 - occ * 0.55);
    // thinness: how quickly we come out of the other side
    const di = sdf(x - Nx * 0.014, y - Ny * 0.014, z - Nz * 0.014);
    attr[v * 4 + 1] = Math.min(1, Math.max(0, 1 - -di / 0.011));
    mat[v] = o.mat(x, y, z);
    o.extra?.([x, y, z], attr, v * 4);
  }
  // consistent winding (outward)
  const index = new Uint32Array(I.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3], wy = pos[c * 3 + 1] - pos[a * 3 + 1], wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const s = fx * (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) + fy * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) + fz * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]);
    if (s >= 0) { index[t] = a; index[t + 1] = b; index[t + 2] = c; } else { index[t] = a; index[t + 1] = c; index[t + 2] = b; }
  }
  return { pos, nrm, attr, mat, index };
}

// ------------------------------------------------------------------ the figure
function solveElbow(S: V3, W: V3, L1: number, L2: number, pole: V3): V3 {
  const d = sub(W, S);
  const D = Math.min(len(d), L1 + L2 - 1e-4);
  const u = norm(d);
  const a = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const pv = norm(sub(pole, mul(u, dot(pole, u))));
  return add(add(S, mul(u, a)), mul(pv, hgt));
}

export function buildFigure(): FigureOut {
  const t0 = performance.now();
  // ---- skeleton (body frame, metres)
  const SR: V3 = [0.0, 1.415, 0.186], SL: V3 = [0.0, 1.41, -0.186];
  const WR = WRIST_R;
  const ER = solveElbow(SR, WR, 0.3, 0.262, [0.05, -0.75, 0.6]);
  const PcR: V3 = add(WR, [0.052, 0.0, 0.0]);
  const H = HAND_H;
  const uR = norm(sub(WR, ER));

  const EL: V3 = [-0.025, 1.12, -0.222];
  const WL: V3 = [0.03, 0.87, -0.214];
  const uL = norm(sub(WL, EL));
  // left hand hangs: fingers down, back of hand outwards (−Z), thumb forwards
  const fL = norm([0.12, -1, 0.02]);
  const nL0: V3 = [0, 0, -1];
  const nL = norm(sub(nL0, mul(fL, dot(nL0, fL))));
  const tL = norm(cross(nL, fL)); // thumb side: forwards (+X)
  const tLf: V3 = dot(tL, [1, 0, 0]) < 0 ? mul(tL, -1) : tL;
  const PcL: V3 = add(WL, mul(fL, 0.05));

  const hips: { L: V3; R: V3 } = { L: [-0.005, 0.905, -0.088], R: [-0.005, 0.905, 0.088] };
  const knee = { L: [0.004, 0.488, -0.1] as V3, R: [0.062, 0.495, 0.105] as V3 };
  const ankle = { L: [-0.012, 0.086, -0.106] as V3, R: [0.034, 0.088, 0.138] as V3 };
  const footDir = { L: norm([1, 0, -0.1]), R: norm([1, 0, 0.3]) };
  const neckPivot: V3 = [-0.012, 1.47, 0];
  const headYaw = 0.2, headPitch = 0.1;

  // ---- right hand + forearm (fine mesh)
  const handR = makeHand({ Pc: PcR, f: [1, 0, 0], n: [0, 1, 0], t: [0, 0, -1], flex: 1, spread: 1, thumbIn: 1 });
  const tR: V3 = [0, 0, -1];
  const foreStartR = add(ER, mul(uR, 0.035));
  const foreR1 = roundCone(add(foreStartR, mul(tR, 0.006)), add(WR, mul(tR, 0.009)), 0.0345, 0.0215);
  const foreR2 = roundCone(add(foreStartR, mul(tR, -0.006)), add(WR, mul(tR, -0.009)), 0.0345, 0.0215);
  const bulgeR = ellipsoid(add(ER, mul(uR, 0.075)), uR, norm(cross(tR, uR)), norm(cross(uR, norm(cross(tR, uR)))), [0.075, 0.037, 0.04]);
  const armR: SDF = (x, y, z) => {
    let d = smin(foreR1(x, y, z), foreR2(x, y, z), 0.02);
    d = smin(d, bulgeR(x, y, z), 0.03);
    // start inside the sleeve
    d = smax(d, -((x - foreStartR[0]) * uR[0] + (y - foreStartR[1]) * uR[1] + (z - foreStartR[2]) * uR[2]), 0.002);
    return d;
  };
  const handRd: SDF = (x, y, z) => smin(handR.d(x, y, z), armR(x, y, z), 0.018);

  // ---- left hand + forearm
  const handL = makeHand({ Pc: PcL, f: fL, n: nL, t: tLf, flex: 1.6, spread: 0.6, thumbIn: 0.4 });
  const foreStartL = add(EL, mul(uL, 0.035));
  const sideL = norm(cross(uL, [0, 0, 1]));
  const foreL1 = roundCone(add(foreStartL, mul(sideL, 0.006)), add(WL, mul(sideL, 0.009)), 0.034, 0.021);
  const foreL2 = roundCone(add(foreStartL, mul(sideL, -0.006)), add(WL, mul(sideL, -0.009)), 0.034, 0.021);
  const bulgeL = sphere(add(EL, mul(uL, 0.07)), 0.04);
  const handLd: SDF = (x, y, z) => {
    let d = smin(foreL1(x, y, z), foreL2(x, y, z), 0.02);
    d = smin(d, bulgeL(x, y, z), 0.03);
    d = smax(d, -((x - foreStartL[0]) * uL[0] + (y - foreStartL[1]) * uL[1] + (z - foreStartL[2]) * uL[2]), 0.002);
    return smin(handL.d(x, y, z), d, 0.018);
  };

  // ---- head (head-local coordinates, then rotated about the neck)
  const cy = Math.cos(headYaw), sy = Math.sin(headYaw), cp = Math.cos(headPitch), sp = Math.sin(headPitch);
  const toHead = (x: number, y: number, z: number): V3 => {
    // inverse of: rotate by pitch about Z (nod), then yaw about Y (turn right = towards +Z)
    let px = x - neckPivot[0], py = y - neckPivot[1], pz = z - neckPivot[2];
    // undo yaw (positive yaw turns the face from +X towards +Z)
    const qx = px * cy + pz * sy, qz = -px * sy + pz * cy;
    px = qx; pz = qz;
    const rx = px * cp - py * sp, ry = px * sp + py * cp;
    return [rx + neckPivot[0], ry + neckPivot[1], pz + neckPivot[2]];
  };
  const fromHead = (p: V3): V3 => {
    let px = p[0] - neckPivot[0], py = p[1] - neckPivot[1], pz = p[2] - neckPivot[2];
    const rx = px * cp + py * sp, ry = -px * sp + py * cp;
    px = rx; py = ry;
    const qx = px * cy - pz * sy, qz = px * sy + pz * cy;
    return [qx + neckPivot[0], py + neckPivot[1], qz + neckPivot[2]];
  };
  // An abstract, gallery-sculpture head: smooth skull and jaw with only soft brow, nose-bridge and
  // jaw planes (no eyes, lips or nostrils), under a wide-brimmed sun hat.
  const cran = ellA([-0.014, 1.607, 0], [0.098, 0.104, 0.0775]);
  const face = ellA([0.026, 1.548, 0], [0.066, 0.076, 0.059]);
  const chin = sphere([0.068, 1.49, 0], 0.022);
  const jawL = sphere([0.004, 1.505, -0.048], 0.022), jawR = sphere([0.004, 1.505, 0.048], 0.022);
  const brow = roundCone([0.074, 1.606, -0.034], [0.074, 1.606, 0.034], 0.012, 0.012);
  const bridge = roundCone([0.083, 1.598, 0], [0.095, 1.562, 0], 0.0065, 0.008);
  const earL = ellipsoid([-0.009, 1.572, -0.076], norm([0.96, 0.2, 0.18]), norm([-0.2, 0.98, 0]), norm([-0.18, 0, 0.98]), [0.016, 0.027, 0.008]);
  const earR = ellipsoid([-0.009, 1.572, 0.076], norm([0.96, 0.2, -0.18]), norm([-0.2, 0.98, 0]), norm([0.18, 0, 0.98]), [0.016, 0.027, 0.008]);
  const neck = roundCone([-0.022, 1.38, 0], [-0.006, 1.545, 0], 0.057, 0.049);
  const hairEll = ellA([-0.02, 1.612, 0], [0.104, 0.104, 0.084]);
  const crown = ellA([-0.014, 1.665, 0], [0.106, 0.072, 0.092]);
  const headLocal = (x: number, y: number, z: number) => {
    let d = smin(cran(x, y, z), face(x, y, z), 0.04);
    d = smin(d, chin(x, y, z), 0.03);
    d = smin(d, smin(jawL(x, y, z), jawR(x, y, z), 0.012), 0.035);
    d = smin(d, brow(x, y, z), 0.03);
    d = smin(d, bridge(x, y, z), 0.016);
    d = smin(d, Math.min(earL(x, y, z), earR(x, y, z)), 0.012);
    return d;
  };
  // a little hair below the hat brim, at the back and sides only
  const hairLocal = (x: number, y: number, z: number) => {
    let d = hairEll(x, y, z);
    const yl = 1.55 + 0.11 * smoothstep(-0.11, 0.06, x);
    d = smax(d, yl - y, 0.01);
    d = smax(d, x - 0.03, 0.02);
    d += 0.002 * (vnoise(x * 70, y * 70, z * 70) - 0.5);
    return d;
  };
  // wide-brimmed sun hat (woven straw): rounded crown and a gently drooping brim
  const hatLocal = (x: number, y: number, z: number) => {
    const cx = x + 0.014;
    let d = smax(crown(x, y, z), 1.628 - y, 0.004);
    const rr = Math.hypot(cx * 0.97, z * 1.04);
    const ang = Math.atan2(z, cx);
    const yb = 1.634 - 0.034 * smoothstep(0.1, 0.205, rr) + 0.004 * Math.sin(ang * 2 + 0.6) * smoothstep(0.12, 0.2, rr);
    const dy = Math.abs(y - yb) - 0.0028, dr = rr - 0.2;
    const brim = Math.hypot(Math.max(dy, 0), Math.max(dr, 0)) + Math.min(Math.max(dy, dr), 0) - 0.0018;
    d = smin(d, brim, 0.012);
    return d;
  };
  const headD: SDF = (x, y, z) => {
    const [a, b, c] = toHead(x, y, z);
    const sk = smin(headLocal(a, b, c), neck(x, y, z), 0.03);
    return Math.min(sk, hairLocal(a, b, c), hatLocal(a, b, c));
  };
  /** Head mesh ids (local to this mesh): 0 skin, 1 hair, 2 hat. */
  const headMat = (x: number, y: number, z: number) => {
    const [a, b, c] = toHead(x, y, z);
    const sk = smin(headLocal(a, b, c), neck(x, y, z), 0.03);
    const ht = hatLocal(a, b, c), hr = hairLocal(a, b, c);
    if (ht <= Math.min(sk, hr) + 0.0006) return 2;
    if (hr < sk + 0.0008) return 1;
    return 0;
  };

  // ---- body (shirt with rolled sleeves, trousers, shoes)
  const chest = ellA([0.008, 1.25, 0], [0.118, 0.16, 0.162]);
  const shL = roundCone([-0.012, 1.43, -0.035], [-0.006, 1.388, -0.152], 0.058, 0.056);
  const shR = roundCone([-0.012, 1.43, 0.035], [-0.006, 1.388, 0.152], 0.058, 0.056);
  const shoulders: SDF = (x, y, z) => smin(shL(x, y, z), shR(x, y, z), 0.03);
  const waist = ellA([-0.002, 1.06, 0], [0.112, 0.14, 0.152]);
  const pelvis = ellA([-0.008, 0.935, 0], [0.114, 0.115, 0.168]);
  const collarPts: V3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI * 0.86 + (i / 12) * Math.PI * 1.72; // opening at the front
    collarPts.push([-0.016 - Math.cos(a) * 0.066, 1.452 + 0.022 * Math.cos(a) * -1 - 0.0, Math.sin(a) * 0.072]);
  }
  const collar = collarPts.slice(1).map((p, i) => roundCone(collarPts[i], p, 0.0085, 0.0085));
  const sleeve = (S: V3, E: V3, u: V3) => {
    const C = add(E, mul(u, 0.07));
    const up = roundCone(S, E, 0.057, 0.047);
    const lowr = roundCone(E, C, 0.047, 0.045);
    const cuff = roundCone(add(C, mul(u, -0.03)), add(C, mul(u, -0.004)), 0.05, 0.05);
    return (x: number, y: number, z: number) => {
      let d = smin(up(x, y, z), lowr(x, y, z), 0.02);
      // folds around the elbow
      const along = (x - E[0]) * u[0] + (y - E[1]) * u[1] + (z - E[2]) * u[2];
      d += 0.0022 * Math.sin(along * 95 + vnoise(x * 30, y * 30, z * 30) * 4) * Math.exp(-(along * along) / 0.006);
      d = smin(d, cuff(x, y, z), 0.008);
      return smax(d, (x - C[0]) * u[0] + (y - C[1]) * u[1] + (z - C[2]) * u[2], 0.004);
    };
  };
  const sleeveR = sleeve(SR, ER, uR), sleeveL = sleeve(SL, EL, uL);
  const thighL = roundCone(hips.L, knee.L, 0.084, 0.06), thighR = roundCone(hips.R, knee.R, 0.084, 0.06);
  const shinL = roundCone(knee.L, add(ankle.L, [0, 0.05, 0]), 0.059, 0.048), shinR = roundCone(knee.R, add(ankle.R, [0, 0.05, 0]), 0.059, 0.048);
  const shoe = (A: V3, f: V3) => {
    const s = norm(cross(f, [0, 1, 0]));
    const upper = ellipsoid(comb(A, f, 0.065, AY, -0.042, s, 0), f, AY, s, [0.135, 0.05, 0.05]);
    const toe = ellipsoid(comb(A, f, 0.15, AY, -0.058, s, 0.004), f, AY, s, [0.07, 0.032, 0.045]);
    const collarS = roundCone(add(A, [0, -0.03, 0]), add(A, [0, 0.035, 0]), 0.045, 0.041);
    const soleC = comb(A, f, 0.07, AY, 0, s, 0.0);
    const sole: SDF = (x, y, z) => {
      const px = x - soleC[0], pz = z - soleC[2];
      const lx = px * f[0] + pz * f[2], lz = px * s[0] + pz * s[2];
      // rounded, foot-shaped slab from y = 0 to 0.022
      const w = 0.047 + 0.008 * smoothstep(-0.05, 0.08, lx) - 0.012 * smoothstep(0.09, 0.15, lx);
      const qx = Math.abs(lx) - 0.135, qz = Math.abs(lz) - w, qy = Math.abs(y - 0.012) - 0.011;
      const r = 0.008;
      const ox = Math.max(qx + r, 0), oy = Math.max(qy + r, 0), oz = Math.max(qz + r, 0);
      return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx + r, qy + r, qz + r), 0) - r;
    };
    const upperD: SDF = (x, y, z) => smax(smin(smin(upper(x, y, z), toe(x, y, z), 0.03), collarS(x, y, z), 0.03), 0.016 - y, 0.004);
    return { upperD, sole };
  };
  const shoeL = shoe(ankle.L, footDir.L), shoeR = shoe(ankle.R, footDir.R);

  const shirtD: SDF = (x, y, z) => {
    let d = smin(chest(x, y, z), shoulders(x, y, z), 0.06);
    d = smin(d, waist(x, y, z), 0.08);
    d = smin(d, pelvis(x, y, z) - 0.004, 0.05);
    d -= 0.006;
    // soft fabric folds
    d += 0.0028 * (vnoise(x * 22, y * 9, z * 22) - 0.5) + 0.0012 * (vnoise(x * 60, y * 25, z * 60) - 0.5);
    d = smax(d, 0.905 + 0.008 * Math.sin(z * 18 + x * 9) - y, 0.006);
    d = smin(d, sleeveR(x, y, z), 0.035);
    d = smin(d, sleeveL(x, y, z), 0.035);
    let c = 1e9;
    for (const s of collar) c = Math.min(c, s(x, y, z));
    d = smin(d, c, 0.008);
    return d;
  };
  const trousersD: SDF = (x, y, z) => {
    let d = smin(pelvis(x, y, z), smin(thighL(x, y, z), thighR(x, y, z), 0.03), 0.05);
    d = smin(d, smin(shinL(x, y, z), shinR(x, y, z), 0.01), 0.025);
    d += 0.0025 * (vnoise(x * 18, y * 26, z * 18) - 0.5);
    d = smax(d, 0.118 - y, 0.004);
    return smax(d, y - 1.02, 0.01);
  };
  const shoesD: SDF = (x, y, z) => Math.min(shoeL.upperD(x, y, z), shoeR.upperD(x, y, z));
  const solesD: SDF = (x, y, z) => Math.min(shoeL.sole(x, y, z), shoeR.sole(x, y, z));
  const shirtB = bounded(shirtD, [0.12, 1.2, 0.03], 0.5);
  const legsB = bounded((x, y, z) => Math.min(trousersD(x, y, z), shoesD(x, y, z), solesD(x, y, z)), [0.03, 0.5, 0], 0.56);
  const bodyD: SDF = (x, y, z) => Math.min(shirtB(x, y, z), legsB(x, y, z));
  const bodyMat = (x: number, y: number, z: number) => {
    const a = shirtD(x, y, z), b = trousersD(x, y, z), c = shoesD(x, y, z), d = solesD(x, y, z);
    const m = Math.min(a, b, c, d);
    return m === a ? MAT.shirt : m === b ? MAT.trousers : m === c ? MAT.shoe : MAT.sole;
  };

  // ---- capsule proxy of the whole figure: soft shadows, and AO between parts
  const caps: [V3, number, V3, number][] = [
    [fromHead([-0.01, 1.62, 0]), 0.1, fromHead([0.03, 1.54, 0]), 0.075],
    [[-0.015, 1.39, 0], 0.055, [-0.006, 1.52, 0], 0.05],
    [[0.0, 1.06, 0], 0.145, [0.0, 1.27, 0], 0.16],
    [[-0.008, 1.385, -0.14], 0.07, [-0.008, 1.385, 0.14], 0.07],
    [[-0.008, 0.93, -0.07], 0.12, [-0.008, 0.93, 0.07], 0.12],
    [hips.L, 0.08, knee.L, 0.06], [hips.R, 0.08, knee.R, 0.06],
    [knee.L, 0.056, ankle.L, 0.046], [knee.R, 0.056, ankle.R, 0.046],
    [add(ankle.L, mul(footDir.L, -0.04)), 0.045, add(ankle.L, add(mul(footDir.L, 0.18), [0, -0.04, 0])), 0.04],
    [add(ankle.R, mul(footDir.R, -0.04)), 0.045, add(ankle.R, add(mul(footDir.R, 0.18), [0, -0.04, 0])), 0.04],
    [SR, 0.052, ER, 0.045], [SL, 0.052, EL, 0.045],
    [ER, 0.038, WR, 0.026], [EL, 0.038, WL, 0.026],
    [add(PcR, [-0.03, -0.005, 0]), 0.026, add(PcR, [0.09, -0.012, 0]), 0.02],
  ];
  const capSdf = caps.map(([a, ra, b, rb]) => roundCone(a, b, ra, rb));
  const all: SDF = (x, y, z) => {
    let d = 1e9;
    for (const c of capSdf) d = Math.min(d, c(x, y, z));
    return d + 0.004;
  };


  // breathing and cloth-flutter weights (attr.z, attr.w)
  const chestC: V3 = [0.06, 1.24, 0];
  const extraBody = (p: V3, out: Float32Array, o: number) => {
    out[o + 2] = Math.exp(-(((p[0] - chestC[0]) ** 2) / 0.02 + ((p[1] - chestC[1]) ** 2) / 0.02 + (p[2] ** 2) / 0.03)) * smoothstep(-0.05, 0.08, p[0]);
    out[o + 3] = bodyMat(p[0], p[1], p[2]) === MAT.shirt ? smoothstep(1.15, 0.86, p[1]) * 0.8 + 0.2 : 0.08 * smoothstep(0.5, 0.15, p[1]);
  };
  const extraHead = (p: V3, out: Float32Array, o: number) => {
    out[o + 2] = 0;
    const hm = headMat(p[0], p[1], p[2]);
    // the hat brim flutters a little in the breeze
    out[o + 3] = hm === 2 ? 0.35 * smoothstep(0.12, 0.2, Math.hypot(p[0] + 0.02, p[2])) : hm === 1 ? 0.3 : 0;
  };

  // ---- meshes
  const bb = (pts: V3[], pad: number): [V3, V3] => {
    const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
    for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i] - pad); hi[i] = Math.max(hi[i], p[i] + pad); }
    return [lo, hi];
  };
  const [rLo, rHi] = bb([foreStartR, WR, PcR, ...handR.tips, add(PcR, [0, 0, 0.045]), add(PcR, [0, 0, -0.05])], 0.04);
  const [lLo, lHi] = bb([foreStartL, WL, PcL, ...handL.tips], 0.045);
  const handRMesh = meshSDF({ lo: rLo, hi: rHi, h: 0.0015, sdf: handRd, mat: handR.mat, ao: all }, H);
  const handLMesh = meshSDF({ lo: lLo, hi: lHi, h: 0.0024, sdf: handLd, mat: handL.mat, ao: all }, H);
  const headMesh = meshSDF({ lo: [-0.24, 1.375, -0.235], hi: [0.22, 1.76, 0.235], h: 0.0028, sdf: headD, mat: headMat, ao: all, extra: extraHead }, H);
  const [bLo, bHi] = bb([[-0.16, 0, -0.3], [0.33, 1.5, 0.27], add(ER, [0.08, 0, 0.08]), add(EL, [0, 0, -0.08])], 0.02);
  bLo[1] = -0.005;
  const bodyMesh = meshSDF({ lo: bLo, hi: bHi, h: 0.0064, sdf: bodyD, mat: bodyMat, ao: all, extra: extraBody }, H);

  // ---- hair follicles on the back of the right hand and forearm (same grid as the skin shader)
  const hairs: number[] = [];
  const g = FOLLICLE;
  const x0 = Math.floor((foreStartR[0] + 0.02 - H[0]) / g), x1 = Math.ceil((PcR[0] + 0.1 - H[0]) / g);
  const z0 = Math.floor((rLo[2] - H[2]) / g), z1 = Math.ceil((rHi[2] - H[2]) / g);
  let hairMid: V3 = [0.004, 0.0015, 0.003];
  let bestScore = 1e9;
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    const [jx, jz] = pcg2d(ix, iz);
    const [k1, k2] = pcg2d(ix + 7919, iz - 104729);
    const lx = (ix + 0.15 + 0.7 * jx) * g, lz = (iz + 0.15 + 0.7 * jz) * g; // H-relative
    if (Math.hypot(lx, lz) < 0.0016) continue; // keep the origin itself clear
    const X = lx + H[0], Z = lz + H[2];
    // sphere-trace down
    let Y = H[1] + 0.08, ok = false;
    for (let it = 0; it < 80; it++) {
      const d = handRd(X, Y, Z);
      if (d < 2e-6) { ok = true; break; }
      Y -= Math.max(d, 1e-5);
      if (Y < H[1] - 0.12) break;
    }
    if (!ok) continue;
    const e = 0.0004;
    const nx = handRd(X + e, Y, Z) - handRd(X - e, Y, Z), ny = handRd(X, Y + e, Z) - handRd(X, Y - e, Z), nz = handRd(X, Y, Z + e) - handRd(X, Y, Z - e);
    const nl = Math.hypot(nx, ny, nz) || 1;
    const N: V3 = [nx / nl, ny / nl, nz / nl];
    if (N[1] < 0.42) continue;
    if (handR.mat(X, Y, Z) !== MAT.skin) continue;
    // density: forearm > back of hand > fingers
    const onFingers = X > PcR[0] + 0.04;
    const onForearm = X < WR[0] - 0.005;
    const keep = onFingers ? (X < PcR[0] + 0.065 ? 0.3 : 0) : onForearm ? 0.92 : 0.6;
    if (k1 > keep) continue;
    // flow: distal along the hand, along the forearm towards the wrist, a little scatter
    const along: V3 = onForearm ? uR : [1, 0, 0];
    const sw = (k2 - 0.5) * 0.7 + 0.25 * Math.sin(lz * 160);
    let dir = norm(add(along, [0, 0, sw]));
    dir = norm(sub(dir, mul(N, dot(dir, N))));
    const hl = onFingers ? 0.0035 + k2 * 0.002 : onForearm ? 0.007 + k2 * 0.007 : 0.0045 + k2 * 0.004;
    // keep a clear view of the origin at the deepest zoom
    const tipX = lx + dir[0] * hl, tipZ = lz + dir[2] * hl;
    const segD = distPointSeg2(0, 0, lx, lz, tipX, tipZ);
    if (segD < 0.0012) continue;
    const root: V3 = [X - H[0], Y - H[1], Z - H[2]];
    hairs.push(root[0], root[1], root[2], N[0], N[1], N[2], dir[0], dir[1], dir[2], hl, k2);
    // label anchor: a hair a few mm from the origin, on the camera's (south-east) side
    const midX = lx + dir[0] * hl * 0.5, midZ = lz + dir[2] * hl * 0.5;
    const score = Math.abs(Math.hypot(midX, midZ) - 0.0016) - 0.003 * (midX * 0.34 + midZ * 0.94) / (Math.hypot(midX, midZ) || 1);
    if (score < bestScore) { bestScore = score; hairMid = [midX, root[1] + hl * 0.2, midZ]; }
  }

  const capsules = new Float32Array(16 * 8);
  caps.forEach(([a, ra, b, rb], i) => {
    capsules.set([a[0] - H[0], a[1] - H[1], a[2] - H[2], ra, b[0] - H[0], b[1] - H[1], b[2] - H[2], rb], i * 8);
  });
  const feet = new Float32Array([
    ankle.L[0] + footDir.L[0] * 0.07 - H[0], ankle.L[2] + footDir.L[2] * 0.07 - H[2], footDir.L[0], footDir.L[2],
    ankle.R[0] + footDir.R[0] * 0.07 - H[0], ankle.R[2] + footDir.R[2] * 0.07 - H[2], footDir.R[0], footDir.R[2],
  ]);
  const rel = (p: V3): V3 => rotY([p[0] - H[0], p[1] - H[1], p[2] - H[2]]);
  // turn the whole figure about the vertical through H (the origin stays put; +Y stays up)
  for (const m of [bodyMesh, headMesh, handRMesh, handLMesh]) { rotArr(m.pos, 3); rotArr(m.nrm, 3); }
  for (let i = 0; i < hairs.length; i += 11) for (const o of [0, 3, 6]) {
    const v = rotY([hairs[i + o], hairs[i + o + 1], hairs[i + o + 2]]);
    hairs[i + o] = v[0]; hairs[i + o + 1] = v[1]; hairs[i + o + 2] = v[2];
  }
  for (let i = 0; i < 16; i++) for (const o of [0, 4]) {
    const v = rotY([capsules[i * 8 + o], capsules[i * 8 + o + 1], capsules[i * 8 + o + 2]]);
    capsules.set(v, i * 8 + o);
  }
  for (let i = 0; i < 2; i++) {
    const c = rotY([feet[i * 4], 0, feet[i * 4 + 1]]), f = rotY([feet[i * 4 + 2], 0, feet[i * 4 + 3]]);
    feet.set([c[0], c[2], f[0], f[2]], i * 4);
  }
  const brimC = rel(fromHead([-0.014, 1.618, 0]));
  return {
    meshes: { body: bodyMesh, head: headMesh, handR: handRMesh, handL: handLMesh },
    hairs: new Float32Array(hairs),
    capsules,
    H,
    feet,
    anchors: { headTop: rel(fromHead([-0.01, 1.735, 0])), chest: rel([0.12, 1.25, 0.05]), hairMid: rotY(hairMid), brim: brimC },
    ms: performance.now() - t0,
  };
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function distPointSeg2(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax, vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
