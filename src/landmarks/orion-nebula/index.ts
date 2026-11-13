/**
 * Orion Nebula (M42) landmark. 1 unit = 2.3e17 m ≈ 24 light-years (the bright nebula's width).
 * The Solar System (the child) sits at the origin, inside the cavity a few light-years from the
 * Trapezium — a size comparison only: the real nebula is about 1,340 light-years away.
 *
 * Structure (model.ts): a blister — a bowl-shaped cavity blown into the face of a dark molecular
 * cloud by the Trapezium stars. Glowing wall puffs and filaments, the Bright Bar, the Dark Bay and
 * dusty fingers in front, M43, an envelope of faint hydrogen, the dark cloud behind, ~700 cluster
 * stars and proplyds. Everything is one instanced sprite batch, sorted far → near whenever the
 * camera moves, with premultiplied blending (gas adds light, dust hides what is behind it).
 */
import * as THREE from 'three';
import type { FrameState, InitContext, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { BAR_C, BAY_MID, M43_C, O_N, ORIENT, PROPLYD_L, STRIDE, TRAPEZIUM, W, buildNebula, toScene } from './model';
import { makeNoiseTexture } from './noise';
import { frag, vert } from './shaders';

const meta: LandmarkMeta = {
  id: 'orion-nebula',
  name: 'Orion Nebula',
  sizeMeters: 2.3e17,
  range: [16.2, 18.5],
  evidence: 'measured',
  nesting: 'comparison',
  nestingNote:
    'Our Solar System is placed inside the nebula only to compare sizes. The real Orion Nebula is about 1,340 light-years away. Our Sun was born in a cloud like this about 4.6 billion years ago.',
  blurb:
    'A stellar nursery: the nearest big star-forming cloud to us, about 1,340 light-years away. You can see it with your naked eye as a fuzzy patch in Orion’s sword — the handle of “the Saucepan” in Australian skies. Here gravity is pulling gas and dust together into new stars.',
  howWeKnow: {
    instrument: 'Hubble and James Webb space telescopes, spectroscopy, radio parallax',
    text:
      'Hubble and JWST have photographed the nebula in fine detail, including hundreds of young stars and the dusty discs around them. Splitting its light into a spectrum shows the exact colours given off by glowing hydrogen and oxygen gas. Radio telescopes measured the tiny yearly shift (parallax) of stars inside it, which gives its distance: about 1,340 light-years. The 3D bowl shape comes from measuring how fast the gas moves towards us. Proplyds are drawn larger than life so you can see them.',
  },
  lightTime: '24 years to cross',
  timescale:
    'The Trapezium stars are less than a million years old. Their light and winds will blow the nebula apart within a few million years.',
  post: { bloom: 0.12, exposure: 1.0 },
  labels: [
    { text: 'Trapezium — four hot young stars that light the nebula', position: toScene(TRAPEZIUM), zoomRange: [-0.75, 0.45] },
    { text: 'Bright Bar', position: toScene(BAR_C), zoomRange: [-0.45, 0.4] },
    { text: 'Dark dust lane', position: toScene(BAY_MID), zoomRange: [-0.3, 0.5] },
    { text: 'Proplyd: a new solar system forming', position: toScene(PROPLYD_L), zoomRange: [-1.25, -0.6] },
    { text: 'M43', position: toScene(M43_C), zoomRange: [-0.35, 0.6] },
    { text: '24 light-years across', position: toScene([0.02, -0.46, W(0.02, -0.46)]), zoomRange: [0.05, 0.95] },
    { text: 'Our Solar System, to scale', position: [0, 0, 0], zoomRange: [-0.55, 0.3] },
  ],
};

const smooth = THREE.MathUtils.smoothstep;
const TIER_F: Record<Quality, number> = { low: 0.27, medium: 0.55, high: 1 };
const TEX_W = 4096;

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.quaternion.copy(ORIENT);
  scene.add(group);

  const noiseTex = makeNoiseTexture(128);
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uData: { value: null as THREE.DataTexture | null },
      uNoise: { value: noiseTex },
      uTime: { value: 0 },
      uTanHalf: { value: Math.tan((45 * Math.PI) / 360) },
      uGain: { value: 1 },
      uDust: { value: 1 },
      uStar: { value: 1 },
      uProp: { value: 1 },
      uSpikes: { value: 1 },
      uDpr: { value: 1 },
      uGroup: { value: new THREE.Vector3(1, 1, 1) },
      uViewport: { value: new THREE.Vector2(1280, 800) },
      uBig: { value: new THREE.Vector2(0.2, 0.5) },
      uT: { value: new THREE.Vector3(-O_N[0], -O_N[1], -O_N[2]) },
      uDustCol: { value: new THREE.Vector3(0.004, 0.002, 0.0016) },
    },
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  let mesh: THREE.Mesh | null = null;
  let geo: THREE.InstancedBufferGeometry | null = null;
  let dataTex: THREE.DataTexture | null = null;
  let idxAttr: THREE.InstancedBufferAttribute | null = null;
  let px = new Float32Array(0), py = new Float32Array(0), pz = new Float32Array(0);
  let count = 0;
  let keys = new Uint16Array(0);
  const BUCKETS = 4096;
  const hist = new Uint32Array(BUCKETS);
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  const camL = new THREE.Vector3();
  const qInv = ORIENT.clone().invert();
  let renderer: THREE.WebGLRenderer | null = null;
  const buf = new THREE.Vector2();

  function clear() {
    if (mesh) group.remove(mesh);
    geo?.dispose(); dataTex?.dispose();
    mesh = null; geo = null; dataTex = null; idxAttr = null;
  }

  function build(q: Quality) {
    clear();
    const b = buildNebula(TIER_F[q]);
    count = b.count;
    const texels = count * 5;
    const h = Math.ceil(texels / TEX_W);
    const arr = new Float32Array(TEX_W * h * 4);
    arr.set(b.data);
    dataTex = new THREE.DataTexture(arr, TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
    dataTex.minFilter = dataTex.magFilter = THREE.NearestFilter;
    dataTex.needsUpdate = true;
    px = new Float32Array(count); py = new Float32Array(count); pz = new Float32Array(count);
    for (let i = 0; i < count; i++) { px[i] = b.data[i * STRIDE]; py[i] = b.data[i * STRIDE + 1]; pz[i] = b.data[i * STRIDE + 2]; }
    keys = new Uint16Array(count);
    const quad = new THREE.PlaneGeometry(2, 2);
    geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    idxAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    idxAttr.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) idxAttr.array[i] = i;
    geo.setAttribute('aIdx', idxAttr);
    geo.instanceCount = count;
    material.uniforms.uData.value = dataTex;
    material.defines = q === 'low' ? {} : { HQ: 1 };
    material.uniforms.uSpikes.value = q === 'low' ? 0 : 1;
    material.needsUpdate = true;
    material.uniforms.uBig.value.set(q === 'low' ? 0.14 : 0.2, q === 'low' ? 0.36 : 0.5);
    mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    group.add(mesh);
    lastCam.set(1e9, 0, 0);
  }

  /** Counting sort on log distance, far → near; only rewrites the index attribute. */
  function sort(cam: THREE.Vector3) {
    if (!idxAttr) return;
    const lo = Math.log(1e-9), span = Math.log(1e4) - lo;
    const k = (BUCKETS - 1) / span;
    hist.fill(0);
    for (let i = 0; i < count; i++) {
      const dx = px[i] - cam.x, dy = py[i] - cam.y, dz = pz[i] - cam.z;
      let b = ((Math.log(dx * dx + dy * dy + dz * dz + 1e-12) - lo) * k) | 0;
      b = b < 0 ? 0 : b >= BUCKETS ? BUCKETS - 1 : b;
      b = BUCKETS - 1 - b; // far first
      keys[i] = b; hist[b]++;
    }
    let sum = 0;
    for (let b = 0; b < BUCKETS; b++) { const c = hist[b]; hist[b] = sum; sum += c; }
    const out = idxAttr.array as Float32Array;
    for (let i = 0; i < count; i++) out[hist[keys[i]]++] = i;
    idxAttr.needsUpdate = true;
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
      const u = material.uniforms;
      u.uTime.value = frame.time;
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      if (renderer) renderer.getDrawingBufferSize(buf);
      if (buf.y > 0) u.uViewport.value.copy(buf);
      u.uDpr.value = dpr;
      u.uTanHalf.value = Math.tan((frame.camera.fov * Math.PI) / 360);
      // zoomed in (inside the cavity), the glow eases in so the Solar System's last views stay readable
      // restrained inside the cavity, full glow from zoom −0.2 on
      u.uGain.value = 1.1 * (0.08 + 0.92 * smooth(z, -1.0, -0.1) ** 2) * (1 + 0.4 * smooth(z, 0.35, 0.9));
      u.uDust.value = 0.55 + 0.45 * smooth(z, -1.1, -0.4);
      u.uStar.value = 0.6 + 0.4 * smooth(z, -1.0, -0.3);
      u.uProp.value = 1 - smooth(z, -0.45, 0.05);
      u.uGroup.value.set(1, 1 - 0.95 * smooth(z, 0.4, 1.05), 1 - smooth(z, -0.4, 0.15));
      // re-sort when the camera has moved noticeably (orbit or zoom)
      camL.copy(frame.camera.position).applyQuaternion(qInv);
      if (camL.distanceTo(lastCam) > camL.length() * 0.004) { sort(camL); lastCam.copy(camL); }
    },
    setQuality(q: Quality) { build(q); },
    dispose() {
      clear();
      material.dispose();
      noiseTex.dispose();
    },
  };
};

export default factory;
