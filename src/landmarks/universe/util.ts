/**
 * Shared maths for the universe landmark (no Three.js).
 *
 * UNITS. The landmark is authored with 1 unit = 8.8e26 m (the observable universe's diameter).
 * Almost everything is built in a child group measured in MILLIONS OF LIGHT-YEARS (Mly) and in
 * GALACTIC coordinates, then scaled by MLY and turned by the same orientation the Milky Way scene
 * uses, so our proxy of the Milky Way lines up with the real child scene at the hand-over.
 *
 * GALACTIC FRAME (copied from the Milky Way landmark's model.ts so the two match):
 *   the Sun is at the origin, the Milky Way's disc lies in the XZ plane, galactic north = +Y,
 *   longitude l = 0 (towards the galactic centre) points along −X and l = 90° along +Z.
 */

/** One million light-years in local units: 9.4607e21 m / 8.8e26 m. */
export const MLY = 9.4607e21 / 8.8e26;
/** Radius of the observable universe in Mly (46.5 billion light-years). */
export const R_UNIVERSE_MLY = 46_500;
/** The Milky Way scene's unit (1e21 m) in Mly. */
export const MW_UNIT_MLY = 1e21 / 9.4607e21;
/** Galactic centre in the galactic frame, Mly (26,000 ly towards l = 0). */
export const GC_MLY: V3 = [-0.246 * MW_UNIT_MLY, 0, 0];
/** Milky Way bar angle (radians) and arm table, in Milky Way units (from milky-way/model.ts). */
export const MW_BAR_ANGLE = (27 * Math.PI) / 180;
export const MW_BAR_HALF = 0.13;
export const MW_ARMS = [
  { rs: 0.145, r0: 0.13, r1: 0.47, w: 1.0 },  // Scutum–Centaurus
  { rs: 0.309, r0: 0.13, r1: 0.5, w: 1.0 },   // Perseus
  { rs: 0.0997, r0: 0.095, r1: 0.5, w: 0.55 },// Norma–Outer
  { rs: 0.212, r0: 0.115, r1: 0.43, w: 0.6 }, // Sagittarius–Carina
];
export const MW_PITCH = Math.tan((13.5 * Math.PI) / 180);

export type V3 = [number, number, number];

/** Direction in the galactic frame for galactic longitude/latitude (degrees). */
export function galDir(lDeg: number, bDeg: number): V3 {
  const l = (lDeg * Math.PI) / 180, b = (bDeg * Math.PI) / 180;
  return [-Math.cos(b) * Math.cos(l), Math.sin(b), Math.cos(b) * Math.sin(l)];
}
/** Point at (l, b) and distance d (Mly). */
export const galPos = (l: number, b: number, d: number): V3 => {
  const v = galDir(l, b);
  return [v[0] * d, v[1] * d, v[2] * d];
};

export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------- vectors (tiny helpers)
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => scl(a, 1 / (len(a) || 1));
/** Any unit vector perpendicular to n. */
export const perp = (n: V3): V3 => norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]));

// ------------------------------------------------------------------- random numbers
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { // mulberry32
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  gauss(): number {
    const u = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** Uniform direction. */
  dir(): V3 {
    const u = this.next() * 2 - 1, t = this.next() * Math.PI * 2, k = Math.sqrt(1 - u * u);
    return [k * Math.cos(t), u, k * Math.sin(t)];
  }
  /** Uniform point inside a ball of radius r. */
  ball(r: number): V3 { return scl(this.dir(), r * Math.cbrt(this.next())); }
  gauss3(sd: number): V3 { return [this.gauss() * sd, this.gauss() * sd, this.gauss() * sd]; }
}

/** Integer-lattice hash → [0, 1). */
export function hash3(x: number, y: number, z: number, k: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(k | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 3-D value noise in [−1, 1]. */
export function vnoise(x: number, y: number, z: number, k = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash3(xi + a, yi + b, zi + c, k);
  const x00 = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * fx;
  const x10 = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * fx;
  const x01 = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * fx;
  const x11 = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return (y0 + (y1 - y0) * fz) * 2 - 1;
}

// ------------------------------------------------------------------- point populations
/**
 * Packed galaxy sprites. Per point: position (Mly, galactic frame), colour (linear),
 * par = (world size in Mly, seed, type, axis ratio). Types: 0 elliptical, 1 spiral,
 * 2 irregular, 3 soft glow (star clouds, distant groups), 4 dust (absorbing).
 */
export const T_ELL = 0, T_SPI = 1, T_IRR = 2, T_GLOW = 3;

export class PopBuilder {
  pos: Float32Array; col: Float32Array; par: Float32Array;
  count = 0;
  /** Growable unless a fixed capacity is given (then extra points are dropped). */
  constructor(private capacity = 0) {
    const n = capacity || 1024;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.par = new Float32Array(n * 4);
  }
  private grow() {
    const n = (this.pos.length / 3) * 2;
    const g = (a: Float32Array, k: number) => { const b = new Float32Array(n * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.col = g(this.col, 3); this.par = g(this.par, 4);
  }
  push(p: V3, c: V3, size: number, seed: number, type: number, q = 1) {
    if (this.count * 3 >= this.pos.length) { if (this.capacity) return; this.grow(); }
    const i = this.count++;
    this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.par[i * 4] = size; this.par[i * 4 + 1] = seed; this.par[i * 4 + 2] = type; this.par[i * 4 + 3] = q;
  }
  build(): Pop {
    if (this.capacity) return { pos: this.pos, col: this.col, par: this.par, count: this.count };
    return { pos: this.pos.slice(0, this.count * 3), col: this.col.slice(0, this.count * 3), par: this.par.slice(0, this.count * 4), count: this.count };
  }
}
export interface Pop { pos: Float32Array; col: Float32Array; par: Float32Array; count: number }

/** Linear-light colours for galaxy types (roughly: old red stars vs young blue stars). */
export const COL = {
  ell: [1.0, 0.7, 0.42] as V3,
  spi: [0.82, 0.86, 1.0] as V3,
  irr: [0.6, 0.76, 1.15] as V3,
};
export const tint = (c: V3, k: number, rng: Rng, jitter = 0.08): V3 => [
  c[0] * k * (1 + rng.gauss() * jitter), c[1] * k * (1 + rng.gauss() * jitter), c[2] * k * (1 + rng.gauss() * jitter),
];
