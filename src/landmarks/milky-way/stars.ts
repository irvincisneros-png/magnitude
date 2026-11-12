/**
 * Local stars around the Sun: real neighbours at their true distances and directions, plus
 * procedural "shells" at growing radii. Each shell only holds stars bright enough to matter at
 * its scale (≈ L_min ∝ R²), which is roughly what a telescope would pick out — so there is always
 * a sharp, natural-looking field of points near the origin at every zoom.
 */
import { LY, Rng, armDensity, galDir, GC } from './model';

export interface RealStar {
  name: string; label: string; l: number; b: number; ly: number; lum: number; col: [number, number, number];
  zoom?: [number, number];
}

// Galactic coordinates computed from J2000 RA/Dec; distances in light-years; luminosity in Suns (visual-ish).
export const REAL_STARS: RealStar[] = [
  { name: 'Alpha Centauri A+B', label: 'Alpha Centauri · 4.4 ly', l: 315.73, b: -0.68, ly: 4.37, lum: 2.0, col: [1, 0.92, 0.8], zoom: [-4.5, -3.0] },
  { name: 'Proxima Centauri', label: '', l: 313.94, b: -1.93, ly: 4.24, lum: 0.0017, col: [1, 0.5, 0.3] },
  { name: "Barnard's Star", label: "Barnard's Star · 6 ly", l: 31.01, b: 14.06, ly: 5.96, lum: 0.0035, col: [1, 0.52, 0.32], zoom: [-4.5, -3.5] },
  { name: 'Wolf 359', label: 'Wolf 359 · 7.9 ly', l: 244.05, b: 56.12, ly: 7.86, lum: 0.0011, col: [1, 0.48, 0.3], zoom: [-4.5, -3.5] },
  { name: 'Sirius', label: 'Sirius · 8.6 ly', l: 227.23, b: -8.89, ly: 8.6, lum: 25, col: [0.78, 0.86, 1], zoom: [-4.5, -2.9] },
  { name: 'Epsilon Eridani', label: 'Epsilon Eridani · 10.5 ly', l: 195.84, b: -48.05, ly: 10.5, lum: 0.34, col: [1, 0.78, 0.56], zoom: [-4.1, -3.2] },
  { name: 'Procyon', label: 'Procyon · 11.5 ly', l: 213.7, b: 13.02, ly: 11.46, lum: 7, col: [0.98, 0.97, 0.95], zoom: [-4.1, -3.0] },
  { name: '61 Cygni', label: '', l: 82.32, b: -5.82, ly: 11.4, lum: 0.15, col: [1, 0.7, 0.45] },
  { name: 'Tau Ceti', label: '', l: 173.1, b: -73.44, ly: 11.9, lum: 0.52, col: [1, 0.88, 0.72] },
  { name: 'Altair', label: 'Altair · 17 ly', l: 47.74, b: -8.91, ly: 16.7, lum: 10.6, col: [0.9, 0.93, 1], zoom: [-3.8, -2.8] },
  { name: 'Vega', label: 'Vega · 25 ly', l: 67.45, b: 19.24, ly: 25, lum: 40, col: [0.78, 0.85, 1], zoom: [-3.7, -2.6] },
  { name: 'Arcturus', label: 'Arcturus · 37 ly', l: 15.05, b: 69.11, ly: 36.7, lum: 170, col: [1, 0.72, 0.44], zoom: [-3.5, -2.5] },
  { name: 'Aldebaran', label: 'Aldebaran · 65 ly', l: 180.97, b: -20.25, ly: 65, lum: 440, col: [1, 0.66, 0.4], zoom: [-3.2, -2.3] },
  { name: 'Polaris', label: 'Polaris · ≈430 ly', l: 123.28, b: 26.46, ly: 433, lum: 1300, col: [1, 0.95, 0.86], zoom: [-2.6, -1.9] },
  { name: 'Betelgeuse', label: 'Betelgeuse · ≈550 ly', l: 199.79, b: -8.96, ly: 550, lum: 90_000, col: [1, 0.5, 0.28], zoom: [-2.6, -1.6] },
  { name: 'Rigel', label: 'Rigel · ≈860 ly', l: 209.24, b: -25.25, ly: 860, lum: 100_000, col: [0.72, 0.8, 1], zoom: [-2.4, -1.6] },
];

export const PLEIADES = { label: 'Pleiades cluster · 444 ly', l: 166.57, b: -23.52, ly: 444, zoom: [-2.7, -1.7] as [number, number] };
export const ORION_NEBULA = { label: 'Orion Nebula · 1,340 ly', l: 209.01, b: -19.38, ly: 1344, zoom: [-2.4, -1.3] as [number, number] };

export const dirLy = (l: number, b: number, ly: number): [number, number, number] => {
  const d = galDir(l, b);
  return [d[0] * ly * LY, d[1] * ly * LY, d[2] * ly * LY];
};

/** shell: radius (ly) of the procedural shell a star belongs to, 0 for real/special stars (never faded). */
export interface StarBuf { pos: Float32Array; col: Float32Array; lum: Float32Array; shell: Float32Array; count: number }

function msColour(L: number, rng: Rng): [number, number, number] {
  const j = rng.range(-0.03, 0.03);
  if (L < 0.01) return [1, 0.5 + j, 0.3 + j];
  if (L < 0.15) return [1, 0.66 + j, 0.42 + j];
  if (L < 0.6) return [1, 0.8 + j, 0.6 + j];
  if (L < 1.8) return [1, 0.93 + j, 0.82 + j];
  if (L < 6) return [1, 0.98, 0.94 + j];
  if (L < 40) return [0.86 + j, 0.91 + j, 1];
  return [0.66 + j, 0.76 + j, 1];
}

const SHELLS = [
  { R: 21, n: 140, lmin: 0.0008, h: 0 },
  { R: 110, n: 2500, lmin: 0.02, h: 0 },
  { R: 560, n: 6000, lmin: 0.5, h: 420 },
  { R: 2800, n: 9000, lmin: 12, h: 380 },
  { R: 11_500, n: 14_000, lmin: 220, h: 360 },
];

export function buildStars(f: number, seed = 5): StarBuf {
  const rng = new Rng(seed);
  const shellF = f >= 1 ? 1 : f >= 0.3 ? 0.5 : 0.2;
  let cap = REAL_STARS.length + 64;
  for (const s of SHELLS) cap += Math.round(s.n * (s.R < 30 ? 1 : shellF));
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), lum = new Float32Array(cap), shell = new Float32Array(cap);
  let n = 0;
  const push = (p: [number, number, number], c: [number, number, number], L: number, R = 0) => {
    if (n >= cap) return;
    pos.set(p, n * 3); col.set(c, n * 3); lum[n] = L; shell[n] = R; n++;
  };

  push([0, 0, 0], [1, 0.93, 0.82], 1); // the Sun itself
  for (const s of REAL_STARS) push(dirLy(s.l, s.b, s.ly), s.col, s.lum);
  // Pleiades: a tight knot of hot blue stars
  const pc = dirLy(PLEIADES.l, PLEIADES.b, PLEIADES.ly);
  for (let i = 0; i < 34; i++) {
    const L = i < 7 ? rng.range(200, 1500) : rng.range(5, 120);
    const sp = (i < 7 ? 3 : 6) * LY;
    push([pc[0] + rng.gauss() * sp, pc[1] + rng.gauss() * sp, pc[2] + rng.gauss() * sp], [0.7, 0.8, 1], L);
  }
  // Orion Nebula's Trapezium (very young, hot)
  const on = dirLy(ORION_NEBULA.l, ORION_NEBULA.b, ORION_NEBULA.ly);
  for (let i = 0; i < 6; i++) {
    const sp = 1.5 * LY;
    push([on[0] + rng.gauss() * sp, on[1] + rng.gauss() * sp, on[2] + rng.gauss() * sp], [0.75, 0.82, 1], rng.range(3000, 40_000));
  }

  let prevR = 4.6; // nothing procedural closer than Proxima
  for (const s of SHELLS) {
    const count = Math.round(s.n * (s.R < 30 ? 1 : shellF));
    let made = 0, guard = 0;
    while (made < count && guard++ < count * 40) {
      let x: number, y: number, z: number;
      const t = rng.range(0, 6.2832);
      if (s.h === 0) { // uniform in volume between prevR·0.75 and R
        const R = s.R * Math.cbrt(rng.next());
        if (R < prevR * 0.75 || rng.next() < smoothJS(0.6, 1, R / s.R) * 0.85) continue;
        const u = rng.range(-1, 1), k = Math.sqrt(1 - u * u);
        x = R * k * Math.cos(t); y = R * u; z = R * k * Math.sin(t);
      } else { // a disc layer of scale height h (the local thin disc)
        const rad = s.R * Math.sqrt(rng.next());
        if (rad < prevR * 0.75 || rng.next() < smoothJS(0.55, 1, rad / s.R) * 0.85) continue;
        x = rad * Math.cos(t); z = rad * Math.sin(t); y = rng.sech2(s.h);
        if (Math.abs(y) > s.R) continue;
        if (s.R > 5000) { // follow the arms at the biggest scale
          const gx = x * LY - GC[0], gz = z * LY - GC[2];
          if (rng.next() > 0.25 + 0.75 * armDensity(Math.hypot(gx, gz), Math.atan2(gz, gx), 0.012)) continue;
        }
      }
      const L = Math.min(150_000, s.lmin / Math.pow(Math.max(1e-6, rng.next()), 1 / 1.15));
      let c = msColour(L, rng);
      if (L > 30 && rng.next() < 0.3) c = rng.next() < 0.75 ? [1, 0.7, 0.42] : [1, 0.52, 0.3]; // giants
      push([x * LY, y * LY, z * LY], c, L, s.R);
      made++;
    }
    prevR = s.R;
  }
  return { pos: pos.subarray(0, n * 3), col: col.subarray(0, n * 3), lum: lum.subarray(0, n), shell: shell.subarray(0, n), count: n };
}

function smoothJS(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
