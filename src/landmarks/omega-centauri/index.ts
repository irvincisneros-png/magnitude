/**
 * Omega Centauri. 1 unit = 1.4e18 m ≈ 150 ly (the cluster's diameter). Origin = cluster centre.
 * Layers: an unresolved-light haze (full-screen triangle, analytic) under hundreds of thousands of
 * GPU-animated star points. No gas or dust: globular clusters have almost none.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { AXIS_RATIO, CORE_A, RED_GIANT_POS, STRAGGLER_POS, buildPopulation } from './population';
import { hazeFrag, hazeVert, starFrag, starVert } from './shaders';

const smooth = THREE.MathUtils.smoothstep;

function makeMeta(): LandmarkMeta {
  const rg = RED_GIANT_POS, bs = STRAGGLER_POS;
  return {
    id: 'omega-centauri',
    name: 'Omega Centauri',
    sizeMeters: 1.4e18,
    range: [17.7, 19.7],
    evidence: 'measured',
    nesting: 'comparison',
    nestingNote:
      'The real cluster is about 17,000 light-years away in Centaurus, orbiting in the Milky Way\'s halo. It is placed here only so you can compare its size with the Orion Nebula.',
    blurb:
      'A globular cluster is a ball of very old stars held together by gravity. Omega Centauri is about 12 billion years old and is the biggest and brightest of the Milky Way\'s 150 or so globular clusters. From Australia you can see it with your naked eye as a fuzzy star in Centaurus. It may be the leftover core of a small galaxy that the Milky Way swallowed long ago.',
    howWeKnow: {
      instrument: 'Hubble and Gaia space telescopes',
      text: 'Telescopes can pick out its individual stars, even in the crowded core. Hubble and Gaia measure how the stars move and what colour they are, and a star\'s colour and brightness reveal its age and mass. The astronomer Edmond Halley listed it in 1677 as a patch of sky that was not a star, long before anyone knew it was millions of suns.',
    },
    lightTime: 'About 150 years to cross',
    timescale:
      'Stars take around a hundred thousand to a million years to orbit inside the cluster, and the cluster itself circles the Milky Way about once every 120 million years. The motion here is enormously sped up.',
    post: { bloom: 0.0, exposure: 1.0 },
    labels: [
      { text: 'Omega Centauri · about 10 million stars', position: [0, 0.66, 0], zoomRange: [-0.6, 1.2] },
      { text: '150 light-years across', position: [0, -0.64, 0], zoomRange: [-0.35, 0.9] },
      { text: 'Core: stars only about 0.2 light-years apart', position: [0.05, 0.035, 0], zoomRange: [-0.45, 0.45] },
      { text: 'Red giants (old, dying stars)', position: [rg[0], rg[1], rg[2]], zoomRange: [-0.45, 0.6] },
      { text: 'Blue stragglers', position: [bs[0], bs[1], bs[2]], zoomRange: [-0.45, 0.45] },
      { text: 'The Orion Nebula, to scale', position: [0, 0.1, 0], zoomRange: [-0.6, 0.1] },
    ],
  };
}

function additive(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
}

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const meta = makeMeta();

  const starMat = additive(starVert, starFrag, {
    uTime: { value: 0 }, uDpr: { value: 1 }, uSpin: { value: 0.004 }, uCamDist: { value: 2 },
    uGainF: { value: 1 }, uW: { value: 1 }, uGainB: { value: 1 }, uHold: { value: 0 }, uSpikes: { value: 1 },
  });
  const hazeMat = additive(hazeVert, hazeFrag, {
    uTan: { value: 0.4 }, uAspect: { value: 1.6 }, uGain: { value: 1 }, uQ: { value: AXIS_RATIO }, uA0: { value: CORE_A * 0.75 },
  });

  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const haze = new THREE.Mesh(triGeo, hazeMat);
  haze.frustumCulled = false; haze.renderOrder = 0;
  scene.add(haze);

  let stars: THREE.Points | null = null;
  let starGeo: THREE.BufferGeometry | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let tierGain = 1;
  let faintBoost = 1; // low tier has ~8x fewer faint stars: each carries more light, and the haze fills in
  let hazeBoost = 1;
  let wFaint = 1; // light given to each faint star relative to the high tier
  const buf = new THREE.Vector2();

  function build(q: Quality) {
    if (stars) scene.remove(stars);
    starGeo?.dispose();
    const p = buildPopulation(q);
    starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    starGeo.setAttribute('aCol', new THREE.BufferAttribute(p.col, 3));
    starGeo.setAttribute('aL', new THREE.BufferAttribute(p.lum, 1));
    starGeo.setAttribute('aOrb', new THREE.BufferAttribute(p.orb, 4));
    stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false; stars.renderOrder = 1;
    scene.add(stars);
    starMat.uniforms.uSpikes.value = q === 'low' ? 0 : 1;
    wFaint = 300_000 / p.n;
    starMat.uniforms.uW.value = wFaint;
    // the rare bright classes are not importance-weighted, so richer tiers hold more of their light; even it out
    tierGain = q === 'low' ? 1 : q === 'medium' ? 0.62 : 0.45;
    faintBoost = q === 'low' ? 2.6 : q === 'medium' ? 1.25 : 1;
    hazeBoost = q === 'low' ? 3.2 : q === 'medium' ? 1.4 : 1;
  }

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      build(ctx.quality);
    },
    update(frame: FrameState) {
      const z = frame.zoom;
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const h = buf.y > 0 ? buf.y : 1000;
      const cam = frame.camera;
      const tan = Math.tan((cam.fov * Math.PI) / 360);
      const pxScale = h / (2 * tan);
      const dist = cam.position.length();
      // apparent core radius in device px; star light is spread over a footprint that does not shrink
      // with distance, so keep total light proportional to the area the cluster covers
      const rPx = 0.15 * (pxScale / Math.max(dist, 1e-4)) / dpr;
      const area = (rPx / 86) ** 2;
      const gF = THREE.MathUtils.clamp(area, 0.012, 6);
      const gB = THREE.MathUtils.clamp(Math.sqrt(area), 0.5, 2.2);
      const hold = 1 - smooth(z, -0.3, 0.1);

      const u = starMat.uniforms;
      u.uTime.value = frame.time; u.uDpr.value = dpr; u.uCamDist.value = dist;
      u.uGainF.value = gF * 0.4 * tierGain * faintBoost; u.uGainB.value = gB * tierGain; u.uHold.value = hold;

      const hu = hazeMat.uniforms;
      hu.uTan.value = tan; hu.uAspect.value = cam.aspect;
      hu.uGain.value = 0.05 * hazeBoost * (0.12 + 0.88 * smooth(z, -0.45, 0.1)) * (1 - 0.8 * smooth(z, 0.5, 1.4));
    },
    setQuality(q: Quality) { build(q); },
    dispose() {
      if (stars) scene.remove(stars);
      starGeo?.dispose(); triGeo.dispose();
      starMat.dispose(); hazeMat.dispose();
    },
  };
};

export default factory;
