/**
 * Placeholder landmark so the whole zoom works before real scenes land.
 * A softly lit, noise-banded sphere (1 unit across, centred on the origin) with a fresnel rim,
 * a slow wire halo and a shell of dust for parallax. Landmark agents REPLACE their
 * src/landmarks/<id>/index.ts entirely and need not use this file.
 */
import * as THREE from 'three';
import type { FrameState, Landmark, LandmarkMeta, Quality } from '../engine/types';

export interface StubLook { hue: number }

const vert = /* glsl */ `
  varying vec3 vN; varying vec3 vView; varying vec3 vObj;
  void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vN = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }`;

const frag = /* glsl */ `
  uniform vec3 uColA; uniform vec3 uColB; uniform float uTime;
  varying vec3 vN; varying vec3 vView; varying vec3 vObj;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, v = 0.0; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec3 n = normalize(vN); vec3 v = normalize(vView);
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    vec3 L = normalize(vec3(0.6, 0.7, 0.5));
    float diff = smoothstep(-0.25, 1.0, dot(n, L));
    float bands = fbm(vObj * 5.0 + vec3(0.0, uTime * 0.03, 0.0));
    vec3 base = mix(uColA, uColB, smoothstep(0.3, 0.75, bands));
    float rim = pow(1.0 - ndv, 3.0);
    vec3 col = base * (0.06 + 0.55 * diff) + uColB * rim * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createStubLandmark(meta: LandmarkMeta, look: StubLook): Landmark {
  const scene = new THREE.Scene();
  const colA = new THREE.Color().setHSL(look.hue, 0.45, 0.16);
  const colB = new THREE.Color().setHSL((look.hue + 0.06) % 1, 0.7, 0.62);

  const sphereMat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { uColA: { value: colA }, uColB: { value: colB }, uTime: { value: 0 } },
  });
  const sphereGeo = new THREE.IcosahedronGeometry(0.5, 24);
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  scene.add(sphere);

  const haloGeo = new THREE.IcosahedronGeometry(0.62, 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: colB, wireframe: true, transparent: true, opacity: 0.12,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  scene.add(halo);

  const dustTex = softDot();
  const dustMat = new THREE.PointsMaterial({
    color: colB.clone().lerp(new THREE.Color(1, 1, 1), 0.5), size: 0.02, sizeAttenuation: true, map: dustTex,
    transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  let dust: THREE.Points | null = null;
  const buildDust = (q: Quality) => {
    if (dust) { scene.remove(dust); dust.geometry.dispose(); }
    const count = q === 'low' ? 600 : q === 'medium' ? 1500 : 3000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 0.7 + Math.random() ** 2 * 3.5;
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const k = Math.sqrt(1 - u * u);
      pos.set([r * k * Math.cos(t), r * u, r * k * Math.sin(t)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(g, dustMat);
    scene.add(dust);
  };

  return {
    meta,
    scene,
    async init(ctx) { buildDust(ctx.quality); },
    update(frame: FrameState) {
      sphereMat.uniforms.uTime.value = frame.time;
      sphere.rotation.y = frame.time * 0.05;
      halo.rotation.set(frame.time * 0.02, frame.time * 0.03, 0);
      if (dust) dust.rotation.y = -frame.time * 0.01;
    },
    setQuality(q) { buildDust(q); },
    dispose() {
      sphereGeo.dispose(); sphereMat.dispose(); haloGeo.dispose(); haloMat.dispose();
      dust?.geometry.dispose(); dustMat.dispose(); dustTex.dispose();
    },
  };
}

/** Small radial-falloff sprite so points read as soft motes rather than squares. */
function softDot(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
    const a = Math.max(0, 1 - d) ** 2.2;
    data.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(data, n, n);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
