/**
 * Landmark "solar-system". 1 unit = 9e12 m (the width of Neptune's orbit); the Sun is the origin and the
 * ecliptic is the XZ plane. Everything is at true distance (orbital elements for J2000, evolved with
 * Kepler's third law); only the planet dots, line widths and star points are screen-space constant so
 * that they stay visible across 6.7 decades of zoom. Time is sped up by an amount that follows the zoom
 * level, so whatever orbits fill the view always move at a watchable pace.
 *
 * Layers: sun proxy (glare + disc) · zodiacal glow · orbit ribbons with comet trails · planet beads ·
 * asteroid belt, Jupiter trojans, inner dust · Kuiper belt, plutinos, scattered disc · heliosphere ·
 * Voyager 1 · Oort cloud · real nearest stars (same brightness law as the Milky Way scene) · sky backdrop.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, LandmarkFactory, LandmarkLabel, LandmarkMeta, Quality } from '../../engine/types';
import {
  beadFrag, beadVert, bodyFrag, bodyVert, discFrag, dustVert, glareFrag, guideFrag, guideVert, helioFrag, helioVert,
  orbitFrag, orbitVert, quadVert, skyFrag, skyVert, starFrag, starVert, zodiFrag,
} from './shaders';

// ------------------------------------------------------------------ constants
const UNIT_M = 9e12;
const AU_U = 1.495978707e11 / UNIT_M;         // 1 AU in units (0.01662)
const LY_U = 9.4607e15 / UNIT_M;              // 1 light-year in units (≈1051)
const SUN_R = 6.957e8 / UNIT_M;
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const T_START = 26.87;                        // years since J2000 → roughly "now"
const NB = 12;                                // orbits / beads drawn as bodies
const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ frames (same maths as the Milky Way scene)
function galDir(lDeg: number, bDeg: number): [number, number, number] {
  const l = lDeg * D2R, b = bDeg * D2R;
  return [-Math.cos(b) * Math.cos(l), Math.sin(b), Math.cos(b) * Math.sin(l)];
}
const ORIENT = (() => {
  const nep = new THREE.Vector3(...galDir(96.384, 29.811));
  const align = new THREE.Quaternion().setFromUnitVectors(nep, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (140 * Math.PI) / 180).multiply(align);
})();
const gv = (l: number, b: number) => new THREE.Vector3(...galDir(l, b)).applyQuaternion(ORIENT);
// ecliptic axes: x = vernal equinox, y = ecliptic longitude 90°, z = north (=+Y)
const EX = gv(96.337, -60.1886); EX.y = 0; EX.normalize();
const EY = gv(186.3724, -0.0201); EY.y = 0; EY.normalize();
const EZ = new THREE.Vector3(0, 1, 0);
const eclDir = (lon: number, lat: number) =>
  new THREE.Vector3().addScaledVector(EX, Math.cos(lat * D2R) * Math.cos(lon * D2R))
    .addScaledVector(EY, Math.cos(lat * D2R) * Math.sin(lon * D2R)).addScaledVector(EZ, Math.sin(lat * D2R));

// ------------------------------------------------------------------ bodies (J2000 elements)
interface Body {
  name: string; a: number; e: number; i: number; node: number; varpi: number; L: number;
  col: [number, number, number]; size: number; dwarf?: boolean;
}
const BODIES: Body[] = [
  { name: 'Mercury', a: 0.387098, e: 0.20563, i: 7.005, node: 48.331, varpi: 77.456, L: 252.251, col: [0.78, 0.72, 0.66], size: 3.4 },
  { name: 'Venus', a: 0.723332, e: 0.00677, i: 3.395, node: 76.680, varpi: 131.533, L: 181.980, col: [1.0, 0.88, 0.62], size: 4.4 },
  { name: 'Earth', a: 1.0, e: 0.01671, i: 0.0, node: 0, varpi: 102.947, L: 100.464, col: [0.35, 0.62, 1.0], size: 4.6 },
  { name: 'Mars', a: 1.523679, e: 0.0934, i: 1.850, node: 49.558, varpi: 336.04, L: 355.453, col: [1.0, 0.45, 0.27], size: 3.8 },
  { name: 'Jupiter', a: 5.2026, e: 0.04849, i: 1.303, node: 100.464, varpi: 14.331, L: 34.351, col: [0.95, 0.76, 0.55], size: 7.0 },
  { name: 'Saturn', a: 9.537, e: 0.05551, i: 2.489, node: 113.665, varpi: 92.599, L: 49.954, col: [1.0, 0.86, 0.58], size: 6.4 },
  { name: 'Uranus', a: 19.19, e: 0.0463, i: 0.773, node: 74.006, varpi: 170.954, L: 313.239, col: [0.62, 0.92, 0.95], size: 5.2 },
  { name: 'Neptune', a: 30.07, e: 0.00899, i: 1.770, node: 131.784, varpi: 44.964, L: 304.880, col: [0.32, 0.48, 1.0], size: 5.2 },
  { name: 'Pluto', a: 39.48, e: 0.2488, i: 17.16, node: 110.299, varpi: 224.07, L: 238.9, col: [0.9, 0.78, 0.66], size: 3.0, dwarf: true },
  { name: 'Eris', a: 67.9, e: 0.436, i: 44.04, node: 35.95, varpi: 187.3, L: 392.0 - 360, col: [0.92, 0.94, 1.0], size: 3.0, dwarf: true },
  { name: 'Makemake', a: 45.5, e: 0.159, i: 28.98, node: 79.4, varpi: 15.0, L: 344.0, col: [1.0, 0.72, 0.58], size: 3.0, dwarf: true },
  { name: 'Haumea', a: 43.1, e: 0.195, i: 28.2, node: 121.9, varpi: 240.0, L: 258.0, col: [0.9, 0.95, 1.0], size: 3.0, dwarf: true },
];
const bodyM0 = (b: Body) => (b.L - b.varpi) * D2R;

function solveE(M: number, e: number) {
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}
/** Position in the scene for orbital elements; writes into out. */
function orbitPoint(a: number, e: number, iDeg: number, nodeDeg: number, varpiDeg: number, E: number, out: THREE.Vector3) {
  const w = (varpiDeg - nodeDeg) * D2R, inc = iDeg * D2R, om = nodeDeg * D2R;
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const x1 = xp * Math.cos(w) - yp * Math.sin(w), y1 = xp * Math.sin(w) + yp * Math.cos(w);
  const y2 = y1 * Math.cos(inc), z2 = y1 * Math.sin(inc);
  const X = x1 * Math.cos(om) - y2 * Math.sin(om), Y = x1 * Math.sin(om) + y2 * Math.cos(om);
  return out.set(0, 0, 0).addScaledVector(EX, X * AU_U).addScaledVector(EY, Y * AU_U).addScaledVector(EZ, z2 * AU_U);
}

// ------------------------------------------------------------------ nearest stars (real directions via galactic l, b)
interface Star { name: string; l: number; b: number; ly: number; lum: number; col: [number, number, number]; label?: string; zoom?: [number, number] }
const STARS: Star[] = [
  { name: 'Alpha Centauri', l: 315.73, b: -0.68, ly: 4.37, lum: 2.0, col: [1, 0.92, 0.8], label: 'Alpha Centauri · 4.4 ly', zoom: [2.4, 3.55] },
  { name: 'Proxima', l: 313.94, b: -1.93, ly: 4.24, lum: 0.0017, col: [1, 0.5, 0.3] },
  { name: "Barnard's Star", l: 31.01, b: 14.06, ly: 5.96, lum: 0.0035, col: [1, 0.52, 0.32], label: "Barnard's Star · 6 ly", zoom: [2.4, 3.55] },
  { name: 'Wolf 359', l: 244.05, b: 56.12, ly: 7.86, lum: 0.0011, col: [1, 0.48, 0.3], label: 'Wolf 359 · 7.9 ly', zoom: [2.4, 3.55] },
  { name: 'Sirius', l: 227.23, b: -8.89, ly: 8.6, lum: 25, col: [0.78, 0.86, 1], label: 'Sirius · 8.6 ly', zoom: [2.4, 3.55] },
  { name: 'Epsilon Eridani', l: 195.84, b: -48.05, ly: 10.5, lum: 0.34, col: [1, 0.78, 0.56], label: 'Epsilon Eridani · 10.5 ly', zoom: [2.4, 3.55] },
  { name: 'Procyon', l: 213.7, b: 13.02, ly: 11.46, lum: 7, col: [0.98, 0.97, 0.95], label: 'Procyon · 11.5 ly', zoom: [2.4, 3.55] },
  { name: '61 Cygni', l: 82.32, b: -5.82, ly: 11.4, lum: 0.15, col: [1, 0.7, 0.45] },
  { name: 'Tau Ceti', l: 173.1, b: -73.44, ly: 11.9, lum: 0.52, col: [1, 0.88, 0.72] },
  { name: 'Altair', l: 47.74, b: -8.91, ly: 16.7, lum: 10.6, col: [0.9, 0.93, 1], label: 'Altair · 17 ly', zoom: [2.4, 3.55] },
];
const starPos = (s: Star) => gv(s.l, s.b).multiplyScalar(s.ly * LY_U);

// ------------------------------------------------------------------ labels
const zr = (aAU: number, k1: number, k2: number): [number, number] => [Math.log10(aAU * AU_U * k1), Math.log10(aAU * AU_U * k2)];
const labels: LandmarkLabel[] = [];
BODIES.forEach((b) => {
  labels.push({ text: b.name, position: [0, 0, 0], zoomRange: b.dwarf ? zr(b.a, 0.6, 9) : zr(b.a, 0.45, b.a < 2 ? 14 : 22) });
});
const L_SUN = labels.length; labels.push({ text: 'Sun', position: [0, 0, 0], zoomRange: [-2.6, -0.2] });
const L_EARTH_LIGHT = labels.length; labels.push({ text: 'Light takes 8 min 20 s to reach Earth', position: [0, 0, 0], zoomRange: zr(1, 1.2, 4.5) });
const L_AU = labels.length; labels.push({ text: '1 AU = Earth–Sun distance (150 million km)', position: [0, 0, 0], zoomRange: zr(1, 1.2, 4.5) });
const L_NEP = labels.length; labels.push({ text: 'Neptune: 4 light-hours from the Sun', position: [0, 0, 0], zoomRange: zr(30.07, 0.7, 5) });
const asteroidLabel = eclDir(115, 0).multiplyScalar(2.75 * AU_U);
labels.push({ text: 'Asteroid belt', position: [asteroidLabel.x, asteroidLabel.y, asteroidLabel.z], zoomRange: zr(2.75, 1.3, 22) });
const kuiperLabel = eclDir(205, 0).multiplyScalar(44 * AU_U);
labels.push({ text: 'Kuiper belt', position: [kuiperLabel.x, kuiperLabel.y, kuiperLabel.z], zoomRange: zr(44, 1.1, 12) });
const trojLabel = eclDir(34.4 + 60 + 14.3, 0).multiplyScalar(5.2 * AU_U);
labels.push({ text: 'Jupiter trojans', position: [trojLabel.x, trojLabel.y, trojLabel.z], zoomRange: zr(5.2, 1.6, 7) });
const NOSE = eclDir(255.7, 5.1);
const helioLabel = NOSE.clone().multiplyScalar(120 * AU_U);
labels.push({ text: 'Heliopause · edge of the Sun’s wind (≈120 AU)', position: [helioLabel.x, helioLabel.y, helioLabel.z], zoomRange: zr(120, 0.8, 7) });
const VOY_DIR = eclDir(255.9, 35.1);
const voyPos = VOY_DIR.clone().multiplyScalar(170 * AU_U);
labels.push({ text: 'Voyager 1 · ≈170 AU (approximate)', position: [voyPos.x, voyPos.y, voyPos.z], zoomRange: zr(170, 0.9, 12) });
const oortLabel = eclDir(25, 22).multiplyScalar(45_000 * AU_U);
labels.push({ text: 'Oort cloud (predicted, never directly seen)', position: [oortLabel.x, oortLabel.y, oortLabel.z], zoomRange: [2.95, 4.9] });
const scatLabel = eclDir(300, 12).multiplyScalar(110 * AU_U);
labels.push({ text: 'Scattered disc', position: [scatLabel.x, scatLabel.y, scatLabel.z], zoomRange: zr(110, 0.9, 5) });
for (const s of STARS) {
  if (!s.label) continue;
  const p = starPos(s);
  labels.push({ text: s.label, position: [p.x, p.y, p.z], zoomRange: s.zoom });
}

const meta: LandmarkMeta = {
  id: 'solar-system',
  name: 'Solar System',
  sizeMeters: 9e12,
  range: [10.8, 17.5],
  evidence: 'measured',
  nesting: 'true',
  nestingNote:
    'Distances and orbits are to scale. The planet dots, star points and line widths are drawn far bigger than life so you can see them: at true size even the Sun is only a speck on this scale. Time is greatly sped up.',
  blurb:
    'Eight planets orbit the Sun in a nearly flat disc, with belts of rock and ice beyond them. Distances and orbits here are to scale, but the planet dots are enlarged so you can see them. Zoom out and the Sun’s wind ends at the heliopause, the Oort cloud of comets stretches a light-year and more, and the nearest stars appear.',
  howWeKnow: {
    instrument: 'Radar ranging, spacecraft tracking (such as Voyager 1) and Kepler’s laws',
    text:
      'Radar bounced off planets and radio signals timed from spacecraft give distances across the Solar System to within metres. Kepler’s third law links each planet’s year to its distance from the Sun. The nearby stars are placed from parallax measured by telescopes such as Gaia. The Oort cloud has never been seen: it is predicted from the orbits of long-period comets.',
  },
  lightTime: 'About 8 minutes 20 seconds from the Sun to Earth; about 4 hours to Neptune; about 4.4 years to the nearest star',
  timescale: 'Earth’s year is 1 year, Neptune’s is 165. Here time is sped up and follows your zoom, so inner planets always move fastest.',
  post: { bloom: 0.5, exposure: 1 },
  labels,
};

// ------------------------------------------------------------------ helpers
function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(TAU * r());

const additive = {
  transparent: true, depthTest: false, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
} as const;

/** Element generators: out = [a, e, M0, w, inc, node, rnd, sizeMul]. */
type Gen = (r: () => number, o: number[]) => void;
const KIRKWOOD = [[2.5, 0.035], [2.82, 0.03], [2.95, 0.02], [3.27, 0.03], [2.06, 0.02]];
const haze = (r: () => number, big = 7) => (r() < 0.05 ? big : 0.9 + 0.7 * r());

const genAsteroid: Gen = (r, o) => {
  let a = 2.7;
  for (let k = 0; k < 20; k++) {
    a = 2.1 + 1.2 * Math.pow((r() + r() + r()) / 3, 1.0);
    if (!KIRKWOOD.some(([c, w]) => Math.abs(a - c) < w)) break;
  }
  const inc = Math.abs(gauss(r)) * 7 * D2R;
  o.push(a, Math.min(0.35, Math.abs(gauss(r)) * 0.11), r() * TAU, r() * TAU, inc, r() * TAU, r(), haze(r, 6));
};
const jup = BODIES[4];
const genTrojan: Gen = (r, o) => {
  const lead = r() < 0.5 ? 1 : -1;
  const lib = gauss(r) * 14 * D2R;
  o.push(jup.a, 0.03 + r() * 0.11, bodyM0(jup) + lead * (60 * D2R) + lib, (jup.varpi - jup.node) * D2R + gauss(r) * 0.4,
    Math.abs(gauss(r)) * 9 * D2R, jup.node * D2R, r(), haze(r, 5));
};
const genDust: Gen = (r, o) => {
  const a = 0.05 + 0.9 * Math.pow(r(), 1.6);
  o.push(a, Math.abs(gauss(r)) * 0.05, r() * TAU, r() * TAU, gauss(r) * 3.5 * D2R, r() * TAU, r(), haze(r, 8));
};
const genKuiper: Gen = (r, o) => {
  const cold = r() < 0.6;
  const a = cold ? 42 + 5.5 * Math.pow(r(), 0.9) : 39 + 9 * r();
  const inc = Math.abs(gauss(r)) * (cold ? 2.5 : 11) * D2R;
  o.push(a, Math.abs(gauss(r)) * (cold ? 0.04 : 0.1), r() * TAU, r() * TAU, inc, r() * TAU, r(), haze(r, 6));
};
const genPlutino: Gen = (r, o) => {
  o.push(39.4 + gauss(r) * 0.25, 0.12 + 0.17 * r(), r() * TAU, (0.7 + gauss(r) * 0.8) * 1.0, Math.abs(gauss(r)) * 10 * D2R + 0.05, r() * TAU, r(), haze(r, 5));
};
const genScattered: Gen = (r, o) => {
  const a = 50 + 110 * Math.pow(r(), 1.7);
  const q = 33 + 9 * r();
  o.push(a, Math.min(0.92, 1 - q / a), r() * TAU, r() * TAU, Math.abs(gauss(r)) * 14 * D2R, r() * TAU, r(), haze(r, 6));
};

interface SetDef {
  name: string; base: number; gen: Gen; tint: [number, number, number]; size: number; gain: number;
  radiusAU: number; fadePx: [number, number]; seed: number;
}
const SETS: SetDef[] = [
  { name: 'dust', base: 12000, gen: genDust, tint: [1.0, 0.82, 0.58], size: 1.5, gain: 0.55, radiusAU: 0.9, fadePx: [30, 90], seed: 11 },
  { name: 'asteroids', base: 30000, gen: genAsteroid, tint: [0.92, 0.84, 0.72], size: 1.5, gain: 0.38, radiusAU: 3.3, fadePx: [26, 80], seed: 12 },
  { name: 'trojans', base: 5000, gen: genTrojan, tint: [0.95, 0.85, 0.7], size: 1.5, gain: 0.8, radiusAU: 5.3, fadePx: [26, 80], seed: 13 },
  { name: 'kuiper', base: 36000, gen: genKuiper, tint: [0.62, 0.78, 1.0], size: 1.5, gain: 0.7, radiusAU: 48, fadePx: [26, 90], seed: 14 },
  { name: 'plutinos', base: 3500, gen: genPlutino, tint: [0.72, 0.84, 1.0], size: 1.5, gain: 0.8, radiusAU: 50, fadePx: [26, 90], seed: 15 },
  { name: 'scattered', base: 6000, gen: genScattered, tint: [0.5, 0.78, 0.9], size: 1.4, gain: 0.55, radiusAU: 120, fadePx: [30, 90], seed: 16 },
];
const countScale = (q: Quality) => (q === 'low' ? 0.3 : q === 'medium' ? 0.6 : 1);
const OORT_N = { low: 9000, medium: 22000, high: 42000 };

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  let renderer: THREE.WebGLRenderer | null = null;
  const buf = new THREE.Vector2();
  let quality: Quality = 'high';
  let simT = T_START;

  // ---- sun proxy
  const quadGeo = track(new THREE.PlaneGeometry(1, 1));
  const glareMat = track(new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: glareFrag, ...additive, uniforms: { uGlare: { value: 1 } } }));
  const glare = new THREE.Mesh(quadGeo, glareMat);
  glare.renderOrder = 20; glare.frustumCulled = false;
  const discMat = track(new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: discFrag, ...additive, uniforms: { uA: { value: 1 } } }));
  const disc = new THREE.Mesh(quadGeo, discMat);
  disc.renderOrder = 19; disc.frustumCulled = false;
  scene.add(glare, disc);

  // ---- zodiacal glow in the ecliptic plane
  const zodiGeo = track(new THREE.PlaneGeometry(2 * 160 * AU_U, 2 * 160 * AU_U));
  zodiGeo.rotateX(-Math.PI / 2);
  const zodiMat = track(new THREE.ShaderMaterial({
    vertexShader: quadVert, fragmentShader: zodiFrag, ...additive, side: THREE.DoubleSide,
    uniforms: { uA: { value: 1 }, uAU: { value: AU_U }, uTime: { value: 0 } },
  }));
  const zodi = new THREE.Mesh(zodiGeo, zodiMat);
  zodi.renderOrder = 0; zodi.frustumCulled = false;
  scene.add(zodi);

  // ---- orbit ribbons
  const SEG = 256;
  const orbitMat = track(new THREE.ShaderMaterial({
    vertexShader: orbitVert, fragmentShader: orbitFrag, ...additive, side: THREE.DoubleSide,
    uniforms: {
      uRes: { value: new THREE.Vector2(1000, 800) }, uHalf: { value: 4 }, uDpr: { value: 1 }, uTrailLen: { value: 2.1 }, uNear: { value: 0.01 },
      uPhase: { value: new Array(12).fill(0) }, uAlpha: { value: new Array(12).fill(1) },
    },
  }));
  {
    const NV = NB * SEG * 4;
    const pos = new Float32Array(NV * 3), nxt = new Float32Array(NV * 3), endA = new Float32Array(NV);
    const info = new Float32Array(NV * 4), col = new Float32Array(NV * 3);
    const idx: number[] = [];
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    BODIES.forEach((b, bi) => {
      for (let k = 0; k < SEG; k++) {
        const E0 = (k / SEG) * TAU, E1 = ((k + 1) / SEG) * TAU;
        orbitPoint(b.a, b.e, b.i, b.node, b.varpi, E0, p0);
        orbitPoint(b.a, b.e, b.i, b.node, b.varpi, E1, p1);
        const base = (bi * SEG + k) * 4;
        for (let v = 0; v < 4; v++) {
          const side = v % 2 === 0 ? -1 : 1, end = v < 2 ? 0 : 1;
          const vi = base + v;
          pos.set([p0.x, p0.y, p0.z], vi * 3); nxt.set([p1.x, p1.y, p1.z], vi * 3);
          endA[vi] = end;
          info.set([side, bi, end ? E1 : E0, b.dwarf ? 0.42 : 1], vi * 4);
          const c = b.col;
          col.set([0.55 * c[0] + 0.45, 0.55 * c[1] + 0.45, 0.55 * c[2] + 0.45], vi * 3);
        }
        idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    });
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(endA, 1));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, orbitMat);
    m.frustumCulled = false; m.renderOrder = 5;
    scene.add(m);
  }

  // ---- planet beads (+ Voyager 1)
  const NBEAD = NB + 1;
  const beadPos = new Float32Array(NBEAD * 3), beadFade = new Float32Array(NBEAD).fill(1);
  const beadGeo = track(new THREE.BufferGeometry());
  beadGeo.setAttribute('position', new THREE.BufferAttribute(beadPos, 3).setUsage(THREE.DynamicDrawUsage));
  beadGeo.setAttribute('aFade', new THREE.BufferAttribute(beadFade, 1).setUsage(THREE.DynamicDrawUsage));
  {
    const col = new Float32Array(NBEAD * 3), size = new Float32Array(NBEAD);
    BODIES.forEach((b, i) => { col.set(b.col, i * 3); size[i] = b.size * 1.4; });
    col.set([0.75, 0.95, 1.0], NB * 3); size[NB] = 2.6;
    beadGeo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    beadGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  }
  const beadMat = track(new THREE.ShaderMaterial({
    vertexShader: beadVert, fragmentShader: beadFrag, ...additive,
    uniforms: { uDpr: { value: 1 }, uRes: { value: new THREE.Vector2(1000, 800) } },
  }));
  const beads = new THREE.Points(beadGeo, beadMat);
  beads.frustumCulled = false; beads.renderOrder = 15;
  scene.add(beads);
  beadPos.set([voyPos.x, voyPos.y, voyPos.z], NB * 3);

  // ---- Keplerian particle sets
  const setObjs: { def: SetDef; mat: THREE.ShaderMaterial; pts: THREE.Points | null }[] = SETS.map((def) => {
    const mat = track(new THREE.ShaderMaterial({
      vertexShader: bodyVert, fragmentShader: bodyFrag, ...additive,
      uniforms: {
        uTime: { value: 0 }, uAU: { value: AU_U }, uDpr: { value: 1 }, uSize: { value: def.size }, uGain: { value: def.gain },
        uEx: { value: EX }, uEy: { value: EY }, uEz: { value: EZ }, uTint: { value: new THREE.Vector3(...def.tint) },
      },
    }));
    return { def, mat, pts: null };
  });
  const buildSets = (q: Quality) => {
    for (const so of setObjs) {
      if (so.pts) { scene.remove(so.pts); so.pts.geometry.dispose(); }
      const n = Math.max(200, Math.round(so.def.base * countScale(q)));
      const r = mulberry(so.def.seed * 977);
      const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
      const o: number[] = [];
      for (let i = 0; i < n; i++) {
        o.length = 0; so.def.gen(r, o);
        A.set(o.slice(0, 4), i * 4); B.set(o.slice(4, 8), i * 4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aA', new THREE.BufferAttribute(A, 4));
      g.setAttribute('aB', new THREE.BufferAttribute(B, 4));
      so.pts = new THREE.Points(g, so.mat);
      so.pts.frustumCulled = false; so.pts.renderOrder = 4;
      scene.add(so.pts);
    }
  };

  // ---- Oort cloud
  const oortMat = track(new THREE.ShaderMaterial({
    vertexShader: dustVert, fragmentShader: bodyFrag, ...additive,
    uniforms: { uDpr: { value: 1 }, uSize: { value: 1.6 }, uGain: { value: 0.2 }, uTint: { value: new THREE.Vector3(0.7, 0.85, 1.0) } },
  }));
  let oort: THREE.Points | null = null;
  let oortN = 1;
  const buildOort = (q: Quality) => {
    if (oort) { scene.remove(oort); oort.geometry.dispose(); }
    const n = OORT_N[q]; oortN = n;
    const r = mulberry(4242);
    const pos = new Float32Array(n * 3), aR = new Float32Array(n);
    const lo = Math.log(2000), hi = Math.log(100000);
    for (let i = 0; i < n; i++) {
      const rAU = Math.exp(lo + (hi - lo) * Math.pow(r(), 0.7));
      const flat = 0.3 + 0.7 * smooth(rAU, 2000, 22000);
      const x = gauss(r), y = gauss(r) * flat, z = gauss(r);
      const l = Math.hypot(x, y, z) || 1;
      pos.set([(x / l) * rAU * AU_U, (y / l) * rAU * AU_U, (z / l) * rAU * AU_U], i * 3);
      aR[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
    oort = new THREE.Points(g, oortMat);
    oort.frustumCulled = false; oort.renderOrder = 3;
    scene.add(oort);
  };

  // ---- heliosphere
  const helioGeo = track(new THREE.SphereGeometry(1, 96, 64));
  {
    const p = helioGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const c = v.dot(NOSE);
      const f = c >= 0 ? 1 + 0.2 * (1 - c) : 1.2 + 2.2 * Math.pow(-c, 1.7);
      v.multiplyScalar(120 * AU_U * f);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    helioGeo.computeVertexNormals();
  }
  const helioMat = track(new THREE.ShaderMaterial({
    vertexShader: helioVert, fragmentShader: helioFrag, ...additive, side: THREE.DoubleSide, uniforms: { uA: { value: 1 } },
  }));
  const helio = new THREE.Mesh(helioGeo, helioMat);
  helio.renderOrder = 2; helio.frustumCulled = false;
  scene.add(helio);

  // ---- guide lines (Sun–Earth, Sun–Neptune)
  const mkGuide = (col: [number, number, number]) => {
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
    const m = track(new THREE.ShaderMaterial({
      vertexShader: guideVert, fragmentShader: guideFrag, ...additive,
      uniforms: { uA: { value: 0 }, uCol: { value: new THREE.Vector3(...col) } },
    }));
    const line = new THREE.Line(g, m);
    line.frustumCulled = false; line.renderOrder = 6;
    scene.add(line);
    return { g, m };
  };
  const guideE = mkGuide([0.6, 0.85, 1.0]);
  const guideN = mkGuide([0.5, 0.7, 1.0]);

  // ---- real nearby stars + the Sun as a star + backdrop
  const mkStarMat = () => track(new THREE.ShaderMaterial({
    vertexShader: starVert, fragmentShader: starFrag, ...additive,
    uniforms: { uE: { value: 22_000 }, uDpr: { value: 1 }, uFade: { value: 1 }, uSpikes: { value: 1 }, uUnitLy: { value: UNIT_M / 9.4607e15 } },
  }));
  const starMat = mkStarMat(), sunStarMat = mkStarMat();
  {
    const pos = new Float32Array(STARS.length * 3), col = new Float32Array(STARS.length * 3), lum = new Float32Array(STARS.length);
    STARS.forEach((s, i) => { const p = starPos(s); pos.set([p.x, p.y, p.z], i * 3); col.set(s.col, i * 3); lum[i] = s.lum; });
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aLum', new THREE.BufferAttribute(lum, 1));
    const pts = new THREE.Points(g, starMat);
    pts.frustumCulled = false; pts.renderOrder = 8;
    scene.add(pts);
    const g2 = track(new THREE.BufferGeometry());
    g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    g2.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array([1, 0.93, 0.8]), 3));
    g2.setAttribute('aLum', new THREE.BufferAttribute(new Float32Array([1]), 1));
    const sp = new THREE.Points(g2, sunStarMat);
    sp.frustumCulled = false; sp.renderOrder = 9;
    scene.add(sp);
  }
  const skyMat = track(new THREE.ShaderMaterial({
    vertexShader: skyVert, fragmentShader: skyFrag, ...additive, uniforms: { uR: { value: 1 }, uDpr: { value: 1 }, uFade: { value: 1 } },
  }));
  let sky: THREE.Points | null = null;
  const buildSky = (q: Quality) => {
    if (sky) { scene.remove(sky); sky.geometry.dispose(); }
    const n = q === 'low' ? 1400 : q === 'medium' ? 2400 : 3600;
    const r = mulberry(909);
    const pos = new Float32Array(n * 3), att = new Float32Array(n * 4);
    const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(ORIENT).normalize();   // galactic pole direction in this frame
    pole.copy(new THREE.Vector3(...galDir(0, 90)).applyQuaternion(ORIENT));
    const d = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      for (;;) {
        d.set(gauss(r), gauss(r), gauss(r)).normalize();
        const lat = Math.abs(d.dot(pole));
        if (r() < 0.35 + 0.65 * Math.exp(-lat * lat * 7)) break;   // thicker toward the Milky Way's plane
      }
      pos.set([d.x, d.y, d.z], i * 3);
      const m = Math.pow(r(), 5);
      att.set([0.05 + 0.5 * m, r(), m, 0], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSky', new THREE.BufferAttribute(att, 4));
    sky = new THREE.Points(g, skyMat);
    sky.frustumCulled = false; sky.renderOrder = -1;
    scene.add(sky);
  };

  const applyQuality = (q: Quality) => {
    quality = q;
    buildSets(q); buildOort(q); buildSky(q);
    const sp = q === 'low' ? 0 : 1;
    starMat.uniforms.uSpikes.value = sp; sunStarMat.uniforms.uSpikes.value = sp;
  };

  // ---- per-frame scratch
  const P = new THREE.Vector3();
  const bodyPos = BODIES.map(() => new THREE.Vector3());

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      applyQuality(ctx.quality);
    },
    update(frame: FrameState) {
      const cam = frame.camera;
      const s = frame.s;
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const H = buf.y > 0 ? buf.y : 900, W = buf.x > 0 ? buf.x : 1200;
      const D = Math.max(1e-9, cam.position.length());
      const fovT = 2 * Math.tan((cam.fov * Math.PI) / 360);
      const ppu = H / dpr / (fovT * D);                       // css px per unit at the origin
      const px = (au: number) => au * AU_U * ppu;

      // adaptive time-lapse: orbits that fill the view complete a lap in roughly 18 s
      const viewAU = Math.pow(10, s) / 1.495978707e11;
      const rate = Math.min(40, Math.max(0.003, Math.pow(0.35 * viewAU * 0.5, 1.5) / 18));
      simT += Math.min(0.1, frame.dt) * rate;

      // ---- sun proxy
      const kG = 1 - 0.9 * smooth(s, 13.8, 16.8);
      glare.position.set(0, 0, 0); glare.quaternion.copy(cam.quaternion);
      glare.scale.setScalar(D * 0.5 * kG);
      glareMat.uniforms.uGlare.value = 1 - 0.85 * smooth(s, 14.5, 16.8);
      disc.quaternion.copy(cam.quaternion);
      const Rw = Math.max(SUN_R, 1.6 / ppu);
      disc.scale.setScalar(2 * Rw);
      discMat.uniforms.uA.value = 1 - smooth(s, 12.4, 13.4);
      zodiMat.uniforms.uA.value = 1 - smooth(s, 14.2, 15.8);

      // ---- bodies
      const phase = orbitMat.uniforms.uPhase.value as number[];
      const alpha = orbitMat.uniforms.uAlpha.value as number[];
      BODIES.forEach((b, i) => {
        const M = bodyM0(b) + (TAU * simT) / Math.pow(b.a, 1.5);
        const E = solveE(M, b.e);
        phase[i] = ((E % TAU) + TAU) % TAU;
        orbitPoint(b.a, b.e, b.i, b.node, b.varpi, E, bodyPos[i]);
        beadPos[i * 3] = bodyPos[i].x; beadPos[i * 3 + 1] = bodyPos[i].y; beadPos[i * 3 + 2] = bodyPos[i].z;
        const pxR = px(b.a);
        const big = pxR / (H / dpr);
        alpha[i] = smooth(pxR, 9, 30) * (b.dwarf ? 0.4 : 1) * (1 - smooth(big, b.dwarf ? 1.3 : 3.5, b.dwarf ? 3.2 : 9));
        beadFade[i] = smooth(pxR, 6, 20);
        const L = meta.labels![i].position;
        L[0] = bodyPos[i].x; L[1] = bodyPos[i].y; L[2] = bodyPos[i].z;
      });
      const voyPx = px(170);
      beadFade[NB] = smooth(voyPx, 14, 40);
      (beadGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (beadGeo.attributes.aFade as THREE.BufferAttribute).needsUpdate = true;
      orbitMat.uniforms.uRes.value.set(W, H);
      orbitMat.uniforms.uHalf.value = 4.2 * dpr;
      orbitMat.uniforms.uDpr.value = dpr;
      orbitMat.uniforms.uNear.value = cam.near * 1.5;
      beadMat.uniforms.uDpr.value = dpr;
      beadMat.uniforms.uRes.value.set(W, H);

      // ---- particle sets
      for (const so of setObjs) {
        const u = so.mat.uniforms;
        u.uTime.value = simT; u.uDpr.value = dpr;
        const f = smooth(px(so.def.radiusAU), so.def.fadePx[0], so.def.fadePx[1]);
        u.uGain.value = so.def.gain * f * (so.def.name === 'dust' ? 1 - smooth(s, 11.9, 12.7) * 0.7 : 1) * (quality === 'low' ? 1.6 : 1);
      }

      // ---- Oort cloud: keep per-point brightness sensible as the shell shrinks to a disc
      const shellPx = 1660 * ppu;
      const area = Math.PI * shellPx * shellPx;
      oortMat.uniforms.uDpr.value = dpr;
      oortMat.uniforms.uGain.value = Math.min(1, Math.max(0.03, area / (oortN * 9))) * 0.15 * smooth(1660 * ppu, 4, 30);

      // ---- heliosphere
      helioMat.uniforms.uA.value = smooth(px(120), 30, 110) * (1 - smooth(s, 15.4, 16.6));

      // ---- guides
      const eP = bodyPos[2], nP = bodyPos[7];
      const ge = guideE.g.attributes.position as THREE.BufferAttribute;
      ge.setXYZ(0, 0, 0, 0); ge.setXYZ(1, eP.x, eP.y, eP.z); ge.needsUpdate = true;
      const gn = guideN.g.attributes.position as THREE.BufferAttribute;
      gn.setXYZ(0, 0, 0, 0); gn.setXYZ(1, nP.x, nP.y, nP.z); gn.needsUpdate = true;
      guideE.m.uniforms.uA.value = 0.5 * smooth(px(1), 70, 200) * (1 - smooth(px(1), 1500, 4000));
      guideN.m.uniforms.uA.value = 0.45 * smooth(px(30.07), 120, 300);

      // ---- stars
      starMat.uniforms.uDpr.value = dpr;
      starMat.uniforms.uFade.value = smooth(s, 15.2, 16.4);
      sunStarMat.uniforms.uDpr.value = dpr;
      sunStarMat.uniforms.uFade.value = smooth(s, 15.8, 16.8);
      skyMat.uniforms.uDpr.value = dpr;
      skyMat.uniforms.uR.value = D * 60;
      skyMat.uniforms.uFade.value = 1 - smooth(s, 15.6, 17.2);

      // ---- labels that follow things
      const L = meta.labels!;
      L[L_SUN].position[0] = 0; L[L_SUN].position[1] = 0; L[L_SUN].position[2] = 0;
      P.copy(eP).multiplyScalar(0.28); P.y += 0.0012;
      L[L_AU].position[0] = P.x; L[L_AU].position[1] = P.y; L[L_AU].position[2] = P.z;
      P.copy(eP).multiplyScalar(0.7); P.y -= 0.0012;
      L[L_EARTH_LIGHT].position[0] = P.x; L[L_EARTH_LIGHT].position[1] = P.y; L[L_EARTH_LIGHT].position[2] = P.z;
      P.copy(nP).multiplyScalar(0.5);
      L[L_NEP].position[0] = P.x; L[L_NEP].position[1] = P.y; L[L_NEP].position[2] = P.z;
    },
    setQuality(q: Quality) { applyQuality(q); },
    dispose() {
      for (const so of setObjs) if (so.pts) so.pts.geometry.dispose();
      if (oort) oort.geometry.dispose();
      if (sky) sky.geometry.dispose();
      for (const d of disposables) d.dispose();
    },
  };
};

export default factory;
