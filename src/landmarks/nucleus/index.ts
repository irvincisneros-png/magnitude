/**
 * Landmark "nucleus": a carbon-12 nucleus, 6 protons + 6 neutrons.
 * 1 local unit = 5.4 fm (the nucleus's diameter). One proton sits exactly on the origin, where the
 * proton landmark appears, so the nucleus centre is offset from the origin by about 0.27 units.
 *
 * Layers (all depth-free):
 * - field: one raymarch over all twelve nucleons (soft fog balls with internal turbulence, a hint
 *          of three bright quark points in each). Protons run warm (as in the proton scene),
 *          neutrons cool. Only rays that touch a nucleon are marched.
 * - arcs:  flickering ribbons between touching neighbours: pions passed back and forth, the
 *          leftover ("residual") strong force that binds the nucleus.
 * - pin:   a pin-prick of light at true size, handing over to the atom's nucleus dot.
 * Nucleon positions jostle constantly (quantum zero-point motion); the layout is modelled.
 */
import * as THREE from 'three';
import type { FrameState, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { makeNoiseVolume } from './noise';
import { arcFrag, arcVert, fieldFrag, fieldVert, pinFrag, pinVert } from './shaders';

const meta: LandmarkMeta = {
  id: 'nucleus',
  name: 'Carbon-12 nucleus',
  sizeMeters: 5.4e-15,
  range: [-14.9, -12.5],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'Six protons and six neutrons packed into a ball about 5 millionths of a billionth of a metre across. The strong force pulls them together harder than the protons\' electric repulsion pushes them apart, and nearly all of the atom\'s mass lives here.',
  howWeKnow: {
    instrument: 'Electron scattering and nuclear physics experiments',
    text:
      'Firing fast electrons at carbon and measuring how they bounce off shows that its nucleus has a radius of about 2.5 femtometres (a femtometre is 10⁻¹⁵ m). That size is measured. The fuzzy, jostling look is a model: nucleons are quantum objects with no sharp edges, and the exact way they are arranged and the glowing links between them are drawn from theory, not photographed.',
  },
  lightTime: 'About 2 × 10⁻²³ seconds',
  timescale: 'Nucleons jostle and swap pions about every 10⁻²³ seconds; nuclear vibrations take about 10⁻²² s',
  post: { bloom: 0.6, exposure: 1.0 },
  labels: [
    { text: 'Proton (+)', position: [0, 0.2, 0], zoomRange: [-0.7, 0.2] },
    { text: 'Neutron (no charge)', position: [0.3, 0.2, 0], zoomRange: [-0.7, 0.2] },
    { text: 'Strong nuclear force holds them together', position: [0.1, 0.1, 0], zoomRange: [-0.35, 0.45] },
    { text: '6 protons + 6 neutrons = carbon-12', position: [0, 0.68, 0], zoomRange: [0.1, 1.3] },
    { text: '99.97% of the atom\'s mass is here', position: [0, -0.68, 0], zoomRange: [0.55, 1.75] },
  ],
};

const N = 12;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A dense random packing of 12 nucleons, shifted so nucleon 0 (a proton) sits on the origin. */
function buildLayout() {
  const rnd = rng(1208);
  const P: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    P.push(v.multiplyScalar(0.28));
  }
  const D = 0.27;
  for (let it = 0; it < 600; it++) {
    const c = new THREE.Vector3();
    P.forEach((p) => c.add(p));
    c.multiplyScalar(1 / N);
    for (let i = 0; i < N; i++) {
      P[i].addScaledVector(c.clone().sub(P[i]), 0.02);
      for (let j = i + 1; j < N; j++) {
        const d = P[i].clone().sub(P[j]);
        const l = d.length();
        if (l < D && l > 1e-6) {
          d.multiplyScalar(((D - l) / l) * 0.5);
          P[i].add(d); P[j].sub(d);
        }
      }
    }
  }
  const c = new THREE.Vector3();
  P.forEach((p) => c.add(p));
  c.multiplyScalar(1 / N);
  P.forEach((p) => p.sub(c));
  // origin proton: the nucleon whose distance from the centre is closest to 0.27 (fills the 0.25–0.3 brief)
  let best = 0, bd = 9;
  P.forEach((p, i) => { const e = Math.abs(p.length() - 0.27); if (e < bd) { bd = e; best = i; } });
  [P[0], P[best]] = [P[best], P[0]];
  const centre = P[0].clone().negate();
  const rest = P.map((p) => p.clone().sub(P[0]));
  // alternate protons/neutrons so each kind is spread through the ball
  const order = rest.map((_, i) => i).sort((a, b) => rest[a].dot(new THREE.Vector3(0.3, 0.8, 0.5)) - rest[b].dot(new THREE.Vector3(0.3, 0.8, 0.5)));
  const type = new Array<number>(N).fill(0);
  order.forEach((idx, k) => { type[idx] = k % 2 === 0 ? 1 : 0; });
  if (type[0] === 0) { // swap with the nearest-ranked proton so nucleon 0 is a proton, keeping 6/6
    const k = order.findIndex((idx) => type[idx] === 1 && idx !== 0);
    type[0] = 1; type[order[k]] = 0;
  }
  return { rest, centre, type };
}

const factory: LandmarkFactory = (): Landmark => {
  const scene = new THREE.Scene();
  const { rest, centre, type } = buildLayout();

  // pairs of touching neighbours
  const pairs: [number, number][] = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (rest[i].distanceTo(rest[j]) < 0.345) pairs.push([i, j]);

  // nearest neutron to the origin proton (label anchor)
  let neutron = 1, nd = 9;
  for (let i = 1; i < N; i++) if (type[i] === 0 && rest[i].length() < nd) { nd = rest[i].length(); neutron = i; }
  // the closest pair to the nucleus centre, for the "strong force" label
  let forcePair = 0, fd = 9;
  pairs.forEach(([a, b], k) => {
    const m = rest[a].clone().add(rest[b]).multiplyScalar(0.5).sub(centre).length();
    if (m < fd) { fd = m; forcePair = k; }
  });

  const rnd = rng(77);
  const phase = rest.map(() => [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]);
  const qRate = rest.map(() => [0, 0, 0].map(() => 1.6 + rnd() * 2.6));
  const qPh = rest.map(() => [0, 0, 0].map(() => [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]));

  const uC = Array.from({ length: N }, () => new THREE.Vector3());
  const uR = new Array<number>(N).fill(1);
  const uQ = Array.from({ length: N * 3 }, () => new THREE.Vector3());
  const uT = type.slice();
  const uCam = new THREE.Vector3();
  const uCN = new THREE.Vector3();
  const viewport = new THREE.Vector2(1, 1);

  let noise: THREE.Data3DTexture | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let quality: Quality = 'high';

  const additive = {
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  } as const;
  const defs = (q: Quality) => (q === 'low' ? { STEPS: 22, OCT: 2 } : q === 'medium' ? { STEPS: 34, OCT: 3 } : { STEPS: 48, OCT: 3 });

  const fieldU = {
    uNoise: { value: null as THREE.Data3DTexture | null },
    uCam: { value: uCam }, uTime: { value: 0 },
    uC: { value: uC }, uR: { value: uR }, uT: { value: uT }, uQ: { value: uQ }, uCN: { value: uCN },
    uGain: { value: 1 }, uHalo: { value: 1 }, uQuark: { value: 1 }, uOrigin: { value: 1 }, uView: { value: 1 }, uIn: { value: 0 },
  };
  const fieldMat = new THREE.ShaderMaterial({
    vertexShader: fieldVert, fragmentShader: fieldFrag, uniforms: fieldU, defines: defs('high'),
    side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const fieldGeo = new THREE.IcosahedronGeometry(1.35, 3);
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.frustumCulled = false;
  field.renderOrder = 0;
  scene.add(field);

  // arcs: instanced ribbons
  const SEG = 18;
  const arcGeo = new THREE.InstancedBufferGeometry();
  {
    const pos = new Float32Array((SEG + 1) * 2 * 3);
    const idx: number[] = [];
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG;
      pos.set([u, -1, 0], s * 6); pos.set([u, 1, 0], s * 6 + 3);
      if (s < SEG) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    arcGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    arcGeo.setIndex(idx);
    const ar = new Float32Array(pairs.length * 4);
    const r2 = rng(5);
    pairs.forEach(([a, b], k) => ar.set([a, b, r2(), 0.6 + r2() * 0.9], k * 4));
    arcGeo.setAttribute('aPair', new THREE.InstancedBufferAttribute(ar, 4));
    arcGeo.instanceCount = pairs.length;
  }
  const arcU = { uC: { value: uC }, uCam: { value: uCam }, uTime: { value: 0 }, uWidth: { value: 0.01 }, uFade: { value: 1 } };
  const arcMat = new THREE.ShaderMaterial({ vertexShader: arcVert, fragmentShader: arcFrag, uniforms: arcU, side: THREE.DoubleSide, ...additive });
  const arcs = new THREE.Mesh(arcGeo, arcMat);
  arcs.frustumCulled = false;
  arcs.renderOrder = 1;
  scene.add(arcs);

  // far-field pin-prick at the nucleus centre
  const quad = new THREE.PlaneGeometry(2, 2);
  const pinU = {
    uTime: { value: 0 }, uViewport: { value: viewport }, uDpr: { value: 1 }, uRn: { value: 0.5 }, uI: { value: 0 },
    uCore: { value: new THREE.Color(1.0, 0.88, 0.76) }, uHalo: { value: new THREE.Color(1.0, 0.58, 0.36) },
  };
  const pinMat = new THREE.ShaderMaterial({ vertexShader: pinVert, fragmentShader: pinFrag, uniforms: pinU, ...additive });
  const pin = new THREE.Mesh(quad, pinMat);
  pin.frustumCulled = false;
  pin.renderOrder = 4;
  pin.position.copy(centre);
  scene.add(pin);

  const applyQuality = (q: Quality) => {
    quality = q;
    fieldMat.defines = defs(q); fieldMat.needsUpdate = true;
  };

  const labels = meta.labels!;
  const tmp = new THREE.Vector3();

  return {
    meta,
    scene,
    async init(ctx) {
      renderer = ctx.renderer;
      noise = makeNoiseVolume(64, 8);
      fieldU.uNoise.value = noise;
      applyQuality(ctx.quality);
      if (location.search.includes('debug')) (window as unknown as Record<string, unknown>).__nucleus = { scene, rest, centre, type, pairs };
    },
    update(f: FrameState) {
      const t = f.time;
      const z = f.zoom;
      const view = 10 ** z;
      if (f.quality !== quality) applyQuality(f.quality);
      if (renderer) { renderer.getDrawingBufferSize(viewport); pinU.uDpr.value = renderer.getPixelRatio(); }

      // zero-point jostling: slow wander plus fast quiver; the origin proton barely moves
      for (let i = 0; i < N; i++) {
        const a = i === 0 ? 0.25 : 1;
        const ph = phase[i];
        uC[i].set(
          rest[i].x + a * (0.011 * Math.sin(t * 1.9 + ph[0]) + 0.005 * Math.sin(t * 7.3 + ph[3])),
          rest[i].y + a * (0.011 * Math.sin(t * 2.3 + ph[1]) + 0.005 * Math.sin(t * 6.1 + ph[4])),
          rest[i].z + a * (0.011 * Math.sin(t * 2.1 + ph[2]) + 0.005 * Math.sin(t * 8.2 + ph[5])),
        );
        uR[i] = 1 + 0.06 * Math.sin(t * 1.4 + ph[0]) + 0.03 * Math.sin(t * 3.7 + ph[1]);
        for (let k = 0; k < 3; k++) {
          const r = 0.052 * uR[i];
          const p = qPh[i][k];
          const w = qRate[i][k];
          uQ[i * 3 + k].set(
            uC[i].x + r * Math.sin(t * w + p[0]),
            uC[i].y + r * Math.sin(t * w * 1.17 + p[1]),
            uC[i].z + r * Math.sin(t * w * 0.83 + p[2]),
          );
        }
      }
      uCN.set(0, 0, 0);
      for (let i = 0; i < N; i++) uCN.add(uC[i]);
      uCN.multiplyScalar(1 / N);
      pin.position.copy(uCN);

      uCam.copy(f.camera.position);
      fieldU.uTime.value = t;
      fieldU.uView.value = view;
      // from outside the ball becomes a point: dim it as the pin-prick takes over
      fieldU.uGain.value = 1 - 0.82 * smooth(0.9, 1.8, z);
      fieldU.uHalo.value = 1 - smooth(0.5, 1.5, z);
      fieldU.uQuark.value = 1 - smooth(0.3, 1.0, z);
      // the real proton fades in below here; keep the proxy a little lighter so they add to one proton
      fieldU.uOrigin.value = 1 - 0.5 * smooth(-0.35, -0.65, z);
      fieldU.uIn.value = smooth(-0.55, -0.7, z) * 0.5;

      arcU.uTime.value = t;
      arcU.uFade.value = (1 - smooth(0.4, 1.2, z)) * (0.45 + 0.55 * smooth(-0.5, 0.1, z));
      arcU.uWidth.value = 0.01 * Math.max(1, Math.min(view, 4) * 0.35);
      arcs.visible = arcU.uFade.value > 0.003;

      pinU.uTime.value = t;
      pinU.uI.value = 0.5 * smooth(0.8, 1.6, z);
      pin.visible = pinU.uI.value > 0.003;

      // labels follow their nucleons
      const o = 0.2;
      labels[0].position = [uC[0].x, uC[0].y + o, uC[0].z];
      labels[1].position = [uC[neutron].x, uC[neutron].y + o, uC[neutron].z];
      const [pa, pb] = pairs[forcePair];
      tmp.copy(uC[pa]).add(uC[pb]).multiplyScalar(0.5);
      labels[2].position = [tmp.x, tmp.y, tmp.z];
      labels[3].position = [uCN.x, uCN.y + 0.68, uCN.z];
      labels[4].position = [uCN.x, uCN.y - 0.68, uCN.z];
    },
    setQuality: applyQuality,
    dispose() {
      fieldGeo.dispose(); fieldMat.dispose();
      arcGeo.dispose(); arcMat.dispose();
      quad.dispose(); pinMat.dispose();
      noise?.dispose(); noise = null;
      renderer = null;
    },
  };
};

export default factory;
