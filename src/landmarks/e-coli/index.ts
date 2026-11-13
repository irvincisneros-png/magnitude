/**
 * Landmark "e-coli": an Escherichia coli bacterium, 2 µm long (1 local unit = 2 µm).
 *
 * Zoom-in end (view ≈ 250–600 nm): just above the outer membrane at the feet of the T4 phage (the
 * child layer, standing at the origin): porins, LPS fuzz, pili rising nearby, the cell curving away.
 * Middle: the hero rod — translucent envelope, nucleoid, packed ribosomes, pili and a bundle of
 * spinning flagella — in a watery medium with out-of-focus neighbours.
 * Zoom-out end (view up to 40 µm): a small rod; the medium fades so the skin-cell layer shows around it.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { Appendages } from './appendages';
import { Envelope } from './envelope';
import { Interior } from './interior';
import { CAP_R, CELL_C, CONTACT, makeShared } from './layout';
import { Medium } from './medium';
import { Surface } from './surface';
import { smooth } from './util';

const meta: LandmarkMeta = {
  id: 'e-coli',
  name: 'E. coli bacterium',
  sizeMeters: 2e-6,
  range: [-6.6, -4.4],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'Escherichia coli is a single-celled prokaryote about 2 micrometres long, roughly 15 times shorter than a skin cell is wide, and it has no nucleus: its DNA sits in a tangle called the nucleoid. Most E. coli live harmlessly in your gut.',
  howWeKnow: {
    instrument: 'Light microscopes, electron microscopes and cryo-electron tomography',
    text:
      'In the 1670s Antonie van Leeuwenhoek saw tiny rod-shaped bacteria through his home-made light microscopes. A light microscope still shows the rod, but its insides are too small for light to resolve. Electron microscopes reveal the two membranes, flagella and pili, and cryo-electron tomography (many images of a frozen cell taken from different angles) maps the ribosomes and nucleoid in 3D.',
  },
  lightTime: 'About 7 × 10⁻¹⁵ seconds (7 femtoseconds) for light to travel the length of the cell',
  timescale: 'In ideal conditions an E. coli cell grows and divides in two about every 20 minutes',
  post: { bloom: 0.45, exposure: 1.1 },
  labels: [
    { text: 'Outer membrane', position: [0, 0, 0], zoomRange: [-0.7, 0.55] },
    { text: 'Nucleoid (DNA, no nucleus)', position: [0, 0, 0], zoomRange: [-0.3, 0.6] },
    { text: 'Ribosomes', position: [0, 0, 0], zoomRange: [-0.4, 0.35] },
    { text: 'Flagellum (spins up to ~100 turns a second)', position: [0, 0, 0], zoomRange: [-0.15, 0.95] },
    { text: 'Pili', position: [0, 0, 0], zoomRange: [-0.9, 0.2] },
    { text: 'Bacteriophage T4 (virus)', position: [0, 0.035, 0], zoomRange: [0.0, 0.6] },
    { text: '2 micrometres long', position: [0, 0, 0], zoomRange: [0.05, 1.1] },
  ],
};

const toLayer = (v: THREE.Vector3): [number, number, number] => [v.x + CELL_C.x, v.y + CELL_C.y, v.z + CELL_C.z];

function createEColi(): Landmark {
  const scene = new THREE.Scene();
  const shared = makeShared();
  const medium = new Medium(shared);
  const envelope = new Envelope(shared);
  const interior = new Interior(shared);
  const appendages = new Appendages(shared);
  const surface = new Surface(shared);

  // pivot sits at the phage's feet so the gentle tumble never lifts the cell off them
  const pivot = new THREE.Group();
  pivot.position.copy(CONTACT);
  const hero = new THREE.Group();
  hero.position.copy(CELL_C).sub(CONTACT);
  surface.proxy.position.copy(CONTACT).negate();
  pivot.add(hero, surface.proxy);
  hero.add(envelope.group, interior.group, appendages.group, surface.group);
  scene.add(medium.group, pivot);

  let renderer: THREE.WebGLRenderer | null = null;
  const buf = new THREE.Vector2();
  const eul = new THREE.Euler();

  const build = (q: Quality) => {
    medium.build(q);
    envelope.build(q);
    interior.build(q);
    appendages.build(q);
    surface.build(q);
    const L = meta.labels!;
    L[0].position = toLayer(new THREE.Vector3(0.32, CAP_R * 0.72, CAP_R * 0.7));
    L[1].position = toLayer(interior.nucleoidLabel);
    L[2].position = toLayer(interior.riboLabel);
    L[3].position = toLayer(appendages.flagLabel);
    L[4].position = toLayer(appendages.piliLabel);
    L[6].position = toLayer(new THREE.Vector3(0, -CAP_R - 0.07, 0));
  };

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      build(ctx.quality);
    },
    update(frame: FrameState) {
      const z = frame.zoom;
      const t = frame.time;
      const cam = frame.camera;
      const d = cam.position.length();
      shared.uTime.value = t;
      shared.uD.value = d;
      if (renderer) renderer.getDrawingBufferSize(buf);
      shared.uPxScale.value = (buf.y || 800) / (2 * Math.tan((cam.fov * Math.PI) / 360));

      // slow tumble about the phage's feet, only once the phage layer has handed over
      const rock = smooth(0.15, 0.7, z);
      eul.set(0.05 * rock * Math.sin(t * 0.09 + 1.0), 0.18 * rock * Math.sin(t * 0.045), 0.06 * rock * Math.sin(t * 0.13));
      pivot.quaternion.setFromEuler(eul);
      pivot.updateMatrixWorld(true);
      shared.uCamObj.value.copy(cam.position);
      hero.worldToLocal(shared.uCamObj.value);

      const mediumA = 1 - smooth(0.35, 1.0, z);
      shared.uFogDensity.value = (0.1 / d) * mediumA;
      shared.uCytoK.value = 6;

      medium.update(cam, mediumA, 1 - smooth(0.2, 0.85, z));
      const zoomIn = 1 - smooth(-0.55, 0.0, z);
      envelope.update(zoomIn, smooth(0.5, 1.2, z));
      interior.update(z, zoomIn);
      appendages.update(t);
      surface.update(z, smooth(-0.45, -0.1, z));
    },
    setQuality(q: Quality) { build(q); },
    dispose() {
      medium.dispose();
      envelope.dispose();
      interior.dispose();
      appendages.dispose();
      surface.dispose();
    },
  };
}

const factory: LandmarkFactory = () => createEColi();
export default factory;
