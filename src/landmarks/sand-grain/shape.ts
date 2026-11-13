/**
 * Pure geometry for the sand-grain scene (no Three.js, runs in a worker):
 *  - signed-distance-like shape functions for the grains (lumpy sub-rounded bodies with
 *    conchoidal fracture facets and percussion pits),
 *  - radial meshing of those shapes,
 *  - a 3D distance/haze/stain grid of the quartz grain (the shader refracts through it),
 *  - a ground-light map for the skin: direct-sun visibility (shadows of every grain) and the
 *    caustic of sunlight refracted through the quartz, traced with photons (with dispersion).
 *
 * Units: 1 = 0.5 mm. Ground (skin) is the plane y = 0.
 */

// ------------------------------------------------------------------ layout (local units)
export interface Placement { x: number; z: number; yaw: number }
export const QUARTZ_AT: Placement = { x: -0.08, z: -0.66, yaw: 0 };
export const FELDSPAR_AT: Placement = { x: 1.5, z: -1.0, yaw: 0.7 };
export const HEAVY_AT: Placement = { x: -1.1, z: -1.3, yaw: -0.4 };
export const SHELL_AT: Placement = { x: 1.05, z: -2.2, yaw: 2.1 };
/** Ground-light map extent (world x, z) and resolution. */
export const MAP = { x0: -2.6, z0: -2.9, w: 4.7, h: 3.7, nx: 540, nz: 426 };
/** Quartz distance grid: cube [-B, B]^3 in the grain's object space. */
export const GRID = { B: 0.64, n: 64 };
export const SINK = 0.012;

// ------------------------------------------------------------------ noise
function hash3(x: number, y: number, z: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz, s), b = hash3(ix + 1, iy, iz, s), c = hash3(ix, iy + 1, iz, s), d = hash3(ix + 1, iy + 1, iz, s);
  const e = hash3(ix, iy, iz + 1, s), f = hash3(ix + 1, iy, iz + 1, s), g = hash3(ix, iy + 1, iz + 1, s), h = hash3(ix + 1, iy + 1, iz + 1, s);
  const l0 = a + (b - a) * fx, l1 = c + (d - c) * fx, l2 = e + (f - e) * fx, l3 = g + (h - g) * fx;
  const m0 = l0 + (l1 - l0) * fy, m1 = l2 + (l3 - l2) * fy;
  return m0 + (m1 - m0) * fz;
}
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};
type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

// ------------------------------------------------------------------ shapes
export interface Cut { n: V3; h: number; k: number; ripple: number; freq: number; c: V3 }
export interface ShapeSpec {
  seed: number; r: V3; lump: number; lumpF: number; fine: number;
  cuts: { n: V3; h: number; k: number; ripple?: number }[]; pits: number; pitR: [number, number];
}
export type ShapeFn = (x: number, y: number, z: number) => number;

export function makeShape(spec: ShapeSpec): ShapeFn {
  const [rx, ry, rz] = spec.r;
  const mr = Math.min(rx, ry, rz);
  const cuts: Cut[] = spec.cuts.map((c, i) => {
    const n = norm(c.n);
    const R = rng(spec.seed * 31 + i);
    // the impact point of a conchoidal fracture: ripples spread out from it across the facet
    const c0: V3 = [n[0] * c.h + (R() - 0.5) * 0.3, n[1] * c.h + (R() - 0.5) * 0.3, n[2] * c.h + (R() - 0.5) * 0.3];
    return { n, h: c.h, k: c.k, ripple: c.ripple ?? 0.004, freq: 38 + R() * 30, c: c0 };
  });
  const base: ShapeFn = (x, y, z) => {
    const q = Math.hypot(x / rx, y / ry, z / rz);
    let d = (q - 1) * mr;
    d += spec.lump * (vnoise(x * spec.lumpF + 3.1, y * spec.lumpF, z * spec.lumpF, spec.seed) - 0.5);
    d += spec.fine * (vnoise(x * spec.lumpF * 3.3, y * spec.lumpF * 3.3 + 7, z * spec.lumpF * 3.3, spec.seed + 1) - 0.5);
    for (const c of cuts) {
      const dx = x - c.c[0], dy = y - c.c[1], dz = z - c.c[2];
      const r = Math.hypot(dx, dy, dz);
      const pl = x * c.n[0] + y * c.n[1] + z * c.n[2] - c.h + c.ripple * Math.sin(r * c.freq) * Math.exp(-r * 2.5);
      d = smax(d, pl, c.k);
    }
    return d;
  };
  // percussion pits: small dish-shaped dents placed on the surface
  const pits: [number, number, number, number][] = [];
  const R = rng(spec.seed * 7 + 99);
  for (let i = 0; i < spec.pits; i++) {
    const dir = norm([R() * 2 - 1, R() * 1.6 - 0.5, R() * 2 - 1]);
    const r = rootAlong(base, dir);
    const pr = spec.pitR[0] + (spec.pitR[1] - spec.pitR[0]) * R() ** 2;
    pits.push([dir[0] * (r + pr * 0.55), dir[1] * (r + pr * 0.55), dir[2] * (r + pr * 0.55), pr]);
  }
  return (x, y, z) => {
    let d = base(x, y, z);
    for (const p of pits) {
      const dx = x - p[0], dy = y - p[1], dz = z - p[2];
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd > p[3] * p[3] * 4) continue;
      d = smax(d, p[3] - Math.sqrt(dd), p[3] * 0.5);
    }
    return d;
  };
}

/** Distance from the centre to the surface along a unit direction. */
function rootAlong(f: ShapeFn, d: V3) {
  let lo = 0, hi = 0.06;
  while (f(d[0] * hi, d[1] * hi, d[2] * hi) < 0 && hi < 2) { lo = hi; hi += 0.05; }
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) * 0.5;
    if (f(d[0] * m, d[1] * m, d[2] * m) < 0) lo = m; else hi = m;
  }
  return (lo + hi) * 0.5;
}

export const QUARTZ: ShapeSpec = {
  // the ellipsoid is deliberately larger than the grain: flat-ish conchoidal faces cut it down,
  // meeting at rounded ridges (sub-angular to sub-rounded), asymmetric
  seed: 11, r: [0.58, 0.44, 0.5], lump: 0.055, lumpF: 2.4, fine: 0.018,
  cuts: [
    { n: [0.7, 0.45, -0.55], h: 0.3, k: 0.05, ripple: 0.006 },
    { n: [-0.6, 0.5, 0.62], h: 0.28, k: 0.045, ripple: 0.005 },
    { n: [-0.9, 0.12, -0.4], h: 0.4, k: 0.04, ripple: 0.007 },
    { n: [0.82, 0.08, 0.55], h: 0.4, k: 0.05, ripple: 0.004 },
    { n: [0.12, 1, -0.22], h: 0.27, k: 0.06, ripple: 0.005 },
    { n: [-0.25, 0.62, -0.75], h: 0.31, k: 0.045, ripple: 0.006 },
    { n: [0.32, 0.38, 0.88], h: 0.33, k: 0.05, ripple: 0.004 },
    { n: [-0.7, -0.3, 0.2], h: 0.42, k: 0.06, ripple: 0.0 },
    { n: [0.05, -1, 0.05], h: 0.27, k: 0.1, ripple: 0.0 },
  ],
  pits: 5, pitR: [0.015, 0.035],
};
export const FELDSPAR: ShapeSpec = {
  // blocky: two cleavages near 90°, worn corners
  seed: 23, r: [0.44, 0.32, 0.38], lump: 0.03, lumpF: 3, fine: 0.01,
  cuts: [
    { n: [1, 0.05, 0], h: 0.25, k: 0.03, ripple: 0.0 },
    { n: [-1, 0.0, 0.08], h: 0.26, k: 0.03, ripple: 0.0 },
    { n: [0, 1, 0.1], h: 0.17, k: 0.035, ripple: 0.0 },
    { n: [0.05, 0.15, 1], h: 0.21, k: 0.03, ripple: 0.0 },
    { n: [0.0, 0.1, -1], h: 0.22, k: 0.03, ripple: 0.0 },
    { n: [0, -1, 0], h: 0.17, k: 0.05, ripple: 0.0 },
    { n: [0.6, 0.6, -0.5], h: 0.26, k: 0.04, ripple: 0.003 },
  ],
  pits: 6, pitR: [0.01, 0.03],
};
export const HEAVY: ShapeSpec = {
  seed: 37, r: [0.24, 0.17, 0.2], lump: 0.035, lumpF: 5, fine: 0.01,
  cuts: [
    { n: [0.8, 0.5, 0.2], h: 0.12, k: 0.015, ripple: 0.002 },
    { n: [-0.4, 0.7, -0.6], h: 0.11, k: 0.015, ripple: 0.0 },
    { n: [-0.7, 0.1, 0.7], h: 0.14, k: 0.02, ripple: 0.002 },
    { n: [0.2, 0.6, 0.8], h: 0.12, k: 0.015, ripple: 0.0 },
    { n: [0.6, -0.1, -0.8], h: 0.13, k: 0.02, ripple: 0.0 },
    { n: [-0.9, 0.3, -0.2], h: 0.15, k: 0.02, ripple: 0.0 },
    { n: [0, -1, 0], h: 0.1, k: 0.03, ripple: 0 },
  ],
  pits: 4, pitR: [0.008, 0.02],
};
/** Rough analytic stand-in for the shell fragment (for its shadow only): a tilted flat disc. */
export const SHELL = { R: 0.46, th: 0.15, curve: 1.3, tilt: 0.12 };

// ------------------------------------------------------------------ meshing
export interface MeshData { pos: Float32Array; nrm: Float32Array; index: Uint32Array; minY: number }

function icosphere(levels: number) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  v = v.map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
  for (let l = 0; l < levels; l++) {
    const cache = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let i = cache.get(key);
      if (i === undefined) {
        const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
        const len = Math.hypot(p[0], p[1], p[2]);
        i = v.push([p[0] / len, p[1] / len, p[2] / len]) - 1;
        cache.set(key, i);
      }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}

export function meshShape(fn: ShapeFn, levels: number): MeshData {
  const { v, f } = icosphere(levels);
  const n = v.length;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let minY = 1e9;
  const e = 0.0015;
  for (let i = 0; i < n; i++) {
    const d = v[i] as V3;
    const r = rootAlong(fn, d);
    const x = d[0] * r, y = d[1] * r, z = d[2] * r;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    minY = Math.min(minY, y);
    const g = norm([fn(x + e, y, z) - fn(x - e, y, z), fn(x, y + e, z) - fn(x, y - e, z), fn(x, y, z + e) - fn(x, y, z - e)]);
    nrm[i * 3] = g[0]; nrm[i * 3 + 1] = g[1]; nrm[i * 3 + 2] = g[2];
  }
  const index = new Uint32Array(f.length * 3);
  f.forEach((t, i) => { index[i * 3] = t[0]; index[i * 3 + 1] = t[1]; index[i * 3 + 2] = t[2]; });
  return { pos, nrm, index, minY };
}

// ------------------------------------------------------------------ half floats
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(val: number) {
  f32[0] = val;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  return sign | ((e << 10) + ((m + 0x1000) >> 13));
}

// ------------------------------------------------------------------ quartz grid
export interface Grid { n: number; B: number; d: Float32Array }
export interface Baked {
  quartz: MeshData; feldspar: MeshData; heavy: MeshData;
  /** A coarser quartz mesh (one icosphere level down: the same vertices, a quarter of the triangles)
   *  used while the grain is small on screen; absent when `quartz` is already that coarse (low). */
  quartzLo?: MeshData;
  grid: Uint16Array; map: Uint16Array; chips: Uint8Array;
  offsets: { quartz: number; feldspar: number; heavy: number; shell: number };
}

function sampleGrid(g: Grid, x: number, y: number, z: number) {
  const s = (g.n - 1) / (2 * g.B);
  const fx = (x + g.B) * s, fy = (y + g.B) * s, fz = (z + g.B) * s;
  if (fx < 0 || fy < 0 || fz < 0 || fx > g.n - 1.001 || fy > g.n - 1.001 || fz > g.n - 1.001) {
    // outside the grid: distance to the box plus a margin
    const ox = Math.max(Math.abs(x) - g.B, 0), oy = Math.max(Math.abs(y) - g.B, 0), oz = Math.max(Math.abs(z) - g.B, 0);
    return Math.hypot(ox, oy, oz) + 0.05;
  }
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const n = g.n, d = g.d;
  const i0 = ix + n * (iy + n * iz);
  const c00 = d[i0] + (d[i0 + 1] - d[i0]) * tx;
  const c10 = d[i0 + n] + (d[i0 + n + 1] - d[i0 + n]) * tx;
  const c01 = d[i0 + n * n] + (d[i0 + n * n + 1] - d[i0 + n * n]) * tx;
  const c11 = d[i0 + n * n + n] + (d[i0 + n * n + n + 1] - d[i0 + n * n + n]) * tx;
  const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}
function gridNormal(g: Grid, x: number, y: number, z: number): V3 {
  const e = 0.01;
  return norm([
    sampleGrid(g, x + e, y, z) - sampleGrid(g, x - e, y, z),
    sampleGrid(g, x, y + e, z) - sampleGrid(g, x, y - e, z),
    sampleGrid(g, x, y, z + e) - sampleGrid(g, x, y, z - e),
  ]);
}
function refract(I: V3, N: V3, eta: number): V3 | null {
  const c = I[0] * N[0] + I[1] * N[1] + I[2] * N[2];
  const k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null;
  const a = eta * c + Math.sqrt(k);
  return [eta * I[0] - a * N[0], eta * I[1] - a * N[1], eta * I[2] - a * N[2]];
}
function reflect(I: V3, N: V3): V3 {
  const c = 2 * (I[0] * N[0] + I[1] * N[1] + I[2] * N[2]);
  return [I[0] - c * N[0], I[1] - c * N[1], I[2] - c * N[2]];
}
const schlick = (cos: number) => 0.045 + 0.955 * Math.pow(1 - Math.abs(cos), 5);

/** Haze (milky cloud of tiny inclusions) and iron-stain fields, shared idea with the shader. */
function haze(x: number, y: number, z: number) {
  const n = vnoise(x * 3.2 + 1, y * 3.2, z * 3.2, 5) * 0.65 + vnoise(x * 8, y * 8, z * 8, 6) * 0.35;
  // a milky veil in the core, thinning towards the clearer rim
  const core = Math.max(0, 1 - Math.hypot(x / 0.42, (y + 0.05) / 0.3, z / 0.36));
  return Math.min(1, Math.max(0, (n - 0.45) * 2.4) * 0.8 + core * 0.35);
}
function stain(x: number, y: number, z: number) {
  const n = vnoise(x * 4 + 9, y * 4, z * 4, 8) * 0.6 + vnoise(x * 13, y * 13, z * 13, 9) * 0.4;
  return Math.min(1, Math.max(0, (n - 0.42) * 2.6));
}

export function bake(sun: V3, quality: 'low' | 'medium' | 'high'): Baked {
  const qF = makeShape(QUARTZ), fF = makeShape(FELDSPAR), hF = makeShape(HEAVY);
  const quartz = meshShape(qF, quality === 'low' ? 5 : 6);
  const quartzLo = quality === 'low' ? undefined : meshShape(qF, 5);
  const feldspar = meshShape(fF, quality === 'low' ? 4 : 5);
  const heavy = meshShape(hF, 4);
  const offsets = { quartz: -quartz.minY - SINK, feldspar: -feldspar.minY - SINK * 0.6, heavy: -heavy.minY - SINK * 0.4, shell: SHELL.th * 0.5 + (SHELL.R * SHELL.R) / (2 * SHELL.curve) + SHELL.tilt * SHELL.R * 0.6 - 0.03 };

  // ---- quartz grid (distance, haze, stain, 1)
  const { n, B } = GRID;
  const gd = new Float32Array(n * n * n);
  const grid = new Uint16Array(n * n * n * 4);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -B + (2 * B * i) / (n - 1), y = -B + (2 * B * j) / (n - 1), z = -B + (2 * B * k) / (n - 1);
    const d = qF(x, y, z);
    const o = i + n * (j + n * k);
    gd[o] = d;
    grid[o * 4] = toHalf(Math.max(-0.4, Math.min(0.4, d)));
    grid[o * 4 + 1] = toHalf(haze(x, y, z));
    grid[o * 4 + 2] = toHalf(stain(x, y, z));
    grid[o * 4 + 3] = toHalf(vnoise(x * 2.2 + 4, y * 2.2, z * 2.2, 12) * 0.75 + vnoise(x * 6 + 1.3, y * 6, z * 6, 13) * 0.25);
  }
  const G: Grid = { n, B, d: gd };

  // ---- ground-light map: rgb = refracted sunlight through the quartz (relative to open sun), a = direct sun visibility
  const { x0, z0, w, h, nx, nz } = MAP;
  const caus = new Float32Array(nx * nz * 3);
  const vis = new Float32Array(nx * nz).fill(1);
  const S = norm(sun);
  const cq: V3 = [QUARTZ_AT.x, offsets.quartz, QUARTZ_AT.z];

  // occluders for the shadow pass, in world space
  const toLocal = (p: Placement, oy: number) => {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    return (x: number, y: number, z: number): V3 => { const dx = x - p.x, dz = z - p.z; return [dx * c - dz * s, y - oy, dx * s + dz * c]; };
  };
  const shellLocal = toLocal(SHELL_AT, offsets.shell);
  const occ: { c: V3; r: number; f: ShapeFn }[] = [
    { c: cq, r: 0.62, f: (x, y, z) => sampleGrid(G, x - cq[0], y - cq[1], z - cq[2]) },
    (() => { const L = toLocal(FELDSPAR_AT, offsets.feldspar); return { c: [FELDSPAR_AT.x, offsets.feldspar, FELDSPAR_AT.z] as V3, r: 0.42, f: (x: number, y: number, z: number) => { const q = L(x, y, z); return fF(q[0], q[1], q[2]); } }; })(),
    (() => { const L = toLocal(HEAVY_AT, offsets.heavy); return { c: [HEAVY_AT.x, offsets.heavy, HEAVY_AT.z] as V3, r: 0.24, f: (x: number, y: number, z: number) => { const q = L(x, y, z); return hF(q[0], q[1], q[2]); } }; })(),
    {
      c: [SHELL_AT.x, offsets.shell, SHELL_AT.z], r: SHELL.R + 0.1,
      f: (x, y, z) => { const q = shellLocal(x, y, z); const yy = q[1] - SHELL.tilt * q[0] + (q[0] * q[0] + q[2] * q[2]) / (2 * SHELL.curve); return Math.max(Math.abs(yy) - SHELL.th * 0.5, Math.hypot(q[0], q[2]) - SHELL.R); },
    },
  ];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const px = x0 + ((i + 0.5) / nx) * w, pz = z0 + ((j + 0.5) / nz) * h;
    let v = 1;
    for (const o of occ) {
      // does the sun ray from (px, 0, pz) pass the occluder's bounding sphere?
      const ox = px - o.c[0], oy = -o.c[1], oz = pz - o.c[2];
      const b = ox * S[0] + oy * S[1] + oz * S[2];
      const cc = ox * ox + oy * oy + oz * oz - o.r * o.r;
      if (b * b - cc < 0 || (b > 0 && cc > 0)) continue;
      let t = Math.max(0.002, -b - o.r * 1.2);
      const tEnd = -b + o.r * 1.2;
      let res = 1;
      for (let k = 0; k < 60 && t < tEnd; k++) {
        const d = o.f(px + S[0] * t, S[1] * t, pz + S[2] * t);
        if (d < 0.0005) { res = 0; break; }
        res = Math.min(res, (d / t) * 120);
        t += Math.max(d * 0.9, 0.003);
      }
      v = Math.min(v, Math.max(0, res));
      if (v <= 0) break;
    }
    vis[i + j * nx] = v * v * (3 - 2 * v);
  }

  // photons through the quartz
  const up: V3 = Math.abs(S[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm([S[1] * up[2] - S[2] * up[1], S[2] * up[0] - S[0] * up[2], S[0] * up[1] - S[1] * up[0]]);
  const e2: V3 = [S[1] * e1[2] - S[2] * e1[1], S[2] * e1[0] - S[0] * e1[2], S[0] * e1[1] - S[1] * e1[0]];
  const texA = (w / nx) * (h / nz);
  const perTexel = quality === 'low' ? 3 : 5;
  const rho = perTexel / (texA * S[1]);
  const Rb = 0.62;
  const side = Math.ceil(Math.sqrt(rho) * 2 * Rb);
  const step = (2 * Rb) / side;
  const expected = rho * S[1] * texA; // photons per texel under open sun
  const wgt = 1 / expected;
  const R = rng(1234);
  const etas = [1.535, 1.544, 1.553];
  for (let a = 0; a < side; a++) for (let b = 0; b < side; b++) {
    const u = -Rb + (a + R()) * step, v2 = -Rb + (b + R()) * step;
    if (u * u + v2 * v2 > Rb * Rb) continue;
    const ch = (a + b * 2) % 3;
    // sun disc jitter (0.27° radius)
    const ja = (R() - 0.5) * 0.009, jb = (R() - 0.5) * 0.009;
    let D: V3 = norm([-S[0] + e1[0] * ja + e2[0] * jb, -S[1] + e1[1] * ja + e2[1] * jb, -S[2] + e1[2] * ja + e2[2] * jb]);
    let p: V3 = [cq[0] + S[0] * 1.2 + e1[0] * u + e2[0] * v2, cq[1] + S[1] * 1.2 + e1[1] * u + e2[1] * v2, cq[2] + S[2] * 1.2 + e1[2] * u + e2[2] * v2];
    // march to the surface
    let t = 0, hit = false;
    for (let k = 0; k < 64 && t < 2.6; k++) {
      const d = sampleGrid(G, p[0] + D[0] * t - cq[0], p[1] + D[1] * t - cq[1], p[2] + D[2] * t - cq[2]);
      if (d < 0.0008) { hit = true; break; }
      t += Math.max(d * 0.9, 0.002);
    }
    if (!hit) continue;
    p = [p[0] + D[0] * t, p[1] + D[1] * t, p[2] + D[2] * t];
    let N = gridNormal(G, p[0] - cq[0], p[1] - cq[1], p[2] - cq[2]);
    // frosted surface: scatter the surface normal
    const fr = 0.07;
    N = norm([N[0] + (R() - 0.5) * fr * 2, N[1] + (R() - 0.5) * fr * 2, N[2] + (R() - 0.5) * fr * 2]);
    const eta = etas[ch];
    const T1 = 1 - schlick(D[0] * N[0] + D[1] * N[1] + D[2] * N[2]);
    let Dn = refract(D, N, 1 / eta);
    if (!Dn) continue;
    D = Dn;
    let energy = T1;
    let out = false;
    for (let bounce = 0; bounce < 3 && !out; bounce++) {
      let s = 0.01, len = 0;
      for (let k = 0; k < 64; k++) {
        const d = sampleGrid(G, p[0] + D[0] * s - cq[0], p[1] + D[1] * s - cq[1], p[2] + D[2] * s - cq[2]);
        if (d > -0.0008) break;
        s += Math.max(-d * 0.9, 0.003);
      }
      len += s;
      p = [p[0] + D[0] * s, p[1] + D[1] * s, p[2] + D[2] * s];
      energy *= Math.exp(-len * 0.35); // haze scatters some light out of the beam
      const No = gridNormal(G, p[0] - cq[0], p[1] - cq[1], p[2] - cq[2]);
      const Ni: V3 = [-No[0], -No[1], -No[2]];
      Dn = refract(D, Ni, eta);
      if (Dn) {
        energy *= 1 - schlick(D[0] * No[0] + D[1] * No[1] + D[2] * No[2]);
        D = Dn; out = true;
      } else {
        D = reflect(D, Ni);
        p = [p[0] + D[0] * 0.004, p[1] + D[1] * 0.004, p[2] + D[2] * 0.004];
      }
    }
    if (!out || D[1] >= -1e-3) continue;
    const tg = -p[1] / D[1];
    if (tg < 0) continue;
    const gx = p[0] + D[0] * tg, gz = p[2] + D[2] * tg;
    const fx = ((gx - x0) / w) * nx - 0.5, fz = ((gz - z0) / h) * nz - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= nx - 1 || iz >= nz - 1) continue;
    const tx = fx - ix, tz = fz - iz;
    const e = energy * wgt * 3;
    const put = (ii: number, jj: number, ww: number) => { caus[((ii + jj * nx) * 3) + ch] += e * ww; };
    put(ix, iz, (1 - tx) * (1 - tz)); put(ix + 1, iz, tx * (1 - tz)); put(ix, iz + 1, (1 - tx) * tz); put(ix + 1, iz + 1, tx * tz);
  }
  // light 3x3 blur of the photon map (denoise), keep caustic lines crisp-ish
  const blurred = new Float32Array(caus.length);
  const K = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (let c = 0; c < 3; c++) {
    let s = 0, ws = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const k = K[(dj + 1) * 3 + di + 1];
      s += caus[(ii + jj * nx) * 3 + c] * k; ws += k;
    }
    blurred[(i + j * nx) * 3 + c] = s / ws;
  }
  const map = new Uint16Array(nx * nz * 4);
  for (let i = 0; i < nx * nz; i++) {
    map[i * 4] = toHalf(Math.min(40, blurred[i * 3]));
    map[i * 4 + 1] = toHalf(Math.min(40, blurred[i * 3 + 1]));
    map[i * 4 + 2] = toHalf(Math.min(40, blurred[i * 3 + 2]));
    map[i * 4 + 3] = toHalf(vis[i]);
  }
  return { quartz, quartzLo, feldspar, heavy, grid, map, offsets, chips: bakeChips() };
}

/** Tileable Voronoi "chips" texture: CHIP.period cells per axis, CHIP.res texels per axis.
 *  rgb = the chip's facet tilt (×0.5 + 0.5), a = distance to the chip border (0 on the border). */
export const CHIP = { period: 8, res: 64 };
function bakeChips(): Uint8Array {
  const { period: P, res: N } = CHIP;
  const pts = new Float32Array(P * P * P * 3);
  const tilt = new Float32Array(P * P * P * 3);
  const R = rng(777);
  for (let i = 0; i < P * P * P; i++) {
    for (let k = 0; k < 3; k++) { pts[i * 3 + k] = 0.1 + R() * 0.8; tilt[i * 3 + k] = R() * 2 - 1; }
  }
  const out = new Uint8Array(N * N * N * 4);
  const s = P / N;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const qx = (x + 0.5) * s, qy = (y + 0.5) * s, qz = (z + 0.5) * s;
    const cx = Math.floor(qx), cy = Math.floor(qy), cz = Math.floor(qz);
    let d1 = 9, d2 = 9, id = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx, iy = cy + dy, iz = cz + dz;
      const w = ((ix + P) % P) + P * (((iy + P) % P) + P * ((iz + P) % P));
      const px = ix + pts[w * 3], py = iy + pts[w * 3 + 1], pz = iz + pts[w * 3 + 2];
      const d = Math.hypot(qx - px, qy - py, qz - pz);
      if (d < d1) { d2 = d1; d1 = d; id = w; } else if (d < d2) d2 = d;
    }
    const o = (x + N * (y + N * z)) * 4;
    out[o] = Math.round((tilt[id * 3] * 0.5 + 0.5) * 255);
    out[o + 1] = Math.round((tilt[id * 3 + 1] * 0.5 + 0.5) * 255);
    out[o + 2] = Math.round((tilt[id * 3 + 2] * 0.5 + 0.5) * 255);
    out[o + 3] = Math.round(Math.min(1, (d2 - d1) / 0.12) * 255);
  }
  return out;
}
