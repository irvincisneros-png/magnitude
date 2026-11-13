/**
 * Landmark "cell": a human skin cell (keratinocyte), 30 µm across (1 local unit = 30 µm).
 *
 * Zoom-in end (view ≈ 50 nm–1 µm): inside the nucleus, among "beads on a string" chromatin that
 * converges on the origin, where the DNA double-helix landmark sits.
 * Middle: the hero cell — translucent membrane, nucleus with pores, nucleolus and melanin cap,
 * ER, Golgi, mitochondria, vesicles, keratin bundles and desmosomes in a crowded cytoplasm.
 * Zoom-out end (view up to 0.5 mm): the cell sits inside a disc of layered epidermis.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { Backdrop } from './backdrop';
import { Chromatin } from './chromatin';
import { CELL_C, CELL_R, GOLGI_C, NM, NUC_C, NUC_R, NUCLEOLUS_C, NUCLEOLUS_R, PAL, cellRho, cellShape, makeShared, nucRho } from './layout';
import { shellGeometry, shellMaterial } from './membrane';
import { Nucleus } from './nucleus';
import { Organelles } from './organelles';
import { Tissue } from './tissue';
import { Bin, smooth } from './util';

const meta: LandmarkMeta = {
  id: 'cell',
  name: 'Human skin cell',
  sizeMeters: 3e-5,
  range: [-5.3, -3.3],
  evidence: 'measured',
  nesting: 'comparison',
  nestingNote:
    'The bacterium at the centre is here only to compare sizes: it is about 15 times smaller than this cell. Real E. coli live in your gut, outside your cells. What this nucleus really holds is your own DNA.',
  blurb:
    'A keratinocyte, the main cell of the outer layer of your skin, is about 30 micrometres across. It is packed with organelles, tough keratin fibres and a nucleus that holds about 2 metres of DNA wound onto protein spools.',
  howWeKnow: {
    instrument: 'Light, fluorescence and electron microscopes',
    text:
      'Stained slices of skin under a light microscope show the layers of cells and their nuclei. Electron microscopes reveal membranes, mitochondria, keratin bundles and the desmosomes that rivet cells together, and cryo-electron tomography has imaged nucleosomes about 10 nanometres wide inside real nuclei.',
  },
  lightTime: 'About 10⁻¹³ seconds (100 femtoseconds) to cross the cell',
  timescale: 'A skin cell takes about 4 weeks to move from the bottom layer to the surface and flake off',
  post: { bloom: 0.5, exposure: 1.1 },
  labels: [
    { text: 'Nucleosomes: DNA wound around histone proteins', position: [24 * NM, 6 * NM, 0], zoomRange: [-2.9, -2.0] },
    { text: 'Chromatin (DNA packed with proteins)', position: [0.012, 0.01, 0], zoomRange: [-1.95, -1.15] },
    { text: 'Nucleolus (builds ribosomes)', position: [NUCLEOLUS_C.x, NUCLEOLUS_C.y + NUCLEOLUS_R, NUCLEOLUS_C.z], zoomRange: [-1.3, -0.45] },
    { text: 'Nuclear envelope with pores', position: [NUC_C.x + NUC_R.x * 0.7, NUC_C.y - NUC_R.y * 0.7, NUC_C.z], zoomRange: [-0.9, -0.2] },
    { text: 'Nucleus', position: [NUC_C.x - NUC_R.x * 0.6, NUC_C.y - NUC_R.y * 0.6, NUC_C.z + NUC_R.z * 0.4], zoomRange: [-0.35, 0.45] },
    { text: 'Melanin cap (shades the DNA from UV)', position: [NUC_C.x, NUC_C.y + NUC_R.y * 1.15, NUC_C.z], zoomRange: [-0.4, 0.3] },
    { text: 'Mitochondrion', position: [0, 0, 0], zoomRange: [-0.6, 0.15] },
    { text: 'Golgi apparatus', position: [GOLGI_C.x, GOLGI_C.y, GOLGI_C.z], zoomRange: [-0.6, 0.15] },
    { text: 'Endoplasmic reticulum', position: [0, 0, 0], zoomRange: [-0.6, 0.15] },
    { text: 'Keratin filaments', position: [0, 0, 0], zoomRange: [-0.6, 0.15] },
    { text: 'Cell membrane', position: [CELL_C.x + CELL_R.x * 0.72, CELL_C.y + CELL_R.y * 0.7, CELL_C.z], zoomRange: [-0.25, 0.45] },
    { text: 'Living skin cells (epidermis)', position: [2.2, 0.4, 0], zoomRange: [0.45, 1.3] },
    { text: 'Dead, flat cells at the skin surface', position: [0, 2.3, 0], zoomRange: [0.6, 1.3] },
    { text: 'New cells are made in the bottom layer', position: [0, -1.5, 2.2], zoomRange: [0.6, 1.3] },
  ],
};

function createCell(): Landmark {
  const scene = new THREE.Scene();
  const shared = makeShared();
  const bin = new Bin();
  const backdrop = new Backdrop(shared);
  const nucleus = new Nucleus(shared);
  const chromatin = new Chromatin(shared);
  const organelles = new Organelles(shared);
  const tissue = new Tissue(shared);
  const hero = new THREE.Group();
  const memOpts = {
    tint: PAL.membrane, rim: PAL.membraneRim, alpha: 0.035, rimA: 0.7,
    bumpF: 22, bumpS: 0.0025, und: 0.008, undF: 4.5, near: 0.12,
  };
  const memFront = bin.add(shellMaterial(shared, memOpts, THREE.FrontSide));
  const memBack = bin.add(shellMaterial(shared, { ...memOpts, rimA: 0.35 }, THREE.BackSide));
  let memGeo: THREE.BufferGeometry | null = null;
  const memMeshes: THREE.Mesh[] = [];
  let renderer: THREE.WebGLRenderer | null = null;
  const buf = new THREE.Vector2();
  const fogCyto = PAL.cytosol.clone().multiplyScalar(1.6);
  const fogNuc = PAL.nucleoplasm.clone().multiplyScalar(1.4);
  const fogOut = PAL.cytosol.clone().multiplyScalar(1.3);

  scene.add(backdrop.mesh, tissue.group, hero);
  hero.add(nucleus.group, chromatin.group, organelles.group);

  const build = (q: Quality) => {
    for (const m of memMeshes) hero.remove(m);
    memMeshes.length = 0;
    memGeo?.dispose();
    memGeo = shellGeometry(q === 'low' ? 36 : q === 'medium' ? 52 : 68, CELL_C, CELL_R, cellShape);
    const back = new THREE.Mesh(memGeo, memBack); back.renderOrder = 0;
    const front = new THREE.Mesh(memGeo, memFront); front.renderOrder = 9;
    memMeshes.push(back, front);
    hero.add(back, front);
    nucleus.build(q);
    chromatin.build(q);
    organelles.build(q);
    tissue.build(q);
    // label anchors that depend on generated content
    const L = meta.labels!;
    L[0].position = chromatin.labelPos.toArray() as [number, number, number];
    L[6].position = organelles.mitoLabel.toArray() as [number, number, number];
    L[8].position = organelles.erLabel.toArray() as [number, number, number];
    L[9].position = organelles.kerLabel.toArray() as [number, number, number];
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
      const cam = frame.camera;
      const d = cam.position.length();
      shared.uTime.value = frame.time;
      shared.uD.value = d;
      if (renderer) renderer.getDrawingBufferSize(buf);
      shared.uPxScale.value = (buf.y || 800) / (2 * Math.tan((cam.fov * Math.PI) / 360));

      // where is the camera?
      const inCell = 1 - smooth(0.96, 1.04, cellRho(cam.position));
      const inNuc = 1 - smooth(0.96, 1.04, nucRho(cam.position));
      const fc = shared.uFogCol.value;
      fc.copy(fogOut).lerp(fogCyto, inCell).lerp(fogNuc, inNuc);
      shared.uFogDensity.value = (0.13 + 0.42 * (1 - smooth(-1.7, -1.0, z)) + 0.4 * (1 - smooth(-2.2, -1.6, z))) / d + 0.75;
      shared.uFogStart.value = inCell > 0.5 ? 0 : Math.max(0, d - 0.6);

      backdrop.update(cam, 1 - smooth(0.3, 1.0, z));
      const interior = z > -1.75;
      for (const m of memMeshes) m.visible = interior;
      nucleus.update(z);
      chromatin.update(1 - smooth(-1.5, -1.05, z), smooth(-1.6, -1.2, z) * (1 - smooth(-0.6, -0.35, z)), 14 * NM * (1 - smooth(-2.6, -2.2, z)));
      organelles.update(z);
      tissue.update(cam, smooth(0.0, 0.45, z), d);
    },
    setQuality(q: Quality) { build(q); },
    dispose() {
      memGeo?.dispose();
      bin.dispose();
      backdrop.dispose();
      nucleus.dispose();
      chromatin.dispose();
      organelles.dispose();
      tissue.dispose();
    },
  };
}

const factory: LandmarkFactory = () => createCell();
export default factory;
