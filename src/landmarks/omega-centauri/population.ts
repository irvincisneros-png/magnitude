/**
 * Star population for Omega Centauri. A flattened Plummer/King-like ball; luminosity function with
 * very many faint stars and few bright ones. Importance sampled: a lower tier keeps the rare bright
 * stars and gives each faint star proportionally more light, so the picture keeps its balance.
 */
import type { Quality } from '../../engine/types';

export const TIER_N: Record<Quality, number> = { low: 38_000, medium: 120_000, high: 300_000 };
export const RED_GIANT_POS: [number, number, number] = [0.13, 0.05, 0.07];
export const STRAGGLER_POS: [number, number, number] = [-0.045, 0.02, 0.05];
export const AXIS_RATIO = 0.85;
export const CORE_A = 0.06;     // Plummer scale; the visible core radius (~0.03) sits inside it
const REF_N = 300_000;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blackbody colour (linear, max component 1), with a touch of extra saturation. */
export function bbColour(T: number): [number, number, number] {
  const t = T / 100;
  let r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  let g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  let b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305.04;
  const f = (v: number) => Math.pow(Math.min(1, Math.max(0, v / 255)), 2.2);
  r = f(r); g = f(g); b = f(b);
  const m = Math.max(r, g, b) || 1;
  r /= m; g /= m; b /= m;
  const l = (r + g + b) / 3;
  const sat = 1.45;
  return [Math.max(0, l + (r - l) * sat), Math.max(0, l + (g - l) * sat), Math.max(0, l + (b - l) * sat)];
}

export interface Population {
  n: number;
  pos: Float32Array; col: Float32Array; lum: Float32Array; orb: Float32Array;
  redGiant: [number, number, number];
  straggler: [number, number, number];
}

export function buildPopulation(q: Quality): Population {
  const N = TIER_N[q];
  const rnd = rng(0x0c3a17);
  const W = REF_N / N;
  // rare, bright classes keep a floor so the colour contrast survives on low
  const nTop = Math.round(Math.max(24, N * 0.0005));
  const nRGB = Math.round(Math.max(900, N * 0.03));
  const nHB = Math.round(Math.max(520, N * 0.014));
  const nBS = Math.round(Math.max(120, N * 0.003));
  const nFaint = N - nTop - nRGB - nHB - nBS;

  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), lum = new Float32Array(N), orb = new Float32Array(N * 4);
  let i = 0;
  let redGiant: [number, number, number] = [0.12, 0.05, 0.02];
  let straggler: [number, number, number] = [-0.04, 0.02, 0.05];
  let bestTop = 0;

  // radial sampler: Plummer, truncated at 2.2; concentration factor shrinks the scale for rare classes
  const place = (scale: number, rMax: number): [number, number, number, number] => {
    let r = 0;
    for (;;) {
      const u = Math.max(rnd(), 1e-6);
      r = scale / Math.sqrt(Math.pow(u, -2 / 3) - 1);
      if (r < rMax) break;
    }
    const ct = 2 * rnd() - 1, ph = 2 * Math.PI * rnd(), st = Math.sqrt(1 - ct * ct);
    return [r * st * Math.cos(ph), r * ct * AXIS_RATIO, r * st * Math.sin(ph), r];
  };

  const put = (scale: number, L: number, T: number, tint = 0) => {
    const [x, y, z, r] = place(scale, 2.2);
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const c = bbColour(T);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    lum[i] = L;
    const amp = 0.002 + (0.25 * r) / (1 + r * r * 40);
    orb[i * 4] = amp * (0.5 + rnd());
    orb[i * 4 + 1] = ((0.12 + 0.5 * rnd()) / Math.sqrt(r + 0.05)) * 0.6;
    orb[i * 4 + 2] = rnd() * 6.2832;
    orb[i * 4 + 3] = rnd() + tint * 0;
    i++;
    return [x, y, z, r] as const;
  };

  for (let k = 0; k < nFaint; k++) {
    const u = Math.max(rnd(), 1e-4);
    const L = 0.0105 * W * Math.min(Math.pow(u, -1 / 1.7), 7);   // many faint, few brighter
    const T = 5000 + 2300 * Math.pow(rnd(), 0.9);               // K dwarfs to turn-off stars: pale orange to yellow-white
    put(CORE_A * 1.0, L, T);
  }
  for (let k = 0; k < nRGB; k++) {
    const u = Math.max(rnd(), 1e-4);
    const L = Math.min(0.28 * Math.pow(u, -1 / 1.25), 3.2);
    const T = 3500 + 800 * (1 - Math.min(1, L / 2.5)) + 200 * rnd();   // brighter = cooler and redder
    put(CORE_A * 1.05, L, T);
  }
  for (let k = 0; k < nHB; k++) {
    const T = 9500 + 14000 * Math.pow(rnd(), 1.3);
    put(CORE_A * 1.0, 0.7 + 1.1 * rnd(), T);
  }
  for (let k = 0; k < nBS; k++) {
    const T = 7000 + 4500 * rnd();
    const p = put(CORE_A * 0.55, 0.35 + 0.5 * rnd(), T);
    if (k === 6) straggler = [p[0], p[1], p[2]];
  }
  for (let k = 0; k < nTop; k++) {
    const L = 3.8 + 8.5 * Math.pow(rnd(), 2.2);
    const T = 3300 + 500 * rnd();
    const p = put(CORE_A * 1.5, L, T);
    if (L > bestTop && p[3] > 0.07 && p[3] < 0.22) { bestTop = L; redGiant = [p[0], p[1], p[2]]; }
  }
  // labelled stars sit at fixed places on every tier
  const set = (k: number, v: [number, number, number]) => { pos[k * 3] = v[0]; pos[k * 3 + 1] = v[1]; pos[k * 3 + 2] = v[2]; };
  set(N - 1, RED_GIANT_POS); lum[N - 1] = Math.max(lum[N - 1], 6);
  set(nFaint + nRGB + nHB + 6, STRAGGLER_POS);
  void redGiant; void straggler; void bestTop;
  return { n: N, pos, col, lum, orb, redGiant: RED_GIANT_POS, straggler: STRAGGLER_POS };
}
