/**
 * Milky Way landmark. 1 unit = 1e21 m ≈ 105,700 ly (the disc's diameter). The Sun is the origin.
 *
 * Layers (all GPU-animated particles, see populations.ts):
 *   emission  — diffuse glow, halo + globular clusters, thick disc, old thin disc, bulge, bar,
 *               nucleus, young blue arm stars                                    (additive)
 *   dust      — absorbing lanes, spurs and the central zone; dims and reddens everything above
 *   hii       — pink H II regions and real local nebulae (drawn after the dust)  (additive)
 *   stars     — resolved local stars: real neighbours + multi-scale procedural shells
 *   ring/line — "you are here" marker and the dashed 26,000 ly line
 *
 * Orientation: the galaxy frame (model.ts) is turned so the ecliptic north pole (galactic
 * l = 96.4°, b = +29.8°) points up (+Y), as in the Solar System scene: the planets' plane really is
 * tilted about 60° to the galaxy's disc. A spin about +Y then sets a three-quarter default view.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, LandmarkFactory, LandmarkLabel, LandmarkMeta, Quality } from '../../engine/types';
import { BAR_ANGLE, GC, galDir } from './model';
import { LOCAL_RATIO, TIER_FRACTION, armLabelPoint, buildDust, buildEmission, buildHII, type Pop } from './populations';
import { ORION_NEBULA, PLEIADES, REAL_STARS, buildStars, dirLy } from './stars';
import { dustFrag, galaxyFrag, galaxyVert, lineFrag, lineVert, ringFrag, ringVert, starFrag, starVert } from './shaders';

const SPIN_DEG = 140;

const ORIENT = (() => {
  const nep = new THREE.Vector3(...galDir(96.384, 29.811));
  const align = new THREE.Quaternion().setFromUnitVectors(nep, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (SPIN_DEG * Math.PI) / 180).multiply(align);
})();

const toScene = (p: [number, number, number]): [number, number, number] => {
  const v = new THREE.Vector3(...p).applyQuaternion(ORIENT);
  return [v.x, v.y, v.z];
};

const ARM_ZOOM: [number, number] = [-0.85, 0.45];
const labels: LandmarkLabel[] = [
  { text: 'You are here (Sun)', position: [0, 0, 0], zoomRange: [-2.9, 0.45] },
  { text: 'Galactic centre — Sagittarius A*', position: toScene(GC), zoomRange: [-1.3, 0.35] },
  { text: '26,000 light-years', position: toScene([GC[0] * 0.5, 0, 0]), zoomRange: [-1.0, -0.15] },
  { text: 'Scutum–Centaurus Arm', position: toScene(armLabelPoint('Scutum–Centaurus', 0.33)), zoomRange: ARM_ZOOM },
  { text: 'Perseus Arm', position: toScene(armLabelPoint('Perseus', 0.37)), zoomRange: ARM_ZOOM },
  { text: 'Sagittarius–Carina Arm', position: toScene(armLabelPoint('Sagittarius–Carina', 0.3)), zoomRange: ARM_ZOOM },
  { text: 'Norma Arm', position: toScene(armLabelPoint('Norma–Outer', 0.19)), zoomRange: [-0.6, 0.4] },
  { text: 'Outer Arm', position: toScene(armLabelPoint('Norma–Outer', 0.44)), zoomRange: ARM_ZOOM },
  { text: 'Orion Spur (our arm)', position: toScene(armLabelPoint('Orion Spur', 0.262)), zoomRange: [-1.7, -0.25] },
  { text: 'Milky Way · 100,000 light-years across', position: toScene([GC[0], 0.0, 0]), zoomRange: [0.6, 1.5] },
  ...REAL_STARS.filter((s) => s.label && s.zoom).map((s) => ({ text: s.label, position: toScene(dirLy(s.l, s.b, s.ly)), zoomRange: s.zoom })),
  { text: PLEIADES.label, position: toScene(dirLy(PLEIADES.l, PLEIADES.b, PLEIADES.ly)), zoomRange: PLEIADES.zoom },
  { text: ORION_NEBULA.label, position: toScene(dirLy(ORION_NEBULA.l, ORION_NEBULA.b, ORION_NEBULA.ly)), zoomRange: ORION_NEBULA.zoom },
];

const meta: LandmarkMeta = {
  id: 'milky-way',
  name: 'Milky Way',
  sizeMeters: 1e21,
  range: [17.8, 22.3],
  evidence: 'modelled',
  nesting: 'true',
  blurb:
    'Our home galaxy: a barred spiral of a few hundred billion stars, about 100,000 light-years across. The Sun is one ordinary star in a small spur called the Orion Arm, about 26,000 light-years from the centre.',
  howWeKnow: {
    instrument: 'Gaia satellite, radio and infrared telescopes',
    text: 'Nobody has ever photographed our galaxy from outside — we live inside it. This view is a model built from surveys: Gaia measures the positions and motions of nearly two billion stars, radio telescopes map the hydrogen gas in the spiral arms, and infrared telescopes see through the dust to the bar and the centre, where stars orbit a black hole four million times the mass of the Sun.',
  },
  lightTime: 'About 100,000 years to cross the disc; light from the galactic centre takes about 26,000 years to reach us.',
  timescale: 'The Sun takes about 230 million years to go once around the galaxy. The motion shown here is enormously sped up.',
  post: { bloom: 0.55, exposure: 1.05 },
  labels,
};

function emissionMaterial(frag: string, dust: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: galaxyVert,
    fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 }, uPxScale: { value: 1000 }, uCap: { value: 56 }, uGain: { value: 1 }, uLocalRatio: { value: LOCAL_RATIO },
      uGC: { value: new THREE.Vector3(...GC) }, uBar: { value: new THREE.Vector2(Math.cos(BAR_ANGLE), Math.sin(BAR_ANGLE)) },
    },
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: dust ? THREE.ZeroFactor : THREE.OneFactor,
    blendDst: dust ? THREE.OneMinusSrcColorFactor : THREE.OneFactor,
    blendSrcAlpha: dust ? THREE.ZeroFactor : THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

function additive(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms,
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

const smooth = THREE.MathUtils.smoothstep;

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const galaxy = new THREE.Group();
  galaxy.quaternion.copy(ORIENT);
  scene.add(galaxy);

  const emitMat = emissionMaterial(galaxyFrag, false);
  const dustMat = emissionMaterial(dustFrag, true);
  const hiiMat = emissionMaterial(galaxyFrag, false);
  hiiMat.uniforms = THREE.UniformsUtils.clone(emitMat.uniforms);
  const starMat = additive(starVert, starFrag, { uE: { value: 22_000 }, uViewLy: { value: 1 }, uDpr: { value: 1 }, uFade: { value: 1 }, uSpikes: { value: 1 } });
  const ringMat = additive(ringVert, ringFrag, { uDpr: { value: 1 }, uA: { value: 0 } });
  const lineMat = additive(lineVert, lineFrag, { uA: { value: 0 } });

  const objects: THREE.Object3D[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  let renderer: THREE.WebGLRenderer | null = null;
  let maxPoint = 256;
  const buf = new THREE.Vector2();

  const localNebulae = [
    { pos: dirLy(ORION_NEBULA.l, ORION_NEBULA.b, ORION_NEBULA.ly), kind: 'orion' as const },
    { pos: dirLy(PLEIADES.l, PLEIADES.b, PLEIADES.ly), kind: 'pleiades' as const },
  ];

  // static helpers: marker ring and the dashed line
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const ring = new THREE.Points(ringGeo, ringMat);
  ring.frustumCulled = false; ring.renderOrder = 6;
  galaxy.add(ring);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, GC[0], GC[1], GC[2]]), 3));
  lineGeo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false; line.renderOrder = 5;
  galaxy.add(line);

  function clear() {
    for (const o of objects) galaxy.remove(o);
    for (const g of geoms) g.dispose();
    objects.length = 0; geoms.length = 0;
  }

  function build(q: Quality) {
    clear();
    const f = TIER_FRACTION[q];
    const add = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
      const p = new THREE.Points(g, m);
      p.frustumCulled = false; p.renderOrder = order;
      galaxy.add(p); objects.push(p); geoms.push(g);
    };
    add(popGeometry(buildEmission(f)), emitMat, 1);
    add(popGeometry(buildDust(f)), dustMat, 2);
    add(popGeometry(buildHII(f, localNebulae)), hiiMat, 3);
    const s = buildStars(f);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
    sg.setAttribute('aCol', new THREE.BufferAttribute(s.col, 3));
    sg.setAttribute('aLum', new THREE.BufferAttribute(s.lum, 1));
    sg.setAttribute('aShell', new THREE.BufferAttribute(s.shell, 1));
    add(sg, starMat, 4);
    starMat.uniforms.uSpikes.value = q === 'low' ? 0 : 1;
  }

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      const gl = renderer.getContext();
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
      if (range && range[1] > 0) maxPoint = range[1];
      build(ctx.quality);
    },
    update(frame: FrameState) {
      const z = frame.zoom;
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const h = buf.y > 0 ? buf.y : 1000;
      const pxScale = h / (2 * Math.tan((frame.camera.fov * Math.PI) / 360));
      const cap = Math.min(maxPoint * 0.5, 56 * dpr);
      // inside the disc the whole sky becomes a bright band; ease it down so it does not blow out
      const inside = 0.55 + 0.45 * smooth(z, -2.2, -0.5);
      for (const m of [emitMat, dustMat, hiiMat]) {
        m.uniforms.uTime.value = frame.time;
        m.uniforms.uPxScale.value = pxScale;
        m.uniforms.uCap.value = cap;
      }
      emitMat.uniforms.uGain.value = 1.0 * inside;
      hiiMat.uniforms.uGain.value = 1.0 * inside;
      dustMat.uniforms.uGain.value = 1.0;
      starMat.uniforms.uDpr.value = dpr;
      starMat.uniforms.uViewLy.value = 105_700 * 10 ** z;
      starMat.uniforms.uFade.value = 1 - smooth(z, -0.7, 0.25);
      // the nearest few light-years are genuinely sparse; open the 'aperture' a little there
      starMat.uniforms.uE.value = 22_000 * (1 + 2 * smooth(z, -3.0, -4.2));
      ringMat.uniforms.uDpr.value = dpr;
      ringMat.uniforms.uA.value = smooth(z, -3.0, -2.5) * (1 - smooth(z, 0.6, 1.1)) * 0.8;
      lineMat.uniforms.uA.value = smooth(z, -1.3, -0.85) * (1 - smooth(z, 0.45, 0.85)) * 0.55;
    },
    setQuality(q: Quality) { build(q); },
    dispose() {
      clear();
      ringGeo.dispose(); lineGeo.dispose();
      for (const m of [emitMat, dustMat, hiiMat, starMat, ringMat, lineMat]) m.dispose();
    },
  };
};

export default factory;
