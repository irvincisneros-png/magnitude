/**
 * The headland and the Illawarra coast as a height function (pure maths, no Three.js).
 *
 * Frame (metres): the person's feet at (0, 0, 0); +X east (the Tasman Sea), −Z north (axes not turned).
 * A grassy latite headland ~34 m above the sea with a cliff 22 m east of the person and a rock
 * platform at its foot, sandy beaches in the bays either side, a coastal plain with suburbs, and
 * the sandstone escarpment rising ~450 m about 6 km inland, as around Wollongong.
 */

function ih(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise2(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = ih(ix, iy), b = ih(ix + 1, iy), c = ih(ix, iy + 1), d = ih(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm2(x: number, y: number, oct: number) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise2(x, y); n += a;
    const nx = 1.6 * x + 1.2 * y + 7.3, ny = -1.2 * x + 1.6 * y + 7.3;
    x = nx; y = ny; a *= 0.5;
  }
  return v / n;
}
const fbm1 = (t: number, oct = 4) => fbm2(t, 0.37, oct);
const G = (z: number, c: number, w: number) => Math.exp(-(((z - c) / w) ** 2));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function coastBase(z: number) {
  return -168 - 0.36 * z + 56 * (fbm1(z / 340 + 11) - 0.5) + 14 * (fbm1(z / 48 + 3, 3) - 0.5) + 8 * (fbm1(z / 17 + 9, 3) - 0.5);
}
function coastRaw(z: number) {
  return coastBase(z) + 190 * G(z, 0, 160) + 135 * G(z, -1900, 240) + 175 * G(z, 2300, 300)
    + 95 * G(z, 5200, 380) + 120 * G(z, -4800, 330) + 70 * G(z, -8300, 600) + 80 * G(z, 9000, 500) - 330 * G(z, -560, 260);
}
const COAST_FIX = 27 - coastRaw(0);
/** x of the shoreline at z (land is to the west, x < coastX). */
export const coastX = (z: number) => coastRaw(z) + COAST_FIX;
/** 0 on beaches, 1 on cliffed headlands. */
export const cliffness = (z: number) => smoothstep(35, 110, coastRaw(z) - coastBase(z));
export const escX = (z: number) => -6300 - 0.36 * z + 520 * (fbm1(z / 2600 + 5) - 0.5);

/** Where the person stands in the map's own frame (metres east, south of the headland's axis). */
export const PERSON_AT = [-55, -106] as const;

export interface Sample { y: number; e: number; W: number; esc: number }
const out: Sample = { y: 0, e: 0, W: 0, esc: 0 };

/** Height above sea level (metres) and terrain descriptors at body-frame (x, z). */
export function rawHeight(xp: number, zp: number, o: Sample = out): Sample {
  // the person stands near the north-east corner of the headland, above a bay
  const x = xp + PERSON_AT[0], z = zp + PERSON_AT[1];
  const e = coastX(z) - x;
  const W = cliffness(z);
  const n1 = fbm2(x / 23 + 3.1, z / 23, 3);
  // plain behind the coast: gentle hills, then the escarpment
  const plainHills = 15 * (fbm2(x / 950, z / 950, 4) - 0.45) * smoothstep(150, 700, e);
  const xe = escX(z);
  const ridge = 1 - Math.abs(fbm2(x / 700 + 2, z / 520, 3) * 2 - 1);
  const esc = smoothstep(xe + 1300, xe - 900, x);
  const escRise = 445 * esc * (0.82 + 0.3 * ridge) + 60 * smoothstep(xe - 900, xe - 4000, x) * (fbm2(x / 1500, z / 1500, 3));
  const plain = 9 + (e - 120) * 0.005 + plainHills + escRise;

  let beach: number;
  if (e < 0) beach = -0.4 - Math.min(-e * 0.05, 22) - 1.5 * smoothstep(0, 25, -e);
  else if (e < 70) beach = e * 0.042 - 0.4;
  else if (e < 125) beach = 2.54 + 6.0 * smoothstep(70, 125, e) + 1.6 * (n1 - 0.5);
  else beach = mix(8.6, plain, smoothstep(125, 260, e));

  let cliff: number;
  const rough = (fbm2(x / 6.5, z / 6.5, 3) - 0.5);
  if (e < -72) cliff = -4.5 - Math.min((-e - 72) * 0.03, 22);
  else if (e < 0) cliff = 0.3 + 1.2 * rough + 0.5 * (n1 - 0.5) - 4.2 * smoothstep(-42, -72, e) - 0.7 * smoothstep(-12, -40, e);
  else {
    // a latite rock face, then a steep scrubby slope, then the rounded grassy crest
    const eb = e + 4 * (fbm2(z / 14 + 5, x / 30, 3) - 0.5);
    const face = Math.pow(smoothstep(-0.5, 5 + 2 * rough, eb + rough * 1.2), 0.6);
    const slopeT = smoothstep(4, 18, eb + rough * 2);
    const crest = smoothstep(14, 24, eb);
    cliff = 0.3 + 15.5 * face + 14.8 * slopeT + 3.4 * crest + 1.2 * rough * (1 - face) + 4 * smoothstep(24, 170, e);
  }
  if (e > 24) cliff = mix(cliff, plain, smoothstep(260, 700, e));

  let y = mix(beach, cliff, W);
  // small-scale relief on the headland top, flattened under the person's feet
  const r = Math.hypot(xp, zp);
  y += 0.45 * (n1 - 0.5) * smoothstep(6, 30, e) * smoothstep(2.5, 12, r);
  o.y = y; o.e = e; o.W = W; o.esc = esc;
  return o;
}
function mix(a: number, b: number, t: number) { return a + (b - a) * t; }

/** Height of the person's ground above the sea: everything is shifted so the feet sit at y = 0. */
export const GROUND_ABOVE_SEA = rawHeight(0, 0).y;
