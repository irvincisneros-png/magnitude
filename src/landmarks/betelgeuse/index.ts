/**
 * Landmark "betelgeuse": the red supergiant, brought next to the Sun to compare sizes.
 * 1 unit = the star's diameter (≈ 1.07e12 m ≈ 7.2 AU); photosphere radius R = 0.5.
 *
 * The star is one full-screen analytic pass (see shaders.ts): a ray–sphere photosphere with a
 * handful of giant convection cells (domain-warped animated Worley noise) plus finer convection that
 * only appears when the camera is close, strong limb darkening, a lumpy limb, a glowing molecular
 * atmosphere with radial filaments, asymmetric plumes, a patchy dust veil (the Great Dimming) and a
 * faint clumpy circumstellar envelope.
 *
 * Placement ('comparison' nesting), camera-anchored like the Sun scene:
 * - zoom ≲ −0.35: the star sits BESIDE the origin (the Sun), its nearest surface point 0.057 units
 *   (≈ 0.4 AU, Mercury's orbit) from the Sun, and its limb looms over one side of the frame while the
 *   Sun and the inner orbits stay against dark space.
 * - zoom −0.35 → +0.28: it glides so that its centre reaches the origin: "if Betelgeuse replaced the
 *   Sun", filling the orbits out to most of the way to Jupiter.
 * The surface keeps a fixed world orientation (slow spin), so orbiting shows other faces.
 */
import * as THREE from 'three';
import type { FrameState, Landmark, LandmarkFactory, LandmarkMeta, Quality } from '../../engine/types';
import { starFrag, starVert, sunFrag, sunVert } from './shaders';

const R = 0.5;
const UNIT_M = 1.07e12;
const AU = 1.495978707e11 / UNIT_M;          // 1 AU ≈ 0.1398 units
const SUN_R = 6.957e8 / UNIT_M;
const RC = R + 0.057;                         // star centre distance from the Sun while side by side
const D2R = Math.PI / 180;
const sm = THREE.MathUtils.smoothstep;

const meta: LandmarkMeta = {
  id: 'betelgeuse',
  name: 'Betelgeuse',
  sizeMeters: 1.07e12,
  range: [10.2, 13.1],
  evidence: 'measured',
  nesting: 'comparison',
  nestingNote:
    'Betelgeuse is really about 550 light-years away, in the constellation Orion. Here it is brought next to the Sun, and then swapped into the Sun’s place, so you can compare their sizes. The Sun and the planets’ orbits are drawn to the same scale.',
  blurb:
    'Betelgeuse is a red supergiant: a dying star 10 to 20 times the Sun’s mass that has swollen to about 770 times the Sun’s width. Some time in the next 100,000 years or so it will explode as a supernova.',
  howWeKnow: {
    instrument: 'Interferometers (such as the VLT Interferometer and ALMA), the Hubble Space Telescope and parallax',
    text:
      'Interferometry combines the light from several telescopes so they act like one giant telescope, sharp enough to see Betelgeuse’s disc. In 1995 Hubble made it the first star after the Sun to have its surface imaged. Its distance comes from parallax, its tiny shift in the sky as Earth orbits the Sun. Width and distance together give its true size, but only to within about 10–20%, because the star pulsates and has no sharp edge.',
  },
  lightTime: 'About an hour to cross the star',
  timescale: 'Its brightness pulses over about 400 days, and giant convection cells churn over months to years. A star this big lives only about 10 million years.',
  post: { bloom: 0.25, exposure: 1 },
  labels: [
    { text: 'Betelgeuse (red supergiant)', position: [0, 0.6, 0] },
    { text: 'Giant convection cells (each bigger than Earth’s orbit)', position: [0, 0, 0], zoomRange: [-1.6, 0.55] },
    { text: 'Dust cloud (the Great Dimming, 2019–20)', position: [0, 0, 0], zoomRange: [-0.5, 0.65] },
    { text: 'Mercury’s orbit would skim the surface', position: [0, 0, 0], zoomRange: [-1.25, -0.5] },
    { text: 'If it replaced the Sun it would swallow Mercury, Venus, Earth and Mars', position: [0, 0, 0], zoomRange: [0.05, 0.8] },
    { text: 'Jupiter’s orbit', position: [0, 0, 0], zoomRange: [0.1, 1.2] },
    { text: 'The Sun, to scale', position: [0, 0, 0], zoomRange: [-1.85, 0.7] },
    { text: '≈ 770 Suns across', position: [0, 0, 0], zoomRange: [-0.2, 0.85] },
  ],
};

// ------------------------------------------------------------------ Jupiter's orbit, same frame as the solar-system scene
function galDir(lDeg: number, bDeg: number): [number, number, number] {
  const l = lDeg * D2R, b = bDeg * D2R;
  return [-Math.cos(b) * Math.cos(l), Math.sin(b), Math.cos(b) * Math.sin(l)];
}
const ORIENT = (() => {
  const nep = new THREE.Vector3(...galDir(96.384, 29.811));
  const align = new THREE.Quaternion().setFromUnitVectors(nep, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 140 * D2R).multiply(align);
})();
const gv = (l: number, b: number) => new THREE.Vector3(...galDir(l, b)).applyQuaternion(ORIENT);
const EX = gv(96.337, -60.1886); EX.y = 0; EX.normalize();
const EY = gv(186.3724, -0.0201); EY.y = 0; EY.normalize();
const EZ = new THREE.Vector3(0, 1, 0);
const JUP = (() => {
  const a = 5.2026, e = 0.04849, inc = 1.303 * D2R, om = 100.464 * D2R, w = (14.331 - 100.464) * D2R;
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k < 128; k++) {
    const E = (k / 128) * Math.PI * 2;
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const x1 = xp * Math.cos(w) - yp * Math.sin(w), y1 = xp * Math.sin(w) + yp * Math.cos(w);
    const y2 = y1 * Math.cos(inc), z2 = y1 * Math.sin(inc);
    const X = x1 * Math.cos(om) - y2 * Math.sin(om), Y = x1 * Math.sin(om) + y2 * Math.cos(om);
    pts.push(new THREE.Vector3().addScaledVector(EX, X * AU).addScaledVector(EY, Y * AU).addScaledVector(EZ, z2 * AU));
  }
  return pts;
})();

function createBetelgeuse(): Landmark {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  let renderer: THREE.WebGLRenderer | null = null;

  // ---- the star: full-screen analytic pass
  const starU = {
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uC: { value: new THREE.Vector3() }, uBody: { value: new THREE.Matrix3() }, uR: { value: R },
    uTime: { value: 0 }, uPix: { value: 0.001 },
    uE3: { value: new THREE.Vector3() }, uDust: { value: new THREE.Vector3(0, 0, 1) }, uDust2: { value: new THREE.Vector3(1, 0, 0) },
    uP1: { value: new THREE.Vector3(1, 0, 0) }, uP2: { value: new THREE.Vector3(0, 1, 0) }, uP3: { value: new THREE.Vector3(0, -1, 0) },
    uClose: { value: 0 }, uDustAmt: { value: 1 }, uEnv: { value: 1 }, uMol: { value: 1 }, uGain: { value: 1 },
  };
  const starMat = track(new THREE.ShaderMaterial({
    vertexShader: starVert, fragmentShader: starFrag, uniforms: starU, defines: { HIGH: 1 },
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  const triGeo = track(new THREE.BufferGeometry());
  triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const star = new THREE.Mesh(triGeo, starMat);
  star.frustumCulled = false; star.renderOrder = 1;
  scene.add(star);

  // ---- the Sun to scale, a marker at the origin (shown once the Sun scene itself has gone)
  const sunU = { uSize: { value: 18 }, uCore: { value: 1 }, uOpacity: { value: 0 } };
  const sunMat = track(new THREE.ShaderMaterial({
    vertexShader: sunVert, fragmentShader: sunFrag, uniforms: sunU,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  const sunGeo = track(new THREE.BufferGeometry());
  sunGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  const sun = new THREE.Points(sunGeo, sunMat);
  sun.frustumCulled = false; sun.renderOrder = 5;
  scene.add(sun);

  // ---- body orientation
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 0, 1).normalize(), 0.35);
  const spin = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), bodyQ = new THREE.Quaternion();
  const bodyM4 = new THREE.Matrix4();

  // ---- per-frame scratch
  const f = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const side = new THREE.Vector3(), C = new THREE.Vector3(), e3 = new THREE.Vector3(), v = new THREE.Vector3(), w = new THREE.Vector3();
  const tmp = new THREE.Vector3(), rd = new THREE.Vector3(), oc = new THREE.Vector3();
  const buf = new THREE.Vector2();

  /** Limb angle from the view axis (towards `side`) for the star centre at angle phi in the (axis, side) plane. */
  const limbAngle = (phi: number, d: number) => {
    const x = RC * Math.cos(phi) + d, y = RC * Math.sin(phi);
    const dc = Math.hypot(x, y);
    if (dc <= R * 1.0005) return -10;
    return Math.atan2(y, x) - Math.asin(R / dc);
  };
  /** Smallest phi whose limb reaches the target angle; if unreachable, the phi with the widest gap. */
  const solvePhi = (d: number, beta: number) => {
    const N = 72;
    let best = Math.PI / 2, bestV = -1e9, prev = 0, prevV = limbAngle(0, d);
    for (let i = 1; i <= N; i++) {
      const p = (i / N) * Math.PI * 0.95;
      const val = limbAngle(p, d);
      if (val > bestV) { bestV = val; best = p; }
      if (prevV < beta && val >= beta) {
        let lo = prev, hi = p;
        for (let k = 0; k < 14; k++) { const m = 0.5 * (lo + hi); if (limbAngle(m, d) >= beta) hi = m; else lo = m; }
        return hi;
      }
      prev = p; prevV = val;
    }
    return best;
  };

  /** Ray-cast from the camera through tan-space screen point (sx, sy); writes the hit (or closest approach) into out. */
  const castAt = (cam: THREE.PerspectiveCamera, sx: number, sy: number, rr: number, out: THREE.Vector3) => {
    rd.copy(fwd).addScaledVector(right, sx).addScaledVector(up, sy).normalize();
    oc.copy(cam.position).sub(C);
    const b = oc.dot(rd), c = oc.lengthSq() - rr * rr, disc = b * b - c;
    const t = disc > 0 ? -b - Math.sqrt(disc) : Math.max(-b, 0);
    return out.copy(cam.position).addScaledVector(rd, Math.max(t, 0));
  };
  const setLabel = (i: number, p: THREE.Vector3) => {
    const L = meta.labels![i].position; L[0] = p.x; L[1] = p.y; L[2] = p.z;
  };

  const applyQuality = (q: Quality) => {
    if (q !== 'low') starMat.defines.HIGH = 1; else delete starMat.defines.HIGH;
    starMat.needsUpdate = true;
  };

  return {
    meta,
    scene,
    async init(ctx) {
      renderer = ctx.renderer;
      applyQuality(ctx.quality);
    },
    update(frame: FrameState) {
      const cam = frame.camera;
      const z = frame.zoom;
      const t = frame.time;
      const d = cam.position.length();
      f.copy(cam.position).normalize();
      fwd.copy(f).negate();
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tx = ty * cam.aspect;

      // Screen direction from the Sun towards the star: left (and a little down) in landscape,
      // diagonal down-left in portrait.
      let dx = -cam.aspect, dy = -0.42;
      const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
      side.copy(right).multiplyScalar(dx).addScaledVector(up, dy).normalize();
      const tEdge = Math.min(tx / Math.abs(dx), ty / Math.abs(dy));
      const beta = Math.atan(Math.max(0.13 * tEdge, 0.075));
      const phi = solvePhi(d, beta);
      const glide = sm(z, -0.35, 0.28);
      C.copy(fwd).multiplyScalar(RC * Math.cos(phi)).addScaledVector(side, RC * Math.sin(phi)).multiplyScalar(1 - glide);

      // Frame around the star as seen from the camera: e3 towards the camera, v towards the Sun on screen.
      e3.copy(cam.position).sub(C).normalize();
      v.copy(side).negate(); v.addScaledVector(e3, -v.dot(e3)).normalize();
      w.crossVectors(e3, v).normalize();
      const dcam = cam.position.distanceTo(C);
      const cap = Math.acos(Math.min(1, R / dcam)); // angular radius of the visible cap (from e3)

      // Dust veil on the disc (lower part, towards the Sun side), and a dusty plume lifting off the limb.
      const a1 = Math.min(0.75 * cap, 0.5);
      tmp.copy(v).multiplyScalar(0.55).addScaledVector(w, -0.83).normalize();
      starU.uDust.value.copy(e3).multiplyScalar(Math.cos(a1)).addScaledVector(tmp, Math.sin(a1)).normalize();
      tmp.copy(v).applyAxisAngle(e3, -0.62);
      starU.uDust2.value.copy(e3).multiplyScalar(Math.cos(cap - 0.06)).addScaledVector(tmp, Math.sin(cap - 0.06)).normalize();
      // Gas plumes, placed around the limb in screen angle (one rises near the Sun side, above it).
      const plumeDir = (ang: number, out: THREE.Vector3) => {
        tmp.copy(v).applyAxisAngle(e3, ang);
        return out.copy(e3).multiplyScalar(Math.cos(cap)).addScaledVector(tmp, Math.sin(cap)).normalize();
      };
      plumeDir(0.42, starU.uP1.value);
      plumeDir(2.6, starU.uP2.value);
      plumeDir(-2.1, starU.uP3.value);

      spin.setFromAxisAngle(yAxis, t * 0.0035 + 0.7);
      bodyQ.copy(tilt).multiply(spin);
      bodyM4.makeRotationFromQuaternion(bodyQ).invert();
      starU.uBody.value.setFromMatrix4(bodyM4);
      starU.uC.value.copy(C);
      starU.uE3.value.copy(e3);
      starU.uTime.value = t;
      starU.uProjInv.value.copy(cam.projectionMatrixInverse);
      starU.uCamWorld.value.copy(cam.matrixWorld);
      let hPx = 800;
      if (renderer) { renderer.getDrawingBufferSize(buf); hPx = buf.y; }
      starU.uPix.value = (2 * ty) / hPx;
      starU.uClose.value = 1 - sm(z, -1.0, -0.2);
      starU.uDustAmt.value = sm(z, -0.9, -0.3);
      starU.uEnv.value = (0.2 + 0.8 * sm(z, -1.2, -0.3)) * (1 - sm(z, 0.3, 1.0));
      starU.uMol.value = (0.45 + 0.55 * sm(z, -1.2, -0.3)) * (1 - 0.55 * sm(z, 0.5, 1.05));

      // Sun marker (true size, minimum ~1 px) once the Sun scene has faded.
      const pxPerUnit = hPx / (2 * ty * d);
      const sunPx = SUN_R * pxPerUnit;
      sunU.uCore.value = Math.max(sunPx, 0.8);
      sunU.uSize.value = Math.max(18, sunPx * 3);
      sunU.uOpacity.value = sm(z, -0.6, -0.25) * (1 - sm(z, 0.55, 0.85));

      // ---- labels
      const rho = Math.tan(Math.asin(Math.min(0.999, R / dcam))); // apparent disc radius (tan space) when centred
      const lerp = THREE.MathUtils.lerp;
      // name: on the wall (zoom-in) → above the disc (centred)
      castAt(cam, lerp(-0.62 * tx, 0, glide), lerp(0.42 * ty, 1.1 * rho, glide), R, tmp); setLabel(0, tmp);
      castAt(cam, lerp(-0.42 * tx, -0.45 * rho, glide), lerp(-0.05 * ty, 0.3 * rho, glide), R, tmp); setLabel(1, tmp);
      tmp.copy(C).addScaledVector(starU.uDust.value, R); setLabel(2, tmp);
      // limb point nearest the Sun on screen
      const tb = Math.tan(beta) + 0.004;
      castAt(cam, dx * tb, dy * tb, R, tmp); setLabel(3, tmp);
      castAt(cam, 0, -1.12 * rho, R, tmp); setLabel(4, tmp);
      // Jupiter's orbit: the ring point furthest right on screen
      let bi = 0, bv = -1e9;
      for (let i = 0; i < JUP.length; i++) { const val = JUP[i].dot(right) - 0.3 * JUP[i].dot(e3); if (val > bv) { bv = val; bi = i; } }
      setLabel(5, JUP[(bi + 6) % JUP.length]);
      castAt(cam, lerp(-0.3 * tx, 0.45 * rho, glide), lerp(-0.55 * ty, -0.4 * rho, glide), R, tmp); setLabel(7, tmp);
    },
    setQuality(q) { applyQuality(q); },
    dispose() {
      for (const x of disposables) x.dispose();
    },
  };
}

const factory: LandmarkFactory = () => createBetelgeuse();
export default factory;
