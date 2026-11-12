/**
 * Observable universe landmark. 1 unit = 8.8e26 m ≈ 93 billion light-years (the diameter of the
 * observable universe); the CMB shell is at radius 0.5. The Milky Way (the Sun, exactly) is the origin.
 *
 * Almost everything lives in `mly`, a group measured in millions of light-years in the Milky Way's
 * galactic frame, scaled by MLY and turned by the Milky Way scene's orientation so the proxy disc
 * lines up with the real child scene. Layers, each fading with zoom so there is always structure at
 * the current scale:
 *   lg      Local Group: Milky Way proxy, Andromeda, Triangulum, Magellanic Clouds, dwarfs
 *   neigh   nearby groups and clusters (Virgo … Coma) joined by filaments; Laniakea flow lines
 *   local   procedural cosmic web to ~400 Mly (real galaxy density)
 *   near    procedural web to ~5 billion ly (fine filaments inside supercluster walls)
 *   far     the whole observable universe as glowing groups thinning towards the edge
 *   cmb     the cosmic microwave background shell + a soft rim glow
 */
import * as THREE from 'three';
import type { FrameState, InitContext, LandmarkFactory, LandmarkLabel, LandmarkMeta, Quality } from '../../engine/types';
import { bakeCMB } from './cmb';
import {
  COMA, GREAT_ATTRACTOR, LMC, M31, M33, MW_POS, SMC, VIRGO, buildLocalGroup, buildNeighbourhood, buildStreamlines,
} from './local';
import { cmbFrag, cmbVert, dustFrag, flowFrag, flowVert, galaxyFrag, galaxyVert, haloFrag, haloVert, ringFrag, ringVert } from './shaders';
import { MLY, R_UNIVERSE_MLY, Rng, add, galDir, galPos, len, scl, smooth, vnoise, type Pop, type V3 } from './util';
import { LOCAL_VOID, LOCAL_VOID_R, WebBuilder } from './web';

/** Same orientation as the Milky Way scene: ecliptic north pole up, then a 140° spin about +Y. */
const ORIENT = (() => {
  const nep = new THREE.Vector3(...galDir(96.384, 29.811));
  const align = new THREE.Quaternion().setFromUnitVectors(nep, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (140 * Math.PI) / 180).multiply(align);
})();

/** Galactic-frame Mly → scene units. */
const toScene = (p: V3): [number, number, number] => {
  const v = new THREE.Vector3(...p).applyQuaternion(ORIENT).multiplyScalar(MLY);
  return [v.x, v.y, v.z];
};

const labels: LandmarkLabel[] = [
  { text: 'Large Magellanic Cloud', position: toScene(add(LMC, [0, 0.025, 0])), zoomRange: [-5.4, -4.55] },
  { text: 'Small Magellanic Cloud', position: toScene(add(SMC, [0, -0.03, 0])), zoomRange: [-5.4, -4.65] },
  { text: 'Milky Way — you are here', position: toScene(add(MW_POS, [0, 0.02, 0])), zoomRange: [-4.6, -2.7] },
  { text: 'Andromeda Galaxy — 2.5 million light-years', position: toScene(M31), zoomRange: [-5.0, -3.4] },
  { text: 'Triangulum Galaxy', position: toScene(M33), zoomRange: [-4.7, -3.7] },
  { text: 'Local Group', position: toScene(add(scl(M31, 0.45), [0, 1.1, 0])), zoomRange: [-4.3, -3.2] },
  { text: 'Virgo Cluster', position: toScene(VIRGO), zoomRange: [-3.5, -1.9] },
  { text: 'Local Void', position: toScene(LOCAL_VOID), zoomRange: [-3.3, -2.2] },
  { text: 'Each dot is a galaxy of billions of stars', position: toScene(galPos(160, -25, 160)), zoomRange: [-3.1, -2.1] },
  { text: 'Great Attractor', position: toScene(GREAT_ATTRACTOR), zoomRange: [-3.0, -2.2] },
  { text: 'Laniakea Supercluster — 520 million light-years', position: toScene(galPos(300, 35, 170)), zoomRange: [-2.9, -2.1] },
  { text: 'Coma Cluster', position: toScene(COMA), zoomRange: [-2.6, -1.6] },
  { text: 'Cosmic web: filaments and voids', position: toScene(galPos(200, 25, 1800)), zoomRange: [-2.2, -0.9] },
  { text: 'Redshift: the farthest galaxies look redder — we see them as they were long ago', position: toScene(galPos(40, -25, 24000)), zoomRange: [-1.1, -0.2] },
  { text: 'On the largest scales, the universe looks the same everywhere', position: toScene(galPos(160, 50, 15000)), zoomRange: [-0.95, -0.5] },
  { text: 'About 2 trillion galaxies', position: toScene(galPos(300, 40, 26000)), zoomRange: [-0.4, 0.3] },
  { text: 'Cosmic microwave background — the oldest light', position: toScene(galPos(250, -15, R_UNIVERSE_MLY)), zoomRange: [-0.45, 0.35] },
  { text: 'Released 380,000 years after the Big Bang, 13.8 billion years ago', position: toScene(galPos(110, 30, R_UNIVERSE_MLY)), zoomRange: [-0.25, 0.2] },
  { text: 'You are here — the centre of OUR view, not of the universe', position: [0, 0, 0], zoomRange: [-1.6, 0.15] },
  { text: 'Observable universe: 93 billion light-years across', position: [0, 0.6, 0], zoomRange: [0.05, 0.6] },
  { text: 'We cannot see further — the universe itself goes on', position: [0, -0.64, 0], zoomRange: [0.28, 0.6] },
];

const meta: LandmarkMeta = {
  id: 'universe',
  name: 'Cosmic web → observable universe',
  sizeMeters: 8.8e26,
  range: [21.6, 27.5],
  evidence: 'modelled',
  nesting: 'true',
  blurb:
    'Galaxies gather in groups and clusters, strung along filaments around enormous empty voids — the cosmic web. The observable universe is about 93 billion light-years across. We sit at its centre only because it is defined by how far we can see.',
  howWeKnow: {
    instrument: 'Galaxy surveys (SDSS, 2dF, DESI) and CMB satellites (WMAP, Planck)',
    text: 'Redshift surveys such as SDSS, 2dF and DESI have measured the distances to millions of galaxies, revealing the pattern of filaments, walls and voids. The WMAP and Planck satellites mapped the cosmic microwave background, the faint glow left over from the hot early universe. The nearby galaxies here are placed at their real directions and distances, but the rest is a statistical model: it has the right kind of pattern, not the real positions of real galaxies.',
  },
  lightTime:
    'The universe is 13.8 billion years old, yet the observable universe is 93 billion light-years across, because space kept expanding while the oldest light was travelling to us.',
  timescale: 'Galaxy clusters and filaments take billions of years to form; the universe has been expanding for 13.8 billion years.',
  post: { bloom: 0.5, exposure: 1.0 },
  labels,
};

// ------------------------------------------------------------------- materials

interface GalUniforms { [k: string]: THREE.IUniform }
function galaxyUniforms(): GalUniforms {
  return {
    uTime: { value: 0 }, uPxScale: { value: 1000 }, uCap: { value: 64 }, uMinPx: { value: 1.5 }, uGain: { value: 1 }, uAlpha: { value: 1 },
    uSizeK: { value: MLY }, uEnergyPow: { value: 2 }, uDepthK: { value: 1e6 }, uCamDist: { value: 1 },
    uRedshift: { value: 1 / R_UNIVERSE_MLY }, uDrift: { value: 0 }, uFocus: { value: 1e9 },
  };
}
function galaxyMaterial(dust = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: galaxyVert, fragmentShader: dust ? dustFrag : galaxyFrag, uniforms: galaxyUniforms(),
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: dust ? THREE.ZeroFactor : THREE.OneFactor,
    blendDst: dust ? THREE.OneMinusSrcColorFactor : THREE.OneFactor,
    blendSrcAlpha: dust ? THREE.ZeroFactor : THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}
function additive(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms, side,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
}
function popGeometry(p: Pop): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(p.col, 3));
  g.setAttribute('aPar', new THREE.BufferAttribute(p.par, 4));
  return g;
}

/** Particle fractions per tier. Low keeps the web (it carries the structure) and thins the rest: ~40k in all. */
const TIER = {
  low: { local: 0.18, near: 0.07, far: 0.05, lg: 0.1, neigh: 0.1 },
  medium: { local: 0.5, near: 0.45, far: 0.45, lg: 0.45, neigh: 0.45 },
  high: { local: 1, near: 1, far: 1, lg: 1, neigh: 1 },
} as const;
const COUNTS = { local: 85_000, near: 160_000, far: 100_000 };

// ------------------------------------------------------------------- populations

const voidCarve = (p: V3, rng: Rng) => {
  const d = len([p[0] - LOCAL_VOID[0], p[1] - LOCAL_VOID[1], p[2] - LOCAL_VOID[2]]);
  const r = LOCAL_VOID_R * (0.85 + 0.3 * vnoise(p[0] / 40, p[1] / 40, p[2] / 40, 77));
  return d > r || rng.next() < 0.03;
};

function localWeb(f: number): WebBuilder {
  return new WebBuilder({
    count: Math.round(COUNTS.local * f), seed: 1001, level: 0, coarse: 0,
    where: (rng) => { for (;;) { const p = rng.ball(600); if (len(p) > 6) return p; } },
    accept: (p, rng) => { const r = len(p); return r > 5.5 && rng.next() > smooth(450, 600, r) && voidCarve(p, rng); },
  });
}
function nearWeb(f: number): WebBuilder {
  return new WebBuilder({
    count: Math.round(COUNTS.near * f), seed: 2002, level: 1, coarse: 0,
    where: (rng) => {
      if (rng.next() < 0.18) return scl(rng.dir(), 300 * Math.pow(6000 / 300, rng.next()));
      return rng.ball(6000);
    },
    accept: (p, rng) => { const r = len(p); return r > 20 && rng.next() > smooth(4500, 6000, r) && voidCarve(p, rng); },
  });
}
function farWeb(f: number): WebBuilder {
  return new WebBuilder({
    count: Math.round(COUNTS.far * f), seed: 3003, level: 2, coarse: 0, glow: true, multi: false,
    mix: [0.3, 0.45, 0.17],
    where: (rng) => rng.ball(R_UNIVERSE_MLY * 0.985),
    // the first galaxies formed a few hundred million years after the Big Bang: towards the edge
    // (looking back in time) there are fewer and fewer, then only the CMB
    accept: (p, rng) => rng.next() > 0.85 * smooth(33000, 45800, len(p)),
  });
}

// ------------------------------------------------------------------- factory

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const mly = new THREE.Group();
  mly.quaternion.copy(ORIENT);
  mly.scale.setScalar(MLY);
  scene.add(mly);

  const mats = {
    far: galaxyMaterial(), near: galaxyMaterial(), local: galaxyMaterial(), neigh: galaxyMaterial(),
    lg: galaxyMaterial(), lgDust: galaxyMaterial(true), lgFar: galaxyMaterial(), mw: galaxyMaterial(), mwDust: galaxyMaterial(true),
  };
  const flowMat = additive(flowVert, flowFrag, { uTime: { value: 0 }, uA: { value: 0 } });
  const ringMat = additive(ringVert, ringFrag, { uDpr: { value: 1 }, uA: { value: 0 } });
  const cmbMat = additive(cmbVert, cmbFrag, { tMap: { value: null }, uA: { value: 0 }, uOutside: { value: 1 } }, THREE.DoubleSide);
  const haloMat = additive(haloVert, haloFrag, { uA: { value: 0 }, uR: { value: 0.5 } }, THREE.BackSide);

  const cmbGeo = new THREE.SphereGeometry(0.5, 160, 96);
  const cmb = new THREE.Mesh(cmbGeo, cmbMat);
  cmb.renderOrder = 0; cmb.frustumCulled = false;
  scene.add(cmb);
  const haloGeo = new THREE.SphereGeometry(0.8, 64, 32);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = 0; halo.frustumCulled = false;
  scene.add(halo);

  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const ring = new THREE.Points(ringGeo, ringMat);
  ring.frustumCulled = false; ring.renderOrder = 9;
  scene.add(ring);

  let cmbTex: THREE.DataTexture | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let maxPoint = 256;
  const buf = new THREE.Vector2();
  const objects: THREE.Object3D[] = [];
  const geoms: THREE.BufferGeometry[] = [];

  /** Procedural web populations are built a slice at a time (they take a few seconds in all). */
  interface Stream { builder: WebBuilder; geo: THREE.BufferGeometry; shown: number }
  let streams: Stream[] = [];
  let builtTier: Quality | null = null;
  /** brightness compensation when a tier draws fewer galaxies */
  let sparse = { local: 1, near: 1, far: 1 };
  let lastZoom = -3;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;

  function clear() {
    for (const o of objects) mly.remove(o);
    for (const g of geoms) g.dispose();
    objects.length = 0; geoms.length = 0;
    streams = [];
    if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; }
  }

  const addObj = (o: THREE.Object3D, g: THREE.BufferGeometry, order: number) => {
    o.frustumCulled = false; o.renderOrder = order;
    mly.add(o); objects.push(o); geoms.push(g);
  };

  function addStream(builder: WebBuilder, mat: THREE.ShaderMaterial, order: number) {
    const { pos, col, par } = builder.pb;
    const g = new THREE.BufferGeometry();
    for (const [name, arr, k] of [['position', pos, 3], ['aCol', col, 3], ['aPar', par, 4]] as const) {
      const a = new THREE.BufferAttribute(arr, k);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    g.setDrawRange(0, 0);
    addObj(new THREE.Points(g, mat), g, order);
    streams.push({ builder, geo: g, shown: 0 });
  }

  /** Advance the unfinished builders for about `ms`, nearest-in-scale first, and upload new points. */
  function pump(ms: number) {
    const t0 = performance.now();
    const order = lastZoom > -1.6 ? [2, 1, 0] : lastZoom > -2.6 ? [1, 0, 2] : [0, 1, 2];
    for (const i of order) {
      const st = streams[i];
      if (!st || st.builder.done) continue;
      const left = ms - (performance.now() - t0);
      if (left <= 0) break;
      st.builder.step(left);
    }
    for (const st of streams) {
      const n = st.builder.pb.count;
      if (n === st.shown) continue;
      for (const name of ['position', 'aCol', 'aPar']) {
        const a = st.geo.getAttribute(name) as THREE.BufferAttribute;
        a.addUpdateRange(st.shown * a.itemSize, (n - st.shown) * a.itemSize);
        a.needsUpdate = true;
      }
      st.geo.setDrawRange(0, n);
      st.shown = n;
    }
  }

  function schedulePump() {
    if (pumpTimer || streams.every((s) => s.builder.done)) return;
    pumpTimer = setTimeout(() => { pumpTimer = null; pump(14); schedulePump(); }, 0);
  }

  function build(q: Quality) {
    if (q === builtTier) return;
    builtTier = q;
    clear();
    const f = TIER[q];
    sparse = { local: 1 / Math.sqrt(f.local), near: 1 / Math.sqrt(f.near), far: 1 / Math.sqrt(f.far) };
    const addPts = (p: Pop, m: THREE.Material, order: number) => {
      const g = popGeometry(p);
      addObj(new THREE.Points(g, m), g, order);
    };
    addStream(localWeb(f.local), mats.local, 3);
    addStream(nearWeb(f.near), mats.near, 2);
    addStream(farWeb(f.far), mats.far, 1);
    addPts(buildNeighbourhood(f.neigh).build(), mats.neigh, 4);
    const lg = buildLocalGroup(f.lg);
    addPts(lg.emit.build(), mats.lg, 5);
    addPts(lg.dust.build(), mats.lgDust, 6);
    addPts(lg.mw.build(), mats.mw, 5);
    addPts(lg.mwDust.build(), mats.mwDust, 6);
    addPts(lg.far.build(), mats.lgFar, 4);
    const sl = buildStreamlines(q === 'low' ? 70 : q === 'medium' ? 110 : 150);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(sl.pos, 3));
    fg.setAttribute('aT', new THREE.BufferAttribute(sl.t, 1));
    fg.setAttribute('aSeed', new THREE.BufferAttribute(sl.seed, 1));
    addObj(new THREE.LineSegments(fg, flowMat), fg, 7);
    schedulePump();
  }

  const setPop = (m: THREE.ShaderMaterial, o: { alpha: number; gain?: number; sizeK?: number; minPx?: number; pow?: number; depthK?: number; drift?: number; focus?: number }) => {
    const u = m.uniforms;
    u.uAlpha.value = o.alpha;
    u.uGain.value = o.gain ?? 1;
    u.uSizeK.value = MLY * (o.sizeK ?? 1);
    u.uMinPx.value = o.minPx ?? 1.5;
    u.uEnergyPow.value = o.pow ?? 2;
    u.uDepthK.value = o.depthK ?? 1e6;
    u.uDrift.value = o.drift ?? 0;
    u.uFocus.value = o.focus ?? 1e9;
  };

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      const gl = renderer.getContext();
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
      if (range && range[1] > 0) maxPoint = range[1];
      cmbTex = bakeCMB(ctx.quality === 'low' ? 512 : 1024);
      cmbMat.uniforms.tMap.value = cmbTex;
      build(ctx.quality);
    },
    update(frame: FrameState) {
      const z = frame.zoom;
      lastZoom = z;
      if (streams.some((st) => !st.builder.done)) { pump(6); schedulePump(); }
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const h = buf.y > 0 ? buf.y : 1000;
      const pxScale = h / (2 * Math.tan((frame.camera.fov * Math.PI) / 360));
      const camDist = frame.camera.position.length();
      const cap = Math.min(maxPoint * 0.5, 64 * dpr);
      for (const m of Object.values(mats)) {
        m.uniforms.uTime.value = frame.time;
        m.uniforms.uPxScale.value = pxScale;
        m.uniforms.uCap.value = cap;
        m.uniforms.uCamDist.value = camDist;
      }

      // Local Group (and the Milky Way proxy, which takes over as the real Milky Way scene fades)
      const lgA = 1 - smooth(-2.9, -2.2, z);
      const proxy = smooth(21.72, 22.3, frame.s);
      // particle discs up close, one integrated sprite each once they shrink to a few pixels
      const discA = 1 - smooth(-4.1, -3.6, z);
      setPop(mats.lg, { alpha: discA });
      setPop(mats.lgDust, { alpha: discA });
      setPop(mats.mw, { alpha: discA * proxy });
      setPop(mats.mwDust, { alpha: discA * proxy });
      setPop(mats.lgFar, { alpha: lgA * smooth(-4.1, -3.6, z), gain: 4 });
      // a soft ball around us, about the size of the view: only a few voids deep, so the web reads
      const V = 10 ** z;
      const focus = 1.3 * V;
      const deep = 1 + 1e6 * (1 - smooth(-3.3, -2.6, z)); // deep in: show everything as a backdrop
      // the neighbourhood: real groups and clusters
      setPop(mats.neigh, { alpha: 1 - smooth(-2.6, -1.7, z), gain: 2.5, focus: focus * deep });
      // procedural web, three nested populations
      setPop(mats.local, { alpha: (1 - smooth(-1.8, -1.1, z)) * Math.sqrt(sparse.local), gain: 10 * sparse.local, sizeK: Math.sqrt(sparse.local), focus: focus * deep, drift: 6 });
      setPop(mats.near, { alpha: smooth(-3.0, -2.3, z) * (1 - smooth(-1.35, -0.75, z)) * Math.sqrt(sparse.near), gain: 60 * sparse.near, sizeK: 2 * Math.sqrt(sparse.near), focus, drift: 3, pow: 1.5 });
      setPop(mats.far, { alpha: smooth(-1.75, -1.05, z) * Math.sqrt(sparse.far), gain: 6 * sparse.far, sizeK: 14, focus, drift: 18, pow: 1.4 });

      flowMat.uniforms.uTime.value = frame.time;
      flowMat.uniforms.uA.value = smooth(-3.3, -2.8, z) * (1 - smooth(-2.6, -2.15, z));
      ringMat.uniforms.uDpr.value = dpr;
      ringMat.uniforms.uA.value = smooth(-3.6, -3.1, z) * 0.75;

      const outside = smooth(0.42, 0.62, camDist);
      cmbMat.uniforms.uOutside.value = outside;
      cmbMat.uniforms.uA.value = smooth(-0.75, -0.2, z) * (0.3 + 0.7 * outside);
      haloMat.uniforms.uA.value = smooth(-0.3, 0.2, z);
    },
    setQuality(q: Quality) { build(q); },
    dispose() {
      clear();
      for (const m of Object.values(mats)) m.dispose();
      flowMat.dispose(); ringMat.dispose(); cmbMat.dispose(); haloMat.dispose();
      cmbGeo.dispose(); haloGeo.dispose(); ringGeo.dispose();
      cmbTex?.dispose();
    },
  };
};

export default factory;
