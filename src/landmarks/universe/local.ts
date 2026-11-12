/**
 * Hand-placed nearby universe (galactic frame, Mly). Positions use real galactic longitude,
 * latitude and distance (rounded); shapes, satellites and cluster members are procedural.
 *
 *   Local Group  — Milky Way proxy (matches the Milky Way scene), Andromeda, Triangulum, the
 *                  Magellanic Clouds and ~60 dwarf galaxies
 *   Neighbourhood — nearby groups (M81, Sculptor, Centaurus A …), the Virgo, Fornax, Hydra,
 *                  Centaurus, Norma, Perseus and Coma clusters, linked by filaments
 *   Laniakea     — streamlines of galaxy motion flowing towards the Great Attractor
 */
import {
  COL, GC_MLY, MW_ARMS, MW_BAR_ANGLE, MW_BAR_HALF, MW_PITCH, MW_UNIT_MLY, PopBuilder, Rng, T_ELL, T_GLOW, T_IRR, T_SPI,
  add, cross, galPos, len, norm, perp, scl, sub, tint, vnoise, type V3,
} from './util';

// ------------------------------------------------------------------- disc galaxies from particles

interface ArmDef { rs: number; r0: number; r1: number; w: number }
interface DiscOpts {
  centre: V3; e1: V3; e2: V3;   // e1, e2 span the disc plane (φ measured from e1 towards e2)
  R: number;                    // radius, Mly
  n: number;                    // emission particles
  arms: ArmDef[];               // in units of R; φ(r) = ln(rs / r) / k (trailing, as in the Milky Way model)
  k: number;                    // tan(pitch)
  bar: number; barAngle: number;// bar half-length (×R) and angle
  bulge: number;                // fraction of particles in the bulge
  irregular: number;            // 0 tidy … 1 ragged
  thick: number;                // vertical scale (×R)
  sb: number;                   // surface-brightness gain
  core: V3; disc: V3; arm: V3;  // colours
  dust: number;                 // number of dust particles
  seed: number;
}

/**
 * A spiral / barred / irregular galaxy as a few thousand soft star-cloud sprites, plus dust that
 * darkens the light behind it. Brightness per sprite is set so the summed surface brightness is
 * about `sb` whatever the particle count.
 */
export function discGalaxy(pb: PopBuilder, dust: PopBuilder, o: DiscOpts) {
  const rng = new Rng(o.seed);
  const nrm = norm(cross(o.e1, o.e2));
  const at = (r: number, phi: number, h: number): V3 => {
    const c = Math.cos(phi) * r * o.R, s = Math.sin(phi) * r * o.R;
    let p = add(o.centre, add(add(scl(o.e1, c), scl(o.e2, s)), scl(nrm, h * o.R)));
    if (o.irregular > 0) {
      const f = 2.2 / o.R;
      const j = o.irregular * 0.22 * o.R;
      p = add(p, [vnoise(p[0] * f, p[1] * f, p[2] * f, o.seed) * j, vnoise(p[0] * f, p[1] * f, p[2] * f, o.seed + 3) * j * 0.5, vnoise(p[0] * f, p[1] * f, p[2] * f, o.seed + 6) * j]);
    }
    return p;
  };
  const f = 0.07;                                  // sprite size as a fraction of R
  const g = (o.sb * 2.2) / (o.n * f * f);          // per-sprite brightness for constant surface brightness
  const ca = Math.cos(o.barAngle), sa = Math.sin(o.barAngle);
  const nb = Math.round(o.n * o.bulge);
  for (let i = 0; i < o.n; i++) {
    const u = rng.next();
    let p: V3, col: V3, size = f * o.R * (0.6 + 0.8 * rng.next()), k = g;
    if (i < nb) {
      // bulge (+ bar): old yellow stars
      if (o.bar > 0 && rng.next() < 0.55) {
        const x = rng.gauss() * o.bar * 0.45, y = rng.gauss() * o.bar * 0.13;
        p = at(Math.hypot(x * ca - y * sa, x * sa + y * ca), Math.atan2(x * sa + y * ca, x * ca - y * sa), rng.gauss() * o.thick * 1.5);
      } else {
        const r = Math.abs(rng.gauss()) * 0.09;
        p = at(r, rng.next() * Math.PI * 2, rng.gauss() * 0.06);
      }
      col = tint(o.core, 1.0, rng, 0.05);
      size *= 0.8; k *= 1.7;
    } else if (u < 0.45 || o.arms.length === 0) {
      // smooth exponential disc
      const r = Math.min(1.0, -0.28 * Math.log(Math.max(1e-9, rng.next() * rng.next())));
      p = at(r, rng.next() * Math.PI * 2, rng.gauss() * o.thick);
      col = tint(o.disc, 1.0, rng, 0.06);
    } else {
      // spiral arms: young blue stars, with clumps of bright star-forming knots
      let tot = 0;
      for (const a of o.arms) tot += a.w * (a.r1 - a.r0);
      let x = rng.next() * tot, arm = o.arms[0];
      for (const a of o.arms) { x -= a.w * (a.r1 - a.r0); if (x <= 0) { arm = a; break; } }
      const r = arm.r0 + (arm.r1 - arm.r0) * rng.next() ** 1.25;
      const phi = Math.log(arm.rs / r) / o.k;
      const spread = 0.035 + 0.05 * r;
      const rr = r + rng.gauss() * spread * 0.7;
      p = at(Math.max(0.02, rr), phi + rng.gauss() * spread * 0.6 / Math.max(r, 0.1), rng.gauss() * o.thick * 0.6);
      const knot = rng.next() < 0.07;
      col = knot ? tint([0.75, 0.82, 1.6], 1, rng, 0.1) : tint(o.arm, 1.0, rng, 0.08);
      if (knot) { size *= 0.35; k *= 3.2; }
      if (rng.next() < 0.02) { col = [1.5, 0.55, 0.85]; size *= 0.3; k *= 2.5; } // pink H II regions
    }
    pb.push(p, scl(col, k), size, rng.next(), T_GLOW, 1);
  }
  // dust lanes along the inner edges of the arms
  const gd = 1.0 / Math.sqrt(Math.max(1, o.dust) / 3000);
  for (let i = 0; i < o.dust && o.arms.length; i++) {
    const arm = o.arms[Math.floor(rng.next() * o.arms.length)];
    const r = arm.r0 + (arm.r1 - arm.r0) * rng.next() ** 1.4;
    const phi = Math.log(arm.rs / r) / o.k;
    const p = at(Math.max(0.03, r - 0.035 + rng.gauss() * 0.025), phi + rng.gauss() * 0.04, rng.gauss() * o.thick * 0.4);
    dust.push(p, scl([0.5, 0.62, 0.8], 0.35 * gd), f * o.R * (0.7 + 0.8 * rng.next()), rng.next(), 4, 1);
  }
}

/** Disc basis for a galaxy seen along `los` with inclination incl (deg) and sky position angle pa (deg). */
function skyBasis(los: V3, incl: number, pa: number): { e1: V3; e2: V3 } {
  const d = norm(los);
  const north = norm(sub([0, 1, 0], scl(d, d[1])));
  const east = cross(d, north);
  const p = (pa * Math.PI) / 180, i = (incl * Math.PI) / 180;
  const maj = add(scl(north, Math.cos(p)), scl(east, Math.sin(p)));
  const minSky = sub(scl(east, Math.cos(p)), scl(north, Math.sin(p)));
  const n = norm(add(scl(d, -Math.cos(i)), scl(minSky, Math.sin(i))));
  return { e1: maj, e2: norm(cross(n, maj)) };
}

const twoArms = (rs: number, r0 = 0.12, r1 = 1, k = 0.24): ArmDef[] => [
  { rs, r0, r1, w: 1 },
  { rs: rs * Math.exp(-k * Math.PI), r0, r1, w: 1 },
];

// ------------------------------------------------------------------- the Local Group

export const MW_POS = GC_MLY;
export const M31: V3 = galPos(121.17, -21.57, 2.5);
export const M33: V3 = galPos(133.61, -31.33, 2.73);
export const LMC: V3 = galPos(280.47, -32.89, 0.163);
export const SMC: V3 = galPos(302.8, -44.3, 0.2);

/** [name, l, b, distance (Mly), diameter (Mly), type] */
const DWARFS: [string, number, number, number, number, number][] = [
  ['Sagittarius dSph', 5.6, -14.2, 0.065, 0.01, T_ELL],
  ['Ursa Minor', 105.0, 44.8, 0.2, 0.002, T_ELL],
  ['Draco', 86.4, 34.7, 0.26, 0.002, T_ELL],
  ['Sculptor', 287.5, -83.2, 0.29, 0.003, T_ELL],
  ['Sextans', 243.5, 42.3, 0.29, 0.003, T_ELL],
  ['Carina', 260.1, -22.2, 0.33, 0.002, T_ELL],
  ['Fornax', 237.1, -65.7, 0.46, 0.006, T_ELL],
  ['Leo II', 220.2, 67.2, 0.69, 0.002, T_ELL],
  ['Leo I', 226.0, 49.1, 0.82, 0.003, T_ELL],
  ['Phoenix', 272.2, -68.9, 1.4, 0.003, T_IRR],
  ['NGC 6822', 25.3, -18.4, 1.6, 0.007, T_IRR],
  ['IC 10', 119.0, -3.3, 2.2, 0.005, T_IRR],
  ['IC 1613', 129.7, -60.6, 2.4, 0.011, T_IRR],
  ['Cetus', 101.5, -72.9, 2.5, 0.004, T_ELL],
  ['Leo A', 196.9, 52.4, 2.6, 0.005, T_IRR],
  ['Tucana', 322.9, -47.4, 2.9, 0.002, T_ELL],
  ['WLM', 75.9, -73.6, 3.0, 0.008, T_IRR],
  ['Pegasus dIrr', 94.8, -43.6, 3.0, 0.004, T_IRR],
  ['Aquarius', 34.0, -31.3, 3.2, 0.003, T_IRR],
  ['Sextans A', 246.1, 39.9, 4.3, 0.006, T_IRR],
  ['Sextans B', 233.2, 43.8, 4.4, 0.006, T_IRR],
];

/** `far`: one integrated sprite per big Local Group galaxy, shown once the particle discs are only a few pixels across. */
export interface LocalGroupBuild { emit: PopBuilder; dust: PopBuilder; mw: PopBuilder; mwDust: PopBuilder; far: PopBuilder }

/** f = particle fraction for the quality tier (1 = high). */
export function buildLocalGroup(f: number): LocalGroupBuild {
  const emit = new PopBuilder(), dust = new PopBuilder(), mw = new PopBuilder(), mwDust = new PopBuilder();
  const rng = new Rng(4242);
  const n = (x: number) => Math.max(150, Math.round(x * f));

  // Milky Way proxy: same centre, plane, bar and arms as the Milky Way scene (its unit = 1e21 m)
  discGalaxy(mw, mwDust, {
    centre: MW_POS, e1: [1, 0, 0], e2: [0, 0, 1], R: 0.5 * MW_UNIT_MLY, n: n(26000),
    arms: MW_ARMS.map((a) => ({ rs: a.rs / 0.5, r0: a.r0 / 0.5, r1: a.r1 / 0.5, w: a.w })), k: MW_PITCH,
    bar: MW_BAR_HALF / 0.5, barAngle: MW_BAR_ANGLE, bulge: 0.2, irregular: 0, thick: 0.012, sb: 0.55,
    core: [1.0, 0.78, 0.5], disc: [0.95, 0.88, 0.8], arm: [0.7, 0.8, 1.15], dust: n(5000), seed: 7,
  });

  // Andromeda: bigger than the Milky Way, inclined 77°, with M32 and M110 beside it
  const m31b = skyBasis(M31, 77, 38);
  discGalaxy(emit, dust, {
    centre: M31, ...m31b, R: 0.11, n: n(22000), arms: [...twoArms(1.05, 0.25, 1, 0.16), { rs: 0.62, r0: 0.3, r1: 0.95, w: 0.6 }], k: 0.16,
    bar: 0.12, barAngle: 0.4, bulge: 0.24, irregular: 0.05, thick: 0.015, sb: 0.6,
    core: [1.0, 0.76, 0.48], disc: [0.95, 0.86, 0.76], arm: [0.72, 0.8, 1.1], dust: n(4500), seed: 31,
  });
  const m33b = skyBasis(M33, 55, 23);
  discGalaxy(emit, dust, {
    centre: M33, ...m33b, R: 0.03, n: n(7000), arms: twoArms(0.9, 0.1, 1, 0.3), k: 0.3,
    bar: 0, barAngle: 0, bulge: 0.06, irregular: 0.25, thick: 0.02, sb: 0.45,
    core: [1.0, 0.85, 0.65], disc: [0.8, 0.85, 1.0], arm: [0.62, 0.78, 1.25], dust: n(1000), seed: 33,
  });
  // Magellanic Clouds: irregular, the LMC with an off-centre bar and one stubby arm
  const lmcb = skyBasis(LMC, 35, 150);
  discGalaxy(emit, dust, {
    centre: LMC, ...lmcb, R: 0.007, n: n(6000), arms: [{ rs: 0.7, r0: 0.25, r1: 0.95, w: 1 }], k: 0.35,
    bar: 0.45, barAngle: 0.3, bulge: 0.25, irregular: 0.45, thick: 0.05, sb: 0.9,
    core: [1.0, 0.9, 0.75], disc: [0.8, 0.85, 1.0], arm: [0.65, 0.78, 1.2], dust: n(500), seed: 51,
  });
  const smcb = skyBasis(SMC, 70, 45);
  discGalaxy(emit, dust, {
    centre: SMC, ...smcb, R: 0.0035, n: n(3000), arms: [], k: 0.3,
    bar: 0.7, barAngle: 0.2, bulge: 0.35, irregular: 0.6, thick: 0.18, sb: 0.8,
    core: [0.95, 0.9, 0.85], disc: [0.75, 0.82, 1.05], arm: [0.7, 0.8, 1.2], dust: 0, seed: 52,
  });
  // Magellanic Bridge: a faint stream of young stars between the Clouds
  for (let i = 0; i < n(400); i++) {
    const t = rng.next();
    const p = add(add(scl(LMC, 1 - t), scl(SMC, t)), rng.gauss3(0.004));
    emit.push(p, scl([0.55, 0.7, 1.1], 0.035), 0.002, rng.next(), T_GLOW, 1);
  }

  // M32 and M110 (NGC 205), NGC 185 and NGC 147 around Andromeda
  emit.push(add(M31, [0.012, 0.01, -0.01]), scl(COL.ell, 1.6), 0.0075, 0.2, T_ELL, 0.8);
  emit.push(add(M31, [-0.02, -0.028, 0.02]), scl(COL.ell, 1.1), 0.017, 0.4, T_ELL, 0.5);
  emit.push(add(M31, [0.05, 0.15, -0.1]), scl(COL.ell, 0.8), 0.006, 0.6, T_ELL, 0.8);
  emit.push(add(M31, [0.03, 0.18, -0.06]), scl(COL.ell, 0.7), 0.007, 0.7, T_ELL, 0.6);

  for (const [, l, b, d, size, type] of DWARFS) {
    const c = type === T_ELL ? scl(COL.ell, 0.45) : scl(COL.irr, 0.85);
    emit.push(galPos(l, b, d), c, size, rng.next(), type, 0.5 + 0.5 * rng.next());
  }
  // faint satellites we only know statistically (dozens are known; many more are expected)
  for (const [host, rmax, count] of [[MW_POS, 0.85, 26], [M31, 0.9, 32]] as [V3, number, number][]) {
    for (let i = 0; i < count; i++) {
      const p = add(host, scl(rng.dir(), rmax * (0.12 + 0.88 * rng.next() ** 1.6)));
      const ell = rng.next() < 0.8;
      emit.push(p, scl(ell ? COL.ell : COL.irr, ell ? 0.35 : 0.6), 0.0012 + 0.003 * rng.next() ** 2, rng.next(), ell ? T_ELL : T_IRR, 0.55 + 0.45 * rng.next());
    }
  }
  const far = new PopBuilder();
  far.push(MW_POS, [0.95, 0.85, 0.75], 0.1, 0.11, T_SPI, 0.6);
  far.push(M31, [0.95, 0.82, 0.7], 0.22, 0.31, T_SPI, 0.3);
  far.push(M33, [0.75, 0.82, 1.0], 0.06, 0.52, T_SPI, 0.6);
  far.push(LMC, [0.75, 0.82, 1.05], 0.014, 0.7, T_IRR, 0.8);
  far.push(SMC, [0.75, 0.82, 1.05], 0.007, 0.9, T_IRR, 0.7);
  return { emit, dust, mw, mwDust, far };
}

// ------------------------------------------------------------------- the neighbourhood (to ~350 Mly)

export const VIRGO: V3 = galPos(283.8, 74.5, 54);
export const COMA: V3 = galPos(58.1, 88.0, 320);
export const NORMA: V3 = galPos(325.3, -7.3, 220);
export const GREAT_ATTRACTOR: V3 = galPos(316, 2, 230);
export const PERSEUS: V3 = galPos(150.6, -13.3, 240);
export const CENTAURUS: V3 = galPos(302.4, 21.6, 170);
export const HYDRA: V3 = galPos(269.6, 26.5, 160);
export const FORNAX: V3 = galPos(236.7, -53.6, 62);
export const LEO_A1367: V3 = galPos(234.8, 73.0, 300);
export const PISCES: V3 = galPos(127, -30, 200);

/** [l, b, distance, members, radius] nearby groups (Mly) */
const GROUPS: [number, number, number, number, number][] = [
  [142.1, 40.9, 12, 24, 0.8],   // M81 group
  [97.4, -88.0, 11.4, 18, 1.2], // Sculptor group
  [309.5, 19.4, 12, 26, 1.2],   // Centaurus A / M83 group
  [102.0, 59.8, 21, 14, 1.0],   // M101 group
  [241.0, 64.4, 35, 10, 0.5],   // Leo Triplet
  [234.0, 57.0, 35, 22, 1.2],   // M96 group
  [123.0, 76.0, 16, 16, 1.5],   // M94 / Canes Venatici
  [136.5, -0.3, 10, 10, 0.6],   // Maffei group
  [195, -45, 75, 60, 3.0],      // Eridanus cloud
  [290, -40, 45, 30, 2.0],      // Dorado group
];

function cluster(pb: PopBuilder, rng: Rng, c: V3, count: number, rc: number, rmax: number, ellFrac: number, bcg: number) {
  pb.push(c, scl(COL.ell, 1.2), bcg, rng.next(), T_ELL, 0.85); // the giant elliptical at the centre (e.g. M87)
  for (let i = 0; i < count; i++) {
    const u = rng.next();
    const r = Math.min(rmax, rc * Math.sqrt(u / Math.max(0.02, 1 - u)));
    const p = add(c, scl(rng.dir(), r));
    const ell = rng.next() < ellFrac * (1 - 0.6 * r / rmax);
    if (ell) pb.push(p, tint(COL.ell, 1.1, rng), 0.025 + 0.1 * rng.next() ** 3, rng.next(), T_ELL, 0.5 + 0.5 * rng.next());
    else pb.push(p, tint(COL.spi, 1, rng), 0.03 + 0.08 * rng.next() ** 2, rng.next(), T_SPI, Math.max(0.15, rng.next()));
  }
}

function group(pb: PopBuilder, rng: Rng, c: V3, count: number, r: number) {
  for (let i = 0; i < count; i++) {
    const p = add(c, scl(rng.dir(), r * rng.next() ** 0.8));
    const u = rng.next();
    if (i < 2) pb.push(p, tint(u < 0.4 ? COL.ell : COL.spi, 1.2, rng), 0.06 + 0.04 * rng.next(), rng.next(), u < 0.4 ? T_ELL : T_SPI, Math.max(0.2, rng.next()));
    else if (u < 0.55) pb.push(p, tint(COL.irr, 0.8, rng), 0.008 + 0.02 * rng.next(), rng.next(), T_IRR, 0.6 + 0.4 * rng.next());
    else if (u < 0.75) pb.push(p, tint(COL.ell, 0.6, rng), 0.006 + 0.012 * rng.next(), rng.next(), T_ELL, 0.7);
    else pb.push(p, tint(COL.spi, 1, rng), 0.03 + 0.05 * rng.next(), rng.next(), T_SPI, Math.max(0.15, rng.next()));
  }
}

/** Galaxies strung along a gently curved filament from a to b, clumped into small groups. */
function filament(pb: PopBuilder, rng: Rng, a: V3, b: V3, count: number, thick: number) {
  const L = len(sub(b, a));
  const mid = add(scl(add(a, b), 0.5), scl(perp(norm(sub(b, a))), L * 0.12 * (rng.next() - 0.5) * 2));
  const beads = Math.max(3, Math.round(L / 9));
  const centres: V3[] = [];
  for (let i = 0; i < beads; i++) {
    const t = (i + 0.2 + 0.6 * rng.next()) / beads;
    const q = add(add(scl(a, (1 - t) ** 2), scl(mid, 2 * t * (1 - t))), scl(b, t * t));
    centres.push(add(q, rng.gauss3(thick * 0.6)));
  }
  for (let i = 0; i < count; i++) {
    const c = centres[Math.floor(rng.next() * centres.length)];
    const p = add(c, rng.gauss3(thick * (rng.next() < 0.7 ? 0.35 : 1.0)));
    const u = rng.next();
    if (u < 0.3) pb.push(p, tint(COL.ell, 0.95, rng), 0.025 + 0.06 * rng.next() ** 2, rng.next(), T_ELL, 0.6 + 0.4 * rng.next());
    else if (u < 0.5) pb.push(p, tint(COL.irr, 0.8, rng), 0.01 + 0.02 * rng.next(), rng.next(), T_IRR, 0.6 + 0.4 * rng.next());
    else pb.push(p, tint(COL.spi, 1, rng), 0.03 + 0.07 * rng.next() ** 2, rng.next(), T_SPI, Math.max(0.15, rng.next()));
  }
}

export function buildNeighbourhood(f: number): PopBuilder {
  const pb = new PopBuilder();
  const rng = new Rng(777);
  const n = (x: number) => Math.max(20, Math.round(x * f));
  for (const [l, b, d, m, r] of GROUPS) group(pb, rng, galPos(l, b, d), Math.max(6, Math.round(m * Math.max(0.4, f))), r);
  cluster(pb, rng, VIRGO, n(1500), 1.6, 8, 0.6, 0.35);
  cluster(pb, rng, FORNAX, n(260), 0.8, 3, 0.65, 0.2);
  cluster(pb, rng, HYDRA, n(450), 1.2, 5, 0.65, 0.3);
  cluster(pb, rng, CENTAURUS, n(700), 1.5, 6, 0.65, 0.35);
  cluster(pb, rng, NORMA, n(900), 1.8, 7, 0.7, 0.4);
  cluster(pb, rng, PERSEUS, n(900), 1.6, 7, 0.7, 0.4);
  cluster(pb, rng, COMA, n(1100), 1.8, 8, 0.75, 0.4);
  cluster(pb, rng, LEO_A1367, n(400), 1.2, 5, 0.6, 0.3);
  const O: V3 = [0, 0, 0];
  const links: [V3, V3, number, number][] = [
    [O, VIRGO, 900, 3.0],            // the Local Sheet towards Virgo
    [VIRGO, LEO_A1367, 700, 6],      // towards the Coma Supercluster
    [LEO_A1367, COMA, 500, 6],
    [VIRGO, HYDRA, 600, 5],
    [HYDRA, CENTAURUS, 500, 5],
    [CENTAURUS, NORMA, 700, 6],      // into the Great Attractor
    [VIRGO, CENTAURUS, 500, 5],
    [O, FORNAX, 300, 3],
    [FORNAX, NORMA, 500, 7],
    [PISCES, PERSEUS, 900, 7],       // the Perseus–Pisces chain
    [galPos(95, -45, 180), PISCES, 500, 7],
    [O, PISCES, 400, 7],
    [PERSEUS, galPos(170, 10, 300), 400, 7],
    [COMA, galPos(30, 50, 330), 400, 8],
  ];
  for (const [a, b, m, t] of links) filament(pb, rng, a, b, n(m), t);
  return pb;
}

// ------------------------------------------------------------------- Laniakea streamlines

export interface Streamlines { pos: Float32Array; t: Float32Array; seed: Float32Array }

/**
 * Laniakea ("immeasurable heaven"): the region, ~520 Mly across, inside which galaxies' motions
 * (after removing the expansion of space) all drain towards the Great Attractor. Drawn as flow
 * lines from random galaxies, bending along the large-scale structure.
 */
export function buildStreamlines(count: number): Streamlines {
  const rng = new Rng(99);
  const pos: number[] = [], tt: number[] = [], sd: number[] = [];
  const GA = GREAT_ATTRACTOR;
  const centre = scl(GA, 0.82);
  const steps = 90;
  for (let i = 0; i < count; i++) {
    let p: V3 = i < 6 ? rng.gauss3(6) : add(centre, rng.ball(270));
    const seed = rng.next();
    const pts: V3[] = [p];
    for (let s = 0; s < steps; s++) {
      const toGA = sub(GA, p);
      const d = len(toGA);
      if (d < 30) break;
      const fq = 1 / 90;
      const swirl: V3 = [vnoise(p[0] * fq, p[1] * fq, p[2] * fq, 1), vnoise(p[0] * fq, p[1] * fq, p[2] * fq, 2), vnoise(p[0] * fq, p[1] * fq, p[2] * fq, 3)];
      const v = norm(add(norm(toGA), scl(swirl, 0.75 * Math.min(1, d / 120))));
      p = add(p, scl(v, Math.min(7, d * 0.12 + 2)));
      pts.push(p);
    }
    if (pts.length < 4) continue;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      tt.push(s / (pts.length - 1), (s + 1) / (pts.length - 1));
      sd.push(seed, seed);
    }
  }
  return { pos: new Float32Array(pos), t: new Float32Array(tt), seed: new Float32Array(sd) };
}
