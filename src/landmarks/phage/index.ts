/**
 * Landmark "phage": bacteriophage T4 landed on an E. coli outer membrane (1 unit = 200 nm).
 *
 * Zoom-in end: the camera sits inside the head, where ~57 µm of DNA is spooled in concentric
 * layers 2.5 nm apart. The origin lies on one strand of an outer layer, running along X; the DNA
 * landmark draws that strand, so it is left out here near the origin. A view-aligned cutaway
 * opens the capsid while zoomed in and closes as we pull back.
 * Middle: the whole virus standing on its six kinked tail fibres.
 * Zoom-out end: more phages on the membrane (one has contracted its sheath and is injecting).
 * Medium, motes and membrane fade out so the E. coli scene takes over.
 */
import * as THREE from 'three';
import type { FrameState, InitContext, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { Blobs, LAYER, buildPhage, headPoly, rng, type PhageCfg } from './geom';
import {
  backFrag, backVert, blobFrag, blobVert, memFrag, memVert, moteFrag, moteVert, secFrag, secVert, shellFrag, shellVert, strandFrag, strandVert,
} from './shaders';

const SURF_Y = -0.75;         // the E. coli outer membrane (matches the parent scene)
const MAIN_Z = 0.1;           // head axis offset so the origin sits on an outer DNA layer
const CURV = 1 / (2 * 9.0);   // gentle membrane curvature
const MEM_R = 5;
const HAZE = new THREE.Color(0.01, 0.022, 0.034);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const meta: LandmarkMeta = {
  id: 'phage',
  name: 'Bacteriophage T4',
  sizeMeters: 2e-7,
  range: [-7.9, -5.5],
  evidence: 'measured',
  nesting: 'true',
  blurb:
    'Bacteriophage T4 is a virus that infects bacteria, not people. Viruses are not cells and cannot reproduce on their own: T4 lands on an E. coli cell, punches through its wall and injects its DNA, which takes over the cell to build new viruses.',
  howWeKnow: {
    instrument: 'Electron microscopy and cryo-electron microscopy (cryo-EM)',
    text:
      'Electron microscopes first showed T4’s “lunar lander” shape in the 1950s. Today cryo-EM freezes millions of viruses in thin ice and combines thousands of images into 3D maps detailed enough to see each protein of the head, the striped tail sheath and the baseplate. Cryo-EM also shows the DNA packed inside the head in layers about 2.5 nanometres apart. The colours, the cut-away view and the jiggling are added to help you see; real proteins are colourless.',
  },
  lightTime: 'About 7 × 10⁻¹⁶ seconds for light to travel the length of the virus',
  timescale:
    'T4 injects its DNA in seconds to a few minutes; about 25–30 minutes later the cell bursts open and releases about 100–200 new phages',
  post: { bloom: 0.45, exposure: 1.1 },
  labels: [
    { text: 'Packed DNA (169,000 base pairs)', position: [0.04, 0.035, 0.0], zoomRange: [-1.25, -0.08] },
    { text: 'Capsid head', position: [0.18, 0.29, MAIN_Z], zoomRange: [-0.35, 0.65] },
    { text: 'Tail sheath (contracts like a syringe)', position: [0.05, -0.42, MAIN_Z], zoomRange: [-0.15, 0.65] },
    { text: 'Baseplate', position: [0.13, -0.68, MAIN_Z], zoomRange: [-0.05, 0.6] },
    { text: 'Tail fibres (recognise the bacterium)', position: [0.36, -0.47, MAIN_Z + 0.2], zoomRange: [-0.05, 0.7] },
    { text: '200 nanometres tall', position: [0, 0.44, MAIN_Z], zoomRange: [0.15, 0.95] },
  ],
};

const MAIN_DETAIL: Record<Quality, number> = { low: 3, medium: 4, high: 5 };
const OTHER_DETAIL: Record<Quality, number> = { low: 1, medium: 2, high: 2 };
const MOTES: Record<Quality, number> = { low: 2500, medium: 6000, high: 10000 };
const MAX_MOTES = MOTES.high;

interface Other { cfg: PhageCfg; x: number; z: number; lift: number; yaw: number; tilt: number }
const OTHERS: Other[] = [
  { cfg: { contracted: true, pose: 'landed', seed: 21, cut: false }, x: 1.3, z: -1.2, lift: 0, yaw: 0.7, tilt: 0 },
  { cfg: { contracted: false, pose: 'landed', seed: 33, cut: false }, x: -1.5, z: -0.5, lift: 0, yaw: 1.9, tilt: 0 },
  { cfg: { contracted: false, pose: 'free', seed: 45, cut: false }, x: -0.4, z: -2.4, lift: 0.75, yaw: 0.3, tilt: 0.35 },
  { cfg: { contracted: true, pose: 'landed', seed: 57, cut: false }, x: -2.9, z: 1.7, lift: 0, yaw: 2.6, tilt: 0 },
  { cfg: { contracted: false, pose: 'landed', seed: 69, cut: false }, x: 3.0, z: -2.6, lift: 0, yaw: 4.0, tilt: 0 },
  { cfg: { contracted: false, pose: 'free', seed: 81, cut: false }, x: 2.4, z: 1.5, lift: 1.1, yaw: 1.2, tilt: -0.5 },
];

const surfY = (x: number, z: number) => SURF_Y - (x * x + z * z) * CURV;

const factory: LandmarkFactory = () => {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T) => { disposables.push(o); return o; };
  let renderer: THREE.WebGLRenderer | null = null;
  let quality: Quality = 'high';
  const buf = new THREE.Vector2(1, 800);

  const uTime = { value: 0 };
  const uD = { value: 1 };
  const uHaze = { value: HAZE };
  const uCutDir = { value: new THREE.Vector3(0, 0, 1) };
  const uCutR = { value: 0 };
  const uCutC = { value: new THREE.Vector3() };
  const noCut = { value: 0 };

  const spheres = new Map<number, THREE.IcosahedronGeometry>();
  const sphere = (d: number) => {
    let g = spheres.get(d);
    if (!g) { g = track(new THREE.IcosahedronGeometry(1, d)); spheres.set(d, g); }
    return g;
  };

  const blobMat = (cut: boolean, flexA: number, nearFade: boolean) => track(new THREE.ShaderMaterial({
    vertexShader: blobVert, fragmentShader: blobFrag,
    uniforms: {
      uTime, uD, uHaze, uCutDir, uCutC, uCutR: cut ? uCutR : noCut,
      uJig: { value: 0.0011 }, uLump: { value: 0.07 }, uFlexA: { value: flexA },
      uNearFade: { value: nearFade ? 0.2 : 0 }, uFade: { value: 1 },
    },
  }));

  // instanced blob geometry from a builder; its shape attributes can be swapped for quality
  const instGeo = (B: Blobs, detail: number) => {
    const g = track(new THREE.InstancedBufferGeometry());
    const sg = sphere(detail);
    g.setAttribute('position', sg.getAttribute('position'));
    g.setAttribute('normal', sg.getAttribute('normal'));
    const ia = (a: number[], n: number) => new THREE.InstancedBufferAttribute(new Float32Array(a), n);
    g.setAttribute('aOff', ia(B.off, 3)); g.setAttribute('aQuat', ia(B.quat, 4)); g.setAttribute('aScale', ia(B.scl, 3));
    g.setAttribute('aCol', ia(B.col, 3)); g.setAttribute('aMisc', ia(B.misc, 4)); g.setAttribute('aFlex', ia(B.flex, 2));
    g.instanceCount = B.count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    return g;
  };
  const setDetail = (g: THREE.InstancedBufferGeometry, detail: number) => {
    const sg = sphere(detail);
    g.setAttribute('position', sg.getAttribute('position'));
    g.setAttribute('normal', sg.getAttribute('normal'));
  };

  // shell (capsid floor) geometry, shared by all phages: flat polyhedron faces
  const poly = headPoly();
  const shellGeo = track(new THREE.BufferGeometry());
  {
    const pos: number[] = [], nrm: number[] = [];
    poly.f.forEach((fc, i) => {
      for (const k of fc) { const v = poly.v[k].clone().multiplyScalar(0.995); pos.push(v.x, v.y, v.z); nrm.push(poly.n[i].x, poly.n[i].y, poly.n[i].z); }
    });
    shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    shellGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  }
  const shellMat = (cut: boolean, glow: number) => track(new THREE.ShaderMaterial({
    vertexShader: shellVert, fragmentShader: shellFrag,
    uniforms: { uTime, uD, uHaze, uCutDir, uCutC, uCutR: cut ? uCutR : noCut, uBase: { value: new THREE.Color(0.45, 0.56, 0.82) }, uGlow: { value: glow }, uFade: { value: 1 } },
    side: cut ? THREE.DoubleSide : THREE.FrontSide,
  }));

  // ------------------------------------------------ main phage
  const sway = new THREE.Group();
  scene.add(sway);
  const mainObj = new THREE.Group();
  mainObj.position.set(0, SURF_Y, MAIN_Z);
  sway.add(mainObj);
  const mainB = new Blobs();
  const mainInfo = buildPhage(mainB, { contracted: false, pose: 'landed', seed: 7, cut: true });
  const mainMat = blobMat(true, 0.0025, false);
  let mainGeo: THREE.InstancedBufferGeometry | null = null;
  let mainMesh: THREE.Mesh | null = null;
  const mainShellMat = shellMat(true, 1);
  const mainShell = new THREE.Mesh(shellGeo, mainShellMat);
  mainShell.position.set(0, mainInfo.headY, 0);
  mainObj.add(mainShell);

  // packed genome
  const quad = track(new THREE.PlaneGeometry(2, 2));
  const strandUniforms = (cut: boolean) => ({
    uTime, uD, uHaze, uCutDir, uCutC, uCutR: cut ? uCutR : noCut,
    uRad: { value: 0.005 }, uPx: { value: 900 }, uNearFade: { value: 0.05 }, uGlowK: { value: 0.12 }, uOriginHole: { value: 0.05 }, uAlpha: { value: 1 },
  });
  const premul = {
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  } as const;
  // packed genome: drawn analytically on the cut plane as end-on strands in concentric layers
  const faces: THREE.Vector4[] = poly.f.map((fc, i) => new THREE.Vector4(poly.n[i].x, poly.n[i].y, poly.n[i].z, poly.n[i].dot(poly.v[fc[0]])));
  const secMat = track(new THREE.ShaderMaterial({
    vertexShader: secVert, fragmentShader: secFrag,
    uniforms: {
      uTime, uD, uHaze, uCutDir, uCutC, uCutR, uSize: { value: 0.45 }, uInv: { value: new THREE.Matrix4() },
      uFaces: { value: faces }, uHC: { value: new THREE.Vector3(0, mainInfo.headY, 0) },
      uSpool: { value: new THREE.Vector4(MAIN_Z, Math.PI, -SURF_Y - mainInfo.headY, LAYER) }, uOriginHole: { value: 0.05 },
    },
    side: THREE.DoubleSide,
  }));
  const secMesh = new THREE.Mesh(quad, secMat);
  secMesh.frustumCulled = false;
  secMesh.renderOrder = 2;
  scene.add(secMesh);

  // ------------------------------------------------ the other phages
  const othersGroup = new THREE.Group();
  scene.add(othersGroup);
  const otherMat = blobMat(false, 0.003, false);
  const otherFull = shellMat(false, 0.5);
  const otherEmpty = shellMat(false, 0.0);
  const otherGeos: THREE.InstancedBufferGeometry[] = [];
  const shadows: THREE.Vector4[] = [];
  const L = new THREE.Vector3(-0.5, 0.72, 0.48).normalize();
  const addShadows = (obj: THREE.Object3D, feet: THREE.Vector3[], headY: number) => {
    obj.updateMatrixWorld(true);
    const w = new THREE.Vector3();
    w.set(0, 0.05, 0).applyMatrix4(obj.matrixWorld); shadows.push(new THREE.Vector4(w.x, 0, w.z, 0.11));
    for (const f of feet) { w.copy(f).applyMatrix4(obj.matrixWorld); shadows.push(new THREE.Vector4(w.x, 0, w.z, 0.03)); }
    w.set(0, headY, 0).applyMatrix4(obj.matrixWorld);
    const hgt = w.y - surfY(w.x, w.z);
    shadows.push(new THREE.Vector4(w.x - (L.x / L.y) * hgt, 0, w.z - (L.z / L.y) * hgt, 0.2));
  };
  scene.updateMatrixWorld(true);
  addShadows(mainObj, mainInfo.feet, mainInfo.headY);

  // injected DNA (under the membrane, glimpsed through it)
  const injA: number[] = [], injB: number[] = [], injS: number[] = [], injF: number[] = [];
  const injGroup = new THREE.Group();
  scene.add(injGroup);

  for (const o of OTHERS) {
    const B = new Blobs();
    const info = buildPhage(B, o.cfg);
    const obj = new THREE.Group();
    const y = surfY(o.x, o.z) + o.lift;
    obj.position.set(o.x, y, o.z);
    const nrm = new THREE.Vector3(2 * o.x * CURV, 1, 2 * o.z * CURV).normalize();
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    obj.rotateY(o.yaw);
    if (o.tilt) obj.rotateX(o.tilt);
    const g = instGeo(B, OTHER_DETAIL[quality]);
    otherGeos.push(g);
    const m = new THREE.Mesh(g, otherMat);
    m.frustumCulled = false; m.renderOrder = 1;
    obj.add(m);
    const sh = new THREE.Mesh(shellGeo, o.cfg.contracted ? otherEmpty : otherFull);
    sh.position.set(0, info.headY, 0);
    sh.renderOrder = 1;
    obj.add(sh);
    othersGroup.add(obj);
    if (o.lift === 0) addShadows(obj, info.feet, info.headY);
    if (o.cfg.contracted) {
      obj.updateMatrixWorld(true);
      const r = rng(o.cfg.seed + 5);
      const pts: THREE.Vector3[] = [];
      const p = info.tubeTip.clone();
      const drift = new THREE.Vector3((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);
      for (let i = 0; i < 160; i++) {
        pts.push(p.clone().applyMatrix4(obj.matrixWorld));
        const t = i / 160;
        p.add(new THREE.Vector3(Math.sin(i * 0.21) * 0.004 + drift.x * 0.01, -0.0045 * (1 - t * 0.5), Math.cos(i * 0.17) * 0.004 + drift.z * 0.01));
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        injA.push(pts[i].x, pts[i].y, pts[i].z); injB.push(pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        injS.push(i * 0.005, (i + 1) * 0.005); injF.push(0);
      }
    }
  }
  const injMat = track(new THREE.ShaderMaterial({
    vertexShader: strandVert, fragmentShader: strandFrag, uniforms: { ...strandUniforms(false), uGlowK: { value: 0.6 }, uRad: { value: 0.006 } },
    ...premul, depthWrite: true, side: THREE.DoubleSide,
  }));
  const injGeo = track(new THREE.InstancedBufferGeometry());
  injGeo.index = quad.index;
  injGeo.setAttribute('position', quad.getAttribute('position'));
  injGeo.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(injA), 3));
  injGeo.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(injB), 3));
  injGeo.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(injS), 2));
  injGeo.setAttribute('aFlag', new THREE.InstancedBufferAttribute(new Float32Array(injF), 1));
  injGeo.instanceCount = injF.length;
  injGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const injMesh = new THREE.Mesh(injGeo, injMat);
  injMesh.frustumCulled = false; injMesh.renderOrder = -1;
  injGroup.add(injMesh);

  // ------------------------------------------------ crowding proteins in the medium
  const crowdB = new Blobs();
  {
    const r = rng(1234);
    const tints = [new THREE.Color(0.55, 0.5, 0.7), new THREE.Color(0.4, 0.62, 0.62), new THREE.Color(0.7, 0.52, 0.55), new THREE.Color(0.6, 0.6, 0.5)];
    let made = 0;
    for (let tries = 0; made < 110 && tries < 5000; tries++) {
      const c = new THREE.Vector3((r() - 0.5) * 6, -0.7 + r() * 2.4, (r() - 0.5) * 6);
      if (c.y < surfY(c.x, c.z) + 0.06) continue;
      const ax = Math.hypot(c.x, c.z - MAIN_Z);
      if (ax < 0.75 && c.y < 0.55) continue;
      let clash = false;
      for (const o of OTHERS) if (Math.hypot(c.x - o.x, c.z - o.z) < 0.7 && c.y < surfY(o.x, o.z) + o.lift + 1.4) clash = true;
      if (clash) continue;
      const size = 0.012 + r() * r() * 0.03;
      const tint = tints[Math.floor(r() * tints.length)];
      const parts = 2 + Math.floor(r() * 4);
      const ph = r() * 100;
      for (let k = 0; k < parts; k++) {
        const off = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(size * 1.4);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6));
        const s = size * (0.55 + r() * 0.45);
        crowdB.add(c.clone().add(off), q, [s, s * (0.7 + r() * 0.5), s * (0.7 + r() * 0.4)], tint.clone().multiplyScalar(0.85 + r() * 0.3), r(), 0, 0, 0, ph, 1);
      }
      made++;
    }
  }
  const crowdMat = blobMat(false, 0.03, true);
  crowdMat.uniforms.uLump.value = 0.12;
  let crowdGeo: THREE.InstancedBufferGeometry | null = null;
  let crowdMesh: THREE.Mesh | null = null;

  // ------------------------------------------------ membrane hint
  const memGeo = track(new THREE.PlaneGeometry(MEM_R * 2, MEM_R * 2, 96, 96));
  memGeo.rotateX(-Math.PI / 2);
  const shadowArr: THREE.Vector4[] = [];
  for (let i = 0; i < 32; i++) shadowArr.push(shadows[i] ? shadows[i].clone() : new THREE.Vector4());
  const memMat = track(new THREE.ShaderMaterial({
    vertexShader: memVert, fragmentShader: memFrag,
    uniforms: {
      uTime, uD, uHaze, uCutDir, uCutC, uCutR: noCut, uCurv: { value: CURV }, uY: { value: SURF_Y }, uAlpha: { value: 0.85 }, uR: { value: MEM_R },
      uShadow: { value: shadowArr }, uShadowN: { value: Math.min(32, shadows.length) }, uTint: { value: new THREE.Color(0.22, 0.44, 0.3) }, uHalo: { value: 0 },
    },
    side: THREE.DoubleSide, ...premul, transparent: true, depthWrite: true,
  }));
  const mem = new THREE.Mesh(memGeo, memMat);
  mem.frustumCulled = false; mem.renderOrder = 0;
  scene.add(mem);

  // ------------------------------------------------ medium backdrop + motes
  const backMat = track(new THREE.ShaderMaterial({
    vertexShader: backVert, fragmentShader: backFrag,
    uniforms: { uAlpha: { value: 1 }, uTime, uTanH: { value: Math.tan((22.5 * Math.PI) / 180) }, uAspect: { value: 1.6 }, uCamRot: { value: new THREE.Matrix3() } },
    depthTest: false, depthWrite: false, ...premul,
  }));
  const back = new THREE.Mesh(quad, backMat);
  back.frustumCulled = false; back.renderOrder = -10;
  scene.add(back);

  const moteGeo = track(new THREE.BufferGeometry());
  {
    const seeds = new Float32Array(MAX_MOTES * 4);
    const r = rng(99);
    for (let i = 0; i < seeds.length; i++) seeds[i] = r();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_MOTES * 3), 3));
    moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    moteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  }
  const moteMat = track(new THREE.ShaderMaterial({
    vertexShader: moteVert, fragmentShader: moteFrag,
    uniforms: { uTime, uBox: { value: 2 }, uDpr: { value: 1 }, uInten: { value: 0.5 } },
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  }));
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false; motes.renderOrder = 6;
  scene.add(motes);

  const applyQuality = (q: Quality) => {
    quality = q;
    if (!mainGeo) {
      mainGeo = instGeo(mainB, MAIN_DETAIL[q]);
      mainMesh = new THREE.Mesh(mainGeo, mainMat);
      mainMesh.frustumCulled = false; mainMesh.renderOrder = 1;
      mainObj.add(mainMesh);
      crowdGeo = instGeo(crowdB, 2);
      crowdMesh = new THREE.Mesh(crowdGeo, crowdMat);
      crowdMesh.frustumCulled = false; crowdMesh.renderOrder = 3;
      scene.add(crowdMesh);
    } else setDetail(mainGeo, MAIN_DETAIL[q]);
    for (const g of otherGeos) setDetail(g, OTHER_DETAIL[q]);
    moteGeo.setDrawRange(0, MOTES[q]);
  };

  const camRot = new THREE.Matrix3();

  return {
    meta,
    scene,
    async init(ctx: InitContext) {
      renderer = ctx.renderer;
      applyQuality(ctx.quality);
      ctx.renderer.compile(scene, new THREE.PerspectiveCamera());
    },
    update(frame: FrameState) {
      const { zoom, camera } = frame;
      if (frame.quality !== quality) applyQuality(frame.quality);
      uTime.value = frame.time;
      const d = camera.position.length();
      uD.value = d;
      if (renderer) renderer.getDrawingBufferSize(buf);
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      const px = (buf.y || 800) / (2 * Math.tan((camera.fov * Math.PI) / 360));

      // gentle Brownian sway, pivoting on the origin so the DNA anchor stays put
      const t = frame.time;
      sway.rotation.set(0.005 * Math.sin(t * 0.31) + 0.002 * Math.sin(t * 0.83), 0, 0.005 * Math.sin(t * 0.23 + 1.0) + 0.002 * Math.sin(t * 0.71));

      // cutaway: open while zoomed in, closing as the camera pulls back to see the whole virus
      uCutDir.value.copy(camera.position).normalize();
      const open = 1 - smooth(-0.32, -0.08, zoom);
      uCutR.value = open * 0.17;
      const cutOn = uCutR.value > 0.0005;
      mainMat.side = cutOn ? THREE.DoubleSide : THREE.FrontSide;
      secMesh.visible = cutOn;
      mainObj.updateMatrixWorld();
      secMat.uniforms.uInv.value.copy(mainObj.matrixWorld).invert();
      uCutC.value.set(0, mainInfo.headY, 0).applyMatrix4(mainObj.matrixWorld);
      injMat.uniforms.uPx.value = px;
      mainShellMat.uniforms.uGlow.value = 0.5;

      // the far scene: other phages, medium, membrane
      // the E. coli scene draws its own phages further out, so ours dissolve as it takes over
      const othersA = 1 - smooth(0.36, 0.48, zoom);
      otherMat.uniforms.uFade.value = othersA;
      otherFull.uniforms.uFade.value = othersA;
      otherEmpty.uniforms.uFade.value = othersA;
      othersGroup.visible = zoom > -0.55 && othersA > 0.01;
      injMesh.visible = zoom > -0.4 && othersA > 0.01;
      injMat.uniforms.uAlpha.value = othersA;
      const medium = 1 - smooth(0.2, 0.5, zoom);
      memMat.uniforms.uAlpha.value = 0.85 * (1 - smooth(0.22, 0.5, zoom)) * smooth(-0.9, -0.5, zoom);
      // after the hand-over only a soft contact shadow under the main phage remains
      memMat.uniforms.uHalo.value = smooth(0.2, 0.45, zoom) * (1 - smooth(1.0, 1.4, zoom));
      mem.visible = memMat.uniforms.uAlpha.value > 0.003 || memMat.uniforms.uHalo.value > 0.003;
      backMat.uniforms.uAlpha.value = medium;
      back.visible = medium > 0.003;
      camRot.setFromMatrix4(camera.matrixWorld);
      backMat.uniforms.uCamRot.value.copy(camRot);
      backMat.uniforms.uAspect.value = camera.aspect;
      backMat.uniforms.uTanH.value = Math.tan((camera.fov * Math.PI) / 360);
      moteMat.uniforms.uBox.value = Math.max(0.25, Math.min(8, 2.6 * d));
      moteMat.uniforms.uDpr.value = dpr;
      moteMat.uniforms.uInten.value = 0.5 * medium * smooth(-0.8, -0.4, zoom);
      motes.visible = moteMat.uniforms.uInten.value > 0.004;
      crowdMat.uniforms.uNearFade.value = 0.35 * d;
      crowdMat.uniforms.uFade.value = medium;
      if (crowdMesh) crowdMesh.visible = medium > 0.01 && zoom > -0.6;
    },
    setQuality(q: Quality) { applyQuality(q); },
    dispose() {
      for (const o of disposables) o.dispose();
      renderer = null;
    },
  };
};

export default factory;
