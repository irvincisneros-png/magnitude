/**
 * Geometry of the hero keratinocyte in local units (1 unit = 30 µm). The origin (where the DNA
 * landmark sits) is inside the nucleus, about a fifth of the way out from its centre.
 */
import * as THREE from 'three';
import { noise3 } from './util';

/** One nanometre in local units. */
export const NM = 1 / 30000;

export const CELL_C = new THREE.Vector3(-0.02, 0.01, 0.02);
/** Ellipsoid radii of the cell before the polyhedral (Kelvin-cell) shaping. ~30 × 26 × 29 µm. */
export const CELL_R = new THREE.Vector3(0.5, 0.43, 0.485);
export const NUC_C = new THREE.Vector3(0.025, -0.012, -0.018);
/** Nucleus ~10 × 8.5 × 9.5 µm. */
export const NUC_R = new THREE.Vector3(0.165, 0.142, 0.158);
export const NUCLEOLUS_C = new THREE.Vector3(-0.04, 0.035, 0.02);
export const NUCLEOLUS_R = 0.032;
/** Golgi stack beside the nucleus; axis points away from it. */
export const GOLGI_C = new THREE.Vector3(0.225, -0.06, 0.07);

/** Rotation applied to the Kelvin polyhedron so its faces are not axis aligned. */
const KQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0.31, -0.18));
const DIAG = 1 / Math.sqrt(3);
const KN: [number, number, number, number][] = [
  [1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 0, 1], [0, -1, 0, 1], [0, 0, 1, 1], [0, 0, -1, 1],
];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) KN.push([sx * DIAG, sy * DIAG, sz * DIAG, 0.866]);

const tv = new THREE.Vector3();
/** Soft truncated octahedron (the space-filling "Kelvin cell"): radius factor along unit dir, mean ≈ 1. */
export function kelvin(x: number, y: number, z: number, p = 7, q: THREE.Quaternion = KQ) {
  tv.set(x, y, z).applyQuaternion(q);
  let s = 0;
  for (const [a, b, c, d] of KN) {
    const k = Math.max(0, (tv.x * a + tv.y * b + tv.z * c) / d);
    s += k ** p;
  }
  return 1 / (s ** (1 / p)) / 0.915;
}

/** Hero membrane radius factor along a unit direction in ellipsoid space. */
export function cellShape(x: number, y: number, z: number) {
  const n = noise3(x * 1.9 + 4.1, y * 1.9 + 0.3, z * 1.9 - 2.2) - 0.5;
  const n2 = noise3(x * 4.3 - 1.0, y * 4.3 + 7.0, z * 4.3 + 2.0) - 0.5;
  return kelvin(x, y, z) * (1 + 0.075 * n + 0.025 * n2);
}
/** Nucleus radius factor along a unit direction. */
export function nucShape(x: number, y: number, z: number) {
  const n = noise3(x * 1.6 + 11.0, y * 1.6 - 3.0, z * 1.6 + 5.0) - 0.5;
  return 1 + 0.07 * n;
}

const q = new THREE.Vector3();
/** Normalised radius of point p relative to the hero membrane (< 1 inside). */
export function cellRho(p: THREE.Vector3) {
  q.subVectors(p, CELL_C).divide(CELL_R);
  const r = q.length() || 1e-9;
  return r / cellShape(q.x / r, q.y / r, q.z / r);
}
/** Normalised radius of point p relative to the nuclear envelope (< 1 inside). */
export function nucRho(p: THREE.Vector3) {
  q.subVectors(p, NUC_C).divide(NUC_R);
  const r = q.length() || 1e-9;
  return r / nucShape(q.x / r, q.y / r, q.z / r);
}

/** Uniforms shared by every material in the landmark (same objects, so one write updates all). */
export function makeShared() {
  return {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(-0.42, 0.74, 0.52).normalize() },
    uFogDensity: { value: 1 },
    uFogStart: { value: 0 },
    uFogCol: { value: new THREE.Color(0.01, 0.02, 0.04) },
    uD: { value: 1 },
    uPxScale: { value: 600 },
  };
}
export type Shared = ReturnType<typeof makeShared>;

/** Palette (linear RGB). False colour in the style of molecular animation; tissue nods to H&E stain. */
export const PAL = {
  outside: new THREE.Color(0.004, 0.008, 0.02),
  cytosol: new THREE.Color(0.035, 0.075, 0.11),
  nucleoplasm: new THREE.Color(0.05, 0.025, 0.09),
  membrane: new THREE.Color(0.36, 0.55, 0.68),
  membraneRim: new THREE.Color(0.55, 0.85, 1.0),
  envelope: new THREE.Color(0.32, 0.22, 0.55),
  envelopeRim: new THREE.Color(0.7, 0.55, 1.0),
};
