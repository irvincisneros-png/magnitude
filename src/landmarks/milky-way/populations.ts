/**
 * Particle populations for the galaxy. Every particle stands for a cloud of unresolved stars
 * (or gas, or dust) and is drawn as a soft Gaussian sprite of a fixed world size, so surface
 * brightness stays physically constant as the camera moves.
 *
 * Packed per particle:
 *   aPos (vec3) — mode 0/1: galactocentric (r, φ, y); mode 2: bar-frame orbit (a, θ0, y)
 *   aCol (vec3) — linear colour × intensity (emission) or extinction per channel (dust)
 *   aPar (vec4) — size, ω (rad/s), seed, mode
 * Mode: 0 = rigid circular orbit (axisymmetric parts), 1 + τ/1000 = born-drift-die cycle of
 * lifetime τ seconds (anything that traces the spiral pattern, so arms never wind up),
 * 2 + q = elongated orbit of axis ratio q aligned with the bar (keeps the bar's shape while stars stream).
 */
import {
  ALL_ARMS, ARMS, BAR_HALF, MAJOR_ARMS, GC, ORION, Rng, armDensity, armPhi, flare, omegaRel,
  pickArm, sampleArm, warp,
} from './model';

export interface Pop { pos: Float32Array; col: Float32Array; par: Float32Array; count: number }

class Builder {
  pos: Float32Array; col: Float32Array; par: Float32Array; n = 0;
  constructor(public cap: number) {
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3); this.par = new Float32Array(cap * 4);
  }
  push(a: number, b: number, c: number, r: number, g: number, bl: number, size: number, om: number, seed: number, mode: number) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    this.pos[i * 3] = a; this.pos[i * 3 + 1] = b; this.pos[i * 3 + 2] = c;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = bl;
    this.par[i * 4] = size; this.par[i * 4 + 1] = om; this.par[i * 4 + 2] = seed; this.par[i * 4 + 3] = mode;
  }
  private grow() {
    this.cap *= 2;
    const p = new Float32Array(this.cap * 3), c = new Float32Array(this.cap * 3), q = new Float32Array(this.cap * 4);
    p.set(this.pos); c.set(this.col); q.set(this.par);
    this.pos = p; this.col = c; this.par = q;
  }
  done(): Pop {
    return { pos: this.pos.subarray(0, this.n * 3), col: this.col.subarray(0, this.n * 3), par: this.par.subarray(0, this.n * 4), count: this.n };
  }
}

const life = (tau: number) => 1 + tau / 1000;

/**
 * Two-resolution sampling near the Sun. Each population is over-sampled K times; one sample in K
 * becomes a normal sprite, and the rest are kept only if they land within LOCAL_R of the Sun, as
 * sprites LOCAL_RATIO times smaller flagged by a negative size. The shader fades the normal sprites
 * out and these in as the camera closes in, so the light stays the same while the detail sharpens.
 */
export const LOCAL_R = 0.12;
export const LOCAL_RATIO = 3;
const inLocal = (r: number, phi: number) => {
  const x = GC[0] + r * Math.cos(phi), z = GC[2] + r * Math.sin(phi);
  return x * x + z * z < LOCAL_R * LOCAL_R;
};
/** Intensity factor for the local sprites so their surface brightness matches. */
const localGain = (K: number) => (LOCAL_RATIO * LOCAL_RATIO) / (K - 1);

/** Per-population brightness multipliers (art-direction knobs). */
export const TUNE = { armGlow: 1, glow: 1, thick: 1, halo: 1, gc: 1, disc: 1, bulge: 1, bar: 1, nucleus: 1, young: 1, dust: 1, hii: 1 };

/** Fraction of the high-tier particle count used by each tier. */
export const TIER_FRACTION = { low: 0.085, medium: 0.4, high: 1 } as const;

const HIGH = {
  oldDisc: 110_000, thick: 14_000, halo: 7_000, bulge: 42_000, bar: 30_000, nucleus: 3_000,
  young: 70_000, armGlow: 22_000, dust: 56_000, glowDisc: 3_500, glowBulge: 500,
  gcClusters: 150, gcStars: 28, hiiClumps: 380, hiiPer: 16,
};

/** Polar coordinates around the GC for a point in the galaxy frame. */
function toPolar(x: number, z: number): [number, number] {
  const dx = x - GC[0], dz = z - GC[2];
  return [Math.hypot(dx, dz), Math.atan2(dz, dx)];
}

/**
 * Size grows and per-sprite intensity is renormalised as counts drop, so total light is the
 * same on every tier: intensity ∝ (N_high · s_high²) / (N · s²).
 */
function scaled(nHigh: number, f: number, sHigh: number, growExp = 0.4) {
  const n = Math.max(1, Math.round(nHigh * f));
  const grow = Math.pow(nHigh / n, growExp);
  const s = sHigh * grow;
  const norm = (nHigh * sHigh * sHigh) / (n * s * s);
  return { n, s, norm };
}

export function buildEmission(f: number, seed = 7): Pop {
  const rng = new Rng(seed);
  const P = {
    oldDisc: scaled(HIGH.oldDisc, f, 0.0095), thick: scaled(HIGH.thick, f, 0.02), halo: scaled(HIGH.halo, f, 0.03),
    bulge: scaled(HIGH.bulge, f, 0.014), bar: scaled(HIGH.bar, f, 0.012), nucleus: scaled(HIGH.nucleus, f, 0.0045),
    young: scaled(HIGH.young, f, 0.0042, 0.12), armGlow: scaled(HIGH.armGlow, f, 0.016), glowDisc: scaled(HIGH.glowDisc, f, 0.07), glowBulge: scaled(HIGH.glowBulge, f, 0.045),
  };
  const gcStars = Math.max(6, Math.round(HIGH.gcStars * Math.sqrt(f)));
  let cap = 2;
  for (const k of Object.keys(P) as (keyof typeof P)[]) cap += P[k].n;
  cap += HIGH.gcClusters * gcStars;
  const B = new Builder(cap);

  // --- diffuse unresolved glow (smooth base light, big sprites)
  for (let i = 0; i < P.glowDisc.n; i++) {
    const r = Math.min(0.6, rng.expDisc(0.09));
    const I = 0.0045 * P.glowDisc.norm * TUNE.glow;
    B.push(r, rng.range(0, 6.2832), rng.gauss() * 0.006, I * 1.0, I * 0.86, I * 0.7, P.glowDisc.s, omegaRel(r), rng.next(), 0);
  }
  for (let i = 0; i < P.glowBulge.n; i++) {
    const r = Math.abs(rng.gauss()) * 0.022;
    const I = 0.008 * P.glowBulge.norm * TUNE.glow;
    B.push(r, rng.range(0, 6.2832), rng.gauss() * 0.011, I, I * 0.75, I * 0.46, P.glowBulge.s, omegaRel(r), rng.next(), 0);
  }

  // --- thick disc (old, faint, puffy) and stellar halo
  for (let i = 0; i < P.thick.n; i++) {
    const r = Math.min(0.6, rng.expDisc(0.075));
    const I = 0.0035 * P.thick.norm * TUNE.thick;
    const y = -Math.log(Math.max(1e-6, rng.next())) * 0.028 * (rng.next() < 0.5 ? -1 : 1);
    B.push(r, rng.range(0, 6.2832), y, I, I * 0.8, I * 0.58, P.thick.s, omegaRel(r) * 0.8, rng.next(), 0);
  }
  for (let i = 0; i < P.halo.n; i++) {
    const R = 0.025 * Math.pow(0.85 / 0.025, rng.next()); // log-uniform → ρ ∝ r⁻³
    const u = rng.range(-1, 1), t = rng.range(0, 6.2832), k = Math.sqrt(1 - u * u);
    const x = R * k * Math.cos(t), z = R * k * Math.sin(t), y = R * u * 0.72;
    const I = 0.0014 * P.halo.norm * TUNE.halo;
    B.push(Math.hypot(x, z), Math.atan2(z, x), y, I, I * 0.78, I * 0.55, P.halo.s, 0, rng.next(), 0);
  }

  // --- globular clusters: tight balls of old stars in the halo
  for (let c = 0; c < HIGH.gcClusters; c++) {
    let x: number, y: number, z: number;
    if (c < 40) { // metal-rich bulge/disc clusters
      const R = Math.abs(rng.gauss()) * 0.08;
      const t = rng.range(0, 6.2832);
      x = R * Math.cos(t); z = R * Math.sin(t); y = rng.gauss() * 0.025;
    } else {
      const R = 0.02 * Math.pow(0.6 / 0.02, rng.next() ** 1.3);
      const u = rng.range(-1, 1), t = rng.range(0, 6.2832), k = Math.sqrt(1 - u * u);
      x = R * k * Math.cos(t); z = R * k * Math.sin(t); y = R * u;
    }
    const rad = 0.0006 + 0.0006 * rng.next();
    const bright = 0.55 + rng.next() * 0.9;
    for (let j = 0; j < gcStars; j++) {
      const px = x + rng.gauss() * rad * 0.6, pz = z + rng.gauss() * rad * 0.6, py = y + rng.gauss() * rad * 0.6;
      const I = (0.35 * bright * HIGH.gcStars * TUNE.gc) / gcStars;
      B.push(Math.hypot(px, pz), Math.atan2(pz, px), py, I, I * 0.86, I * 0.64, 0.0014, 0, rng.next(), 0);
    }
  }

  // --- old thin disc, mildly enhanced on the arms (drift cycle so the enhancement never winds up)
  const K_OLD = 6, K_YOUNG = 6;
  for (let i = 0; i < P.oldDisc.n; ) {
    const r = rng.expDisc(0.085);
    if (r > 0.62) continue;
    const phi = rng.range(0, 6.2832);
    const hole = 0.35 + 0.65 * smoothJS(0.05, 0.13, r); // the inner disc is partly cleared by the bar
    const armE = armDensity(r, phi, 0.026, MAJOR_ARMS) + 0.35 * armDensity(r, phi, 0.02, ARMS.slice(2));
    if (rng.next() > hole * (0.22 + 0.78 * armE)) continue;
    const y = rng.sech2(0.0045 * flare(r)) + warp(r, phi);
    const j = rng.range(-0.06, 0.06);
    const whiter = armE * 0.12;
    const grow = 0.7 + 1.6 * r; // bigger, fainter sprites where the outer disc is sparse
    const I = (0.019 * P.oldDisc.norm * TUNE.disc) / (grow * grow);
    const main = rng.next() < 1 / K_OLD;
    if (!main && !inLocal(r, phi)) continue;
    const k = main ? 1 : localGain(K_OLD);
    const sz = main ? P.oldDisc.s * grow : (-P.oldDisc.s * grow) / LOCAL_RATIO;
    B.push(r, phi, y, I * k, I * k * (0.83 + j + whiter), I * k * (0.62 + j * 1.5 + whiter * 1.8), sz, omegaRel(r), rng.next(), life(150));
    if (main) i++;
  }

  // --- boxy/peanut bulge on bar-aligned elliptical orbits
  for (let i = 0; i < P.bulge.n; i++) {
    const sc = [0.008, 0.018, 0.034][rng.next() < 0.3 ? 0 : rng.next() < 0.57 ? 1 : 2];
    const u = rng.gauss() * sc, v = rng.gauss() * sc;
    const a = Math.hypot(u, v), th = Math.atan2(v, u);
    const peanut = 1 + 0.55 * Math.exp(-(((Math.abs(u) - 0.03) / 0.018) ** 2));
    const y = rng.gauss() * sc * 0.62 * peanut;
    const j = rng.range(-0.05, 0.05);
    const I = 0.009 * P.bulge.norm * TUNE.bulge;
    B.push(a, th, y, I, I * (0.68 + j), I * (0.38 + j), P.bulge.s, omegaRel(a) * 1.2, rng.next(), 2.62);
  }

  // --- the long bar
  const q = 0.3;
  for (let i = 0; i < P.bar.n; i++) {
    const x = Math.max(-BAR_HALF * 1.1, Math.min(BAR_HALF * 1.1, rng.gauss() * BAR_HALF * 0.45));
    const zz = rng.gauss() * 0.02 * (1 - 0.4 * Math.abs(x) / BAR_HALF);
    const a = Math.hypot(x, zz / q), th = Math.atan2(zz / q, x);
    const y = rng.gauss() * 0.0065;
    const I = 0.0095 * P.bar.norm * TUNE.bar;
    B.push(a, th, y, I, I * 0.7, I * 0.4, P.bar.s, omegaRel(Math.max(a, 0.02)), rng.next(), 2 + q);
  }

  // --- nuclear star cluster / nuclear disc (HDR core)
  for (let i = 0; i < P.nucleus.n; i++) {
    const u = rng.gauss() * 0.0045, v = rng.gauss() * 0.0045;
    const a = Math.hypot(u, v), th = Math.atan2(v, u);
    const I = 0.06 * P.nucleus.norm * TUNE.nucleus;
    B.push(a, th, rng.gauss() * 0.0018, I, I * 0.86, I * 0.7, P.nucleus.s, omegaRel(a), rng.next(), 2.9);
  }
  B.push(0, 0, 0, 2.2, 1.75, 1.2, 0.012, 0, 0, 0); // the very centre
  B.push(0, 0, 0, 0.5, 0.42, 0.32, 0.05, 0, 0, 0);

  // --- unresolved blue light of the arms (broad, soft)
  for (let i = 0; i < P.armGlow.n; ) {
    const a = pickArm(rng);
    const p = sampleArm(rng, a, 0.2);
    if (!p) continue;
    const r = p.r + 0.002 + rng.gauss() * (0.008 + 0.02 * p.r);
    const phi = p.phi + rng.gauss() * 0.015;
    const I = 0.03 * P.armGlow.norm * TUNE.armGlow * a.strength;
    B.push(r, phi, rng.gauss() * 0.002 + warp(r, phi), I * 0.62, I * 0.78, I * 1.0, P.armGlow.s, omegaRel(r), rng.next(), life(90));
    i++;
  }

  // --- young blue-white stars and associations along the arms
  const centres: { r: number; phi: number }[] = [];
  while (centres.length < 1400) {
    const a = pickArm(rng);
    const p = sampleArm(rng, a, 0.2);
    if (p) centres.push({ r: p.r + rng.gauss() * 0.006, phi: p.phi });
  }
  for (let i = 0; i < P.young.n; ) {
    let r: number, phi: number;
    if (rng.next() < 0.68) {
      const c = centres[Math.floor(rng.next() * centres.length)];
      const sp = 0.0022 + 0.004 * (c.r % 0.0137) / 0.0137;
      r = c.r + rng.gauss() * sp; phi = c.phi + (rng.gauss() * sp) / c.r;
    } else {
      const a = pickArm(rng);
      const p = sampleArm(rng, a, 0.2);
      if (!p) continue;
      r = p.r + rng.gauss() * (0.006 + 0.016 * p.r);
      phi = p.phi + rng.gauss() * 0.01;
    }
    const y = rng.gauss() * 0.0016 * flare(r) + warp(r, phi);
    const t = rng.next();
    const I = 0.075 * P.young.norm * TUNE.young * (0.4 + rng.next() ** 2 * 1.4);
    const cr = 0.42 + 0.45 * t * t, cg = 0.6 + 0.3 * t * t, cb = 1.0;
    const main = rng.next() < 1 / K_YOUNG;
    if (!main && !inLocal(r, phi)) continue;
    const k = main ? 1 : localGain(K_YOUNG);
    B.push(r, phi, y, I * cr * k, I * cg * k, I * cb * k, main ? P.young.s : -P.young.s / LOCAL_RATIO, omegaRel(r), rng.next(), life(60));
    if (main) i++;
  }
  return B.done();
}

/** Dark dust: lanes on the inner edge of each arm, feathery spurs, a general layer and the central zone. */
export function buildDust(f: number, seed = 11): Pop {
  const rng = new Rng(seed);
  const P = scaled(HIGH.dust, f, 0.0068, 0.3);
  const B = new Builder(P.n);
  const tau = 0.36 * P.norm * TUNE.dust; // optical depth per sprite
  const K_DUST = 5;
  let made = 0;
  const pushDust = (r: number, phi: number, y: number, amt: number) => {
    const main = rng.next() < 1 / K_DUST;
    if (!main && !inLocal(r, phi)) return;
    const e = 1 - Math.exp(-tau * amt * (main ? 1 : localGain(K_DUST)));
    B.push(r, phi, y, e * 0.8, e * 0.9, e * 1.0, main ? P.s : -P.s / LOCAL_RATIO, omegaRel(r), rng.next(), life(110));
    if (main) made++;
  };
  while (made < P.n) {
    const roll = rng.next();
    if (roll < 0.58) { // lane just inside each arm
      const a = pickArm(rng);
      const p = sampleArm(rng, a, 0.26);
      if (!p) continue;
      const r = p.r - 0.0085 + rng.gauss() * (0.003 + 0.006 * p.r);
      const phi = p.phi + rng.gauss() * 0.01;
      pushDust(r, phi, rng.gauss() * 0.0019 * flare(r) + warp(r, phi), a === ORION ? 0.7 : 1);
    } else if (roll < 0.78) { // feathers / spurs trailing outward from the arms
      const a = pickArm(rng, ARMS);
      const p = sampleArm(rng, a, 0.25);
      if (!p) continue;
      const len = rng.range(0.008, 0.035);
      const tt = rng.next() * len;
      const ang = 0.9; // spur angle from the radial direction, trailing
      const x0 = p.r * Math.cos(p.phi), z0 = p.r * Math.sin(p.phi);
      const rx = Math.cos(p.phi), rz = Math.sin(p.phi);  // radial
      const tx = -Math.sin(p.phi), tz = Math.cos(p.phi); // direction of rotation
      const x = x0 + (rx * Math.cos(ang) - tx * Math.sin(ang)) * tt + rng.gauss() * 0.0012;
      const z = z0 + (rz * Math.cos(ang) - tz * Math.sin(ang)) * tt + rng.gauss() * 0.0012;
      const r = Math.hypot(x, z), phi = Math.atan2(z, x);
      pushDust(r, phi, rng.gauss() * 0.0009 + warp(r, phi), 0.8 * (1 - tt / len));
    } else if (roll < 0.95) { // general mottled disc dust
      const r = rng.expDisc(0.1);
      if (r > 0.55 || r < 0.03) continue;
      const phi = rng.range(0, 6.2832);
      if (rng.next() > 0.3 + 0.7 * armDensity(r, phi, 0.03)) continue;
      pushDust(r, phi, rng.gauss() * 0.0022 * flare(r) + warp(r, phi), 0.55);
    } else { // thin, curved dust lanes on the leading edges of the bar
      const sg = rng.next() < 0.5 ? -1 : 1;
      const u = rng.range(0.15, 1.0);
      const x = sg * u * BAR_HALF;
      const zz = sg * (0.011 + 0.03 * u * u) + rng.gauss() * 0.0018;
      const c = Math.cos(0.4712), sn = Math.sin(0.4712);
      const gx = x * c - zz * sn, gz = x * sn + zz * c;
      const amt = 0.55 * Math.sin(Math.PI * u);
      pushDust(Math.hypot(gx, gz), Math.atan2(gz, gx), rng.gauss() * 0.0009, amt);
    }
  }
  return B.done();
}

/** H II regions (pink hydrogen glow around hot new stars), plus a few real local nebulae. */
export function buildHII(f: number, local: { pos: [number, number, number]; kind: 'orion' | 'pleiades' }[], seed = 23): Pop {
  const rng = new Rng(seed);
  const clumps = Math.max(80, Math.round(HIGH.hiiClumps * Math.sqrt(f)));
  const per = Math.max(5, Math.round(HIGH.hiiPer * Math.sqrt(f)));
  const B = new Builder(clumps * (per + 4) + 64);
  let cx = 0, cphi = 0, left = 0;
  let made = 0;
  while (made < clumps) {
    if (left <= 0) { // star-forming complexes of a few H II regions each
      const a = pickArm(rng);
      const p = sampleArm(rng, a, 0.22);
      if (!p) continue;
      cx = p.r + 0.003 + rng.gauss() * (0.003 + 0.01 * p.r); cphi = p.phi + rng.gauss() * 0.015;
      left = 1 + Math.floor(rng.next() * 4);
    }
    left--;
    const r0 = cx + rng.gauss() * 0.004, phi0 = cphi + (rng.gauss() * 0.006) / cx;
    const y0 = rng.gauss() * 0.0008 + warp(r0, phi0);
    const sd = rng.next();
    const big = 0.6 + 1.2 * rng.next() ** 2;
    const tau = life(40);
    const om = omegaRel(r0);
    const hdr = 1.0 * big * TUNE.hii;
    B.push(r0, phi0, y0, 1.0 * hdr * 0.5, 0.3 * hdr * 0.5, 0.48 * hdr * 0.5, 0.0034 * big, om, sd, tau);
    for (let j = 0; j < per; j++) {
      const sp = 0.0016 * big;
      const r = r0 + rng.gauss() * sp, phi = phi0 + (rng.gauss() * sp) / r0;
      const t = rng.next();
      const I = (0.6 * 14 * TUNE.hii) / per;
      B.push(r, phi, y0 + rng.gauss() * sp * 0.4, I * 1.0, I * (0.22 + 0.15 * t), I * (0.4 + 0.2 * t), 0.0022 * (0.6 + rng.next()), om, sd, tau);
    }
    for (let j = 0; j < 3; j++) { // the hot stars lighting it up
      const r = r0 + rng.gauss() * 0.0008, phi = phi0 + (rng.gauss() * 0.0008) / r0;
      B.push(r, phi, y0, 1.6, 1.9, 2.6, 0.0011, om, sd, tau);
    }
    made++;
  }
  // real local nebulae (positions already in the galaxy frame)
  for (const n of local) {
    const [r, phi] = toPolar(n.pos[0], n.pos[2]);
    const y = n.pos[1];
    const S = 1 / 105_700;
    if (n.kind === 'orion') {
      B.push(r, phi, y, 1.6, 0.55, 0.8, 26 * S, 0, 0, 0);
      B.push(r, phi, y, 1.2, 0.3, 0.45, 60 * S, 0, 0, 0);
      B.push(r, phi, y, 0.5, 1.4, 1.3, 7 * S, 0, 0, 0); // ionised oxygen core (teal)
      for (let j = 0; j < 14; j++) {
        const o = () => rng.gauss() * 18 * S;
        const [rr, pp] = toPolar(n.pos[0] + o(), n.pos[2] + o());
        B.push(rr, pp, y + o(), 0.7, 0.18, 0.3, (14 + rng.next() * 18) * S, 0, 0, 0);
      }
    } else {
      for (let j = 0; j < 6; j++) { // blue reflection nebulosity
        const o = () => rng.gauss() * 4 * S;
        const [rr, pp] = toPolar(n.pos[0] + o(), n.pos[2] + o());
        B.push(rr, pp, y + o(), 0.12, 0.2, 0.45, (8 + rng.next() * 8) * S, 0, 0, 0);
      }
    }
  }
  return B.done();
}

function smoothJS(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Label anchor on an arm at radius r (galaxy frame). */
export function armLabelPoint(name: string, r: number): [number, number, number] {
  const a = ALL_ARMS.find((x) => x.name === name) ?? ARMS[0];
  const phi = armPhi(a, r);
  return [GC[0] + r * Math.cos(phi), 0, GC[2] + r * Math.sin(phi)];
}
