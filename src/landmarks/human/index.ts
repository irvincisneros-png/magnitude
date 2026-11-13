/**
 * Landmark "human": a person 1.7 m tall (1 local unit) standing on a grassy headland on the
 * Illawarra coast, NSW, one arm reaching out towards the sea on a summer morning.
 *
 * The origin is a point on the skin of the back of their right hand, where the skin-cell scene
 * sits. Zoom-in end (view ~80 µm): the mosaic of flat dead skin cells under raking sunlight.
 * Then the criss-cross micro-relief, pores and hairs; the hand; the whole person (hero shot);
 * the headland, cliff, rock platform, beaches and surf; and from ~5 km up the coast between the
 * sea and the escarpment, softening into haze and cloud as the Earth scene takes over.
 *
 * Scene root scales metres → units (1/1.7); all children are authored in metres relative to the
 * origin ("H metres"). See glsl.ts for the shared lighting, depth and air model.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { Figure } from './figure';
import { makeShared } from './glsl';
import { Grass } from './grass';
import { Skin } from './skin';
import { Sky } from './sky';
import { Terrain } from './terrain';

const UNIT = 1.7;

const meta: LandmarkMeta = {
  id: 'human',
  name: 'Human',
  sizeMeters: 1.7,
  range: [-4.1, 3.7],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'You are about 1.7 metres tall, standing on a headland near Wollongong, NSW. This is the scale we live at: every other size in Magnitude is compared with you, from the skin cells on the back of your hand to the coast below.',
  howWeKnow: {
    instrument: 'Tape measures, rulers and microscopes',
    text:
      'Human heights are measured directly with a stadiometer (a ruler on a wall). Closer in, a dermatoscope or a microscope shows the fine furrows of skin, hairs about 70 micrometres wide and flat dead cells about 30–40 micrometres across. Surveyors and satellites map the headland, cliffs and coast.',
  },
  lightTime: 'About 6 nanoseconds to travel your height',
  timescale: 'A heartbeat: about 1 second. A breath: about 4 seconds',
  post: { bloom: 0.32, exposure: 1.0 },
  labels: [
    { text: 'Dead skin cells (~30 micrometres) flake off constantly', position: [0.00004 / UNIT, 0.000004 / UNIT, 0.00003 / UNIT], zoomRange: [-4.1, -3.05] },
    { text: 'Hair: about 70 micrometres wide', position: [0.0004 / UNIT, 0.0007 / UNIT, 0.0009 / UNIT], zoomRange: [-2.9, -1.85] },
    { text: 'Skin: your largest organ', position: [0.012 / UNIT, 0.002 / UNIT, 0.014 / UNIT], zoomRange: [-1.8, -0.85] },
    { text: '1.7 m — the scale we live at', position: [0, 0, 0], zoomRange: [-0.35, 0.85] },
    { text: 'You are here', position: [0, 0, 0], zoomRange: [1.1, 3.1] },
  ],
};

function createHuman(): Landmark {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.scale.setScalar(1 / UNIT);
  scene.add(root);
  const shared = makeShared();
  const sky = new Sky(shared);
  const terrain = new Terrain(shared);
  const grass = new Grass(shared);
  const figure = new Figure(shared);
  const skin = new Skin(shared);
  sky.setDepth(terrain.depthN);
  root.add(sky.group, terrain.group, grass.group, figure.group, skin.group);
  let renderer: THREE.WebGLRenderer | null = null;
  let tier: Quality = 'high';
  let disposed = false;
  const buf = new THREE.Vector2();

  const build = (q: Quality) => {
    tier = q;
    terrain.build(q);
    grass.build(q);
    skin.build(q);
    figure.setTier(q);
  };

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      build(ctx.quality);
      // the person is meshed in a worker; the scene shows meanwhile and the figure appears when ready
      void figure.build().then((d) => {
        if (disposed) return;
        skin.setHairs(d.hairs);
        grass.setFeet(d.feet, tier);
        shared.uFeet.value[0].set(d.feet[0], d.feet[1], d.feet[2], d.feet[3]);
        shared.uFeet.value[1].set(d.feet[4], d.feet[5], d.feet[6], d.feet[7]);
        shared.uBrim.value.set(d.anchors.brim[0], d.anchors.brim[1], d.anchors.brim[2], 0.2);
        // bounding sphere of the figure, for a cheap early-out in the soft-shadow test
        const c = new THREE.Vector3(), t = new THREE.Vector3();
        for (let i = 0; i < 32; i++) c.add(t.fromArray(d.capsules, (i >> 1) * 8 + (i & 1) * 4));
        c.multiplyScalar(1 / 32);
        let r = 0;
        for (let i = 0; i < 32; i++) r = Math.max(r, t.fromArray(d.capsules, (i >> 1) * 8 + (i & 1) * 4).distanceTo(c) + d.capsules[(i >> 1) * 8 + (i & 1) * 4 + 3]);
        shared.uFigBound.value.set(c.x, c.y, c.z, Math.max(r, 0.3) + 0.25);
        const L = meta.labels!;
        L[3].position = [d.anchors.headTop[0] / UNIT, (d.anchors.headTop[1] + 0.08) / UNIT, d.anchors.headTop[2] / UNIT];
        L[4].position = [d.anchors.headTop[0] / UNIT, (d.anchors.headTop[1] + 0.25) / UNIT, d.anchors.headTop[2] / UNIT];
      }).catch((err) => console.error('[human] figure build failed', err));
    },
    update(frame: FrameState) {
      const z = frame.zoom;
      const cam = frame.camera;
      const d = cam.position.length();
      shared.uTime.value = frame.time;
      shared.uZoom.value = z;
      shared.uCamM.value.copy(cam.position).multiplyScalar(UNIT);
      const nearU = d / 200;
      shared.uLogD.value.set(1 / (nearU * 0.25), 1 / Math.log2((3e4 / (nearU * 0.25)) + 1));
      if (renderer) renderer.getDrawingBufferSize(buf);
      shared.uPx.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(buf.y || 800, 1);
      shared.uBlur.value = THREE.MathUtils.smoothstep(-z, 1.1, 2.4);
      shared.uWind.value = 0.5 + 0.5 * Math.sin(frame.time * 0.13) * Math.sin(frame.time * 0.071 + 1.3);
      const viewM = 10 ** z * UNIT;
      const patchR = skin.update(z, viewM);
      figure.update(frame.time, patchR);
      grass.update(z);
      // skin regime: the place is far out of focus, so a cheap painted backdrop stands in for the
      // terrain, sea and grass (they cost most of the frame and would be sub-pixel blur anyway)
      const backdrop = z < -1.3 ? 1 : 0;
      terrain.group.visible = backdrop === 0;
      if (backdrop) grass.group.visible = false;
      sky.update(cam, z, backdrop);
      figure.setLogDepth(!backdrop);
      skin.setLogDepth(!backdrop);
    },
    setQuality(q: Quality) { if (q !== tier) build(q); },
    dispose() {
      disposed = true;
      sky.dispose(); terrain.dispose(); grass.dispose(); figure.dispose(); skin.dispose();
    },
  };
}

const factory: LandmarkFactory = () => createHuman();
export default factory;
