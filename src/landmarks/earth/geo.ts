/**
 * Geodesy for the Earth landmark.
 *
 * Local frame (spec §4): Wollongong's surface point is the origin, local up = +Y, north = −Z,
 * east = +X. Earth is a sphere of diameter 1 unit (radius 0.5) centred at (0, −0.5, 0).
 * "Geo" vectors are Earth-fixed unit vectors: x → (0°, 0°), y → (0°, 90°E), z → North Pole.
 */
import * as THREE from 'three';

export const WOLLONGONG = { lat: -34.42, lon: 150.89 };
export const R = 0.5;
const D2R = Math.PI / 180;

/** Earth-fixed unit vector for a latitude/longitude in degrees. */
export function geoVec(latDeg: number, lonDeg: number): THREE.Vector3 {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

/** Local east / up / north basis at Wollongong, expressed in geo coordinates. */
export function anchorBasis() {
  const la = WOLLONGONG.lat * D2R, lo = WOLLONGONG.lon * D2R;
  const up = geoVec(WOLLONGONG.lat, WOLLONGONG.lon);
  const east = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
  const north = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  return { east, up, north };
}

/** Geo unit vector → local direction (x = east, y = up, z = −north). */
export function geoToLocalDir(g: THREE.Vector3): THREE.Vector3 {
  const { east, up, north } = anchorBasis();
  return new THREE.Vector3(g.dot(east), g.dot(up), -g.dot(north));
}

/** A point at `altitude` (local units) above the surface at lat/lon, in local coordinates. */
export function geoToLocalPoint(latDeg: number, lonDeg: number, altitude = 0): [number, number, number] {
  const d = geoToLocalDir(geoVec(latDeg, lonDeg)).multiplyScalar(R + altitude);
  return [d.x, d.y - R, d.z];
}

/** Direction towards the Sun from a point on the surface, given local azimuth/elevation (deg). */
export function localSkyDir(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = azimuthDeg * D2R, el = elevationDeg * D2R;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Earth's spin axis (towards the North Pole) in the local frame. */
export function polarAxisLocal(): THREE.Vector3 {
  return geoToLocalDir(new THREE.Vector3(0, 0, 1)).normalize();
}
