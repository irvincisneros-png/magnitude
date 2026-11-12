/**
 * Milky Way structural model (pure maths, no Three.js).
 *
 * GALAXY FRAME (before the landmark's orientation quaternion is applied):
 * - The Sun is at the origin. The disc lies in the XZ plane, galactic north = +Y.
 * - The galactic centre (GC) is at (−SUN_R, 0, 0), i.e. galactic longitude l = 0 points along −X,
 *   l = 90° (the direction the Sun orbits) along +Z. Right-handed galactic coordinates.
 * - Galactocentric polar angle φ is measured around the GC from +X (the Sun's side) towards +Z,
 *   so φ increases in the direction of rotation. Trailing spiral arms therefore get bigger as φ falls.
 * 1 unit = 1e21 m ≈ 105,700 light-years.
 */

export const LY = 1 / 105_700;          // one light-year in local units
export const SUN_R = 26_000 * LY;       // 0.246: Sun–centre distance
export const GC: [number, number, number] = [-SUN_R, 0, 0];
export const BAR_ANGLE = (27 * Math.PI) / 180;   // bar's near end leads the Sun–centre line by ~27°
export const BAR_HALF = 0.13;                     // ~14,000 ly half-length (the "long bar")

const RC = 0.03;     // core radius of the rotation curve
const ROT_K = 5e-4;  // art-directed time warp: how fast the disc turns on screen
const OMEGA_SUN = 1 / Math.sqrt(SUN_R * SUN_R + RC * RC);
/** Angular speed (rad / s on screen) relative to the Sun: flat rotation curve → Ω ∝ 1/r. */
export const omegaRel = (r: number) => ROT_K * (1 / Math.sqrt(r * r + RC * RC) - OMEGA_SUN);

// ----------------------------------------------------------------- random numbers

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
  /** Radius for an exponential surface-density disc (Gamma(2, h)). */
  expDisc(h: number) { return -h * Math.log(Math.max(1e-12, this.next() * this.next())); }
  /** sech²-shaped vertical offset with scale height h. */
  sech2(h: number) { const u = Math.min(0.999999, Math.max(1e-6, this.next())); return h * Math.atanh(2 * u - 1); }
}

// ----------------------------------------------------------------- spiral arms

export interface Arm {
  name: string;
  rs: number;      // radius where the arm crosses the Sun–centre line (φ = 0)
  rStart: number;
  rEnd: number;
  strength: number;
  k: number;       // tan(pitch)
  phiMax: number;  // φ at rStart
  phiMin: number;  // φ at rEnd
  seed: number;    // phase of the along-arm clumping
}

function arm(name: string, rs: number, rStart: number, rEnd: number, strength: number, seed: number, pitchDeg = 13.5): Arm {
  const k = Math.tan((pitchDeg * Math.PI) / 180);
  return { name, rs, rStart, rEnd, strength, seed, k, phiMax: Math.log(rs / rStart) / k, phiMin: Math.log(rs / rEnd) / k };
}

/**
 * Four-arm logarithmic spiral, pitch 12°. Successive arms are 90° apart, so on the Sun–centre line
 * the radii step by exp(2π·tan12°/4) ≈ 1.4: Norma 3.7 kpc, Scutum–Centaurus 5.1, Sagittarius–Carina
 * 7.2, (Sun 8.0), Perseus 10.0, then Norma again as the Outer Arm at 14 kpc. The two major arms
 * start at the two ends of the bar (this falls out of the geometry: r(φ = 27°) ≈ 0.143).
 */
export const ARMS: Arm[] = [
  arm('Scutum–Centaurus', 0.145, BAR_HALF, 0.47, 1.0, 0.3),
  arm('Perseus', 0.309, BAR_HALF, 0.5, 1.0, 2.1),
  arm('Norma–Outer', 0.0997, 0.095, 0.5, 0.55, 4.0),
  arm('Sagittarius–Carina', 0.212, 0.115, 0.43, 0.6, 5.3),
];
/** The two arms that are strong in old stars too (Spitzer/GLIMPSE star counts). */
export const MAJOR_ARMS: Arm[] = ARMS.slice(0, 2);
/** The Orion Spur (Local Arm): a short, weaker spur through the Sun. */
export const ORION: Arm = arm('Orion Spur', SUN_R, 0.226, 0.268, 0.42, 1.2, 11);
export const ALL_ARMS: Arm[] = [...ARMS, ORION];

export const armPhi = (a: Arm, r: number) => Math.log(a.rs / r) / a.k;
export const armR = (a: Arm, phi: number) => a.rs * Math.exp(-a.k * phi);

/** Fade near an arm's ends (0..1). */
function armTaper(a: Arm, r: number) {
  const inner = smooth(a.rStart - 0.004, a.rStart + 0.025, r);
  const outer = 1 - smooth(a.rEnd - 0.12, a.rEnd, r);
  return inner * outer;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Signed radial distance from (r, φ) to the nearest winding of an arm; null if off the arm's span. */
export function armOffset(a: Arm, r: number, phi: number): { d: number; rArm: number } | null {
  const phiA = Math.log(a.rs / r) / a.k;
  const n = Math.round((phiA - phi) / (2 * Math.PI));
  const p = phi + 2 * Math.PI * n;
  if (p > a.phiMax + 0.15 || p < a.phiMin - 0.15) return null;
  const rArm = armR(a, p);
  return { d: r - rArm, rArm };
}

/** 0..~1 enhancement from all arms at (r, φ) with Gaussian half-width sigma. */
export function armDensity(r: number, phi: number, sigma: number, arms: Arm[] = ALL_ARMS) {
  let acc = 0;
  for (const a of arms) {
    const o = armOffset(a, r, phi);
    if (!o) continue;
    acc += a.strength * armTaper(a, o.rArm) * Math.exp(-(o.d * o.d) / (2 * sigma * sigma));
  }
  return Math.min(1.2, acc);
}

/** Uniform-by-arc-length point on an arm (arc length ∝ dr for a log spiral). Returns null on rejection. */
export function sampleArm(rng: Rng, a: Arm, falloff: number): { r: number; phi: number } | null {
  const r = rng.range(a.rStart, a.rEnd);
  const phi = armPhi(a, r);
  const w = armTaper(a, r) * Math.exp(-(r - a.rStart) / falloff) * armClump(a, phi);
  if (rng.next() > w) return null;
  return { r, phi };
}

/** Along-arm brightness variation: arms are broken into brighter and fainter segments. */
export function armClump(a: Arm, phi: number) {
  const v = 0.5 + 0.32 * Math.sin(phi * 1.9 + a.seed) + 0.18 * Math.sin(phi * 4.7 + a.seed * 2.3);
  return 0.25 + 0.75 * Math.min(1, Math.max(0, v));
}

export function pickArm(rng: Rng, arms: Arm[] = ALL_ARMS): Arm {
  let tot = 0;
  for (const a of arms) tot += a.strength * (a.rEnd - a.rStart);
  let x = rng.next() * tot;
  for (const a of arms) { x -= a.strength * (a.rEnd - a.rStart); if (x <= 0) return a; }
  return arms[arms.length - 1];
}

/** Gentle outer warp (the real disc bends up on one side and down on the other beyond ~40,000 ly). */
export const warp = (r: number, phi: number) => 0.016 * smooth(0.3, 0.55, r) * Math.sin(phi - 0.3);
/** Disc flaring: thicker towards the edge. */
export const flare = (r: number) => 1 + (r / 0.38) ** 2;

/** Point in the galaxy frame at galactocentric (r, φ, y). */
export function galToFrame(r: number, phi: number, y: number): [number, number, number] {
  return [GC[0] + r * Math.cos(phi), y, GC[2] + r * Math.sin(phi)];
}

/** Direction in the galaxy frame for galactic longitude/latitude (degrees). */
export function galDir(lDeg: number, bDeg: number): [number, number, number] {
  const l = (lDeg * Math.PI) / 180, b = (bDeg * Math.PI) / 180;
  return [-Math.cos(b) * Math.cos(l), Math.sin(b), Math.cos(b) * Math.sin(l)];
}
