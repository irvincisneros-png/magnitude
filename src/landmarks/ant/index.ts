/**
 * Landmark "ant": a black garden ant (Lasius niger) worker, 4 mm long (1 unit), standing on the
 * back of a person's hand (the human scene draws the skin) on the −X side of the origin, facing +X
 * towards a grain of sand. It antennates constantly, turns its head, works its mandibles, its
 * gaster pulses and it shifts its weight; feet stay pinned to the skin.
 *
 * Built from signed-distance fields meshed in a worker (model.ts, build.ts), rigged in rig.ts,
 * shaded in glsl.ts. Lighting constants that must match the human scene live in light.ts.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { AntRig } from './rig';
import { buildAnt, type AntData } from './build';
import { EYE_C, LEGS, UNIT_MM, restPose, toWorld, type V3 } from './model';

const rest = restPose();
const U = (p: V3): [number, number, number] => [p[0] / UNIT_MM, p[1] / UNIT_MM, p[2] / UNIT_MM];

const meta: LandmarkMeta = {
  id: 'ant',
  name: 'Black garden ant',
  sizeMeters: 0.004,
  range: [-4.2, -1.2],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'A black garden ant worker, about 4 millimetres long, exploring the back of your hand. Like every insect it has three body parts, six legs and a hard outer skeleton, and it lives in a colony of thousands of sisters with one queen.',
  howWeKnow: {
    instrument: 'Hand lens, light microscope and scanning electron microscope',
    text:
      'A ruler and a hand lens show that a worker is about 4 mm long. Under a light microscope you can count the 12 segments of each antenna and the 5 segments of each foot. A scanning electron microscope, which makes images with a beam of electrons instead of light, shows the fine hairs on the body and the hundreds of tiny lenses (facets) that make up each compound eye.',
  },
  lightTime: 'About 1.3 × 10⁻¹¹ s (13 trillionths of a second) to cross the ant',
  timescale: 'A worker lives from a few weeks to a couple of years; a queen can live for more than 20 years',
  post: { bloom: 0.36, exposure: 1.0 },
  labels: [
    { text: 'Compound eye', position: U(toWorld(rest.head, [EYE_C[0], EYE_C[1] + 0.05, EYE_C[2] + 0.1])), zoomRange: [-0.85, 0.05] },
    { text: 'Antenna (smell and touch)', position: U(toWorld(rest.funiculus, [0.35, 0.06, 0])), zoomRange: [-0.85, 0.15] },
    { text: 'Head', position: U(toWorld(rest.head, [0.4, 0.3, 0])), zoomRange: [-0.2, 0.6] },
    { text: 'Thorax', position: U(toWorld(rest.trunk, [0.1, 0.35, 0])), zoomRange: [-0.2, 0.6] },
    { text: 'Abdomen (gaster)', position: U(toWorld(rest.gaster, [-0.7, 0.5, 0])), zoomRange: [-0.2, 0.6] },
    { text: 'Six legs: an insect', position: U(toWorld(rest.legs[1].femur, [LEGS[1].Lf, 0.06, 0])), zoomRange: [0.0, 0.8] },
    { text: '4 millimetres long', position: U(toWorld(rest.trunk, [-0.2, 0.75, 0])), zoomRange: [0.55, 1.35] },
    { text: 'Can carry many times its own weight', position: U(toWorld(rest.mandible, [0.3, -0.05, -0.1])), zoomRange: [0.25, 0.9] },
  ],
};

/** Cached: the SDF is deterministic, so it is meshed once per page load. */
let cache: Promise<AntData> | null = null;
function generate(): Promise<AntData> {
  if (cache) return cache;
  cache = new Promise<AntData>((resolve) => {
    let worker: Worker | null = null;
    const fallback = () => { worker?.terminate(); resolve(buildAnt()); };
    try {
      worker = new Worker(new URL('./ant.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<AntData>) => { worker?.terminate(); resolve(e.data); };
      worker.onerror = (e) => { console.warn('[ant] mesh worker failed, building on the main thread', e.message); fallback(); };
      worker.postMessage(0);
    } catch { fallback(); }
  });
  return cache;
}

function createAnt(): Landmark {
  const scene = new THREE.Scene();
  const rig = new AntRig();
  scene.add(rig.root);
  let renderer: THREE.WebGLRenderer | null = null;
  let tier: Quality = 'high';
  let disposed = false;
  const buf = new THREE.Vector2();
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const bound = new THREE.Sphere(new THREE.Vector3(-0.8, 0.15, 0.1), 1.25);

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      tier = ctx.quality;
      void generate().then((d) => {
        if (disposed) return;
        // copies: the cached arrays are shared between landmark instances
        const copy: AntData = { ms: d.ms, parts: d.parts.map((p) => ({ name: p.name, pos: p.pos.slice(), nrm: p.nrm.slice(), attr: p.attr.slice(), index: p.index.slice(), hairs: p.hairs.slice() })) };
        rig.setData(copy, tier);
      }).catch((err) => console.error('[ant] mesh build failed', err));
    },
    update(frame: FrameState) {
      const cam = frame.camera;
      // skip the animation entirely while the ant and its shadow are off screen
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      const seen = frustum.intersectsSphere(bound);
      rig.root.visible = seen;
      if (!seen) return;
      rig.shared.uTime.value = frame.time;
      if (renderer) renderer.getDrawingBufferSize(buf);
      rig.shared.uPx.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(buf.y || 800, 1);
      rig.setZoom(frame.zoom);
      rig.pose(frame.time);
    },
    setQuality(q: Quality) { if (q !== tier) { tier = q; rig.setQuality(q); } },
    dispose() {
      disposed = true;
      rig.dispose();
    },
  };
}

const factory: LandmarkFactory = () => createAnt();
export default factory;
