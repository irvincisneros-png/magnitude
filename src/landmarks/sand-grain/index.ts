/**
 * Landmark "sand-grain": a medium grain of beach sand (0.5 mm, 1 local unit) stuck to the back of
 * a hand at Woonona Beach, NSW. The human scene draws the skin (the plane y = 0, normal +Y); this
 * layer adds the grains and their contact cues on it.
 *
 * Layout (local units): the origin is skin, where the skin-cell scene sits. The hero quartz grain
 * rests beside it (centre x 0.62, z 0.1, near edge ~0.1 from the origin); a feldspar grain, a
 * heavy-mineral grain and a shell fragment lie further out on the +X side (the ant stands at −X);
 * silt and dust specks are scattered around, none within 0.08 of the origin.
 *
 * Files: light.ts (Sun/sky constants matching the human scene: retune there), shape.ts + bake.worker.ts
 * (meshes, quartz distance grid, shadow + caustic map), quartz.ts, solids.ts, specks.ts, decal.ts.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { lightUniforms, sunDir } from './light';
import { envUniforms } from './env';
import { FELDSPAR_AT, GRID, HEAVY_AT, MAP, QUARTZ_AT, SHELL_AT, type Baked, type MeshData } from './shape';
import { quartzMaterial } from './quartz';
import { shellGeometry, solidMaterial } from './solids';
import { Specks } from './specks';
import { decalMesh } from './decal';

const meta: LandmarkMeta = {
  id: 'sand-grain',
  name: 'Grain of sand',
  sizeMeters: 0.0005,
  range: [-4.5, -2.3],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'Sand is rock that has been broken down by weather, rivers and waves; on Australia’s east coast it is mostly quartz, with bits of shell. Geologists call any grain from 0.06 to 2 millimetres across “sand”, whatever it is made of. This 0.5 mm grain is stuck to the back of a hand at Woonona Beach, NSW.',
  howWeKnow: {
    instrument: 'Sieves and light microscopes',
    text:
      'Shaking sand through a stack of sieves with finer and finer mesh sorts the grains by size. Under a microscope, geologists identify each grain’s mineral and read its shape: rounded, frosted grains have been knocked about by waves and wind for a long time, while sharp, angular grains are fresh from their rock. Together these clues tell them where the sand came from and how far it has travelled.',
  },
  lightTime: 'About 1.7 × 10⁻¹² seconds (1.7 picoseconds) to cross the grain',
  timescale: 'Quartz is so tough that a grain can be millions of years old, recycled through many beaches, sand dunes and sandstones',
  post: { bloom: 0.45, exposure: 1.0 },
  labels: [
    { text: 'Quartz (silicon dioxide)', position: [QUARTZ_AT.x, 0.66, QUARTZ_AT.z], zoomRange: [-0.45, 0.95] },
    { text: '0.5 millimetres across', position: [QUARTZ_AT.x + 0.5, 0.3, QUARTZ_AT.z], zoomRange: [-0.15, 0.6] },
    { text: 'Rounded by waves over thousands of years', position: [QUARTZ_AT.x - 0.32, 0.5, QUARTZ_AT.z + 0.2], zoomRange: [-0.95, -0.2] },
    { text: 'Shell fragment', position: [SHELL_AT.x, 0.3, SHELL_AT.z], zoomRange: [-0.1, 0.8] },
    { text: 'Skin on the back of a hand', position: [-0.55, 0.0, 0.75], zoomRange: [-1.2, 0.15] },
  ],
};

function meshFrom(d: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(d.pos.length / 3), 1));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  return g;
}

function bakeInWorker(sun: THREE.Vector3, quality: Quality): Promise<Baked> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { resolve(e.data as Baked); w.terminate(); };
    w.onerror = (e) => { reject(e); w.terminate(); };
    w.postMessage({ sun: [sun.x, sun.y, sun.z], quality });
  });
}

function createSandGrain(): Landmark {
  const scene = new THREE.Scene();
  const env = envUniforms();
  const light = lightUniforms();
  const shared = { ...light, ...env };
  const sdfU = { tSdf: { value: null as THREE.Data3DTexture | null }, uB: { value: GRID.B }, uN: { value: GRID.n } };
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  let quartz: THREE.Mesh | null = null;
  let specks: Specks | null = null;
  let tier: Quality = 'high';
  let renderer: THREE.WebGLRenderer | null = null;
  const buf = new THREE.Vector2();
  const tierN = (q: Quality) => (q === 'low' ? 0 : q === 'medium' ? 1 : 2);

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      tier = ctx.quality;
      const b = await bakeInWorker(sunDir(), ctx.quality);

      const sdfTex = new THREE.Data3DTexture(b.grid, GRID.n, GRID.n, GRID.n);
      sdfTex.format = THREE.RGBAFormat; sdfTex.type = THREE.HalfFloatType;
      sdfTex.minFilter = sdfTex.magFilter = THREE.LinearFilter;
      sdfTex.wrapS = sdfTex.wrapT = sdfTex.wrapR = THREE.ClampToEdgeWrapping;
      sdfTex.unpackAlignment = 1;
      sdfTex.needsUpdate = true;
      const mapTex = new THREE.DataTexture(b.map, MAP.nx, MAP.nz, THREE.RGBAFormat, THREE.HalfFloatType);
      mapTex.minFilter = mapTex.magFilter = THREE.LinearFilter;
      mapTex.wrapS = mapTex.wrapT = THREE.ClampToEdgeWrapping;
      mapTex.needsUpdate = true;
      texs.push(sdfTex, mapTex);
      sdfU.tSdf.value = sdfTex;
      env.tMap.value = mapTex;

      const qU = { ...shared, ...sdfU };
      const qGeo = meshFrom(b.quartz);
      const qMat = quartzMaterial(qU, tierN(tier));
      quartz = new THREE.Mesh(qGeo, qMat);
      quartz.position.set(QUARTZ_AT.x, b.offsets.quartz, QUARTZ_AT.z);
      geos.push(qGeo); mats.push(qMat);

      const place = (g: THREE.BufferGeometry, kind: 0 | 1 | 2, at: { x: number; z: number; yaw: number }, y: number) => {
        const m = solidMaterial(shared, kind);
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(at.x, y, at.z);
        mesh.rotation.y = at.yaw;
        geos.push(g); mats.push(m);
        scene.add(mesh);
      };
      place(meshFrom(b.feldspar), 0, FELDSPAR_AT, b.offsets.feldspar);
      place(meshFrom(b.heavy), 1, HEAVY_AT, b.offsets.heavy);
      const sg = shellGeometry();
      sg.computeBoundingBox();
      place(sg, 2, SHELL_AT, -sg.boundingBox!.min.y - 0.01);

      specks = new Specks(shared);
      specks.build(tier);
      scene.add(quartz, specks.mesh);

      const decal = decalMesh({
        ...shared, ...sdfU,
        uOffQ: { value: quartz.position.clone() },
        uAo: { value: [FELDSPAR_AT, HEAVY_AT, SHELL_AT].map((p) => new THREE.Vector4(p.x, p.z, p.yaw, 0)) },
        uAoR: { value: [new THREE.Vector2(0.36, 0.3), new THREE.Vector2(0.2, 0.17), new THREE.Vector2(0.44, 0.44)] },
      });
      geos.push(decal.geometry); mats.push(decal.material as THREE.Material);
      scene.add(decal);
    },
    update(frame: FrameState) {
      const cam = frame.camera;
      env.uTime.value = frame.time;
      env.uZoom.value = frame.zoom;
      if (renderer) renderer.getDrawingBufferSize(buf);
      env.uPx.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(buf.y || 800, 1);
    },
    setQuality(q: Quality) {
      if (q === tier) return;
      tier = q;
      specks?.build(q);
      if (quartz) {
        const m = quartz.material as THREE.ShaderMaterial;
        m.defines.TIER = tierN(q);
        m.defines.STEPS = q === 'low' ? 8 : q === 'medium' ? 12 : 16;
        m.needsUpdate = true;
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      specks?.dispose();
    },
  };
}

const factory: LandmarkFactory = () => createSandGrain();
export default factory;
