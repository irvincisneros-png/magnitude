/**
 * Landmark "atom": a carbon atom as a probability cloud (1s² 2s² 2p²), not a Bohr model.
 *
 * Layers (all additive, no depth writes, so nothing z-fights however close the camera gets):
 * - cloud:   instanced soft dots sampled exactly from hydrogen-like |ψ|² (see orbitals.ts),
 *            flickering in and out, streaking radially while the camera dives.
 * - volume:  a ray-marched glow of the same analytic density (the "soft fuzzy ball").
 * - rings:   camera-facing hairline rings at 10 pm, 1 pm, 100 fm, 10 fm, each tagged in-scene,
 *            so the 4.5-decade dive through empty space stays legible.
 * - nucleus: a pin-prick proxy at true nuclear size (5.4 fm) that hands over to the nucleus layer.
 */
import * as THREE from 'three';
import type { FrameState, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { sampleCarbon } from './orbitals';
import {
  cloudFrag, cloudVert, nucleusFrag, nucleusVert, ringFrag, ringVert, tagFrag, tagVert, volumeFrag, volumeVert,
} from './shaders';

const SIZE_M = 1.5e-10;
/** Orientation of the orbital frame (2px along local x, 2py along local y), tilted for depth. */
const TILT = new THREE.Euler(0.32, -0.42, 0.12);
const tilted = (x: number, y: number, z: number): [number, number, number] => {
  const v = new THREE.Vector3(x, y, z).applyEuler(TILT);
  return [v.x, v.y, v.z];
};

const meta: LandmarkMeta = {
  id: 'atom',
  name: 'Carbon atom',
  sizeMeters: 1.5e-10,
  range: [-13.3, -8.8],
  evidence: 'modelled',
  nesting: 'true',
  blurb:
    'Six electrons spread around a tiny nucleus in fuzzy clouds called orbitals. Electrons do not orbit like planets: quantum physics only tells us where each one is likely to be found, and almost all of the atom is empty space.',
  howWeKnow: {
    instrument: 'X-ray crystallography, spectroscopy and quantum mechanics',
    text:
      'X-rays scattered by crystals such as diamond show that carbon atoms sit about 150 picometres apart. The colours of light carbon absorbs and gives off match the energy levels quantum mechanics predicts for its orbitals. The cloud shapes shown here are calculated from that theory (each dot is a possible electron position), not photographed.',
  },
  lightTime: 'About 5 × 10⁻¹⁹ seconds (half an attosecond)',
  timescale: 'Electron motion: about 10⁻¹⁷ s (tens of attoseconds)',
  post: { bloom: 0.55, exposure: 1.0 },
  labels: [
    { text: 'Carbon atom', position: [0, 0.74, 0], zoomRange: [0.3, 1.3] },
    { text: 'Electron cloud: where the electrons probably are', position: [0, -0.42, 0], zoomRange: [0.0, 0.65] },
    { text: '2p orbitals: dumbbell-shaped lobes', position: tilted(0.62, 0, 0), zoomRange: [-0.7, 0.15] },
    { text: 'Each dot is a place an electron might be found', position: [0.07, -0.07, 0], zoomRange: [-0.8, -0.3] },
    { text: '1s orbital: two electrons close to the nucleus', position: [-0.02, 0.024, 0], zoomRange: [-1.1, -0.55] },
    { text: '99.9999999999% empty space', position: [0, -0.0024, 0], zoomRange: [-2.2, -1.45] },
    { text: 'Nucleus: about 28,000 times narrower than the atom', position: [0, -4e-4, 0], zoomRange: [-3.0, -2.3] },
  ],
};

const COUNTS: Record<Quality, number> = { low: 36_000, medium: 110_000, high: 240_000 };
const STEPS: Record<Quality, number> = { low: 10, medium: 18, high: 28 };
const MAX_COUNT = COUNTS.high;

/** Linear colours per orbital: [phase A, phase B]. 1s gold, 2s teal, 2px rose, 2py violet-blue. */
const COL_A = [new THREE.Color(1.0, 0.6, 0.26), new THREE.Color(0.18, 0.78, 0.78), new THREE.Color(1.0, 0.3, 0.58), new THREE.Color(0.42, 0.38, 1.0)];
const COL_B = [new THREE.Color(1.0, 0.86, 0.6), new THREE.Color(0.3, 0.55, 1.0), new THREE.Color(0.74, 0.32, 1.0), new THREE.Color(0.3, 0.7, 1.0)];

/** Decade rings: radius in metres and their in-scene tags. */
const RINGS: { m: number; main: string; sub: string }[] = [
  { m: 1e-11, main: '10 pm', sub: 'WHERE THE 1s ELECTRONS CROWD' },
  { m: 1e-12, main: '1 pm', sub: '×10 CLOSER' },
  { m: 1e-13, main: '100 fm', sub: '×100 CLOSER' },
  { m: 1e-14, main: '10 fm', sub: '×1000 CLOSER' },
];
const NUCLEUS_R = 0.5 * 5.4e-15 / SIZE_M;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function makeTagAtlas(): THREE.CanvasTexture {
  const W = 512, H = 96;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H * RINGS.length;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  RINGS.forEach((r, i) => {
    // canvas rows run top-down, UV rows bottom-up: row i is drawn at the bottom-up slot
    const y0 = (RINGS.length - 1 - i) * H;
    g.globalAlpha = 1;
    g.font = '300 38px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(r.main, W / 2, y0 + 44);
    g.globalAlpha = 0.72;
    g.font = '600 19px "Helvetica Neue", Helvetica, Arial, sans-serif';
    const sp = (g as CanvasRenderingContext2D & { letterSpacing?: string });
    if ('letterSpacing' in g) sp.letterSpacing = '3px';
    g.fillText(r.sub, W / 2, y0 + 76);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
}

const additive = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.rotation.copy(TILT);
  scene.add(group);

  let renderer: THREE.WebGLRenderer | null = null;
  let quality: Quality = 'high';
  const viewport = new THREE.Vector2(1, 1);
  const camObj = new THREE.Vector3();
  let prevDist = -1;
  let dolly = 0;

  // ---- shared uniforms
  const uTime = { value: 0 };
  const uViewport = { value: viewport };
  const uDpr = { value: 1 };
  const uPhaseRate = { value: 0.32 };
  const uColA = { value: COL_A };
  const uColB = { value: COL_B };

  // ---- electron sample cloud
  const quad = new THREE.PlaneGeometry(2, 2);
  const cloudGeo = new THREE.InstancedBufferGeometry();
  cloudGeo.index = quad.index;
  cloudGeo.setAttribute('position', quad.getAttribute('position'));
  const samples = sampleCarbon(MAX_COUNT);
  cloudGeo.setAttribute('aPos', new THREE.InstancedBufferAttribute(samples.pos, 3));
  cloudGeo.setAttribute('aData', new THREE.InstancedBufferAttribute(samples.data, 4));
  cloudGeo.instanceCount = COUNTS.high;
  cloudGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: cloudVert,
    fragmentShader: cloudFrag,
    uniforms: {
      uTime, uViewport, uColA, uColB, uPhaseRate,
      uSize: { value: 0.0024 },
      uMinPx: { value: 1.3 },
      uMaxPx: { value: 200 },
      uBokehPx: { value: 8 },
      uDolly: { value: 0 },
      uFocus: { value: 1 },
      uBackdrop: { value: 0.14 },
      uIntensity: { value: 1 },
      uGain: { value: [0.9, 1.2, 2.6, 2.6] },
      uDensityPow: { value: 1.0 },
      uFloor: { value: 0.03 },
    },
    ...additive,
  });
  const cloud = new THREE.Mesh(cloudGeo, cloudMat);
  cloud.frustumCulled = false;
  cloud.renderOrder = 2;
  group.add(cloud);

  // ---- volumetric glow
  const VOL_R = 1.35;
  const volGeo = new THREE.SphereGeometry(VOL_R, 48, 24);
  const volMat = new THREE.ShaderMaterial({
    vertexShader: volumeVert,
    fragmentShader: volumeFrag,
    defines: { STEPS: STEPS.high },
    uniforms: {
      uTime, uColA, uColB, uPhaseRate,
      uCamObj: { value: camObj },
      uR: { value: VOL_R },
      uGlow: { value: 1 },
      uContrast: { value: 1.0 },
      uVolScale: { value: 1.0 },
      uKnee: { value: 4.0 },
      uIso: { value: 0.3 },
      uSkin: { value: 2.4 },
      uBall: { value: 0 },
      uBallCol: { value: new THREE.Color(0.55, 0.5, 0.95) },
      uGainV: { value: [12, 0.05, 0.3, 0.3] },
    },
    side: THREE.BackSide,
    ...additive,
  });
  const volume = new THREE.Mesh(volGeo, volMat);
  volume.frustumCulled = false;
  volume.renderOrder = 1;
  group.add(volume);

  // ---- nucleus proxy (in the scene, not the tilted group: it is a point)
  const nucMat = new THREE.ShaderMaterial({
    vertexShader: nucleusVert,
    fragmentShader: nucleusFrag,
    uniforms: {
      uTime, uViewport, uDpr,
      uRn: { value: NUCLEUS_R },
      uI: { value: 0.5 },
      uCore: { value: new THREE.Color(1.0, 0.88, 0.76) },
      uHalo: { value: new THREE.Color(1.0, 0.58, 0.36) },
    },
    ...additive,
  });
  const nucleus = new THREE.Mesh(quad, nucMat);
  nucleus.frustumCulled = false;
  nucleus.renderOrder = 4;
  scene.add(nucleus);

  // ---- decade rings + tags
  const tagTex = makeTagAtlas();
  const ringCol = new THREE.Color(0.62, 0.78, 1.0);
  const tagSize = new THREE.Vector2(256, 48);
  const rings = RINGS.map((r, i) => {
    const radius = r.m / SIZE_M;
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      uniforms: { uTime, uRadius: { value: radius }, uAlpha: { value: 0 }, uCol: { value: ringCol } },
      ...additive,
    });
    const ring = new THREE.Mesh(quad, ringMat);
    ring.frustumCulled = false;
    ring.renderOrder = 3;
    const tagMat = new THREE.ShaderMaterial({
      vertexShader: tagVert,
      fragmentShader: tagFrag,
      uniforms: {
        uViewport, uDpr,
        uRadius: { value: radius },
        uRow: { value: i },
        uRows: { value: RINGS.length },
        uSizePx: { value: tagSize },
        uTex: { value: tagTex },
        uAlpha: { value: 0 },
        uCol: { value: new THREE.Color(0.8, 0.88, 1.0) },
      },
      ...additive,
    });
    const tag = new THREE.Mesh(quad, tagMat);
    tag.frustumCulled = false;
    tag.renderOrder = 3;
    scene.add(ring, tag);
    return { radius, ring, ringMat, tag, tagMat };
  });

  const applyQuality = (q: Quality) => {
    quality = q;
    cloudGeo.instanceCount = COUNTS[q];
    if (volMat.defines.STEPS !== STEPS[q]) {
      volMat.defines.STEPS = STEPS[q];
      volMat.needsUpdate = true;
    }
  };

  return {
    meta,
    scene,
    async init(ctx) {
      renderer = ctx.renderer;
      applyQuality(ctx.quality);
      ctx.renderer.compile(scene, new THREE.PerspectiveCamera());
    },
    update(frame: FrameState) {
      const { zoom, camera, dt } = frame;
      uTime.value = frame.time;
      if (renderer) {
        renderer.getDrawingBufferSize(viewport);
        uDpr.value = renderer.getPixelRatio();
      }
      if (frame.quality !== quality) applyQuality(frame.quality);
      const dpr = uDpr.value;
      const H = viewport.y;

      // camera dive speed → motion streaks (ignore teleports such as deep links / setS)
      const dist = camera.position.length();
      let v = 0;
      if (prevDist > 0 && dt > 0 && dt < 0.25 && Math.abs(Math.log(dist / prevDist)) < 0.4) v = (prevDist - dist) / dt;
      prevDist = dist;
      dolly += (v - dolly) * Math.min(1, dt * 10);
      cloudMat.uniforms.uFocus.value = dist;
      const shutter = 0.055;
      cloudMat.uniforms.uDolly.value = THREE.MathUtils.clamp(dolly * shutter, -0.6 * dist, 0.6 * dist);

      // dots: fewer on low → each a little brighter; dimmer overall as the atom shrinks into DNA
      const n = COUNTS[quality];
      const out = smooth(0.2, 1.1, zoom);
      cloudMat.uniforms.uIntensity.value = 0.3 * (COUNTS.high / n) ** 0.85 * (1 - 0.45 * out) * (1 - 0.4 * smooth(0.3, -0.8, zoom) * (1 - smooth(-1.8, -2.6, zoom)));
      cloudMat.uniforms.uMinPx.value = (quality === 'low' ? 1.25 : 1.15) * dpr;
      cloudMat.uniforms.uBokehPx.value = 7 * dpr;
      cloudMat.uniforms.uMaxPx.value = 0.16 * H;

      // volume: the soft ball from outside, fading to a clear void as we dive past the 1s core
      group.updateMatrixWorld();
      camObj.copy(camera.position);
      group.worldToLocal(camObj);
      // (inside the 1s core the glow would fill the frame; let the dots carry the density there)
      const volVis = smooth(-1.7, -0.5, zoom);
      volMat.uniforms.uGainV.value[0] = 12 * smooth(-1.05, -0.25, zoom);
      volume.visible = volVis > 0.002;
      const ball = smooth(0.35, 0.95, zoom);
      volMat.uniforms.uBall.value = 0.9 * ball;
      volMat.uniforms.uSkin.value = 2.4 * (1 - 0.75 * ball);
      volMat.uniforms.uGlow.value = 0.55 * volVis * (1 + 0.35 * out);

      // nucleus: a faint spark from outside, intensely bright at the bottom of the dive
      nucMat.uniforms.uI.value = 0.3 + 0.7 * smooth(-0.3, -2.4, zoom);

      // rings fade in while their on-screen radius is a sensible fraction of the view
      const half = 0.5 * 10 ** zoom;
      const inside = smooth(-0.05, -0.45, zoom);
      tagSize.set(256 * dpr, 48 * dpr);
      for (const r of rings) {
        const ratio = r.radius / half;
        const a = smooth(0.09, 0.26, ratio) * (1 - smooth(0.68, 0.95, ratio)) * inside;
        r.ring.visible = r.tag.visible = a > 0.002;
        r.ringMat.uniforms.uAlpha.value = 0.32 * a;
        r.tagMat.uniforms.uAlpha.value = 0.55 * a;
      }
    },
    setQuality(q) { applyQuality(q); },
    dispose() {
      quad.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
      volGeo.dispose();
      volMat.dispose();
      nucMat.dispose();
      tagTex.dispose();
      for (const r of rings) { r.ringMat.dispose(); r.tagMat.dispose(); }
      renderer = null;
    },
  };
};

export default factory;
