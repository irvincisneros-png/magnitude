/**
 * Geometry of the hero E. coli in local units (1 unit = 2 µm, the rod's length).
 *
 * The rod lies on its side along X. The layer origin (where the T4 phage's capsid sits) is just
 * above the top of the cell, a little off-centre along the rod; the phage's baseplate touches the
 * outer membrane at CONTACT = (0, -0.075, 0) (150 nm below the origin), where the surface normal is +Y.
 *
 * "Cell space" is the hero group's frame: the capsule is centred at its origin, axis along X.
 */
import * as THREE from 'three';
import { fbm3 } from './util';

/** One nanometre in local units. */
export const NM = 1 / 2000;
/** Capsule radius (0.76 µm wide) and half-length of the cylindrical part (total length 2 µm). */
export const CAP_R = 0.19;
export const CAP_H = 0.5 - CAP_R;
/** Where the phage's feet touch the membrane (layer space). */
export const CONTACT = new THREE.Vector3(0, -0.075, 0);
/** Cell centre in layer space (rod axis along X, origin 0.1 units = 200 nm behind mid-length). */
export const CELL_C = new THREE.Vector3(0.1, CONTACT.y - CAP_R, 0);
/** Contact point in cell space. */
export const CONTACT_CELL = CONTACT.clone().sub(CELL_C);

/** Closest point on the capsule axis segment. */
export function axisPoint(p: THREE.Vector3, out: THREE.Vector3) {
  return out.set(Math.min(CAP_H, Math.max(-CAP_H, p.x)), 0, 0);
}

/** Radius of the (softly wrinkled) membrane at the surface point in direction of p (cell space). */
export function surfR(p: THREE.Vector3) {
  const n = fbm3(p.x * 9 + 3.1, p.y * 9 - 1.7, p.z * 9 + 0.4, 3) - 0.5;
  const n2 = fbm3(p.x * 31 - 7.0, p.y * 31 + 2.0, p.z * 31 + 5.0, 2) - 0.5;
  const w = Math.min(1, p.distanceTo(CONTACT_CELL) / 0.09);
  const ww = w * w * (3 - 2 * w);
  return CAP_R * (1 + (0.045 * n + 0.016 * n2) * ww);
}

const ta = new THREE.Vector3();
/** Projects p (cell space) onto the membrane; writes the outward normal into nrm. */
export function toSurface(p: THREE.Vector3, nrm: THREE.Vector3) {
  axisPoint(p, ta);
  nrm.subVectors(p, ta);
  if (nrm.lengthSq() < 1e-12) nrm.set(0, 1, 0);
  nrm.normalize();
  p.copy(ta).addScaledVector(nrm, CAP_R);
  return p.copy(ta).addScaledVector(nrm, surfR(p));
}

/** Uniforms shared by every material in the landmark (same objects, so one write updates all). */
export function makeShared() {
  return {
    uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(-0.42, 0.74, 0.52).normalize() },
    uFogDensity: { value: 0.05 },
    uFogCol: { value: new THREE.Color(0.006, 0.02, 0.026) },
    uD: { value: 1 },
    uPxScale: { value: 600 },
    uCamObj: { value: new THREE.Vector3(0, 0, 5) },
    uCytoK: { value: 9 },
  };
}
export type Shared = ReturnType<typeof makeShared>;

/** Palette (linear RGB), in the spirit of Goodsell's E. coli paintings. */
export const PAL = {
  medium: new THREE.Color(0.006, 0.02, 0.026),
  mediumHi: new THREE.Color(0.02, 0.055, 0.06),
  cytosol: new THREE.Color(0.03, 0.075, 0.1),
  membrane: new THREE.Color(0.2, 0.42, 0.24),
  membraneRim: new THREE.Color(0.55, 1.0, 0.62),
  inner: new THREE.Color(0.75, 0.95, 0.45),
  ribosome: new THREE.Color(0.5, 0.16, 0.42),
  protein: new THREE.Color(0.16, 0.36, 0.56),
  dna: new THREE.Color(1.0, 0.78, 0.42),
  flagellum: new THREE.Color(0.62, 0.66, 0.46),
  pilus: new THREE.Color(0.66, 0.74, 0.55),
  phage: new THREE.Color(0.36, 0.36, 0.42),
  lps: new THREE.Color(0.5, 0.82, 0.48),
  porin: new THREE.Color(0.34, 0.6, 0.36),
};
