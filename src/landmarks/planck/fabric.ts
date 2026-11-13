/**
 * The "fabric of space": a 3D lattice of fine lines (the textbook space-time grid), drawn at
 * three self-similar sizes. In the vertex shader every line is
 * - puckered into small dimples,
 * - tugged by a slow, large warp,
 * - and shaken by fine uncertainty jitter that grows as you dive deeper.
 * Lines fade near the camera, far away and outside the froth, so no hard edges show.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON } from './glsl';

const LINES = 13;      // lines per axis per direction
const SPAN = 3.0;      // half-size of one lattice (local units at scale 1)

const vert = /* glsl */ `
  uniform float uScale; uniform float uTime; uniform float uJit; uniform vec3 uCam;
  attribute float aAlong;
  varying float vA; varying float vTone;

  ${COMMON}

  void main() {
    vec3 p = position * uScale;
    // large slow tug
    p += 0.20 * uScale * sin(p.yzx * (0.9 / uScale) + uTime * vec3(0.31, 0.27, 0.23));
    p += 0.07 * uScale * sin(p.zxy * (2.3 / uScale) - uTime * vec3(0.19, 0.29, 0.21));
    // a soft pull towards the centre, like the textbook 'well' in the fabric of space
    float rr = length(p) / uScale;
    p *= 1.0 - 0.28 * exp(-rr * rr * 0.6);
    // puckers: the grid is pulled into small dimples, like space being tugged locally
    vec3 pk = sin(p * (5.3 / uScale) + uTime * vec3(0.5, 0.37, 0.43));
    p += 0.035 * uScale * pk.yzx * pk.zxy;
    // uncertainty jitter: a fine shake that re-rolls many times a second
    float tick = floor(uTime * 14.0);
    vec3 jv = hash33(floor(position * 7.0) + tick) - 0.5;
    p += jv * uScale * 0.012 * uJit;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = length(p - uCam);
    float near = smoothstep(0.03 * uScale, 0.35 * uScale, dist);
    float far = 1.0 - smoothstep(1.2 * uScale, 3.2 * uScale, dist);
    float edge = 1.0 - smoothstep(0.45, 1.0, length(position) / ${SPAN.toFixed(1)});
    float pulse = 0.75 + 0.25 * sin(aAlong * 9.0 - uTime * 1.3 + position.x * 2.0);
    vA = near * far * edge * pulse;
    vTone = 0.5 + 0.5 * sin(position.y * 1.7 + position.z * 1.1 + uTime * 0.2);
  }`;

const frag = /* glsl */ `
  uniform float uOpacity;
  varying float vA; varying float vTone;
  void main() {
    vec3 col = mix(vec3(0.30, 0.26, 0.85), vec3(0.62, 0.78, 1.0), vTone);
    float a = vA * uOpacity;
    gl_FragColor = vec4(col * a, 0.0);
  }`;

function buildLattice(segs: number): THREE.BufferGeometry {
  const lineCount = LINES * LINES * 3;
  const verts = lineCount * segs * 2;
  const pos = new Float32Array(verts * 3);
  const along = new Float32Array(verts);
  let o = 0;
  const step = (2 * SPAN) / (LINES - 1);
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < LINES; i++) for (let j = 0; j < LINES; j++) {
      const a = -SPAN + i * step, b = -SPAN + j * step;
      for (let k = 0; k < segs; k++) {
        for (let e = 0; e < 2; e++) {
          const t = -SPAN + ((k + e) / segs) * 2 * SPAN;
          const v = axis === 0 ? [t, a, b] : axis === 1 ? [a, t, b] : [a, b, t];
          pos.set(v, o * 3);
          along[o] = t;
          o++;
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  return g;
}

export interface Fabric {
  group: THREE.Group;
  /** sizes of the three lattices (spacing = 0.5 · scale) */
  scales: number[];
  mats: THREE.ShaderMaterial[];
  setQuality(q: Quality): void;
  dispose(): void;
}

export function createFabric(q: Quality): Fabric {
  const group = new THREE.Group();
  const scales = [0.25, 1, 4];
  const shared = { uTime: { value: 0 }, uJit: { value: 0.3 }, uCam: { value: new THREE.Vector3() } };
  const mats = scales.map((s) => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: { ...shared, uScale: { value: s }, uOpacity: { value: 0 } },
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  let geo: THREE.BufferGeometry | null = null;
  const lines: THREE.LineSegments[] = [];
  const setQuality = (tier: Quality) => {
    lines.forEach((l) => group.remove(l));
    lines.length = 0;
    geo?.dispose();
    geo = buildLattice(tier === 'low' ? 28 : tier === 'medium' ? 44 : 64);
    mats.forEach((m) => {
      const l = new THREE.LineSegments(geo!, m);
      l.frustumCulled = false;
      l.renderOrder = 0;
      lines.push(l);
      group.add(l);
    });
  };
  setQuality(q);
  return {
    group, scales, mats, setQuality,
    dispose() { geo?.dispose(); mats.forEach((m) => m.dispose()); },
  };
}
