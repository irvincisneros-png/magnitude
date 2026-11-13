/**
 * Landmark "planck": an artist's impression of "quantum foam" at the Planck length.
 * Nothing here has been observed. 1 local unit = 1.6 × 10⁻³⁵ m; the froth is centred on the
 * origin. This is the floor of the whole journey (the engine does not fade it at the bottom).
 *
 * Zoom story (zoom = s − log10(1.6e-35)):
 *   +2.8  a faint pearly shimmer at the centre of the desert's blackness, fading to nothing
 *   +1…+2 a frayed ball of froth wrapped in a warped grid: the "fabric" of space
 *    0…+0.7 hero: clumps of packed foam cells (shared flat walls, bright borders, thin-film
 *         colour) draining, popping and reforming around dark voids, nested in depth
 *   −0.7  the bottom: froth all around, the grid shaking itself apart, static everywhere
 */
import * as THREE from 'three';
import type { FrameState, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { createFoam, SHELL_K, SHELL_R0 } from './foam';
import { createFabric } from './fabric';
import { createMotes } from './motes';

const meta: LandmarkMeta = {
  id: 'planck',
  name: 'Planck scale (quantum foam)',
  sizeMeters: 1.6e-35,
  range: [-35.5, -32.0],
  evidence: 'speculative',
  nesting: 'true',
  blurb:
    'Nobody has ever observed anything this small. This is an artist\'s impression of "quantum foam": the idea that at the Planck length, space and time themselves may stop being smooth and become a jittery, bubbling froth, where our theories of gravity and quantum physics both stop working.',
  howWeKnow: {
    instrument: 'Calculation only (no experiment can reach this scale)',
    text: 'The Planck length is calculated, not measured. It comes from combining three constants of nature: G (the strength of gravity), ħ (the reduced Planck constant, from quantum physics) and c (the speed of light). The answer is about 1.6 × 10⁻³⁵ m. Our most powerful microscope, the Large Hadron Collider, probes down to only about 10⁻¹⁹ m, which is still ten million billion times bigger. Physicists expect that a theory of "quantum gravity" is needed here, but nobody yet knows what space is like at this size.',
  },
  lightTime: 'About 5.4 × 10⁻⁴⁴ seconds (one "Planck time", the shortest time that may make sense)',
  timescale: 'Perhaps a Planck time, about 10⁻⁴⁴ seconds, if time still has a meaning here',
  post: { bloom: 0.6, exposure: 1.05 },
  labels: [
    { text: 'Quantum foam (artist\'s impression)', position: [0, 0, 0], zoomRange: [0.9, 2.3] },
    { text: 'The Planck length: 1.6 × 10⁻³⁵ m', position: [0, 0, 0], zoomRange: [-0.75, 0.55] },
    { text: 'Artist\'s impression — no experiment can see this small', position: [0, 0, 0], zoomRange: [-0.75, 0.85] },
    { text: 'Below this, \'distance\' may have no meaning', position: [0, 0, 0], zoomRange: [-0.75, -0.3] },
  ],
};

/** Screen-space anchors for the labels (fractions of the view height from the centre). */
const LABEL_SCREEN: [number, number][] = [[0, 0.25], [0, 0.24], [0, -0.3], [0, 0.15]];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const factory: LandmarkFactory = (): Landmark => {
  const scene = new THREE.Scene();
  let foam: ReturnType<typeof createFoam> | null = null;
  let fabric: ReturnType<typeof createFabric> | null = null;
  let motes: ReturnType<typeof createMotes> | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const buf = new THREE.Vector2();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  const applyQuality = (q: Quality) => {
    foam?.setQuality(q);
    fabric?.setQuality(q);
    motes?.setQuality(q);
  };

  return {
    meta,
    scene,
    async init(ctx) {
      renderer = ctx.renderer;
      foam = createFoam(ctx.quality);
      fabric = createFabric(ctx.quality);
      motes = createMotes(ctx.quality);
      scene.add(foam.back, fabric.group, foam.mesh, motes.group);
      if (location.search.includes('debug')) (window as unknown as Record<string, unknown>).__planck = { scene, foam, fabric, motes };
    },
    update(f: FrameState) {
      if (!foam || !fabric || !motes) return;
      const z = f.zoom;
      const view = 10 ** z;
      const cam = f.camera;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const hPx = Math.max(1, buf.y);
      const fovRad = (cam.fov * Math.PI) / 180;

      // deeper = more restless
      const jit = 0.35 + 1.4 * smooth(0.3, -0.7, z);

      const u = foam.uniforms;
      u.uInvProj.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld);
      u.uCam.value.copy(cam.position);
      u.uTime.value = f.time;
      u.uPxAng.value = fovRad / hPx;
      u.uCamD.value = Math.max(cam.position.length(), 1e-4);
      u.uJit.value = jit;
      u.uBright.value = 1 - 0.75 * smooth(1.6, 2.8, z);
      u.uHalo.value = smooth(0.3, 1.6, z);
      u.uStatic.value = smooth(-0.15, -0.7, z);
      // first skin to test: the largest one that is not far behind / around the camera
      const camD = u.uCamD.value as number;
      u.uK0.value = Math.max(0, Math.ceil(Math.log(SHELL_R0 / (2.6 * camD)) / Math.log(1 / SHELL_K)));
      u.uVoid.value = 0.62 - 0.17 * smooth(0.0, -0.7, z);   // denser froth at the bottom
      foam.backUniforms.uBack.value = 1 - smooth(1.1, 2.4, z);

      const fu = fabric.mats[0].uniforms;
      fu.uTime.value = f.time;
      fu.uJit.value = jit + 2.5 * smooth(-0.2, -0.7, z);
      fu.uCam.value.copy(cam.position);
      const fabricFade = 1 - smooth(0.2, 1.4, z);
      fabric.scales.forEach((s, i) => {
        // each lattice is strongest when its spacing is about a quarter of the view
        const x = (Math.log10((0.5 * s) / view) - Math.log10(0.22)) / 0.5;
        fabric!.mats[i].uniforms.uOpacity.value = 0.22 * Math.exp(-x * x) * fabricFade * (1 - 0.45 * smooth(-0.3, -0.7, z));
      });

      const mu = motes.uniforms;
      mu.uTime.value = f.time;
      mu.uPx.value = hPx / (2 * Math.tan(fovRad / 2));
      mu.uJit.value = jit;
      mu.uOpacity.value = 1 - smooth(1.4, 2.6, z);

      // labels sit at fixed places on screen, on the plane through the origin
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      meta.labels!.forEach((lb, i) => {
        const [sx, sy] = LABEL_SCREEN[i];
        lb.position[0] = (right.x * sx + up.x * sy) * view;
        lb.position[1] = (right.y * sx + up.y * sy) * view;
        lb.position[2] = (right.z * sx + up.z * sy) * view;
      });
    },
    setQuality(q) { applyQuality(q); },
    dispose() {
      foam?.dispose(); fabric?.dispose(); motes?.dispose();
      foam = fabric = motes = null;
    },
  };
};

export default factory;
