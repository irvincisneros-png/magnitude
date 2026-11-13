/**
 * Landmark "proton": three valence quarks (u, u, d) darting inside a seething gluon field,
 * joined by a Y-shaped flux tube, with sea quark–antiquark pairs flickering in and out.
 * 1 local unit = 1.7 fm (the proton's diameter); the proton is centred on the origin.
 *
 * Zoom story (zoom = s − log10(1.7e-15)):
 *   +0.6  a fuzzy glowing ball, ready to sit among the nucleons of the carbon nucleus
 *    0    hero: the storm, the Y string, colour charges swapping as gluons are exchanged
 *   −1…−2 inside: wisps, filaments and sea pairs at the view's own scale
 *   −2…−3.3 the field thins to a sparse shimmer, then nothing: quarks are smaller than
 *         10⁻¹⁸ m (no measured size), so the dive ends in the empty desert.
 */
import * as THREE from 'three';
import type { FrameState, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { makeNoiseVolume } from './noise';
import { createField } from './field';
import { createSea } from './sea';

const meta: LandmarkMeta = {
  id: 'proton',
  name: 'Proton (quarks & gluons)',
  sizeMeters: 1.7e-15,
  range: [-18.5, -14.2],
  evidence: 'modelled',
  nesting: 'true',
  blurb:
    'A proton is not a solid ball: it is two up quarks and one down quark held together by a seething field of gluons, and about 99% of its mass comes from that field\'s energy, not from the quarks. The red, green and blue are only labels for a property called "colour charge"; quarks have no real colour.',
  howWeKnow: {
    instrument: 'Particle accelerators (electron–proton scattering) and supercomputer simulations',
    text: 'Firing very fast electrons at protons and measuring how they bounce off (first at Stanford in 1968, later at the HERA collider in Germany) showed point-like quarks inside. The proton\'s size, about 0.84 femtometres in radius, comes from these experiments and from laser measurements of hydrogen atoms. No one can photograph the gluon field, so this picture is a model based on the theory of quantum chromodynamics.',
  },
  lightTime: 'About 6 × 10⁻²⁴ seconds (6 trillionths of a trillionth of a second)',
  timescale: 'Quarks exchange gluons about every 10⁻²⁴ seconds',
  post: { bloom: 0.55, exposure: 1.0 },
  labels: [
    { text: 'Proton', position: [0, 0.58, 0], zoomRange: [0.15, 0.65] },
    { text: 'Gluon field: most of the proton\'s mass', position: [0.1, -0.42, 0.05], zoomRange: [-0.9, 0.25] },
    { text: 'Colours = labels for colour charge, not real colours', position: [-0.05, 0.42, 0], zoomRange: [-0.9, 0.25] },
    { text: 'Sea quarks: pairs that pop in and out', position: [0.012, 0.008, 0], zoomRange: [-2.1, -1.3] },
    { text: 'Quarks have no measured size (smaller than 10⁻¹⁸ m)', position: [0, 0, 0], zoomRange: [-3.4, -2.5] },
  ],
};

// colour charges (labelling convention), linear RGB
const PALETTE = [new THREE.Vector3(1.0, 0.13, 0.08), new THREE.Vector3(0.16, 1.0, 0.26), new THREE.Vector3(0.16, 0.38, 1.0)];
const FLAVOURS = ['u', 'u', 'd'];
const CONFINE = 0.32;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function letterTexture(ch: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  g.font = 'italic 600 84px "Iowan Old Style", "Palatino Linotype", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.85)';
  g.shadowBlur = 10;
  g.fillStyle = 'rgba(255,248,236,0.95)';
  g.fillText(ch, 64, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const factory: LandmarkFactory = (): Landmark => {
  const scene = new THREE.Scene();
  let noise: THREE.Data3DTexture | null = null;
  let field: ReturnType<typeof createField> | null = null;
  let sea: ReturnType<typeof createSea> | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const buf = new THREE.Vector2();

  // quark state
  const pos = [new THREE.Vector3(0.16, 0.08, 0.02), new THREE.Vector3(-0.12, 0.1, -0.08), new THREE.Vector3(0.0, -0.16, 0.1)];
  const vel = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const tgt = pos.map((p) => p.clone());
  const retarget = [0.3, 0.7, 1.1];
  const assign = [0, 1, 2];
  const colNow = PALETTE.map((p) => p.clone());
  const junction = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  // gluon exchange
  let exA = -1, exB = -1, exT = 0;
  const EX_DUR = 0.42;
  let nextEx = 0.8;
  const sparkPos = new THREE.Vector3();
  const sparkCol = new THREE.Vector3();

  // letters
  const letterTex = FLAVOURS.map(letterTexture);
  const letterMat = letterTex.map((t) => new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
  const letters = letterMat.map((m) => { const s = new THREE.Sprite(m); s.renderOrder = 5; scene.add(s); return s; });

  const randInBall = (out: THREE.Vector3, r: number) => {
    do { out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (out.lengthSq() > 1);
    return out.multiplyScalar(r);
  };

  const step = (dt: number) => {
    const h = Math.min(dt, 1 / 30);
    for (let i = 0; i < 3; i++) {
      retarget[i] -= h;
      if (retarget[i] <= 0) {
        // dart: a new target somewhere in the confinement region, mostly away from the centre
        randInBall(tgt[i], CONFINE);
        tgt[i].addScaledVector(pos[i], 0.25);
        if (tgt[i].length() > CONFINE) tgt[i].setLength(CONFINE);
        retarget[i] = 0.35 + Math.random() * 1.1;
      }
      // spring to target (darting), plus confinement pull back toward the other two quarks
      tmp.subVectors(tgt[i], pos[i]).multiplyScalar(70);
      vel[i].addScaledVector(tmp, h);
      vel[i].multiplyScalar(Math.exp(-9 * h));
      pos[i].addScaledVector(vel[i], h);
    }
    junction.set(0, 0, 0).add(pos[0]).add(pos[1]).add(pos[2]).multiplyScalar(1 / 3);
    // keep the three quarks centred on the proton (the origin)
    const pull = Math.min(1, 1.5 * h);
    for (let i = 0; i < 3; i++) { pos[i].addScaledVector(junction, -pull); tgt[i].addScaledVector(junction, -pull); }
    junction.multiplyScalar(1 - pull);

    // gluon exchange: a gluon runs q_A → junction → q_B and swaps their colour charges
    nextEx -= h;
    if (exA < 0 && nextEx <= 0) {
      exA = Math.floor(Math.random() * 3);
      exB = (exA + 1 + Math.floor(Math.random() * 2)) % 3;
      exT = 0;
    }
    if (exA >= 0) {
      exT += h / EX_DUR;
      const u = Math.min(exT, 1);
      if (u < 0.5) sparkPos.lerpVectors(pos[exA], junction, u * 2);
      else sparkPos.lerpVectors(junction, pos[exB], u * 2 - 1);
      sparkCol.copy(colNow[exA]).lerp(colNow[exB], u);
      if (exT >= 1) {
        const t = assign[exA]; assign[exA] = assign[exB]; assign[exB] = t;
        exA = exB = -1;
        nextEx = 0.35 + Math.random() * 0.9;
      }
    }
    const k = 1 - Math.exp(-10 * h);
    for (let i = 0; i < 3; i++) colNow[i].lerp(PALETTE[assign[i]], k);
  };

  const applyQuality = (q: Quality) => {
    field?.setQuality(q);
    sea?.setQuality(q);
  };

  return {
    meta,
    scene,
    async init(ctx) {
      renderer = ctx.renderer;
      noise = makeNoiseVolume(64, 8);
      field = createField(noise, ctx.quality);
      scene.add(field.mesh);
      const gl = ctx.renderer.getContext();
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
      sea = createSea(ctx.quality, range ? range[1] : 64);
      scene.add(sea.group);
      // settle the quark motion so the first frame is not frozen in the start pose
      for (let i = 0; i < 90; i++) step(1 / 60);
    },
    update(f: FrameState) {
      if (!field || !sea) return;
      step(f.dt);
      const z = f.zoom;
      const view = 10 ** z;
      const fu = field.uniforms;
      fu.uTime.value = f.time;
      fu.uCam.value.copy(f.camera.position);
      for (let i = 0; i < 3; i++) { fu.uQ.value[i].copy(pos[i]); fu.uQC.value[i].copy(colNow[i]); }
      fu.uJ.value.copy(junction);
      let tr = 0;
      for (let i = 0; i < 3; i++) tr = Math.max(tr, pos[i].distanceTo(junction));
      fu.uTubeR.value = tr + 0.09;
      fu.uSparkP.value.copy(sparkPos);
      fu.uSparkC.value.copy(sparkCol);
      const sparkEnv = exA >= 0 ? Math.sin(Math.PI * Math.min(exT, 1)) : 0;
      fu.uSpark.value = sparkEnv;
      fu.uBreath.value = 1 + 0.045 * Math.sin(f.time * 1.1) + 0.02 * Math.sin(f.time * 2.7 + 1.3);
      fu.uField.value = smooth(-3.15, -2.0, z);
      fu.uThin.value = 1 - smooth(-2.6, -0.4, z);
      fu.uIn.value = smooth(-0.2, -1.2, z);
      fu.uDeep.value = smooth(-1.0, -1.9, z);
      fu.uTube.value = smooth(-1.5, -0.45, z);
      fu.uQuark.value = smooth(-3.1, -2.3, z);
      fu.uHalo.value = 1 - smooth(0.05, 0.55, z);
      fu.uPt.value = 0.0035 * view;
      fu.uView.value = view;
      fu.uWarp.value = 1 + 1.6 * smooth(-0.2, -1.6, z);

      const su = sea.uniforms;
      su.uTime.value = f.time;
      if (renderer) { renderer.getDrawingBufferSize(buf); su.uPx.value = buf.y / (2 * Math.tan((f.camera.fov * Math.PI) / 360)); }
      su.uFade.value = smooth(-3.6, -3.1, z) * (1 - smooth(0.2, 0.7, z) * 0.6);
      su.uMote.value = 0.6 + 0.4 * (1 - smooth(-1.5, 0, z));
      for (let i = 0; i < 3; i++) su.uCol.value[i].copy(PALETTE[i]);

      // flavour letters: constant on-screen size, beside each quark
      const la = smooth(-1.7, -1.1, z) * (1 - smooth(0.25, 0.6, z));
      const sz = 0.065 * Math.min(view, 1.2);
      for (let i = 0; i < 3; i++) {
        letters[i].position.copy(pos[i]);
        letters[i].position.x += sz * 0.55; letters[i].position.y += sz * 0.55;
        letters[i].scale.setScalar(sz);
        letterMat[i].opacity = la * 0.9;
        letters[i].visible = la > 0.01;
      }
    },
    setQuality: applyQuality,
    dispose() {
      field?.dispose(); sea?.dispose(); noise?.dispose();
      letterTex.forEach((t) => t.dispose()); letterMat.forEach((m) => m.dispose());
      field = null; sea = null; noise = null;
    },
  };
};

export default factory;
