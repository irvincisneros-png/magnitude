/**
 * Hairs on the back of the right hand around the origin, rooted in the same jittered follicle grid
 * the skin shader draws (skinGlsl.ts), on the ellipsoid that matches the skin's curvature at the
 * anchor (pose.ts PALM). Pure maths: per hair root xyz, normal xyz, flow direction xyz, length,
 * seed (11 floats) in H metres.
 */
import { FOLLICLE, HAND_FRAME, PALM, type V3 } from './pose';

/** PCG-style 2D integer hash, identical to the GLSL `pcg2d` (used for the follicles). */
export function pcg2d(x: number, y: number): [number, number] {
  let vx = x >>> 0, vy = y >>> 0;
  vx = (Math.imul(vx, 1664525) + 1013904223) >>> 0;
  vy = (Math.imul(vy, 1664525) + 1013904223) >>> 0;
  vx = (vx + Math.imul(vy, 1664525)) >>> 0;
  vy = (vy + Math.imul(vx, 1664525)) >>> 0;
  vx = (vx ^ (vx >>> 16)) >>> 0;
  vy = (vy ^ (vy >>> 16)) >>> 0;
  vx = (vx + Math.imul(vy, 1664525)) >>> 0;
  vy = (vy + Math.imul(vx, 1664525)) >>> 0;
  vx = (vx ^ (vx >>> 16)) >>> 0;
  vy = (vy ^ (vy >>> 16)) >>> 0;
  return [vx / 4294967296, vy / 4294967296];
}

const toH = (v: V3): V3 => {
  const { x, y, z } = HAND_FRAME;
  return [x[0] * v[0] + y[0] * v[1] + z[0] * v[2], x[1] * v[0] + y[1] * v[1] + z[1] * v[2], x[2] * v[0] + y[2] * v[1] + z[2] * v[2]];
};
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function makeHairs(): Float32Array {
  const [a, b, c] = PALM;
  const g = FOLLICLE;
  const out: number[] = [];
  for (let iz = Math.floor(-0.021 / g); iz <= Math.ceil(0.021 / g); iz++) for (let ix = Math.floor(-0.05 / g); ix <= Math.ceil(0.045 / g); ix++) {
    const [jx, jz] = pcg2d(ix, iz);
    const [k1, k2] = pcg2d(ix + 7919, iz - 104729);
    const lx = (ix + 0.15 + 0.7 * jx) * g, lz = (iz + 0.15 + 0.7 * jz) * g;
    if (Math.hypot(lx, lz) < 0.0016) continue; // keep the origin itself clear
    const q = 1 - (lx * lx) / (a * a) - (lz * lz) / (c * c);
    if (q < 0.45) continue; // stay where the ellipsoid matches the hand
    // sparser towards the knuckles (+x) and the sides
    const keep = 0.62 * (1 - Math.max(0, (lx - 0.02) / 0.03)) * (0.6 + 0.4 * q);
    if (k1 > keep) continue;
    const y = -b + b * Math.sqrt(q);
    const N = norm([lx / (a * a), (y + b) / (b * b), lz / (c * c)]);
    const sw = (k2 - 0.5) * 0.7 + 0.25 * Math.sin(lz * 160);
    let dir = norm([1, 0, sw]);
    const dn = dir[0] * N[0] + dir[1] * N[1] + dir[2] * N[2];
    dir = norm([dir[0] - N[0] * dn, dir[1] - N[1] * dn, dir[2] - N[2] * dn]);
    const hl = 0.0045 + k2 * 0.004;
    // keep a clear view of the origin at the deepest zoom
    const tx = lx + dir[0] * hl, tz = lz + dir[2] * hl;
    const dx = tx - lx, dz = tz - lz, t = Math.max(0, Math.min(1, -(lx * dx + lz * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(lx + dx * t, lz + dz * t) < 0.0012) continue;
    const R = toH([lx, y, lz]), NH = toH(N), D = toH(dir);
    out.push(R[0], R[1], R[2], NH[0], NH[1], NH[2], D[0], D[1], D[2], hl, k2);
  }
  return new Float32Array(out);
}
