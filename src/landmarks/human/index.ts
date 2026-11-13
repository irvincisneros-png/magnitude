/**
 * Landmark "human": a person 1.7 m tall (1 local unit) standing at the top of a sandy beach-access
 * track on the foredune at the southern end of Woonona Beach, Woonona NSW (northern Wollongong), on
 * a summer morning, looking north-north-west along the beach.
 *
 * The origin is a point on the skin of the back of their right hand, where the skin-cell scene
 * sits. Zoom-in end (view ~80 µm): the mosaic of flat dead skin cells under raking sunlight.
 * Then the criss-cross micro-relief, pores and hairs; the hand; the whole person (hero shot);
 * the dune, the beach and the surf; and from ~5 km up the coast between the sea and the
 * escarpment, softening into haze and cloud as the Earth scene takes over.
 *
 * The place is real and at true scale: built from OpenStreetMap and elevation data by
 * tools/build-woonona.mjs (see CREDITS.md and site.ts). Scene root scales metres → units (1/1.7);
 * all children are authored in metres relative to the origin ("H metres"). See glsl.ts for the
 * shared lighting, depth and air model.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { Built } from './built';
import { Figure2 } from './figure2/index';
import { COMMON, FRAME, MAP_O, makeShared } from './glsl';
import { makeHairs } from './hairs';
import { FEET_M, FIG, FIG_YAW, rotY } from './pose';
import { Grass } from './grass';
import { loadSite, padSpot, releaseSite, siteHeight } from './siteData';
import { makeSiteTextures, type SiteTextures } from './siteTex';
import { Skin } from './skin';
import { Sky } from './sky';
import { Terrain } from './terrain';
import { Trees } from './trees';

import { UNIT } from './pose';

/** Map metres (east, north = −z, height above sea) → local units. Measured positions from the data. */
const at = (x: number, z: number, h: number): [number, number, number] => [(x + MAP_O[0]) / UNIT, (h + FRAME.sea) / UNIT, (z + MAP_O[1]) / UNIT];

const meta: LandmarkMeta = {
  id: 'human',
  name: 'Human',
  sizeMeters: 1.7,
  range: [-4.1, 3.7],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'You are about 1.7 metres tall, standing on the dunes at Woonona Beach, NSW, north of Wollongong. This is the scale we live at: every other size in Magnitude is compared with you, from the skin cells on the back of your hand to the coast around you.',
  howWeKnow: {
    instrument: 'Tape measures, microscopes, maps and elevation surveys',
    text:
      'Human heights are measured directly with a stadiometer (a ruler on a wall). Closer in, a dermatoscope or a microscope shows the fine furrows of skin, hairs about 70 micrometres wide and flat dead cells about 30–40 micrometres across. The beach in this scene is built from real map data (OpenStreetMap) and elevation surveys made with laser scanners flown in aircraft and radar from space, so its shape and size are true.',
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
    // measured from the map and elevation data (tools/build-woonona.mjs → features.json "measured")
    { text: 'Woonona Beach: about 1.3 km of sand', position: at(52, -617, 3), zoomRange: [2.05, 3.2] },
    { text: 'Dry sand above high tide: about 13 m wide (4–25 m)', position: at(6, -80, 2.5), zoomRange: [1.25, 2.05] },
    { text: 'Woonona Rock Pool: 52 m × 23 m', position: at(359, -1137, 3), zoomRange: [2.2, 3.0] },
    { text: 'Illawarra Escarpment: 370–420 m high, 3.6 km inland', position: at(-3680, 0, 390), zoomRange: [2.3, 3.47] },
  ],
};

function createHuman(): Landmark {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.scale.setScalar(1 / UNIT);
  scene.add(root);
  const shared = makeShared();
  const sky = new Sky(shared);
  // the person (figure2/: baked from the CC0 MakeHuman mesh), in scene units, turned to look along the beach.
  // COMMON's skyIrr is renamed in the figure's shaders, which bring their own.
  const figure = new Figure2({
    prelude: '\n#define skyIrr humanSkyIrr\n' + COMMON + '\n#undef skyIrr\nLOGZ_VARY\n',
    vertexOutro: 'LOGZ_VERT(mv)',
    // glints on the sunglasses can be sub-pixel and extreme from afar: keep them from blooming into a halo
    fragmentOutro: `col = min(col, vec3(4.0)); col = aerial(col, wp * ${UNIT.toFixed(2)}); LOGZ_FRAG`,
    uniforms: shared as unknown as Record<string, THREE.IUniform>,
  });
  figure.setYaw(FIG_YAW);
  figure.setSun(shared.uSun.value, shared.uSunCol.value);
  shared.uFigShadow.value = figure.shadow.texture;
  shared.uFigShadowMat.value = figure.shadow.matrix;
  const feet = new Float32Array(FEET_M);
  shared.uFeet.value[0].set(feet[0], feet[1], feet[2], feet[3]);
  shared.uFeet.value[1].set(feet[4], feet[5], feet[6], feet[7]);
  const skin = new Skin(shared);
  skin.setHairs(makeHairs());
  root.add(sky.group, skin.group);
  scene.add(figure.group);
  // the place is built once its data has loaded
  let terrain: Terrain | null = null, grass: Grass | null = null, built: Built | null = null, trees: Trees | null = null;
  let tex: SiteTextures | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let tier: Quality = 'high';
  let disposed = false;
  let siteHeld = false;
  let logz = true;
  const buf = new THREE.Vector2();
  const holeP = new THREE.Vector3();

  const build = (q: Quality) => {
    tier = q;
    terrain?.build(q);
    grass?.setFeet(feet, q);
    built?.build(q);
    trees?.build(q);
    skin.build(q);
    figure.setTier(q);
  };

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      tier = ctx.quality;
      skin.build(tier);
      figure.setTier(tier);
      // the person's mesh streams in meanwhile; it appears when ready
      void figure.load((p) => ctx.assetUrl(p.replace(/^human\//, ''))).then((info) => {
        if (disposed) return;
        if (Math.abs(info.groundY - FIG.groundY) > 1e-3 || Math.abs(info.feet[0] - FIG.feet[0]) > 1e-3) console.warn('[human] figure.json changed: update pose.ts');
        const top = rotY([info.headTop.x, Math.max(info.headTop.y, 0), info.headTop.z]);
        const L = meta.labels!;
        L[3].position = [top[0], top[1] + 0.05, top[2]];
        L[4].position = [top[0], top[1] + 0.15, top[2]];
      }).catch((err) => console.error('[human] figure load failed', err));
      const D = await loadSite(ctx.assetUrl);
      siteHeld = true;
      if (disposed) { releaseSite(); siteHeld = false; return; }
      padSpot(D);
      tex = makeSiteTextures(D, renderer);
      sky.setSite(tex);
      terrain = new Terrain(shared, D, tex);
      grass = new Grass(shared, D);
      built = new Built(shared, D);
      trees = new Trees(shared, D);
      root.add(terrain.group, built.group, trees.group, grass.group);
      build(tier);
      if (Math.abs(siteHeight(D, 0, 0) + FRAME.sea - FRAME.ground) > 0.01) console.warn('[human] ground under the feet does not match GROUND_ELEV_M');
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
      figure.setHole(patchR > 0 ? (0.68 * patchR) / UNIT : 0, holeP);
      figure.update(frame.time, renderer ?? undefined, shared.uWind.value);
      shared.uFigShadowOn.value = figure.shadow.on.value as number;
      grass?.update(z);
      // skin regime: the place is far out of focus, so a cheap painted backdrop stands in for the
      // terrain, sea, buildings and grass (they cost most of the frame and would be sub-pixel blur anyway)
      const backdrop = z < -1.3 && tex ? 1 : 0;
      const placeOn = backdrop === 0;
      if (terrain) terrain.group.visible = placeOn;
      if (built) built.group.visible = placeOn && z > -1.0;
      if (trees) trees.group.visible = placeOn;
      if (backdrop && grass) grass.group.visible = false;
      sky.update(cam, z, backdrop);
      if (logz !== !backdrop) { logz = !backdrop; figure.setDefine('NO_LOGZ', backdrop === 1); }
      skin.setLogDepth(!backdrop);
    },
    setQuality(q: Quality) { if (q !== tier) build(q); },
    dispose() {
      disposed = true;
      sky.dispose(); figure.dispose(); skin.dispose();
      terrain?.dispose(); grass?.dispose(); built?.dispose(); trees?.dispose(); tex?.dispose();
      if (siteHeld) { releaseSite(); siteHeld = false; }
    },
  };
}

const factory: LandmarkFactory = () => createHuman();
export default factory;
