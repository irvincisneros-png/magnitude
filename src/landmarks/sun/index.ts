/**
 * Landmark "sun": a living star. Procedural photosphere (three scales of convection cells,
 * sunspots with filamentary penumbrae, faculae, wavelength-dependent limb darkening), a
 * hydrogen-alpha chromosphere rim, a streaming K-corona, prominences flowing along twisted
 * magnetic loops, and a to-scale Earth proxy at the origin.
 *
 * Layout ('comparison' nesting): Earth sits at the origin (its centre 0.5 Earth-units below,
 * matching the Earth landmark, whose origin is on Earth's surface). The Sun is kept BEHIND
 * Earth as seen from the orbiting camera, offset so Earth is seen against the disc near the
 * upper-right limb, like a transit. The Sun's own surface keeps a fixed world orientation, so
 * orbiting still shows you different faces of the star.
 */
import * as THREE from 'three';
import type { FrameState, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import {
  beadFrag, coronaFrag, earthFrag, earthVert, glareFrag, photoFrag, photoVert, promFrag, promVert, quadVert,
} from './shaders';

const R = 0.5;
const EARTH_R = 0.5 * (1.27e7 / 1.39e9); // Earth radius in Sun units (Sun diameter = 1)
const NSPOT = 16;

const meta: LandmarkMeta = {
  id: 'sun',
  name: 'Sun',
  sizeMeters: 1.39e9,
  range: [8.6, 11.5],
  evidence: 'measured',
  nesting: 'comparison',
  nestingNote:
    'Earth is drawn to the correct size but placed right next to the Sun so you can compare them. In reality Earth is about 150 million km away, roughly 107 Sun-widths.',
  blurb:
    'The Sun is our star: a glowing ball of hot plasma 1.39 million km across, wide enough to line up 109 Earths. Nuclear fusion in its core turns hydrogen into helium and makes the light we see.',
  howWeKnow: {
    instrument: 'Radar, spacecraft and solar telescopes (such as NASA’s Solar Dynamics Observatory)',
    text:
      'Radar echoes and spacecraft tracking measure the Earth–Sun distance: about 150 million km. The Sun covers about half a degree of our sky, so geometry gives its width. Space telescopes photograph its boiling surface, sunspots and prominences every few seconds.',
  },
  lightTime: 'About 4.6 seconds to cross the Sun (and 8 minutes 20 seconds to reach Earth)',
  timescale: 'Granules boil for about 10 minutes; the Sun spins once in about 25 days; the sunspot cycle lasts about 11 years',
  post: { bloom: 0.22, exposure: 1 },
  labels: [
    { text: 'Earth, to scale', position: [0, 0.004, 0], zoomRange: [-1.6, 0.45] },
    { text: '109 Earths fit across the Sun', position: [0, 0, 0], zoomRange: [-0.35, 0.55] },
    { text: 'Prominence', position: [0, 0, 0], zoomRange: [-1.6, 0.15] },
  ],
};

/** Deterministic PRNG so the star looks the same every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dirFromLatLon = (lat: number, lon: number) =>
  new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));

interface Loop { a: THREE.Vector3; b: THREE.Vector3; height: number; strands: number; per: number; thick: number; bright: number }

/** Build a Points geometry: particles streaming along twisted strands of each magnetic loop. */
function buildLoops(loops: Loop[], scale: number, rand: () => number): THREE.BufferGeometry {
  let total = 0;
  for (const l of loops) total += Math.max(1, Math.round(l.strands * l.per * scale));
  const A = new Float32Array(total * 3), B = new Float32Array(total * 3);
  const P = new Float32Array(total * 4), Q = new Float32Array(total * 4), pos = new Float32Array(total * 3);
  let k = 0;
  for (const l of loops) {
    const n = Math.max(1, Math.round(l.strands * l.per * scale));
    const per = Math.max(1, Math.round(n / l.strands));
    for (let i = 0; i < n; i++) {
      const strand = Math.floor(i / per);
      const sr = rng(strand * 7919 + Math.round(l.a.x * 1e4))();
      A.set([l.a.x, l.a.y, l.a.z], k * 3);
      B.set([l.b.x, l.b.y, l.b.z], k * 3);
      const glow = rand() < 0.12; // a few large soft particles give the loop a halo
      P.set([rand(), (strand / l.strands) * Math.PI * 2 + sr, l.thick * (0.3 + 0.7 * sr) * (glow ? 1.6 : 1), rand()], k * 4);
      Q.set([
        l.height * (0.82 + 0.3 * sr),
        (0.004 + 0.01 * rand()) * (rand() < 0.5 ? 1 : -1),
        glow ? l.thick * 2.2 : 0.0022 * (0.6 + rand()) * (l.thick / 0.004),
        l.bright * (glow ? 0.035 : 0.16 + 0.14 * rand()) / Math.pow(scale, 0.8),
      ], k * 4);
      k++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aA', new THREE.BufferAttribute(A, 3));
  g.setAttribute('aB', new THREE.BufferAttribute(B, 3));
  g.setAttribute('aP', new THREE.BufferAttribute(P, 4));
  g.setAttribute('aQ', new THREE.BufferAttribute(Q, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.0);
  return g;
}

const additive = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
} as const;

const countScale = (q: Quality) => (q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1);

function createSun(): Landmark {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  let renderer: THREE.WebGLRenderer | null = null;

  // ---- sun body (fixed world orientation, slow spin about a slightly tilted axis)
  const body = new THREE.Group();
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(7.25));
  scene.add(body);

  const rand = rng(1391);
  const spots: THREE.Vector4[] = [];
  const groups: { lat: number; lon: number }[] = [];
  for (let gI = 0; gI < 7; gI++) {
    const lat = (rand() < 0.5 ? -1 : 1) * THREE.MathUtils.degToRad(8 + rand() * 24);
    const lon = rand() * Math.PI * 2;
    groups.push({ lat, lon });
    const nIn = 1 + Math.floor(rand() * 3);
    for (let j = 0; j < nIn && spots.length < NSPOT; j++) {
      const d = dirFromLatLon(lat + (rand() - 0.5) * 0.05, lon + (j - nIn / 2) * 0.05 + (rand() - 0.5) * 0.02);
      const size = j === 0 ? 0.012 + rand() * 0.02 : 0.005 + rand() * 0.01;
      spots.push(new THREE.Vector4(d.x, d.y, d.z, size));
    }
  }
  while (spots.length < NSPOT) spots.push(new THREE.Vector4(0, 1, 0, 0));

  const photoMat = track(new THREE.ShaderMaterial({
    vertexShader: photoVert, fragmentShader: photoFrag,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 1.25 }, uSpots: { value: spots } },
    defines: { HIGH: 1 },
    extensions: { derivatives: true } as never,
  }));
  let photoGeo = track(new THREE.SphereGeometry(R, 192, 96));
  const photo = new THREE.Mesh(photoGeo, photoMat);
  body.add(photo);

  // ---- prominences on the body (they rotate with the star)
  const promUniforms = { uTime: { value: 0 }, uPx: { value: 800 }, uCenter: { value: new THREE.Vector3() }, uGain: { value: 1 } };
  const promMat = track(new THREE.ShaderMaterial({
    vertexShader: promVert, fragmentShader: promFrag, uniforms: promUniforms,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  const bodyLoops: Loop[] = [];
  {
    const r = rng(77);
    const lats = [12, -18, 25, -32, 48, -55, 64, -9, 38, -42, 20];
    lats.forEach((latD, i) => {
      const lat = THREE.MathUtils.degToRad(latD + (r() - 0.5) * 6);
      const lon = (i / lats.length) * Math.PI * 2 + r() * 0.4;
      const span = 0.05 + r() * 0.1;
      const ang = r() * Math.PI;
      const c = dirFromLatLon(lat, lon);
      const e = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).cross(c).normalize();
      bodyLoops.push({
        a: c.clone().addScaledVector(e, -span / 2).normalize(),
        b: c.clone().addScaledVector(e, span / 2).normalize(),
        height: 0.02 + r() * 0.05, strands: 6, per: 420, thick: 0.0028 + r() * 0.002, bright: 0.9 + r() * 0.5,
      });
    });
    // active-region loops above some sunspot groups
    groups.slice(0, 4).forEach((g) => {
      const c = dirFromLatLon(g.lat, g.lon);
      const e = new THREE.Vector3(0, 1, 0).cross(c).normalize();
      for (let j = 0; j < 4; j++) {
        const sp = 0.025 + j * 0.012;
        bodyLoops.push({
          a: c.clone().addScaledVector(e, -sp).normalize(), b: c.clone().addScaledVector(e, sp * 0.9).normalize(),
          height: 0.012 + j * 0.006, strands: 2, per: 260, thick: 0.0012, bright: 0.7,
        });
      }
    });
  }

  // ---- hero prominence, kept on the limb beside Earth (camera-anchored frame)
  const heroLoops: Loop[] = [
    { a: new THREE.Vector3(-0.075, 1, -0.02).normalize(), b: new THREE.Vector3(0.06, 1, 0.03).normalize(), height: 0.07, strands: 30, per: 560, thick: 0.0065, bright: 1.0 },
    { a: new THREE.Vector3(-0.03, 1, -0.04).normalize(), b: new THREE.Vector3(0.1, 1, -0.01).normalize(), height: 0.045, strands: 8, per: 700, thick: 0.003, bright: 1.0 },
    { a: new THREE.Vector3(0.09, 1, 0.0).normalize(), b: new THREE.Vector3(0.15, 1, 0.02).normalize(), height: 0.022, strands: 4, per: 400, thick: 0.002, bright: 0.9 },
  ];
  const heroFrame = new THREE.Group();
  scene.add(heroFrame);
  let bodyProm: THREE.Points | null = null;
  let heroProm: THREE.Points | null = null;
  const buildProm = (q: Quality) => {
    const s = countScale(q);
    if (bodyProm) { body.remove(bodyProm); bodyProm.geometry.dispose(); }
    if (heroProm) { heroFrame.remove(heroProm); heroProm.geometry.dispose(); }
    bodyProm = new THREE.Points(buildLoops(bodyLoops, s, rng(5)), promMat);
    heroProm = new THREE.Points(buildLoops(heroLoops, s, rng(9)), promMat);
    bodyProm.frustumCulled = false; heroProm.frustumCulled = false;
    bodyProm.renderOrder = 3; heroProm.renderOrder = 3;
    body.add(bodyProm); heroFrame.add(heroProm);
  };

  // ---- corona + chromosphere: camera-facing quad through the Sun's centre
  const quadGeo = track(new THREE.PlaneGeometry(1, 1));
  const coronaMat = track(new THREE.ShaderMaterial({
    vertexShader: quadVert, fragmentShader: coronaFrag, ...additive,
    uniforms: {
      uCenter: { value: new THREE.Vector3() }, uBodyInv: { value: new THREE.Matrix3() }, uTime: { value: 0 },
      uCorona: { value: 1 }, uChromo: { value: 1 }, uDetail: { value: 1 },
    },
  }));
  const corona = new THREE.Mesh(quadGeo, coronaMat);
  corona.scale.setScalar(6.2);
  corona.renderOrder = 2;
  corona.frustumCulled = false;
  scene.add(corona);

  // ---- glare for the far end (constant angular size)
  const glareMat = track(new THREE.ShaderMaterial({
    vertexShader: quadVert, fragmentShader: glareFrag, ...additive, depthTest: false, uniforms: { uGlare: { value: 0 } },
  }));
  const glare = new THREE.Mesh(quadGeo, glareMat);
  glare.renderOrder = 6;
  glare.frustumCulled = false;
  scene.add(glare);

  // ---- "109 Earths" bead strip across the disc
  const beadMat = track(new THREE.ShaderMaterial({
    vertexShader: quadVert, fragmentShader: beadFrag, transparent: true, premultipliedAlpha: true,
    depthTest: false, depthWrite: false, uniforms: { uOpacity: { value: 0 } },
    extensions: { derivatives: true } as never,
  }));
  const beads = new THREE.Mesh(quadGeo, beadMat);
  beads.renderOrder = 5;
  beads.frustumCulled = false;
  scene.add(beads);

  // ---- Earth proxy at the origin (centre 1 Earth radius below, like the Earth landmark)
  const earthMat = track(new THREE.ShaderMaterial({
    vertexShader: earthVert, fragmentShader: earthFrag,
    uniforms: { uLight: { value: new THREE.Vector3(0, 1, 0) }, uToSun: { value: new THREE.Vector3(0, 0, -1) }, uTime: { value: 0 } },
  }));
  const earthGeo = track(new THREE.SphereGeometry(EARTH_R, 64, 32));
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.position.set(0, -EARTH_R, 0);
  earth.rotation.z = THREE.MathUtils.degToRad(23.4);
  earth.renderOrder = 4;
  scene.add(earth);

  // ---- per-frame scratch
  const C = new THREE.Vector3(), f = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), e3 = new THREE.Vector3(), tmp = new THREE.Vector3();
  const yv = new THREE.Vector3(), zv = new THREE.Vector3();
  const basis = new THREE.Matrix4(), spinQ = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  const buf = new THREE.Vector2();
  const OFF = 0.36;             // Earth's sideways offset from the disc centre (0.72 R)
  const GAP = 0.06;             // depth gap between Earth and the photosphere behind it
  const DEPTH = GAP + Math.sqrt(R * R - OFF * OFF);
  const OX = -0.5, OY = -0.866; // disc centre lies down-left of Earth, so the limb is up-right

  const applyQuality = (q: Quality) => {
    const high = q !== 'low';
    if (high) photoMat.defines.HIGH = 1; else delete photoMat.defines.HIGH;
    photoMat.needsUpdate = true;
    photoGeo.dispose();
    photoGeo = q === 'low' ? new THREE.SphereGeometry(R, 128, 64) : new THREE.SphereGeometry(R, 192, 96);
    photo.geometry = photoGeo;
    coronaMat.uniforms.uDetail.value = high ? 1 : 0.6;
    buildProm(q);
  };

  return {
    meta,
    scene,
    async init(ctx) {
      renderer = ctx.renderer;
      applyQuality(ctx.quality);
    },
    update(frame: FrameState) {
      const t = frame.time;
      const cam = frame.camera;
      const z = frame.zoom;

      // Sun placement: behind Earth along the view, offset down-left in screen space.
      f.copy(cam.position).normalize();
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      C.copy(f).multiplyScalar(-DEPTH).addScaledVector(right, OX * OFF).addScaledVector(up, OY * OFF);
      body.position.copy(C);
      spinQ.setFromAxisAngle(yAxis, t * 0.004 + 1.3);
      body.quaternion.copy(tilt).multiply(spinQ);
      body.updateMatrixWorld();

      photoMat.uniforms.uTime.value = t;
      promUniforms.uTime.value = t;
      promUniforms.uCenter.value.copy(C);
      if (renderer) {
        renderer.getDrawingBufferSize(buf);
        promUniforms.uPx.value = buf.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
      }

      // Hero prominence frame: on the limb nearest Earth, as seen from this camera.
      e3.copy(cam.position).sub(C);
      const dc = e3.length();
      e3.normalize();
      e1.copy(C).negate();
      e1.addScaledVector(e3, -e1.dot(e3)).normalize();
      const k = Math.min(0.999, R / dc);
      tmp.copy(e1).multiplyScalar(Math.sqrt(1 - k * k)).addScaledVector(e3, k).normalize(); // limb normal
      // rotate along the limb a little so the arch stands beside Earth, not behind it
      tmp.applyAxisAngle(e3, -0.13);
      yv.copy(tmp);
      e2.crossVectors(yv, e3).normalize();
      zv.crossVectors(e2, yv).normalize();
      basis.makeBasis(e2, yv, zv);
      heroFrame.position.copy(C);
      heroFrame.quaternion.setFromRotationMatrix(basis);
      // tip it slightly behind the limb so the loop rises into space
      heroFrame.rotateX(-0.06);
      heroFrame.updateMatrixWorld();

      // Corona quad and glare face the camera.
      corona.position.copy(C);
      corona.quaternion.copy(cam.quaternion);
      coronaMat.uniforms.uCenter.value.copy(C);
      coronaMat.uniforms.uBodyInv.value.setFromMatrix4(body.matrixWorld).invert();
      coronaMat.uniforms.uTime.value = t;
      // Corona fades with zoom-out so the solar system takes over; the glare replaces it.
      coronaMat.uniforms.uCorona.value = 1 - THREE.MathUtils.smoothstep(z, 1.0, 2.4);
      coronaMat.uniforms.uChromo.value = 1 - THREE.MathUtils.smoothstep(z, 0.6, 1.6);

      glare.position.copy(C);
      glare.quaternion.copy(cam.quaternion);
      glare.scale.setScalar(cam.position.distanceTo(C) * 0.5);
      glareMat.uniforms.uGlare.value = THREE.MathUtils.smoothstep(z, 0.7, 1.9);
      promUniforms.uGain.value = 1.0 * (1 - THREE.MathUtils.smoothstep(z, 1.2, 2.2));

      // Bead strip: across the apparent diameter, through the disc centre.
      const sil = dc / Math.sqrt(Math.max(1e-6, dc * dc - R * R));
      beads.position.copy(C);
      // face the camera position, so the strip spans the true silhouette cone
      zv.copy(e3); e2.copy(right).addScaledVector(zv, -right.dot(zv)).normalize(); yv.crossVectors(zv, e2);
      basis.makeBasis(e2, yv, zv);
      beads.quaternion.setFromRotationMatrix(basis);
      beads.scale.set(2 * R * sil, (2 * R * sil) / 109, 1);
      beadMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(z, -0.45, -0.15) * (1 - THREE.MathUtils.smoothstep(z, 0.45, 0.8));

      // Earth proxy: three-quarter lit from upper left for legibility, backlit rim from the Sun.
      earthMat.uniforms.uLight.value.copy(f).multiplyScalar(0.7).addScaledVector(right, -0.55).addScaledVector(up, 0.45).normalize();
      earthMat.uniforms.uToSun.value.copy(C).sub(earth.position).normalize();
      earthMat.uniforms.uTime.value = t;
      earth.rotation.y = t * 0.02;

      // Labels that track moving features.
      const L = meta.labels!;
      // on the strip, directly below Earth (keeps the text on screen in portrait too)
      tmp.copy(C).addScaledVector(right, -OX * OFF);
      L[1].position[0] = tmp.x; L[1].position[1] = tmp.y; L[1].position[2] = tmp.z;
      tmp.set(0, R + 0.078, 0).applyMatrix4(heroFrame.matrixWorld);
      L[2].position[0] = tmp.x; L[2].position[1] = tmp.y; L[2].position[2] = tmp.z;
    },
    setQuality(q) { applyQuality(q); },
    dispose() {
      if (bodyProm) bodyProm.geometry.dispose();
      if (heroProm) heroProm.geometry.dispose();
      photoGeo.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

const factory: LandmarkFactory = () => createSun();
export default factory;
