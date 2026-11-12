/**
 * Opaque organelle/protein material: soft subsurface lighting, fresnel rim, procedural bump,
 * depth fog and a dithered near-camera dissolve. Works on plain and instanced meshes.
 * Defines: CRISTAE (mitochondrion inner folds), ACOLOR (per-instance colour attribute aColor),
 * SEED (per-instance float aSeed), BEND (bend along local y by aSeed), FIBRE (striations along uv.x),
 * DNA (double-helix grooves from uv).
 */
import * as THREE from 'three';
import { COMMON, FRAG } from './glsl';
import type { Shared } from './layout';

const vert = /* glsl */ `
${COMMON}
#ifdef ACOLOR
attribute vec3 aColor;
#endif
#ifdef SEED
attribute float aSeed;
#endif
uniform float uBend; uniform float uDrift;
varying vec3 vW; varying vec3 vN; varying vec3 vLoc; varying vec3 vCol; varying float vSeed; varying vec2 vUv;
void main() {
  vec3 p = position; vec3 n = normal;
  float seed = 0.0;
#ifdef SEED
  seed = aSeed;
#endif
#ifdef BEND
  float bk = uBend * (seed - 0.5) * 2.0;
  p.x += bk * (p.y * p.y - 1.0);
  n = normalize(n + vec3(0.0, -2.0 * bk * p.y, 0.0) * n.x);
#endif
  vLoc = p; vSeed = seed; vUv = uv;
  vCol = vec3(1.0);
#ifdef ACOLOR
  vCol = aColor;
#endif
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  if (uDrift > 0.0) {
    float t = uTime * 0.25 + seed * 40.0;
    wp.xyz += uDrift * vec3(sin(t), sin(t * 1.31 + 1.7), sin(t * 0.87 + 4.1));
  }
  vW = wp.xyz;
  mat3 nm = mat3(modelMatrix) * mat3(im);
  vN = normalize(transpose(inverse(nm)) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
${COMMON}
${FRAG}
uniform vec3 uTint; uniform vec3 uRimCol;
uniform float uRimA; uniform float uBumpF; uniform float uBumpS; uniform float uWrap; uniform float uTrans;
uniform float uSpec; uniform float uEmit; uniform float uFade; uniform float uNear; uniform float uClearR;
varying vec3 vW; varying vec3 vN; varying vec3 vLoc; varying vec3 vCol; varying float vSeed; varying vec2 vUv;
void main() {
  vec3 toC = cameraPosition - vW;
  float dist = length(toC);
  vec3 v = toC / dist;
  float nf = smoothstep(uD * uNear * 0.3, uD * uNear, dist) * uFade;
  if (uClearR > 0.0) nf *= smoothstep(uClearR * 0.6, uClearR, length(vW));
  if (ign(gl_FragCoord.xy) > nf) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float h = fbm3(vLoc * uBumpF + vSeed * 13.0);
  vec3 base = uTint * vCol * (0.78 + 0.44 * h);
#ifdef FIBRE
  float str = 0.5 + 0.5 * sin(vUv.y * 6.2831 * 5.0 + vUv.x * 0.0 + h * 3.0);
  h += str * 0.6;
  base *= 0.8 + 0.35 * str;
#endif
#ifdef BEADS
  // nucleosome "beads" along a chromatin fibre (uv.x = arc length in local units; ~20 nm repeat)
  float bead = 0.5 + 0.5 * sin(vUv.x * 9400.0 + sin(vUv.x * 2100.0) * 2.0);
  h = h * 0.5 + bead * 0.6;
  base *= 0.85 + 0.22 * bead;
#endif
#ifdef DNA
  // two sugar-phosphate backbones winding at 3.4 nm per turn, minor groove offset
  float ph = fract(vUv.y - vUv.x / 3.4);
  float b1 = smoothstep(0.16, 0.0, abs(ph - 0.15));
  float b2 = smoothstep(0.16, 0.0, abs(ph - 0.53));
  float ridge = max(b1, b2);
  h = ridge;
  base *= 0.72 + 0.45 * ridge;
#endif
  n = bumpN(n, vW, h * uBumpS);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
#ifdef CRISTAE
  // cristae: irregular inner folds seen through the translucent outer membrane
  float wob = (fbm2o(vLoc * vec3(2.5, 1.2, 2.5) + vSeed * 7.0) - 0.5) * 9.0;
  float cr = sin(vLoc.y * 21.0 + wob + vLoc.x * 3.0);
  float lines = smoothstep(0.55, 0.98, cr) * smoothstep(0.15, 0.6, vnoise(vLoc * 5.0 + vSeed * 3.0));
  lines *= 1.0 - smoothstep(0.25, 0.9, fwidth(vLoc.y * 21.0 + wob));
  float depthK = 0.25 + 0.75 * ndv;
  base *= mix(1.0, 0.62, lines * depthK);
  base += vec3(0.30, 0.12, 0.05) * (1.0 - lines) * ndv * ndv * 0.4;
#endif
  vec3 col = sssLight(base, n, v, uWrap, uTrans, uSpec);
  float fr = pow(1.0 - ndv, 3.0);
  col += uRimCol * fr * uRimA + base * uEmit;
  float f = fogF(dist);
  col = mix(col, uFogCol, f);
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SolidOpts {
  tint: THREE.Color; rim?: THREE.Color; rimA?: number; bumpF?: number; bumpS?: number;
  wrap?: number; trans?: number; spec?: number; emit?: number; near?: number; bend?: number; drift?: number;
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
      uEmit: { value: o.emit ?? 0 }, uFade: { value: 1 }, uNear: { value: o.near ?? 0.25 },
      uBend: { value: o.bend ?? 0 }, uDrift: { value: o.drift ?? 0 }, uClearR: { value: 0 },
    },
    side: o.side ?? THREE.FrontSide,
  });
}
