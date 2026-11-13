/**
 * The watery world around the bacterium: a dim, softly mottled medium (drawn first, full screen),
 * neighbouring bacteria far out of focus (a couple caught mid-division, pinching at the septum),
 * and drifting motes. All of it fades away at the zoom-out end so the parent scene shows through.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { ADD, COMMON, PREMUL } from './glsl';
import { PAL, type Shared } from './layout';
import { Bin, randDir, rng } from './util';

const MOTES = { low: 500, medium: 900, high: 1400 };

const bgVert = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const bgFrag = /* glsl */ `
${COMMON}
uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uLo; uniform vec3 uHi; uniform float uA;
varying vec2 vNdc;
void main() {
  vec4 hv = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (hv.xyz / hv.w));
  float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  float m = fbm2o(rd * 2.2 + vec3(0.0, uTime * 0.01, uTime * 0.006));
  float m2 = vnoise(rd * 6.0 - vec3(uTime * 0.015));
  // faint light from above, scattered through the water
  float glow = pow(clamp(dot(rd, uLightDir), 0.0, 1.0), 6.0);
  vec3 col = mix(uLo, uHi, up * up) * (0.7 + 0.6 * m + 0.15 * m2) + uHi * glow * 0.6;
  gl_FragColor = vec4(col * uA, uA);
}`;

const nbVert = /* glsl */ `
${COMMON}
attribute vec3 aC; attribute vec3 aAxis; attribute vec4 aShape; // halfLen, radius, pinch, seed
uniform float uBlur;
varying vec2 vXY; varying vec2 vAx; varying vec4 vShape; varying float vBlur; varying float vDist;
void main() {
  vec3 cv = (viewMatrix * vec4(aC, 1.0)).xyz;
  vec3 av = mat3(viewMatrix) * aAxis;
  float dist = -cv.z;
  // defocus grows with distance from the focal plane (the hero)
  float blur = aShape.y * (0.35 + uBlur * clamp(abs(dist - uD) / max(uD, 1.0), 0.0, 3.0));
  vec2 ax = av.xy * aShape.x;
  float ext = length(ax) + aShape.y + blur * 2.0;
  vec2 xy = position.xy * ext;
  vXY = xy; vAx = ax; vShape = aShape; vBlur = blur; vDist = dist;
  gl_Position = projectionMatrix * vec4(cv + vec3(xy, 0.0), 1.0);
}`;
const nbFrag = /* glsl */ `
${COMMON}
uniform vec3 uMem; uniform vec3 uRim; uniform vec3 uCyto; uniform float uA;
varying vec2 vXY; varying vec2 vAx; varying vec4 vShape; varying float vBlur; varying float vDist;
void main() {
  float L2 = max(dot(vAx, vAx), 1e-8);
  float t = clamp(dot(vXY, vAx) / L2, -1.0, 1.0);
  vec2 cp = vAx * t;
  float d = length(vXY - cp);
  float r = vShape.y * (1.0 - vShape.z * exp(-t * t / 0.012));
  // round caps: shrink radius near the ends of the segment
  float sdf = d - r;
  float a = smoothstep(vBlur, -vBlur, sdf);
  if (a < 0.003) discard;
  float across = clamp(d / max(r, 1e-5), 0.0, 1.0);
  float m = fbm2o(vec3(vXY / vShape.y * 1.5, vShape.w * 20.0 + uTime * 0.05));
  vec3 col = uCyto * (1.0 + 1.0 * m) + uMem * 0.18 + uRim * pow(across, 4.0) * 0.18;
  // nucleoid glow in the middle of each lobe
  col += vec3(0.5, 0.4, 0.22) * 0.12 * (1.0 - across) * smoothstep(0.2, 0.7, m);
  col = mix(col, uFogCol * 2.0, clamp(fogF(vDist) * 1.5, 0.0, 0.85));
  a *= uA * 0.85;
  gl_FragColor = vec4(col * a, a);
}`;

const moteVert = /* glsl */ `
${COMMON}
attribute float aSize; attribute float aSeed;
uniform float uA;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * 0.07 + aSeed * 40.0;
  p += aSize * 6.0 * vec3(sin(t), sin(t * 1.3 + 1.0), cos(t * 0.8));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float px = aSize * uPxScale / max(dist, 1e-6);
  float a = uA * (0.25 + 0.75 * fract(aSeed * 7.3));
  if (px < 1.5) { a *= (px / 1.5) * (px / 1.5); px = 1.5; }
  a *= smoothstep(uD * 0.05, uD * 0.4, dist);
  a /= 1.0 + (px / 40.0) * (px / 40.0);
  vA = a;
  gl_PointSize = min(px * 3.0, 160.0);
  gl_Position = projectionMatrix * mv;
  if (a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const moteFrag = /* glsl */ `
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float g = exp(-d2 * 9.0);
  gl_FragColor = vec4(vec3(0.45, 0.75, 0.7) * g * vA, 0.0);
}`;

export class Medium {
  readonly bg: THREE.Mesh;
  readonly neighbours: THREE.Mesh;
  private motes?: THREE.Points;
  readonly group = new THREE.Group();
  private bgMat: THREE.ShaderMaterial;
  private nbMat: THREE.ShaderMaterial;
  private moteMat: THREE.ShaderMaterial;
  private bin = new Bin();
  private qbin = new Bin();

  constructor(shared: Shared) {
    this.bgMat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: bgVert, fragmentShader: bgFrag,
      uniforms: {
        ...shared, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uLo: { value: PAL.medium.clone() }, uHi: { value: PAL.mediumHi.clone() }, uA: { value: 1 },
      },
      depthTest: false, depthWrite: false, transparent: false,
    }));
    this.bg = new THREE.Mesh(this.bin.add(new THREE.PlaneGeometry(2, 2)), this.bgMat);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -100;

    // neighbours
    const r = rng(41);
    const N = 11;
    const base = new THREE.PlaneGeometry(2, 2);
    const g = this.bin.add(new THREE.InstancedBufferGeometry());
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    const C = new Float32Array(N * 3), A = new Float32Array(N * 3), S = new Float32Array(N * 4);
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      randDir(r, v);
      v.y *= 0.6;
      v.normalize().multiplyScalar(2.6 + r() * 6.5);
      C.set([v.x, v.y - 0.3, v.z], i * 3);
      randDir(r, v);
      A.set([v.x, v.y, v.z], i * 3);
      const div = i % 4 === 1;
      const len = div ? 0.62 + r() * 0.1 : 0.32 + r() * 0.16;
      S.set([len - 0.19, 0.17 + r() * 0.04, div ? 0.55 + r() * 0.25 : 0, r()], i * 4);
    }
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 3));
    g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(A, 3));
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(S, 4));
    g.instanceCount = N;
    this.nbMat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: nbVert, fragmentShader: nbFrag, ...PREMUL, depthTest: true,
      uniforms: {
        ...shared, uBlur: { value: 0.5 }, uA: { value: 1 },
        uMem: { value: PAL.membrane.clone() }, uRim: { value: PAL.membraneRim.clone() }, uCyto: { value: PAL.cytosol.clone() },
      },
    }));
    this.neighbours = new THREE.Mesh(g, this.nbMat);
    this.neighbours.frustumCulled = false;
    this.neighbours.renderOrder = -90;

    this.moteMat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: moteVert, fragmentShader: moteFrag, ...ADD, depthTest: true,
      uniforms: { ...shared, uA: { value: 0.5 } },
    }));
    this.group.add(this.bg, this.neighbours);
  }

  build(q: Quality) {
    this.qbin.dispose();
    if (this.motes) this.group.remove(this.motes);
    const n = MOTES[q];
    const r = rng(17);
    const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const rad = 0.06 * 10 ** (r() * 2.3);
      randDir(r, v).multiplyScalar(rad);
      pos.set([v.x, v.y, v.z], i * 3);
      size[i] = rad * (0.002 + r() * r() * 0.006);
      seed[i] = r();
    }
    const g = this.qbin.add(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = -80;
    this.group.add(this.motes);
  }

  update(cam: THREE.PerspectiveCamera, mediumA: number, nbA: number) {
    const u = this.bgMat.uniforms;
    u.uInvProj.value = cam.projectionMatrixInverse;
    u.uCamWorld.value = cam.matrixWorld;
    u.uA.value = mediumA;
    this.bg.visible = mediumA > 0.002;
    this.nbMat.uniforms.uA.value = nbA;
    this.neighbours.visible = nbA > 0.002;
    this.moteMat.uniforms.uA.value = 0.35 * mediumA;
    if (this.motes) this.motes.visible = mediumA > 0.002;
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
