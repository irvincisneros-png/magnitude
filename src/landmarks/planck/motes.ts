/**
 * Flickering "uncertainty" motes: tiny pairs of sparks that appear from nothing, fly apart a
 * little and fall back together, then vanish (an impression of the restless energy of empty
 * space). Spread with a log-radial density around the origin so there are some at every zoom.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';

const vert = /* glsl */ `
  attribute vec4 aSeed;     // xyz direction-ish, w random
  attribute float aSide;    // ±1: which member of the pair
  uniform float uTime; uniform float uPx; uniform float uJit;
  varying float vA; varying vec3 vCol;
  void main() {
    float rate = 0.35 + 0.9 * fract(aSeed.w * 13.1);
    float age = uTime * rate + aSeed.w * 37.0;
    float gen = floor(age);
    float u = age - gen;
    // a new random place each generation
    vec3 h = fract(sin(vec3(gen * 12.9898 + aSeed.w * 78.233, gen * 39.346 + aSeed.x * 11.13, gen * 73.156 + aSeed.y * 51.7)) * 43758.5453);
    float rad = 2.2 * pow(10.0, -2.6 * pow(fract(aSeed.z + h.x * 0.37), 0.8));
    vec3 dir = normalize(vec3(aSeed.x, aSeed.y, aSeed.z * 2.0 - 1.0) + (h - 0.5) * 1.6 + 1e-4);
    vec3 p = dir * rad;
    vec3 sep = normalize(vec3(h.y - 0.5, h.z - 0.5, h.x - 0.5) + 1e-4);
    float life = sin(3.14159265 * u);
    p += sep * aSide * rad * 0.06 * life * (1.0 + uJit);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = uPx * rad * 0.012 / max(-mv.z, 1e-6);
    gl_PointSize = clamp(px, 1.0, 3.2);
    float shrink = smoothstep(0.7, 2.6, px) * (0.25 + 0.75 * smoothstep(0.004, 0.1, rad));          // sub-pixel sparks fade instead of popping
    vA = pow(life, 3.0) * shrink * (0.4 + 0.6 * fract(aSeed.w * 7.7));
    vCol = mix(vec3(0.55, 0.65, 1.0), mix(vec3(1.0, 0.55, 0.85), vec3(0.5, 1.0, 0.9), h.z), 0.45 * h.y);
  }`;

const frag = /* glsl */ `
  uniform float uOpacity;
  varying float vA; varying vec3 vCol;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = exp(-dot(c, c) * 14.0) * vA * uOpacity;
    gl_FragColor = vec4(vCol * a * 0.6, 0.0);
  }`;

export interface Motes {
  group: THREE.Group;
  uniforms: Record<string, THREE.IUniform>;
  setQuality(q: Quality): void;
  dispose(): void;
}

export function createMotes(q: Quality): Motes {
  const group = new THREE.Group();
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 }, uPx: { value: 800 }, uJit: { value: 0.3 }, uOpacity: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  let pts: THREE.Points | null = null;
  const setQuality = (tier: Quality) => {
    if (pts) { group.remove(pts); pts.geometry.dispose(); }
    const pairs = tier === 'low' ? 1000 : tier === 'medium' ? 2500 : 4500;
    const seed = new Float32Array(pairs * 2 * 4);
    const side = new Float32Array(pairs * 2);
    const pos = new Float32Array(pairs * 2 * 3);
    for (let i = 0; i < pairs; i++) {
      const s = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random(), Math.random()];
      for (let e = 0; e < 2; e++) {
        seed.set(s, (i * 2 + e) * 4);
        side[i * 2 + e] = e ? 1 : -1;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 20;
    group.add(pts);
  };
  setQuality(q);
  return {
    group, uniforms, setQuality,
    dispose() { pts?.geometry.dispose(); mat.dispose(); },
  };
}
