/**
 * Fine grains and dust on the skin around the grain: 20–100 µm specks of quartz silt, dark mineral
 * flecks, shell chips and brown organic dust. Instanced lumpy rocks, displaced in the vertex shader
 * (each instance its own shape), shadowed by the ground-light map.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { LIGHT_GLSL } from './light';
import { ENV_GLSL } from './env';
import { FELDSPAR_AT, HEAVY_AT, QUARTZ_AT, SHELL_AT, rng } from './shape';

const vert = /* glsl */ `
${LIGHT_GLSL}
uniform sampler2D tMap; uniform vec2 uMapMin; uniform vec2 uMapSize;
attribute vec4 aI;  // x, z, size, seed
attribute float aKind;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying float vKind; varying float vVis; varying float vSeed; varying float vSize;
float disp(vec3 d, float seed) {
  return 1.0 + 0.32 * (vnoise3(d * 1.6 + seed * 37.0) - 0.5) * 2.0 + 0.08 * (vnoise3(d * 4.3 + seed * 11.0) - 0.5) * 2.0;
}
void main() {
  vec3 d = normalize(position);
  float seed = aI.w;
  vec3 t1 = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  vec3 t2 = cross(d, t1);
  float e = 0.08;
  vec3 asp = vec3(1.0, 0.55 + 0.3 * fract(seed * 5.1), 0.7 + 0.3 * fract(seed * 3.3));
  if (aKind > 2.5) asp = vec3(1.0, 0.35, 0.8); // flaky organic dust
  vec3 p0 = d * disp(d, seed) * asp;
  vec3 p1 = normalize(d + t1 * e) * disp(normalize(d + t1 * e), seed) * asp;
  vec3 p2 = normalize(d + t2 * e) * disp(normalize(d + t2 * e), seed) * asp;
  vec3 n = normalize(cross(p1 - p0, p2 - p0));
  if (dot(n, d) < 0.0) n = -n;
  float a = seed * 40.0;
  mat3 rot = mat3(cos(a), 0.0, -sin(a), 0.0, 1.0, 0.0, sin(a), 0.0, cos(a));
  float s = aI.z * 0.5;
  vec3 w = rot * p0 * s + vec3(aI.x, s * asp.y * 0.78, aI.y);
  vObj = p0 * 2.0 + seed * 10.0;
  vW = w; vN = rot * n; vKind = aKind; vSeed = seed; vSize = aI.z;
  vec2 uv = (aI.xy - uMapMin) / uMapSize;
  vVis = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 1.0 : textureLod(tMap, uv, 0.0).a;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const frag = /* glsl */ `
${LIGHT_GLSL}
${ENV_GLSL}
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying float vKind; varying float vSeed; varying float vVis; varying float vSize;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float fp = length(cameraPosition - vW) * uPx;
  vec3 N0 = normalize(vN);
  vec3 N = N0;
  float nv = max(dot(N, V), 1e-3);
  float ndl = dot(N, uSun);
  float ao = mix(0.45, 1.0, smoothstep(0.0, vSize * 0.35, vW.y));
  float F = 0.045 + 0.955 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 hv = normalize(uSun + V);
  float nh = max(dot(N, hv), 0.0);
  vec3 col;
  float k = vKind;
  if (k < 0.5) {
    // clear quartz silt: mostly what is behind/below it, brightened and frosted, plus sparkle
    vec3 tr = mix(envDiff(vW, refract(-V, N, 0.65)), (uSkinLd * vVis + uSkinLa) * 1.1, 0.5) * 0.7 + uSunCol * pow(max(dot(-V, uSun), 0.0), 4.0) * 0.25 * vVis;
    vec3 frost = skyIrr(N) * 0.2 + uSunCol * max(ndl, 0.0) * 0.06 * vVis;
    col = (1.0 - F) * (tr + frost) * vec3(1.0, 0.95, 0.88) + F * envDiff(vW, R);
    col += uSunCol * ggx(nh, 0.06) * max(ndl, 0.0) * vVis * 0.05;
  } else {
    vec3 alb = k < 1.5 ? vec3(0.025, 0.022, 0.02) : k < 2.5 ? vec3(0.5, 0.45, 0.38) : vec3(0.2, 0.12, 0.07);
    alb *= 0.8 + 0.4 * fract(vSeed * 13.7);
    float rough = k < 1.5 ? 0.15 : 0.45;
    float F0 = k < 1.5 ? 0.1 : 0.04;
    vec3 diff = vec3(clamp((ndl + 0.25) / 1.25, 0.0, 1.0));
    col = alb * (uSunCol * diff * vVis + skyIrr(N) * 1.3 * ao + uSkinLd * max(-N.y, 0.0) * 0.3);
    float Fh = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, hv), 0.0), 5.0);
    col += uSunCol * Fh * ggx(nh, rough) * max(ndl, 0.0) * vVis / (4.0 * nv + 0.4);
    col += (F0 + (1.0 - F0) * pow(1.0 - nv, 5.0)) * envDiff(vW, R) * 0.6;
  }
  col *= mix(0.7, 1.0, ao);
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const COUNT: Record<Quality, number> = { low: 160, medium: 260, high: 380 };

export class Specks {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry | null = null;
  private base: THREE.IcosahedronGeometry;
  readonly material: THREE.ShaderMaterial;

  constructor(uniforms: Record<string, THREE.IUniform>) {
    this.base = new THREE.IcosahedronGeometry(1, 3);
    this.material = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
  }

  build(q: Quality) {
    const n = COUNT[q];
    const R = rng(4242);
    const I = new Float32Array(n * 4), K = new Float32Array(n);
    const keepOut = [
      { x: QUARTZ_AT.x, z: QUARTZ_AT.z, r: 0.56 }, { x: FELDSPAR_AT.x, z: FELDSPAR_AT.z, r: 0.4 },
      { x: HEAVY_AT.x, z: HEAVY_AT.z, r: 0.24 }, { x: SHELL_AT.x, z: SHELL_AT.z, r: 0.55 },
    ];
    let i = 0, guard = 0;
    while (i < n && guard++ < n * 50) {
      // denser close to the grain and the origin, thinning out to ~3 units
      // the −Z half, round the grain and out towards the neighbours (the ant stands at −X)
      const r = 0.12 + 2.6 * R() ** 1.3;
      const a = Math.PI + R() * Math.PI + (R() - 0.5) * 0.4;
      let x = r * Math.cos(a), z = r * Math.sin(a);
      if (R() < 0.35) { x = QUARTZ_AT.x + (R() - 0.5) * 1.6; z = QUARTZ_AT.z + (R() - 0.5) * 1.3; }
      if (x < -0.3 && Math.abs(z) < 0.5) continue;
      if (z > 0.15) continue;
      // size: 20–100 µm (0.04–0.2 units), mostly small
      const s = 0.04 + 0.14 * R() ** 4;
      if (Math.hypot(x, z) < 0.08 + s * 0.6) continue;
      if (keepOut.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + s * 0.5)) continue;
      const u = R();
      const kind = u < 0.55 ? 0 : u < 0.72 ? 1 : u < 0.85 ? 2 : 3;
      I.set([x, z, s, R()], i * 4);
      K[i] = kind;
      i++;
    }
    const g = new THREE.InstancedBufferGeometry();
    g.index = this.base.index;
    g.setAttribute('position', this.base.getAttribute('position'));
    g.setAttribute('aI', new THREE.InstancedBufferAttribute(I.subarray(0, i * 4), 4));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(K.subarray(0, i), 1));
    g.instanceCount = i;
    this.geo?.dispose();
    this.geo = g;
    this.mesh.geometry = g;
  }

  dispose() {
    this.geo?.dispose();
    this.base.dispose();
    this.material.dispose();
  }
}
