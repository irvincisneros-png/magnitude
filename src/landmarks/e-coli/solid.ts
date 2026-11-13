/**
 * Opaque protein-surface material (flagella, pili, phages, membrane proteins): soft subsurface
 * lighting, fresnel rim, procedural bump, depth fog and a dithered fade/near-camera dissolve.
 * Defines: SEED (per-vertex or per-instance float aSeed), SWAY (pili wave about their base;
 * uses uv.x = arc length and aLen), FIBRE (helical subunit striations along uv), ACOLOR.
 */
import * as THREE from 'three';
import { COMMON, FRAG } from './glsl';
import type { Shared } from './layout';

const vert = /* glsl */ `
${COMMON}
#ifdef SEED
attribute float aSeed;
#endif
#ifdef SWAY
attribute float aLen;
#endif
#ifdef ACOLOR
attribute vec3 aColor;
#endif
uniform float uSway;
varying vec3 vW; varying vec3 vN; varying vec3 vLoc; varying float vSeed; varying vec2 vUv; varying vec3 vCol;
void main() {
  vec3 p = position; vec3 n = normal;
  float seed = 0.0;
#ifdef SEED
  seed = aSeed;
#endif
  vCol = vec3(1.0);
#ifdef ACOLOR
  vCol = aColor;
#endif
#ifdef SWAY
  float k = uv.x / max(aLen, 1e-5);
  float t = uTime * (0.7 + seed * 0.6) + seed * 31.0;
  vec3 dir = vec3(sin(t) + 0.4 * sin(t * 2.7 + uv.x * 40.0), 0.3 * sin(t * 1.3), cos(t * 0.8 + 1.0) + 0.4 * sin(t * 2.1));
  p += dir * k * k * aLen * uSway;
#endif
  vLoc = p; vSeed = seed; vUv = uv;
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vW = wp.xyz;
  mat3 nm = mat3(modelMatrix) * mat3(im);
  vN = normalize(nm * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
${COMMON}
${FRAG}
uniform vec3 uTint; uniform vec3 uRimCol;
uniform float uRimA; uniform float uBumpF; uniform float uBumpS; uniform float uWrap; uniform float uTrans;
uniform float uSpec; uniform float uFade; uniform float uNear;
varying vec3 vW; varying vec3 vN; varying vec3 vLoc; varying float vSeed; varying vec2 vUv; varying vec3 vCol;
void main() {
  vec3 toC = cameraPosition - vW;
  float dist = length(toC);
  vec3 v = toC / dist;
  float nf = smoothstep(uD * uNear * 0.3, uD * uNear, dist) * uFade;
  if (ign(gl_FragCoord.xy) > nf) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float h = fbm3(vLoc * uBumpF + vSeed * 13.0);
  vec3 base = uTint * vCol * (0.8 + 0.4 * h);
#ifdef FIBRE
  // flagellin / pilin subunits packed in a helical lattice
  float ph = vUv.y * 6.2831 * 5.0 + vUv.x * 2200.0;
  float st = 0.5 + 0.5 * sin(ph);
  float ring = 0.5 + 0.5 * sin(vUv.x * 2600.0 - vUv.y * 6.2831);
  float lod = 1.0 - smoothstep(0.4, 1.6, fwidth(ph));
  h = mix(h, st * ring, 0.7 * lod);
  base *= 1.0 + (st * ring - 0.4) * 0.35 * lod;
#endif
  n = bumpN(n, vW, h * uBumpS);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  vec3 col = sssLight(base, n, v, uWrap, uTrans, uSpec);
  col += uRimCol * pow(1.0 - ndv, 3.0) * uRimA;
  col = mix(col, uFogCol, fogF(dist));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SolidOpts {
  tint: THREE.Color; rim?: THREE.Color; rimA?: number; bumpF?: number; bumpS?: number;
  wrap?: number; trans?: number; spec?: number; near?: number; sway?: number;
  defines?: Record<string, string | number | boolean>; side?: THREE.Side;
}

export function solidMaterial(shared: Shared, o: SolidOpts) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    defines: o.defines ?? {},
    uniforms: {
      ...shared,
      uTint: { value: o.tint }, uRimCol: { value: o.rim ?? o.tint.clone().multiplyScalar(1.4) },
      uRimA: { value: o.rimA ?? 0.5 }, uBumpF: { value: o.bumpF ?? 8 }, uBumpS: { value: o.bumpS ?? 0 },
      uWrap: { value: o.wrap ?? 0.6 }, uTrans: { value: o.trans ?? 0.5 }, uSpec: { value: o.spec ?? 0.3 },
      uFade: { value: 1 }, uNear: { value: o.near ?? 0.05 }, uSway: { value: o.sway ?? 0 },
    },
    side: o.side ?? THREE.FrontSide,
  });
}
