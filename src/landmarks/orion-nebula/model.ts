/**
 * The Orion Nebula as data: every cloud puff, dust clump, star and proplyd is one record of
 * STRIDE floats (5 RGBA float texels), drawn as one sorted, instanced sprite batch.
 *
 * NEBULA FRAME (N): the Trapezium is at (0,0,0). +Z points out of the open mouth of the blister
 * (towards Earth in real life), +Y is celestial north, +X is west (east is to the left, as in sky
 * photographs). The back wall of the cavity is a bowl z = W(x, y) behind the Trapezium; the dark
 * molecular cloud lies behind that. Units: 1 = 24 light-years.
 *
 * SCENE FRAME: the Solar System (the landmark origin) sits in a clear pocket of the cavity at O_N,
 * in front of and north-west of the Trapezium. scene = ORIENT · (p_N − O_N), with ORIENT turning
 * +Z towards the default camera so the home view looks into the bowl.
 *
 * Sprite styles (record field `nscale`): positive = billowy noise mask, negative = ridged
 * (filament) mask; |nscale| sets the noise frequency. `erode` 0 = soft Gaussian, 1 = ragged,
 * noise-eroded edge.
 */
import * as THREE from 'three';
import { curl3, fbm3, ridged3, rng, type V3 } from './noise';

export const STRIDE = 20;
/** Origin (Solar System) in the nebula frame: ≈0.14 units (3.4 ly) from the Trapezium. */
export const O_N: V3 = [0.06, 0.04, 0.12];
export const ORIENT = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.18));

export const toScene = (p: V3): [number, number, number] => {
  const v = new THREE.Vector3(p[0] - O_N[0], p[1] - O_N[1], p[2] - O_N[2]).applyQuaternion(ORIENT);
  return [v.x, v.y, v.z];
};

/** Back wall of the cavity (the main ionisation front). */
export const W = (x: number, y: number) => -0.045 + 0.78 * (x * x + y * y) + 0.12 * y * Math.max(0, -y);
function wallNormal(x: number, y: number): V3 {
  const e = 1e-3;
  const dx = (W(x + e, y) - W(x - e, y)) / (2 * e), dy = (W(x, y + e) - W(x, y - e)) / (2 * e);
  const l = Math.hypot(dx, dy, 1);
  return [-dx / l, -dy / l, 1 / l];
}

// ---------------------------------------------------------------- named features (nebula frame)
export const BAR_C: V3 = [-0.062, -0.07, 0];
BAR_C[2] = W(BAR_C[0], BAR_C[1]) + 0.02;
const BAR_U: V3 = [0.75, -0.66, 0];
export const M43_C: V3 = [-0.03, 0.2, 0];
M43_C[2] = W(M43_C[0], M43_C[1]) + 0.03;
const BAY_TIP: [number, number] = [-0.012, 0.02];
const BAY_OUT: [number, number] = [-0.24, 0.17];
export const BAY_MID: V3 = [-0.1, 0.075, 0];
BAY_MID[2] = W(BAY_MID[0], BAY_MID[1]) + 0.06;
/** The labelled proplyd: in the clear pocket close to the Solar System. */
export const PROPLYD_L: V3 = [O_N[0] - 0.013, O_N[1] - 0.007, O_N[2] - 0.006];
export const TRAPEZIUM: V3 = [0, 0, 0];

// ---------------------------------------------------------------- light and colour
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// natural colour: oxygen-teal and white near the hot stars, hydrogen pink → magenta-red further out
const RAMP: [number, V3][] = [
  [0.0, [0.92, 1.0, 0.97]],
  [0.03, [0.66, 1.0, 0.86]],
  [0.06, [1.0, 0.86, 0.74]],
  [0.1, [1.0, 0.6, 0.55]],
  [0.16, [1.0, 0.36, 0.44]],
  [0.27, [0.92, 0.2, 0.38]],
  [0.5, [0.7, 0.11, 0.3]],
];
export function gasColour(d: number): V3 {
  for (let i = 1; i < RAMP.length; i++) {
    if (d < RAMP[i][0]) return lerp3(RAMP[i - 1][1], RAMP[i][1], sstep(RAMP[i - 1][0], RAMP[i][0], d));
  }
  return RAMP[RAMP.length - 1][1];
}
const REFLECT: V3 = [0.42, 0.5, 1.0]; // blue-violet starlight scattered by dust
const BROWN: V3 = [0.5, 0.26, 0.14];

/**
 * Surface brightness of gas at p lit by the Trapezium (with a wall normal, if on the wall).
 * Fan-shaped: compact and sharply cut to the north (Dark Bay side), open and bright to the south.
 */
function flux(p: V3, n?: V3): number {
  const d = Math.hypot(p[0], p[1], p[2]) + 1e-6;
  let cosi = 1;
  if (n) cosi = Math.max(0.2, -(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) / d);
  const ky = p[1] > 0 ? 1.7 : 0.75;
  const de = Math.hypot(p[0], p[1] * ky, p[2]);
  return cosi * (1 / (1 + (de / 0.045) ** 2) + 0.3 / (1 + (de / 0.14) ** 2) + 0.06 / (1 + (de / 0.4) ** 2));
}

// ---------------------------------------------------------------- record builder
type Kind = 0 | 1 | 2; // cloud puff, star, proplyd
/** Group: 0 = the nebula itself, 1 = surroundings (fade when zoomed out), 2 = fine near-origin detail. */
interface Rec {
  p: V3; size: number; axis?: V3; kind?: Kind; emit?: V3; abs?: number; rim?: V3;
  erode?: number; seed: number; rot?: number; nscale?: number; group?: number; lum?: number;
}

export class Batch {
  data: number[] = [];
  count = 0;
  /** Nebula-frame positions are stored relative to the origin (O_N subtracted). */
  push(r: Rec) {
    const a = r.axis ?? [0, 0, 0], e = r.emit ?? [0, 0, 0], m = r.rim ?? [0, 0, 0];
    this.data.push(
      r.p[0] - O_N[0], r.p[1] - O_N[1], r.p[2] - O_N[2], r.size,
      a[0], a[1], a[2], r.kind ?? 0,
      e[0], e[1], e[2], r.abs ?? 0,
      m[0], m[1], m[2], r.erode ?? 0.5,
      r.seed, r.rot ?? 0, r.nscale ?? 1, r.kind === 1 || r.kind === 2 ? (r.lum ?? 1) : (r.group ?? 0),
    );
    this.count++;
  }
}

const distO = (p: V3) => Math.hypot(p[0] - O_N[0], p[1] - O_N[1], p[2] - O_N[2]);
const len = (p: V3) => Math.hypot(p[0], p[1], p[2]);
const scale = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];

/** Tier scaling: fewer, a bit larger, brighter sprites (coverage, i.e. overdraw, ∝ √f). */
interface Tier { f: number; size: number; emit: number; abs: (a: number) => number }
function tier(f: number): Tier {
  const k = f ** -0.5;
  return { f, size: f ** -0.25, emit: k, abs: (a) => 1 - (1 - Math.min(a, 0.95)) ** Math.min(k, 1.6) };
}

function gauss(r: () => number) { return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(6.2832 * r()); }
/** small per-sprite colour variation so the gas is not one flat pink */
function jitter(c: V3, r: () => number, k = 0.12): V3 {
  const a = 1 + (r() - 0.5) * k, b = 1 + (r() - 0.5) * k * 1.6;
  return [c[0] * a, c[1] * b, c[2] * (2 - a)];
}
/** random unit tangent on the wall at (x, y) */
function tangent(x: number, y: number, ang: number): V3 {
  const nn = wallNormal(x, y);
  const t1: V3 = [nn[2], 0, -nn[0]];
  const l1 = len(t1); t1[0] /= l1; t1[2] /= l1;
  const t2: V3 = [nn[1] * t1[2] - nn[2] * t1[1], nn[2] * t1[0] - nn[0] * t1[2], nn[0] * t1[1] - nn[1] * t1[0]];
  const c = Math.cos(ang), s = Math.sin(ang);
  return [t1[0] * c + t2[0] * s, t1[1] * c + t2[1] * s, t1[2] * c + t2[2] * s];
}

/** Build every population for a tier fraction (1 = high). */
export function buildNebula(f: number): Batch {
  const B = new Batch();
  const t = tier(f);
  const n = (count: number) => Math.max(1, Math.round(count * f));
  /** keeps the Solar System's pocket clear of anything big */
  const clearOf = (p: V3, R: number, gap = 0.035) => distO(p) > R * 1.2 + gap;
  const tmp: V3 = [0, 0, 0];

  // ---- 1. dark molecular cloud behind the bowl: opaque, ragged, silver-lined when backlit -----
  {
    const r = rng(101);
    for (let i = 0, made = 0; made < n(520) && i < 40000; i++) {
      const x = (r() * 2 - 1) * 0.6, y = (r() * 2 - 1) * 0.9 - 0.05, z = -0.06 - r() * 0.5;
      const e = (x / 0.42) ** 2 + ((y + 0.05) / 0.72) ** 2 + ((z + 0.28) / 0.26) ** 2;
      const dn = fbm3(x * 3.1, y * 3.1, z * 3.1);
      if (e > 1 || r() > (dn - 0.3) * 2.4) continue;
      const p: V3 = [x, y, Math.min(z, W(x, y) - 0.04)];
      const rr = Math.hypot(x, y);
      const R = (0.07 + 0.09 * r()) * t.size;
      const glow = flux([x, y, W(x, y)]);
      B.push({
        p, size: R, abs: t.abs(0.55 + 0.3 * r()), erode: 0.9, seed: r(), rot: r() * 6.28, nscale: 1.1,
        emit: scale(BROWN, 0.006 * glow * t.emit),
        rim: scale(gasColour(Math.max(0.12, rr)), Math.min(0.9, 0.08 + glow * 1.2) * t.emit), group: rr > 0.4 ? 1 : 0,
      });
      made++;
    }
    for (let i = 0; i < n(36); i++) {
      const a = r() * 6.2832, rr = 0.28 * Math.sqrt(r());
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 1.3 - 0.03;
      B.push({ p: [x, y, W(x, y) - 0.14 - r() * 0.18], size: (0.13 + 0.1 * r()) * t.size, abs: t.abs(0.7), erode: 0.5, seed: r(), rot: r() * 6.28 });
    }
  }

  // ---- 2. faint outer envelope (magenta-red) and blue-violet reflection haze on the fringes -----
  {
    const r = rng(202);
    for (let i = 0; i < n(240); i++) {
      const a = r() * 6.2832, rr = 0.2 + 0.6 * Math.sqrt(r());
      const x = Math.cos(a) * rr * 0.9, y = Math.sin(a) * rr - 0.14;
      const p: V3 = [x, y, W(Math.max(-0.5, Math.min(0.5, x)), Math.max(-0.5, Math.min(0.5, y))) + (r() - 0.6) * 0.12];
      const R = (0.07 + 0.09 * r()) * t.size;
      if (!clearOf(p, R)) continue;
      const k = 0.06 * Math.max(0, fbm3(x * 4, y * 4, 1.3) - 0.38) * (1 - sstep(0.45, 0.85, rr)) * t.emit;
      B.push({ p, size: R, emit: scale(gasColour(0.35 + rr * 0.2), k), erode: 0.75, seed: r(), rot: r() * 6.28, nscale: 0.8, group: rr > 0.45 ? 1 : 0 });
    }
    for (let i = 0; i < n(200); i++) {
      const a = r() * 6.2832, rr = 0.24 + 0.3 * r();
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr - 0.08;
      if (y > 0.05 && x < 0.1 && x > -0.3) continue; // not over the Dark Bay
      const p: V3 = [x, y, W(x, y) + 0.01 + r() * 0.04];
      const R = (0.025 + 0.04 * r()) * t.size;
      if (!clearOf(p, R)) continue;
      B.push({ p, size: R, emit: scale(jitter(REFLECT, r, 0.2), (0.05 + 0.08 * flux(p)) * t.emit), erode: 0.7, seed: r(), rot: r() * 6.28, nscale: 1.4, group: rr > 0.45 ? 1 : 0 });
    }
  }

  // ---- 3. back wall: broad base glow, then textured anisotropic puffs ---------------------
  {
    const r = rng(353);
    for (let i = 0; i < n(420); i++) {
      const a = r() * 6.2832, rr = 0.48 * Math.pow(r(), 0.8);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr - 0.06 * rr;
      const p: V3 = [x, y, W(x, y) - 0.01];
      const R = (0.03 + 0.07 * rr) * (0.8 + 0.4 * r()) * t.size;
      if (!clearOf(p, R)) continue;
      const F = flux(p, wallNormal(x, y)) * (0.6 + 0.8 * fbm3(x * 6, y * 6, 4.1));
      B.push({ p, size: R, emit: scale(jitter(gasColour(len(p)), r), F * 0.22 * t.emit), erode: 0.3, seed: r(), rot: r() * 6.28, nscale: 0.9 });
    }
  }
  {
    const r = rng(303);
    for (let i = 0, made = 0; made < n(3400) && i < 60000; i++) {
      const a = r() * 6.2832, rr = 0.58 * Math.pow(r(), 0.7);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr - 0.04 * rr;
      const clump = fbm3(x * 7 + 3, y * 7, 0.5);
      if (r() > 0.2 + 1.3 * Math.max(0, clump - 0.35)) continue;
      const z = W(x, y) + (fbm3(x * 5, y * 5, 7.7) - 0.5) * 0.05 * (0.3 + rr);
      const p: V3 = [x, y, z];
      const R = (0.012 + 0.035 * rr) * (0.7 + 0.6 * r()) * t.size;
      if (!clearOf(p, R)) continue;
      const F = flux(p, wallNormal(x, y)) * (0.3 + 2.0 * Math.max(0, clump - 0.3) ** 1.2);
      const knot = r() < 0.14 && rr > 0.06;
      const c = jitter(gasColour(len(p)), r);
      B.push({
        p, size: R, axis: scale(tangent(x, y, r() * 6.28), 1.4 + r() * 1.4),
        emit: scale(knot ? BROWN : c, F * (knot ? 0.03 : 0.75) * t.emit), abs: knot ? t.abs(0.55 + 0.3 * r()) : 0,
        rim: knot ? scale(c, Math.min(1.5, F * 1.4) * t.emit) : undefined, erode: knot ? 0.95 : 0.55 + 0.4 * r(),
        seed: r(), rot: r() * 6.28, nscale: 0.8 + r() * 0.8, group: rr > 0.48 ? 1 : 0,
      });
      made++;
    }
  }

  // ---- 4. mottled fine grain in and around the bright core --------------------------------
  {
    const r = rng(404);
    for (let i = 0; i < n(2400); i++) {
      const near = r() < 0.25;
      const a = r() * 6.2832, rr = near ? 0.12 * Math.sqrt(r()) : 0.16 * Math.pow(r(), 0.8);
      const x = (near ? O_N[0] : 0) + Math.cos(a) * rr, y = (near ? O_N[1] : -0.02) + Math.sin(a) * rr * 1.1;
      const p: V3 = [x, y, W(x, y) + (r() - 0.3) * 0.03];
      const R = (0.0035 + 0.006 * r()) * t.size;
      if (!clearOf(p, R, 0.012)) continue;
      const F = flux(p, wallNormal(x, y)) * (0.3 + 1.4 * ridged3(x * 30, y * 30, 2.2));
      B.push({ p, size: R, axis: scale(tangent(x, y, r() * 6.28), 1.3 + r()), emit: scale(jitter(gasColour(len(p)), r, 0.2), F * 0.6 * t.emit), erode: 0.85, seed: r(), rot: r() * 6.28, nscale: 2.2 });
    }
  }

  // ---- 5. filament sheets: streamlines (champagne flow + curl noise) with ridged masks ------
  {
    const r = rng(505);
    const lines = n(170);
    for (let l = 0; l < lines; l++) {
      const a = r() * 6.2832, rr = 0.03 + 0.42 * Math.pow(r(), 0.8);
      let x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (y > 0.06 && x < 0.04 && x > -0.3) continue; // the Dark Bay stays dark
      const w = (0.005 + 0.012 * rr) * t.size;
      for (let s = 0; s < 14; s++) {
        curl3(x * 4, y * 4, 0.7, tmp);
        const c0 = Math.hypot(tmp[0], tmp[1]) + 1e-6, rl = Math.hypot(x, y) + 1e-6;
        const ex = tmp[0] / c0 * 0.6 + x / rl * 0.8, ey = tmp[1] / c0 * 0.6 + y / rl * 0.8;
        const tl = Math.hypot(ex, ey) + 1e-6;
        const dx = ex / tl, dy = ey / tl;
        x += dx * w * 2.2; y += dy * w * 2.2;
        if (Math.hypot(x - M43_C[0], y - M43_C[1]) < 0.08) break;
        const p: V3 = [x, y, W(x, y) + 0.004];
        if (!clearOf(p, w * 3, 0.02)) continue;
        const F = flux(p, wallNormal(x, y)) * (0.7 + 0.5 * Math.sin(s * 0.45 + l));
        const z2 = W(x + dx * 0.01, y + dy * 0.01) - W(x, y);
        const ax: V3 = [dx, dy, z2 * 100];
        B.push({ p, size: w, axis: scale(ax, 3.4 / len(ax)), emit: scale(jitter(gasColour(len(p)), r), F * 1.1 * t.emit), erode: 0.75, seed: r(), nscale: -0.9 });
      }
    }
  }

  // ---- 6. the wings: bright rose ionisation fronts with dark dust on their outer side -------
  {
    const r = rng(606);
    const arcs: [number, number][][] = [
      [[-0.05, -0.05], [-0.42, -0.2], [-0.4, 0.28]],
      [[0.06, -0.06], [0.44, -0.22], [0.38, 0.25]],
      [[-0.17, -0.26], [0.0, -0.42], [0.2, -0.28]],
      [[-0.4, 0.28], [-0.33, 0.4], [-0.22, 0.38]],
    ];
    for (const [ai, arc] of arcs.entries()) {
      const cnt = n(ai === 3 ? 160 : 420);
      for (let i = 0; i < cnt; i++) {
        const u = r();
        const b = (k: number) => (1 - u) ** 2 * arc[0][k] + 2 * u * (1 - u) * arc[1][k] + u * u * arc[2][k];
        const db = (k: number) => 2 * (1 - u) * (arc[1][k] - arc[0][k]) + 2 * u * (arc[2][k] - arc[1][k]);
        const tx = db(0), ty = db(1), tl = Math.hypot(tx, ty);
        let nx = -ty / tl, ny = tx / tl;
        // make the normal point away from the Trapezium
        if (nx * b(0) + ny * b(1) < 0) { nx = -nx; ny = -ny; }
        const wig = (fbm3(u * 9, ai, 0) - 0.5) * 0.08;
        const dust = r() < 0.26;
        const off = dust ? 0.012 + Math.abs(gauss(r)) * 0.02 : -Math.abs(gauss(r)) * (0.015 + 0.035 * u);
        const x = b(0) + nx * (off + wig), y = b(1) + ny * (off + wig);
        const p: V3 = [x, y, W(x, y) + 0.012 + (r() - 0.5) * 0.02];
        const R = (dust ? 0.016 + 0.02 * r() : 0.01 + 0.022 * r()) * t.size;
        if (!clearOf(p, R)) continue;
        const F = (flux(p) * 0.8 + 0.06) * (0.7 + 0.6 * fbm3(u * 14, ai * 3, 2));
        const c = jitter(gasColour(Math.max(0.14, len(p))), r);
        if (dust) {
          B.push({ p, size: R, axis: scale([tx / tl, ty / tl, 0], 1.8), abs: t.abs(0.75), emit: scale(BROWN, 0.02 * F * t.emit), rim: scale(c, Math.min(1.2, F * 2.5) * t.emit), erode: 0.95, seed: r(), nscale: 1.2 });
        } else {
          B.push({ p, size: R, axis: scale([tx / tl, ty / tl, 0], 1.6 + r() * 1.4), emit: scale(c, F * 0.9 * t.emit), erode: 0.7, seed: r(), nscale: r() < 0.5 ? -0.8 : 0.9 });
        }
      }
    }
  }

  // ---- 7. the Bright Bar: a sharp luminous ridge with dark neutral gas right behind it -------
  {
    const r = rng(707);
    const toT: V3 = [-BAR_C[0], -BAR_C[1], 0];
    const tl = Math.hypot(toT[0], toT[1]); toT[0] /= tl; toT[1] /= tl;
    for (let i = 0; i < n(300); i++) {
      const s = (r() * 2 - 1) * 0.085;
      const across = Math.abs(gauss(r)) * 0.0022 * (1 + 1.5 * Math.abs(s) / 0.085);
      const back = -2.2 * s * s - across;
      const p: V3 = [BAR_C[0] + BAR_U[0] * s + toT[0] * back, BAR_C[1] + BAR_U[1] * s + toT[1] * back, BAR_C[2] + (r() - 0.5) * 0.004];
      const taper = 1 - sstep(0.055, 0.088, Math.abs(s));
      B.push({ p, size: (0.003 + 0.003 * r()) * t.size, axis: scale(BAR_U, 4.5), emit: scale([1.0, 0.72, 0.6], (1.6 + 1.2 * r()) * taper * t.emit), erode: 0.85, seed: r(), nscale: -1.2 });
    }
    for (let i = 0; i < n(180); i++) {
      const s = (r() * 2 - 1) * 0.095;
      const back = -2.2 * s * s - (0.007 + Math.abs(gauss(r)) * 0.014);
      const p: V3 = [BAR_C[0] + BAR_U[0] * s + toT[0] * back, BAR_C[1] + BAR_U[1] * s + toT[1] * back, BAR_C[2] + 0.004 + (r() - 0.5) * 0.008];
      B.push({ p, size: (0.008 + 0.008 * r()) * t.size, axis: scale(BAR_U, 2.2), abs: t.abs(0.85), emit: scale(BROWN, 0.02 * t.emit), rim: scale([1.0, 0.65, 0.55], 1.0 * t.emit), erode: 0.95, seed: r(), nscale: 1.2 });
    }
  }

  // ---- 8. the Dark Bay ("Fish's Mouth"), the lane to M43 and dark fingers, in front of the glow ----
  {
    const r = rng(808);
    const dark = (base: [number, number], tip: [number, number], wOut: number, wTip: number, cnt: number, zLift: number, abs: number) => {
      const ux = tip[0] - base[0], uy = tip[1] - base[1], L = Math.hypot(ux, uy);
      const nx = -uy / L, ny = ux / L;
      for (let i = 0; i < cnt; i++) {
        const u = Math.pow(r(), 0.75);
        const w = wOut + (wTip - wOut) * u;
        const wig = (fbm3(u * 6, base[0] * 9, 4.4) - 0.5) * wOut * 1.0;
        const off = (r() * 2 - 1) * w * 0.55 + wig;
        const x = base[0] + ux * u + nx * off, y = base[1] + uy * u + ny * off;
        const p: V3 = [x, y, W(x, y) + zLift * (1 - 0.5 * u) + (r() - 0.5) * 0.015];
        const R = (w * 0.55 + 0.005) * (0.8 + 0.6 * r()) * t.size;
        if (!clearOf(p, R)) continue;
        const F = flux([x, y, W(x, y)]);
        B.push({
          p, size: R, axis: scale([ux / L, uy / L, 0], 1.3 + r()), abs: t.abs(abs * (0.85 + 0.3 * r())),
          rim: scale(jitter(gasColour(len(p)), r), Math.min(2.0, F * 2.2 + 0.03) * t.emit),
          erode: 0.92, seed: r(), rot: r() * 6.28, nscale: 1.0, emit: scale(BROWN, 0.015 * F * t.emit),
        });
      }
    };
    dark(BAY_OUT, BAY_TIP, 0.13, 0.012, n(520), 0.055, 0.9);
    dark([-0.21, 0.25], [-0.05, 0.1], 0.06, 0.014, n(130), 0.05, 0.8);          // spur of the bay towards M43
    dark([-0.2, 0.13], [0.12, 0.145], 0.03, 0.022, n(130), 0.045, 0.75);       // lane between M42 and M43
    dark([-0.33, -0.22], [-0.09, -0.075], 0.032, 0.007, n(70), 0.045, 0.85);   // fingers pointing at the Trapezium
    dark([0.3, -0.26], [0.1, -0.1], 0.03, 0.006, n(60), 0.04, 0.85);
    dark([0.38, 0.0], [0.17, -0.005], 0.03, 0.006, n(50), 0.04, 0.85);
    dark([-0.42, -0.02], [-0.2, -0.0], 0.03, 0.007, n(50), 0.045, 0.85);
    for (let i = 0; i < n(150); i++) {
      const x = (r() * 2 - 1) * 0.5, y = (r() * 2 - 1) * 0.45;
      const p: V3 = [x, y, 0.2 + r() * 0.12];
      const R = (0.05 + 0.07 * r()) * t.size;
      if (!clearOf(p, R, 0.05) || fbm3(x * 5, y * 5, 9) < 0.47) continue;
      B.push({ p, size: R, abs: t.abs(0.08 + 0.1 * r()), emit: scale(BROWN, 0.004 * t.emit), erode: 0.9, seed: r(), rot: r() * 6.28, nscale: 1.1 });
    }
  }

  // ---- 9. M43: the round "comma" lit by NU Orionis, with blue haze round the star ------------
  {
    const r = rng(909);
    for (let i = 0; i < n(420); i++) {
      const u = r() * 2 - 1, a = r() * 6.2832, k = Math.sqrt(1 - u * u);
      const rad = 0.055 * Math.pow(r(), 0.5);
      const p: V3 = [M43_C[0] + rad * k * Math.cos(a) * 1.1, M43_C[1] + rad * k * Math.sin(a), M43_C[2] + rad * u * 0.6];
      const R = (0.008 + 0.016 * r()) * t.size;
      if (!clearOf(p, R)) continue;
      const dl = rad / 0.055;
      const F = (1 / (1 + (dl / 0.4) ** 2)) * (0.6 + 0.8 * fbm3(p[0] * 30, p[1] * 30, 1));
      const c = lerp3([1.0, 0.8, 0.72], [1.0, 0.32, 0.45], sstep(0.1, 0.7, dl));
      B.push({ p, size: R, emit: scale(jitter(c, r), F * 0.32 * t.emit), erode: 0.75, seed: r(), rot: r() * 6.28, nscale: 0.9 });
    }
    for (let i = 0; i < n(60); i++) {
      const rad = 0.03 * Math.sqrt(r()), a = r() * 6.2832;
      const p: V3 = [M43_C[0] + Math.cos(a) * rad, M43_C[1] + Math.sin(a) * rad, M43_C[2] + 0.01];
      B.push({ p, size: (0.012 + 0.01 * r()) * t.size, emit: scale(REFLECT, 0.07 * t.emit), erode: 0.5, seed: r(), rot: r() * 6.28, nscale: 1.2 });
    }
    // dark eastern lane that bends M43 into a comma
    for (let i = 0; i < n(110); i++) {
      const a = 1.9 + r() * 1.8, rad = 0.05 + gauss(r) * 0.007;
      const p: V3 = [M43_C[0] + Math.cos(a) * rad * 1.1, M43_C[1] + Math.sin(a) * rad * 0.8, M43_C[2] + 0.03];
      B.push({ p, size: (0.01 + 0.01 * r()) * t.size, abs: t.abs(0.8), rim: scale([1.0, 0.45, 0.5], 0.35 * t.emit), emit: scale(BROWN, 0.006 * t.emit), erode: 0.92, seed: r(), rot: r() * 6.28 });
    }
  }

  // ---- 10. wisps inside the cavity: continuous curved streamlines, ridged masks ------------
  {
    const r = rng(1001);
    for (let l = 0; l < n(70); l++) {
      const a = r() * 6.2832, rr = 0.04 + 0.3 * r();
      const p: V3 = [Math.cos(a) * rr, Math.sin(a) * rr, 0];
      if (p[1] > 0.06 && p[0] < 0.05) continue;
      p[2] = W(p[0], p[1]) + 0.015 + r() * 0.1;
      const R0 = 0.008 * (0.7 + 0.6 * r()) * t.size;
      for (let s = 0; s < 16; s++) {
        curl3(p[0] * 5, p[1] * 5, p[2] * 5, tmp);
        const c0 = len(tmp) + 1e-6, pl = len(p) + 1e-6;
        tmp[0] = tmp[0] / c0 * 0.75 + p[0] / pl * 0.6; tmp[1] = tmp[1] / c0 * 0.75 + p[1] / pl * 0.6; tmp[2] = tmp[2] / c0 * 0.75 + p[2] / pl * 0.6;
        const tl = len(tmp) + 1e-6;
        const step = R0 * 1.6; // overlapping segments read as one curved strand
        p[0] += (tmp[0] / tl) * step; p[1] += (tmp[1] / tl) * step; p[2] += (tmp[2] / tl) * step;
        if (p[2] < W(p[0], p[1]) + 0.005) p[2] = W(p[0], p[1]) + 0.005;
        if (distO(p) < 0.03 + R0) continue;
        const F = flux(p) * (0.5 + 0.5 * Math.sin(s * 0.4));
        B.push({ p: [...p], size: R0, axis: scale(tmp, 2.6 / tl), emit: scale(jitter(gasColour(len(p)), r), F * 0.3 * t.emit), erode: 0.6, seed: r(), nscale: -0.6 });
      }
    }
  }

  // ---- 11. stars ------------------------------------------------------------------------
  {
    const r = rng(1010);
    const star = (p: V3, lum: number, col: V3) => B.push({ p, size: 0, kind: 1, emit: col, seed: r(), lum });
    const BLUE: V3 = [0.7, 0.82, 1.0];
    // the Trapezium: θ¹ Ori C (an O7 star, by far the brightest), A, B and D. Spacing ×2 for clarity.
    star([-0.0012, -0.0026, 0.001], 40, BLUE);
    star([0.0075, 0.0016, -0.0008], 15, [0.75, 0.85, 1.0]);
    star([0.0006, -0.0068, 0.0012], 12, [0.78, 0.87, 1.0]);
    star([-0.0064, 0.005, -0.0004], 12, [0.76, 0.85, 1.0]);
    star([BAR_C[0] + 0.02, BAR_C[1] - 0.008, BAR_C[2] + 0.02], 14, BLUE);       // θ² Ori A
    star([M43_C[0] - 0.004, M43_C[1] + 0.006, M43_C[2]], 9, [0.78, 0.86, 1.0]); // NU Ori
    // ~700 young stars of the Orion Nebula Cluster, concentrated on the Trapezium (Plummer profile)
    for (let i = 0; i < 700; i++) {
      const u = r() * 2 - 1, a = r() * 6.2832, k = Math.sqrt(1 - u * u);
      const rad = Math.min(0.35, 0.038 / Math.sqrt(Math.pow(Math.max(r(), 0.002), -2 / 3) - 1));
      const p: V3 = [rad * k * Math.cos(a), rad * k * Math.sin(a) * 1.15, rad * u * 0.7];
      if (r() < 0.75 && p[2] < W(p[0], p[1]) + 0.003) p[2] = W(p[0], p[1]) + 0.003 + r() * 0.02;
      if (distO(p) < 0.012 || len(p) < 0.009) continue;
      const m = Math.pow(r(), 4);
      const typ = r();
      const col: V3 = typ < 0.05 ? [0.72, 0.84, 1.0] : typ < 0.25 ? [1.0, 0.95, 0.88] : typ < 0.65 ? [1.0, 0.76, 0.52] : [1.0, 0.58, 0.4];
      star(p, (0.12 + 3.0 * m) * (typ < 0.05 ? 2.5 : 1), col);
    }
    for (let i = 0; i < 7; i++) {
      const u = r() * 2 - 1, a = r() * 6.2832, k = Math.sqrt(1 - u * u), rr = 0.014 + 0.035 * r();
      star([O_N[0] + rr * k * Math.cos(a), O_N[1] + rr * k * Math.sin(a), O_N[2] + rr * u], 0.15 + 0.4 * r(), [1.0, 0.7, 0.52]);
    }
    // older stars of the wider Orion complex, in front of and behind the cloud
    for (let i = 0; i < 260; i++) {
      const p: V3 = [(r() * 2 - 1) * 1.3, (r() * 2 - 1) * 1.3, (r() * 2 - 1) * 0.8];
      if (distO(p) < 0.05) continue;
      const m = Math.pow(r(), 4);
      star(p, 0.08 + 1.0 * m, lerp3([1.0, 0.75, 0.55], [0.8, 0.88, 1.0], r()));
    }
  }

  // ---- 12. proplyds: young stars whose discs are being boiled away by the Trapezium ---------
  {
    const r = rng(1111);
    const proplyd = (p: V3, size: number) => {
      const d = len(p);
      const I = Math.min(4, 0.6 + 0.012 / (d * d + 1e-4) * 0.08);
      B.push({ p, size, kind: 2, axis: scale(p, 1 / d), emit: [1.0, 0.7, 0.72], seed: r(), lum: I });
    };
    for (let i = 0; i < 55; i++) {
      const u = r() * 2 - 1, a = r() * 6.2832, k = Math.sqrt(1 - u * u);
      const rad = 0.01 + 0.05 * r() * r();
      proplyd([rad * k * Math.cos(a), rad * k * Math.sin(a), Math.abs(rad * u) * 0.8 + 0.001], 0.0005 + 0.0006 * r());
    }
    proplyd(PROPLYD_L, 0.001);
    for (let i = 0; i < 3; i++) {
      const u = r() * 2 - 1, a = r() * 6.2832, k = Math.sqrt(1 - u * u), rr = 0.012 + 0.025 * r();
      proplyd([O_N[0] + rr * k * Math.cos(a), O_N[1] + rr * k * Math.sin(a), O_N[2] + rr * u], 0.0007 + 0.0004 * r());
    }
  }

  return B;
}
