/**
 * Point-sprite particles (ribosomes, proteins, DNA loops, LPS sugar chains).
 * Sprites are shaded as little lit beads (Goodsell-style grain) rather than glows. World-space
 * sizes; sub-pixel points dim instead of shimmering, and huge near-camera points fade.
 * CYTO: particles inside the cell fade into the cytoplasm with depth (analytic capsule).
 */
import * as THREE from 'three';
import { COMMON, PREMUL } from './glsl';
import type { Shared } from './layout';

const vert = /* glsl */ `
${COMMON}
attribute vec3 aColor; attribute float aSize; attribute float aSeed;
uniform float uSizeMul; uniform float uAlpha; uniform float uMaxPx; uniform float uDrift; uniform vec3 uCyto;
uniform float uMinPx; uniform float uCytoMul;
#ifdef SWAY
attribute float aH;
#endif
varying vec3 vCol; varying float vA; varying float vSeed;
void main() {
  vec3 p = position;
  float t = uTime * 0.9 + aSeed * 60.0;
  p += uDrift * aSize * vec3(sin(t) + 0.5 * sin(t * 2.3 + 1.0), sin(t * 1.37 + 2.0) + 0.5 * sin(t * 2.9), sin(t * 0.79 + 4.0) + 0.5 * sin(t * 2.1 + 3.0));
#ifdef SWAY
  // sugar chains sway more towards their free ends
  float s = uTime * 0.6 + aSeed * 7.0;
  p += aH * aH * 22.0 * vec3(sin(s), 0.3 * sin(s * 0.7), cos(s * 1.3));
#endif
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float px = aSize * uSizeMul * uPxScale / max(dist, 1e-7);
  float a = uAlpha;
  if (px < uMinPx) { a *= (px / uMinPx) * (px / uMinPx); px = uMinPx; }
  a /= 1.0 + pow(px / uMaxPx, 4.0);
  vec3 col = aColor;
#ifdef CYTO
  float dep = cytoDepth(p);
  float att = exp(-dep * uCytoK * uCytoMul);
  vec3 rn = p - vec3(clamp(p.x, -CAP_H, CAP_H), 0.0, 0.0);
  float rl = length(rn);
  float lit = dot(rn / max(rl, 1e-5), uLightDir) * 0.5 + 0.5;
  col *= mix(1.0, 0.45 + 0.85 * lit, smoothstep(0.2, 0.9, rl / CAP_R));
  col = mix(uCyto * 1.6, col, att);
  a *= 0.25 + 0.75 * att;
#endif
  float f = fogF(dist);
  a *= 1.0 - f;
  vCol = col; vA = a; vSeed = aSeed;
  gl_PointSize = min(px, 256.0);
  gl_Position = projectionMatrix * mv;
  if (a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const frag = /* glsl */ `
varying vec3 vCol; varying float vA; varying float vSeed;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  // slightly lumpy outline (two subunits for ribosomes, irregular blobs for proteins)
  float ang = atan(q.y, q.x);
  float edge = 1.0 - 0.12 * sin(ang * 3.0 + vSeed * 40.0) - 0.06 * sin(ang * 5.0 + vSeed * 17.0);
  float d2 = dot(q, q) / (edge * edge);
  if (d2 > 1.0) discard;
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - d2)));
  float sh = 0.32 + 0.78 * clamp(dot(n, normalize(vec3(-0.45, 0.6, 0.65))), 0.0, 1.0);
  sh += 0.25 * pow(clamp(dot(n, normalize(vec3(-0.2, 0.35, 1.0))), 0.0, 1.0), 24.0);
  float a = vA * smoothstep(1.0, 0.7, d2);
  gl_FragColor = vec4(vCol * sh * a, a);
}`;

export interface PointsOpts { alpha: number; sizeMul?: number; maxPx?: number; minPx?: number; drift?: number; cyto?: THREE.Color; sway?: boolean; cytoMul?: number }

export function pointsMaterial(shared: Shared, o: PointsOpts) {
  const defines: Record<string, number> = {};
  if (o.cyto) defines.CYTO = 1;
  if (o.sway) defines.SWAY = 1;
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    defines,
    uniforms: {
      ...shared,
      uSizeMul: { value: o.sizeMul ?? 1 }, uAlpha: { value: o.alpha }, uMaxPx: { value: o.maxPx ?? 70 },
      uMinPx: { value: o.minPx ?? 1.5 }, uCytoMul: { value: o.cytoMul ?? 1 }, uDrift: { value: o.drift ?? 0 }, uCyto: { value: o.cyto ?? new THREE.Color() },
    },
    ...PREMUL,
  });
}

export function pointsGeometry(pos: Float32Array, col: Float32Array, size: Float32Array, seed: Float32Array, h?: Float32Array) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  if (h) g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  g.computeBoundingSphere();
  return g;
}
