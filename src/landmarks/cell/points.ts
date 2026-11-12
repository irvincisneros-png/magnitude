/**
 * Soft additive point sprites (chromatin domains, cytoplasmic particles, nucleoplasm proteins).
 * World-space sizes; sub-pixel points dim rather than shimmer, and points that grow huge near the
 * camera fade out, so they never become big blurry discs.
 */
import * as THREE from 'three';
import { COMMON } from './glsl';
import type { Shared } from './layout';

const vert = /* glsl */ `
${COMMON}
attribute vec3 aColor; attribute float aSize; attribute float aSeed;
uniform float uSizeMul; uniform float uAlpha; uniform float uMaxPx; uniform float uDrift;
uniform float uInnerR; uniform float uInnerFade; uniform float uFogMul;
varying vec3 vCol; varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * 0.35 + aSeed * 50.0;
  p += uDrift * aSize * vec3(sin(t), sin(t * 1.37 + 2.0), sin(t * 0.79 + 4.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float px = aSize * uSizeMul * uPxScale / max(dist, 1e-7);
  float a = uAlpha;
  if (px < 1.6) { a *= (px / 1.6) * (px / 1.6); px = 1.6; }
  a /= 1.0 + (px / uMaxPx) * (px / uMaxPx);
  float r = length(position);
  a *= mix(1.0, smoothstep(uInnerR * 0.6, uInnerR, r), uInnerFade);
  float f = fogF(dist) * uFogMul;
  a *= 1.0 - f;
  vCol = aColor;
  vA = a;
  gl_PointSize = min(px, 220.0);
  gl_Position = projectionMatrix * mv;
  if (a < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const frag = /* glsl */ `
varying vec3 vCol; varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float g = exp(-d2 * 3.2) - 0.04;
  gl_FragColor = vec4(vCol * g * vA, 0.0);
}`;

export interface PointsOpts { sizeMul?: number; alpha: number; maxPx?: number; drift?: number; innerR?: number }

export function pointsMaterial(shared: Shared, o: PointsOpts) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      ...shared,
      uSizeMul: { value: o.sizeMul ?? 1 }, uAlpha: { value: o.alpha }, uMaxPx: { value: o.maxPx ?? 40 },
      uDrift: { value: o.drift ?? 0 }, uInnerR: { value: o.innerR ?? 0 }, uInnerFade: { value: 0 },
      uFogMul: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
}

export function pointsGeometry(pos: Float32Array, col: Float32Array, size: Float32Array, seed: Float32Array) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.computeBoundingSphere();
  return g;
}
