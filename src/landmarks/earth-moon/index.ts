/**
 * Landmark "earth-moon": the Earth–Moon system at true scale. 1 unit = 384,400 km, Earth at the origin.
 *
 * Moon: shaded ShaderMaterial world (maria, layered craters with bump, rayed Tycho/Copernicus, earthshine,
 * Lommel–Seeliger lighting) on a Kepler orbit (e = 0.055, 5.1° to the ecliptic), tidally locked. A shaded
 * sprite keeps it from vanishing when it is smaller than a few pixels. Around it: day-tick orbit ribbon,
 * "30 Earths" bead strip, a laser-pulse, Earth's and the Moon's shadow cones, LEO/GPS/GEO satellite shells,
 * a matching star backdrop and (zoomed out) a small lit Earth proxy.
 *
 * The Sun direction and polar axis come from the Earth scene's frame (same helpers). SUN_AZ/SUN_EL mirror
 * the constants in earth/index.ts (not exported from there).
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkLabel, LandmarkMeta, Quality } from '../../engine/types';
import { localSkyDir, polarAxisLocal } from '../earth/geo';
import { starFrag, starVert } from '../earth/shaders';
import {
  beadFrag, beadVert, coneFrag, coneVert, dotFrag, earthFrag, earthVert, moonFrag, moonVert, pulseFrag, pulseVert,
  ribbonFrag, ribbonVert, satVert, spriteFrag, spriteVert,
} from './shaders';

const KM = 384400;                      // 1 unit
const R_E = 6371 / KM;                  // 0.016574
const R_M = 1737.4 / KM;                // 0.004520
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const SUN_AZ = 72, SUN_EL = 22;         // same as earth/index.ts
const ECC = 0.055, INCL = 5.1 * D2R, OBLIQ = 23.4 * D2R;
const SIDEREAL = 27.32;
const smooth = THREE.MathUtils.smoothstep;

const meta: LandmarkMeta = {
  id: 'earth-moon',
  name: 'Earth–Moon system',
  sizeMeters: 3.84e8,
  range: [7.6, 9.7],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'The Moon is about a quarter of Earth’s width and sits 30 Earth-widths away, so there is a huge amount of empty space between them. Its gravity pulls the oceans into tides, and we see phases because half of the Moon is always lit by the Sun and we view that half from different angles through the month.',
  howWeKnow: {
    instrument: 'Lunar laser ranging',
    text:
      'Apollo astronauts left mirror-like reflectors on the Moon. Observatories fire laser pulses at them and time the return trip, which gives the distance to within millimetres. These measurements show the Moon is drifting away from us by about 3.8 cm every year.',
  },
  lightTime: 'About 1.3 seconds from Earth to the Moon',
  timescale: 'One orbit takes 27.3 days; one full cycle of phases takes 29.5 days (about a month). Satellites circle Earth in 90 minutes (low orbit) to 24 hours (geostationary).',
  post: { bloom: 0.3, exposure: 1 },
  labels: [
    { text: 'Moon', position: [0, 0, 0], zoomRange: [-0.45, 1.05] },
    { text: '384,400 km', position: [0, 0, 0], zoomRange: [-0.15, 0.75] },
    { text: 'Light takes 1.3 seconds', position: [0, 0, 0], zoomRange: [-0.2, 0.8] },
    { text: '30 Earths fit in the gap', position: [0, 0, 0], zoomRange: [-0.1, 0.4] },
    { text: 'The Moon’s whole orbit almost fits inside the Sun', position: [0, 0, 0], zoomRange: [0.55, 1.05] },
    { text: 'Earth’s shadow', position: [0, 0, 0], zoomRange: [-0.2, 0.3] },
    { text: 'International Space Station orbit (400 km up)', position: [0, 0, 0], zoomRange: [-1.0, -0.65] },
    { text: 'GPS satellites', position: [0, 0, 0], zoomRange: [-1.0, -0.4] },
    { text: 'Geostationary ring (36,000 km up)', position: [0, 0, 0], zoomRange: [-1.0, -0.1] },
  ],
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const additive = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
} as const;
const premult = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
} as const;

const leoCount = (q: Quality) => (q === 'high' ? 2600 : q === 'medium' ? 1500 : 800);
const starCount = (q: Quality) => (q === 'high' ? 14000 : q === 'medium' ? 9000 : 4500);

const ll = (lon: number, lat: number, w: number) => {
  const lo = lon * D2R, la = lat * D2R;
  return new THREE.Vector4(Math.sin(lo) * Math.cos(la), Math.sin(la), Math.cos(lo) * Math.cos(la), w * D2R * 1.2);
};
const MARE = [
  ll(-17, 33, 17), ll(18, 28, 10), ll(31, 8, 12), ll(59, 17, 6.5), ll(51, -4, 9), ll(34, -15, 5.5), ll(-15, -21, 9),
  ll(-39, -24, 6), ll(-55, 14, 24), ll(-1, 58, 9), ll(-23, -10, 6), ll(3, 14, 6), ll(-93, -19, 7), ll(147, 27, 5),
];
const RAYS = [ll(-11, -43, 1.5), ll(-20, 10, 3.2), ll(-38, 8, 7), ll(-47, 24, 7)];

const kepler = (M: number) => {
  let E = M + ECC * Math.sin(M);
  for (let k = 0; k < 4; k++) E -= (E - ECC * Math.sin(E) - M) / (1 - ECC * Math.cos(E));
  return E;
};
const keplerDays = (aKm: number) => (TAU * Math.sqrt((aKm ** 3) / 398600.4418)) / 86400;

function createEarthMoon(): Landmark {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  let renderer: THREE.WebGLRenderer | null = null;
  let tier: Quality = 'medium';

  // ---------------------------------------------------------------- frames
  const S0 = localSkyDir(SUN_AZ, SUN_EL).normalize();
  const P = polarAxisLocal().normalize();
  const sun = S0.clone();
  const qWob = new THREE.Quaternion();
  // Ecliptic normal N: perpendicular to the Sun direction, tilted 23.4° from the polar axis.
  const kdot = S0.dot(P);
  const pperp = P.clone().addScaledVector(S0, -kdot);
  const pl = pperp.length();
  pperp.normalize();
  const phi = Math.acos(Math.min(1, Math.cos(OBLIQ) / pl));
  const N = pperp.clone().multiplyScalar(Math.cos(phi)).addScaledVector(new THREE.Vector3().crossVectors(S0, pperp), -Math.sin(phi)).normalize();
  const E1 = S0.clone();                                    // ecliptic longitude 0 = towards the Sun
  const E2 = new THREE.Vector3().crossVectors(N, E1).normalize();
  // orbit plane (inclined 5.1° about a node line)
  const OMEGA = 40 * D2R, ARGP = 100 * D2R;
  const Nd = E1.clone().multiplyScalar(Math.cos(OMEGA)).addScaledVector(E2, Math.sin(OMEGA));
  const Qv = new THREE.Vector3().crossVectors(N, Nd);
  const Qp = Qv.clone().multiplyScalar(Math.cos(INCL)).addScaledVector(N, Math.sin(INCL));
  const Nm = new THREE.Vector3().crossVectors(Nd, Qp).normalize();           // orbit normal
  const Pn = Nd.clone().multiplyScalar(Math.cos(ARGP)).addScaledVector(Qp, Math.sin(ARGP));
  const Qn = Nd.clone().multiplyScalar(-Math.sin(ARGP)).addScaledVector(Qp, Math.cos(ARGP));
  const orbitPoint = (M: number, out: THREE.Vector3) => {
    const E = kepler(M);
    const x = Math.cos(E) - ECC, y = Math.sqrt(1 - ECC * ECC) * Math.sin(E);
    return out.copy(Pn).multiplyScalar(x).addScaledVector(Qn, y);
  };
  // equatorial frame for satellites
  const EqX = S0.clone().addScaledVector(P, -kdot).normalize();
  const EqY = new THREE.Vector3().crossVectors(P, EqX).normalize();

  // starting phase: Moon in the upper-right of the ring in the default view (yaw 0.35, pitch 0.18),
  // clear of the bottom-left info card and not behind Earth, with a clearly visible lit fraction
  let M0 = 0;
  {
    const cd = new THREE.Vector3(Math.cos(0.18) * Math.sin(0.35), Math.sin(0.18), Math.cos(0.18) * Math.cos(0.35));
    const camRight = new THREE.Vector3(0, 1, 0).cross(cd).normalize();
    const camUp = new THREE.Vector3().crossVectors(cd, camRight).normalize();
    const v = new THREE.Vector3();
    let best = -1e9;
    for (let i = 0; i < 1440; i++) {
      const M = (i / 1440) * TAU;
      orbitPoint(M, v);
      const lit = 0.5 * (1 - S0.dot(v.clone().normalize()));
      const sr = v.dot(camRight), su = v.dot(camUp);
      if (sr < 0.2 || su < 0.15) continue;
      const score = sr + su + 1.4 * lit;
      if (score > best) { best = score; M0 = M; }
    }
  }
  let simDays = 0;
  let lastF = 0.3;

  // ---------------------------------------------------------------- stars (same field as the Earth scene)
  const starMat = track(new THREE.ShaderMaterial({
    vertexShader: starVert, fragmentShader: starFrag, ...additive, depthTest: false,
    uniforms: { uDist: { value: 1 }, uScale: { value: 1 }, uOpacity: { value: 1 } },
  }));
  let stars: THREE.Points | null = null;
  const buildStars = (qt: Quality) => {
    if (stars) { scene.remove(stars); stars.geometry.dispose(); }
    const n = starCount(qt);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    const gN = new THREE.Vector3(-0.87, 0.46, -0.2).normalize();
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 8; k++) {
        const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        v.set(s * Math.cos(t), u, s * Math.sin(t));
        if (i % 20 < 11 || Math.abs(v.dot(gN)) < 0.25 * rnd() + 0.05) break;
      }
      pos.set([v.x, v.y, v.z], i * 3);
      const b = Math.pow(rnd(), 5.5);
      const temp = rnd();
      const c = temp < 0.12 ? [0.7, 0.8, 1.0] : temp < 0.55 ? [1.0, 0.97, 0.92] : temp < 0.85 ? [1.0, 0.86, 0.68] : [1.0, 0.72, 0.5];
      const lum = 0.08 + b * 2.4;
      col.set([c[0] * lum, c[1] * lum, c[2] * lum], i * 3);
      size[i] = 1.6 + b * 4.0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    stars = new THREE.Points(g, starMat);
    stars.frustumCulled = false;
    stars.renderOrder = 1;
    scene.add(stars);
  };

  // ---------------------------------------------------------------- Moon
  const moonUniforms = {
    uSun: { value: sun }, uEarthDir: { value: new THREE.Vector3(-1, 0, 0) }, uEarthLit: { value: 0.5 },
    uPx: { value: 3 }, uBump: { value: 1 }, uMare: { value: MARE }, uRay: { value: RAYS }, uOpacity: { value: 1 },
  };
  const moonMat = track(new THREE.ShaderMaterial({
    vertexShader: moonVert, fragmentShader: moonFrag, uniforms: moonUniforms, ...premult, depthWrite: true,
  }));
  const moonGeo = track(new THREE.SphereGeometry(R_M, 64, 48));
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.renderOrder = 7; moon.frustumCulled = false;
  scene.add(moon);

  // ---------------------------------------------------------------- sprites (tiny-body floor)
  const dummyGeo = track(new THREE.BufferGeometry());
  dummyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const makeSprite = (col: THREE.Vector3, halo: THREE.Vector3, r: number, haloPx: number) => {
    const m = track(new THREE.ShaderMaterial({
      vertexShader: spriteVert, fragmentShader: spriteFrag, ...additive, depthTest: true,
      uniforms: {
        uPos: { value: new THREE.Vector3() }, uR: { value: r }, uHalo: { value: haloPx }, uDpr: { value: 1 },
        uCol: { value: col }, uHaloCol: { value: halo }, uL: { value: new THREE.Vector3(1, 0, 0) },
        uAmt: { value: 0 }, uShine: { value: 0.5 }, uHaloAmt: { value: 0.3 },
      },
    }));
    const p = new THREE.Points(dummyGeo, m);
    p.frustumCulled = false; p.renderOrder = 8;
    scene.add(p);
    return { m, p };
  };
  const moonSprite = makeSprite(new THREE.Vector3(0.78, 0.76, 0.72), new THREE.Vector3(0.7, 0.72, 0.8), 4.5, 4);
  const earthSprite = makeSprite(new THREE.Vector3(0.12, 0.3, 0.75), new THREE.Vector3(0.25, 0.5, 1.0), 2.3, 8);
  earthSprite.m.uniforms.uHaloAmt.value = 0.55;

  // ---------------------------------------------------------------- Earth proxy
  const earthMat = track(new THREE.ShaderMaterial({
    vertexShader: earthVert, fragmentShader: earthFrag, ...premult, depthWrite: true,
    uniforms: { uSun: { value: sun }, uOpacity: { value: 0 }, uTime: { value: 0 } },
  }));
  const earthGeo = track(new THREE.SphereGeometry(R_E, 48, 32));
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), P);
  earth.renderOrder = 6; earth.frustumCulled = false; earth.visible = false;
  scene.add(earth);

  // ---------------------------------------------------------------- ribbons
  const ribbonUniforms = () => ({
    uRes: { value: new THREE.Vector2(1280, 800) }, uHalf: { value: 5 }, uNear: { value: 0.01 }, uDpr: { value: 1 },
    uMoonU: { value: 0 }, uAlpha: { value: 1 }, uDark: { value: 0 }, uTicksN: { value: 0 }, uTrail: { value: 0 },
    uCol: { value: new THREE.Vector3(0.72, 0.84, 1.0) },
  });
  const makeRibbonMat = () => track(new THREE.ShaderMaterial({
    vertexShader: ribbonVert, fragmentShader: ribbonFrag, uniforms: ribbonUniforms(),
    extensions: { derivatives: true } as never,
    side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  const ribbonGeo = (pts: THREE.Vector3[]) => {
    const n = pts.length - 1;
    const pos = new Float32Array(n * 4 * 3), nxt = new Float32Array(n * 4 * 3), info = new Float32Array(n * 4 * 3);
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[i + 1];
      for (let v = 0; v < 4; v++) {
        const k = (i * 4 + v);
        const end = v >> 1, side = v & 1 ? 1 : -1;
        pos.set([a.x, a.y, a.z], k * 3); nxt.set([b.x, b.y, b.z], k * 3);
        info.set([side, end, (i + end) / n], k * 3);
      }
      const o = i * 4;
      idx.set([o, o + 1, o + 2, o + 1, o + 3, o + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  };
  const NSEG = 720;
  const orbitPts: THREE.Vector3[] = [];
  for (let i = 0; i <= NSEG; i++) orbitPts.push(orbitPoint((i / NSEG) * TAU, new THREE.Vector3()));
  const orbitMat = makeRibbonMat();
  orbitMat.uniforms.uTicksN.value = SIDEREAL;
  orbitMat.uniforms.uTrail.value = 1;
  const orbitGeo = track(ribbonGeo(orbitPts));
  const orbitLine = new THREE.Mesh(orbitGeo, orbitMat);
  orbitLine.frustumCulled = false; orbitLine.renderOrder = 3;
  scene.add(orbitLine);

  const shellMat = makeRibbonMat();
  shellMat.uniforms.uCol.value.set(0.55, 0.8, 1.0);
  const shellPts: THREE.Vector3[][] = [];
  {
    const ring = (r: number, inc: number, node: number) => {
      const out: THREE.Vector3[] = [];
      const nd = EqX.clone().multiplyScalar(Math.cos(node)).addScaledVector(EqY, Math.sin(node));
      const q = EqX.clone().multiplyScalar(-Math.sin(node)).addScaledVector(EqY, Math.cos(node));
      for (let i = 0; i <= 192; i++) {
        const a = (i / 192) * TAU;
        out.push(nd.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(q, Math.sin(a) * r * Math.cos(inc)).addScaledVector(P, Math.sin(a) * r * Math.sin(inc)));
      }
      return out;
    };
    shellPts.push(ring(42164 / KM, 0, 0));
    for (let k = 0; k < 6; k++) shellPts.push(ring(26560 / KM, 55 * D2R, (k * 60 + 15) * D2R));
  }
  const shellGeos = shellPts.map((p) => track(ribbonGeo(p)));
  const shellMeshes = shellGeos.map((g) => {
    const m = new THREE.Mesh(g, shellMat);
    m.frustumCulled = false; m.renderOrder = 3; scene.add(m); return m;
  });

  // ---------------------------------------------------------------- satellites
  const satUniformsFor = (size: number) => ({
    uDays: { value: 0 }, uDpr: { value: 1 }, uOpacity: { value: 0 }, uSize: { value: size },
    uEx: { value: EqX }, uEy: { value: EqY }, uP: { value: P },
  });
  const leoMat = track(new THREE.ShaderMaterial({ vertexShader: satVert, fragmentShader: dotFrag, ...additive, depthTest: false, uniforms: satUniformsFor(2.0) }));
  const shellSatMat = track(new THREE.ShaderMaterial({ vertexShader: satVert, fragmentShader: dotFrag, ...additive, depthTest: false, uniforms: satUniformsFor(2.6) }));
  const buildSatGeo = (list: { r: number; inc: number; node: number; ph: number; rate: number; b: number; cls: number }[]) => {
    const n = list.length;
    const orb = new Float32Array(n * 4), rb = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    list.forEach((s, i) => { orb.set([s.r, s.inc, s.node, s.ph], i * 4); rb.set([s.rate, s.b, s.cls], i * 3); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aOrb', new THREE.BufferAttribute(orb, 4));
    g.setAttribute('aRB', new THREE.BufferAttribute(rb, 3));
    return g;
  };
  let leoPts: THREE.Points | null = null;
  const buildLeo = (qt: Quality) => {
    if (leoPts) { scene.remove(leoPts); leoPts.geometry.dispose(); }
    const rnd = rng(4242), list = [];
    const n = leoCount(qt);
    for (let i = 0; i < n; i++) {
      const alt = 400 + 800 * Math.pow(rnd(), 1.3);
      const a = 6371 + alt;
      const t = rnd();
      const inc = (t < 0.5 ? 53 : t < 0.72 ? 97.5 : t < 0.86 ? 70 : t < 0.94 ? 51.6 : 30 + 20 * rnd()) * D2R;
      const node = Math.floor(rnd() * 36) / 36 * TAU + (rnd() - 0.5) * 0.02;
      list.push({ r: a / KM, inc, node, ph: rnd() * TAU, rate: 1 / keplerDays(a), b: 0.35 + 0.65 * rnd(), cls: 0 });
    }
    leoPts = new THREE.Points(buildSatGeo(list), leoMat);
    leoPts.frustumCulled = false; leoPts.renderOrder = 5;
    scene.add(leoPts);
  };
  const shellList: Parameters<typeof buildSatGeo>[0] = [];
  {
    const rnd = rng(77);
    const a = 26560;
    for (let k = 0; k < 6; k++) for (let j = 0; j < 5; j++) {
      shellList.push({ r: a / KM, inc: 55 * D2R, node: (k * 60 + 15) * D2R, ph: ((j + (k % 2) * 0.5) / 5) * TAU + (rnd() - 0.5) * 0.1, rate: 1 / keplerDays(a), b: 1.0, cls: 1 });
    }
    const g = 42164;
    for (let j = 0; j < 140; j++) shellList.push({ r: g / KM, inc: 0, node: 0, ph: rnd() * TAU, rate: 1 / keplerDays(g), b: 0.5 + 0.6 * rnd(), cls: 2 });
  }
  const shellSatGeo = track(buildSatGeo(shellList));
  const shellSats = new THREE.Points(shellSatGeo, shellSatMat);
  shellSats.frustumCulled = false; shellSats.renderOrder = 5;
  scene.add(shellSats);

  // ---------------------------------------------------------------- Earth–Moon dimension line
  const distMat = makeRibbonMat();
  distMat.uniforms.uCol.value.set(0.7, 0.8, 0.95);
  const distGeo = track(ribbonGeo([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]));
  const distLine = new THREE.Mesh(distGeo, distMat);
  distLine.frustumCulled = false; distLine.renderOrder = 3;
  scene.add(distLine);

  // ---------------------------------------------------------------- beads + pulse
  const beadGeo = track(new THREE.BufferGeometry());
  {
    const k = new Float32Array(29);
    for (let i = 0; i < 29; i++) k[i] = i + 1;
    beadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(29 * 3), 3));
    beadGeo.setAttribute('aK', new THREE.BufferAttribute(k, 1));
  }
  const beadMat = track(new THREE.ShaderMaterial({
    vertexShader: beadVert, fragmentShader: beadFrag, ...additive, depthTest: false,
    extensions: { derivatives: true } as never,
    uniforms: { uDir: { value: new THREE.Vector3(1, 0, 0) }, uStep: { value: 2 * R_E }, uProj: { value: 800 }, uOpacity: { value: 0 }, uL: { value: new THREE.Vector3(1, 0, 0) } },
  }));
  const beads = new THREE.Points(beadGeo, beadMat);
  beads.frustumCulled = false; beads.renderOrder = 4;
  scene.add(beads);

  const pulseGeo = track(new THREE.BufferGeometry());
  {
    const k = new Float32Array(24);
    for (let i = 0; i < 24; i++) k[i] = i;
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    pulseGeo.setAttribute('aK', new THREE.BufferAttribute(k, 1));
  }
  const pulseMat = track(new THREE.ShaderMaterial({
    vertexShader: pulseVert, fragmentShader: pulseFrag, ...additive, depthTest: false,
    uniforms: { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uF: { value: -1 }, uDir: { value: 1 }, uDpr: { value: 1 }, uOpacity: { value: 1 } },
  }));
  const pulse = new THREE.Points(pulseGeo, pulseMat);
  pulse.frustumCulled = false; pulse.renderOrder = 9;
  scene.add(pulse);

  // ---------------------------------------------------------------- shadow cones
  const coneMat = track(new THREE.ShaderMaterial({
    vertexShader: coneVert, fragmentShader: coneFrag, ...premult, side: THREE.DoubleSide, depthTest: true,
    uniforms: { uOpacity: { value: 1 }, uStrength: { value: 1 } },
  }));
  const coneGeo = track(new THREE.CylinderGeometry(0, 1, 1, 48, 1, true).translate(0, 0.5, 0)); // base y=0 radius 1, apex y=1
  const earthCone = new THREE.Mesh(coneGeo, coneMat);
  earthCone.scale.set(R_E, 3.6, R_E);
  earthCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), S0.clone().negate());
  earthCone.renderOrder = 2; earthCone.frustumCulled = false;
  scene.add(earthCone);
  const moonConeMat = coneMat.clone();
  moonConeMat.uniforms = { uOpacity: { value: 1 }, uStrength: { value: 0.8 } };
  track(moonConeMat);
  const moonCone = new THREE.Mesh(coneGeo, moonConeMat);
  moonCone.scale.set(R_M, 0.974, R_M);
  moonCone.quaternion.copy(earthCone.quaternion);
  moonCone.renderOrder = 2; moonCone.frustumCulled = false;
  scene.add(moonCone);

  // ---------------------------------------------------------------- per-frame scratch
  const moonPos = new THREE.Vector3(), mdir = new THREE.Vector3(), xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3();
  const basis = new THREE.Matrix4(), tmp = new THREE.Vector3(), camR = new THREE.Vector3(), camU = new THREE.Vector3();
  const buf = new THREE.Vector2();
  const Lcam = new THREE.Vector3();
  const L = meta.labels as LandmarkLabel[];
  const setLabel = (i: number, v: THREE.Vector3) => { L[i].position[0] = v.x; L[i].position[1] = v.y; L[i].position[2] = v.z; };
  const gpsLabel = new THREE.Vector3().copy(EqX).multiplyScalar(Math.cos(40 * D2R) * 26560 / KM).addScaledVector(P, Math.sin(40 * D2R) * 26560 / KM);
  const geoLabel = new THREE.Vector3().copy(EqY).multiplyScalar(-42164 / KM);
  const issLabel = new THREE.Vector3().copy(P).multiplyScalar(R_E * 1.09).addScaledVector(EqX, R_E * 0.4);

  const applyQuality = (qt: Quality) => {
    tier = qt;
    buildStars(qt);
    buildLeo(qt);
    moonUniforms.uBump.value = qt === 'low' ? 0 : 1;
  };

  const landmark: Landmark = {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      applyQuality(ctx.quality);
    },

    update(frame: FrameState) {
      const cam = frame.camera;
      cam.updateMatrixWorld();
      const z = frame.zoom;
      const dt = Math.min(frame.dt, 0.1);
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const projScale = buf.y / (2 * Math.tan((cam.fov * D2R) / 2));
      const viewH = Math.pow(10, z);

      // simulated time (days): one Moon orbit in ~50 s at home zoom, much slower deep in
      const rate = (SIDEREAL / 50) * Math.pow(10, 1.8 * (Math.min(z, 0.25) - 0.25));
      simDays += dt * rate;

      // Sun direction (same slow wobble as the Earth scene)
      qWob.setFromAxisAngle(P, 0.035 * Math.sin(frame.time * 0.012));
      sun.copy(S0).applyQuaternion(qWob);

      // ---- Moon
      const M = M0 + (TAU * simDays) / SIDEREAL;
      orbitPoint(M, moonPos);
      mdir.copy(moonPos).normalize();
      moon.position.copy(moonPos);
      za.copy(mdir).negate();                              // near side faces Earth
      ya.copy(N).addScaledVector(za, -N.dot(za)).normalize();
      xa.crossVectors(ya, za);
      basis.makeBasis(xa, ya, za);
      moon.quaternion.setFromRotationMatrix(basis);
      const moonDist = cam.position.distanceTo(moonPos);
      const moonPx = (R_M * projScale) / Math.max(moonDist, 1e-6);
      moonUniforms.uPx.value = moonPx;
      moonUniforms.uEarthDir.value.copy(za);
      moonUniforms.uEarthLit.value = 0.5 * (1 + sun.dot(mdir));
      moon.visible = moonPx > 0.4;

      // shaded sprites (view-space light)
      Lcam.copy(sun).transformDirection(cam.matrixWorldInverse);
      const sdpr = dpr;
      moonSprite.m.uniforms.uPos.value.copy(moonPos);
      moonSprite.m.uniforms.uL.value.copy(Lcam);
      moonSprite.m.uniforms.uDpr.value = sdpr;
      moonSprite.m.uniforms.uShine.value = 0.5 * (1 + sun.dot(mdir)) * 0.6;
      moonSprite.m.uniforms.uAmt.value = 1 - smooth(moonPx, 4.5, 9);
      moonSprite.m.uniforms.uHaloAmt.value = 0.22 * (0.3 + 0.7 * 0.5 * (1 - sun.dot(mdir)));
      earthSprite.m.uniforms.uL.value.copy(Lcam);
      earthSprite.m.uniforms.uDpr.value = sdpr;
      const earthFade = smooth(z, 0.55, 0.85);
      const earthPx = (R_E * projScale) / Math.max(cam.position.length(), 1e-6);
      earthSprite.m.uniforms.uAmt.value = earthFade * (1 - smooth(earthPx, 3.5, 8));
      earthMat.uniforms.uOpacity.value = earthFade;
      earthMat.uniforms.uTime.value = frame.time;
      earth.visible = earthFade > 0.002;

      // ---- stars: complement of the Earth scene's own star fade, then fade out for the Sun's scene
      const starIn = smooth(z, -0.881, 0.019);
      starMat.uniforms.uOpacity.value = starIn * (1 - smooth(z, 0.3, 0.95));
      if (stars) stars.visible = starMat.uniforms.uOpacity.value > 0.002;
      starMat.uniforms.uDist.value = cam.position.length() * 20 + 1;
      starMat.uniforms.uScale.value = dpr;

      // ---- ribbons
      for (const m of [orbitMat, shellMat, distMat]) {
        const u = m.uniforms;
        u.uRes.value.copy(buf); u.uDpr.value = dpr; u.uHalf.value = 5 * dpr; u.uNear.value = cam.near;
      }
      orbitMat.uniforms.uMoonU.value = ((M / TAU) % 1 + 1) % 1;
      orbitMat.uniforms.uDark.value = smooth(z, 0.45, 0.85);
      orbitMat.uniforms.uAlpha.value = 1.0;
      const shellA = 0.55 * (1 - smooth(z, -0.45, -0.05)) * smooth(z, -1.6, -1.0 + 0.0);
      shellMat.uniforms.uAlpha.value = Math.max(shellA, 0.0) * 0.8;
      for (const m of shellMeshes) m.visible = shellMat.uniforms.uAlpha.value > 0.003;

      // ---- Earth–Moon distance line (updates the 4 ribbon vertices in place)
      {
        const pa = distGeo.attributes.position as THREE.BufferAttribute, na = distGeo.attributes.aNext as THREE.BufferAttribute;
        const A0 = tmp.copy(mdir).multiplyScalar(R_E * 1.5);
        pa.setXYZ(0, A0.x, A0.y, A0.z); pa.setXYZ(1, A0.x, A0.y, A0.z); pa.setXYZ(2, A0.x, A0.y, A0.z); pa.setXYZ(3, A0.x, A0.y, A0.z);
        const B0 = tmp.copy(moonPos).addScaledVector(mdir, -R_M * 2.2 - 0.004 * viewH);
        for (let k = 0; k < 4; k++) na.setXYZ(k, B0.x, B0.y, B0.z);
        pa.needsUpdate = true; na.needsUpdate = true;
        distMat.uniforms.uAlpha.value = 0.55 * smooth(z, -0.15, 0.0) * (1 - smooth(z, 0.7, 0.95));
        distLine.visible = distMat.uniforms.uAlpha.value > 0.003;
      }

      // ---- satellites
      leoMat.uniforms.uDays.value = simDays;
      leoMat.uniforms.uDpr.value = dpr;
      leoMat.uniforms.uOpacity.value = 0.9 * (1 - smooth(z, -0.7, -0.3));
      shellSatMat.uniforms.uDays.value = simDays;
      shellSatMat.uniforms.uDpr.value = dpr;
      shellSatMat.uniforms.uOpacity.value = 1.0 * (1 - smooth(z, -0.45, -0.05));
      if (leoPts) leoPts.visible = leoMat.uniforms.uOpacity.value > 0.003;
      shellSats.visible = shellSatMat.uniforms.uOpacity.value > 0.003;

      // ---- beads along the Earth–Moon line
      beadMat.uniforms.uDir.value.copy(mdir);
      beadMat.uniforms.uProj.value = projScale;
      beadMat.uniforms.uL.value.copy(Lcam);
      beadMat.uniforms.uOpacity.value = smooth(z, -0.15, 0.0) * (1 - smooth(z, 0.3, 0.45));
      beads.visible = beadMat.uniforms.uOpacity.value > 0.003;

      // ---- light pulse (real time: 1.28 s each way, then a pause)
      const T = frame.time % 4.4;
      let f = -1, dir = 1;
      if (T < 1.28) { f = T / 1.28; dir = 1; } else if (T < 2.56) { f = 1 - (T - 1.28) / 1.28; dir = -1; }
      pulseMat.uniforms.uF.value = f;
      pulseMat.uniforms.uDir.value = dir;
      pulseMat.uniforms.uDpr.value = dpr;
      pulseMat.uniforms.uA.value.copy(mdir).multiplyScalar(R_E);
      pulseMat.uniforms.uB.value.copy(moonPos).addScaledVector(mdir, -R_M);
      pulseMat.uniforms.uOpacity.value = 1 - smooth(z, 0.55, 0.95);
      pulse.visible = pulseMat.uniforms.uOpacity.value > 0.003;

      // ---- shadows
      const shA = 1 - smooth(z, 0.45, 0.95);
      coneMat.uniforms.uOpacity.value = shA;
      moonConeMat.uniforms.uOpacity.value = shA;
      earthCone.visible = moonCone.visible = shA > 0.003;
      moonCone.position.copy(moonPos);

      // ---- labels
      camR.setFromMatrixColumn(cam.matrixWorld, 0);
      camU.setFromMatrixColumn(cam.matrixWorld, 1);
      const off = 0.02 * viewH;
      tmp.copy(moonPos).addScaledVector(camU, off * 0.9 + R_M); setLabel(0, tmp);
      tmp.copy(moonPos).multiplyScalar(0.5); setLabel(1, tmp);                       // centred on the dimension line
      const pf = f >= 0 ? f : lastF;
      if (f >= 0) lastF = f;
      tmp.copy(mdir).multiplyScalar(R_E + pf * (1 - R_E - R_M)).addScaledVector(camU, off * 1.1); setLabel(2, tmp);
      tmp.copy(mdir).multiplyScalar(0.76).addScaledVector(camU, off); setLabel(3, tmp);
      // topmost point of the Moon's orbit as seen from this camera
      ya.copy(camU).addScaledVector(Nm, -camU.dot(Nm));
      if (ya.lengthSq() < 1e-6) ya.copy(Pn);
      ya.normalize();
      tmp.copy(ya).addScaledVector(camU, off); setLabel(4, tmp);
      tmp.copy(S0).multiplyScalar(-1.1).addScaledVector(camU, off); setLabel(5, tmp);
      setLabel(6, issLabel); setLabel(7, gpsLabel); setLabel(8, geoLabel);
    },

    setQuality(qt: Quality) { if (qt !== tier) applyQuality(qt); },

    dispose() {
      if (stars) stars.geometry.dispose();
      if (leoPts) leoPts.geometry.dispose();
      for (const d of disposables) d.dispose();
    },
  };
  return landmark;
}

const factory: LandmarkFactory = () => createEarthMoon();
export default factory;
