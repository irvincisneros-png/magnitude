/** CPU-side noise and randomness for building the Orion Nebula (no Three.js). */
import * as THREE from 'three';

export type V3 = [number, number, number];

/** Small seeded PRNG (mulberry32) so the nebula is the same every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz,
  );
}

export function fbm3(x: number, y: number, z: number, oct = 4): number {
  let a = 0.5, v = 0, n = 0;
  for (let i = 0; i < oct; i++) { v += a * noise3(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.2; a *= 0.5; }
  return v / n;
}

/** Ridged fbm: bright thin ridges where the noise crosses its middle (filaments). */
export function ridged3(x: number, y: number, z: number, oct = 3): number {
  let a = 0.5, v = 0, n = 0;
  for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(noise3(x, y, z) * 2 - 1); v += a * r * r; n += a; x = x * 2.1 + 5.3; y = y * 2.1 + 1.1; z = z * 2.1 + 7.7; a *= 0.5; }
  return v / n;
}

/** Curl of a noise vector field: divergence-free directions for wispy streamlines. */
export function curl3(x: number, y: number, z: number, out: V3): V3 {
  const e = 0.01;
  const f = (ox: number, oy: number, oz: number, k: number) => fbm3(x + ox + k * 31.4, y + oy + k * 11.7, z + oz + k * 5.9, 2);
  const dFz_dy = (f(0, e, 0, 2) - f(0, -e, 0, 2)) / (2 * e), dFy_dz = (f(0, 0, e, 1) - f(0, 0, -e, 1)) / (2 * e);
  const dFx_dz = (f(0, 0, e, 0) - f(0, 0, -e, 0)) / (2 * e), dFz_dx = (f(e, 0, 0, 2) - f(-e, 0, 0, 2)) / (2 * e);
  const dFy_dx = (f(e, 0, 0, 1) - f(-e, 0, 0, 1)) / (2 * e), dFx_dy = (f(0, e, 0, 0) - f(0, -e, 0, 0)) / (2 * e);
  out[0] = dFz_dy - dFy_dz; out[1] = dFx_dz - dFz_dx; out[2] = dFy_dx - dFx_dy;
  return out;
}

/**
 * Tileable 2D noise texture for shaping sprites on the GPU (one fetch replaces many octaves):
 * R = billowy fbm, G = ridged (filaments), B = fine turbulence, A = second billowy field.
 */
export function makeNoiseTexture(n = 128): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4);
  // periodic value noise on a lattice of `per` cells
  const lat = (per: number, seed: number) => {
    const g = new Float32Array(per * per);
    const r = rng(seed);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return (x: number, y: number) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      let fx = x - ix, fy = y - iy;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const at = (a: number, b: number) => g[(((b % per) + per) % per) * per + (((a % per) + per) % per)];
      const a0 = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
      const a1 = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
      return a0 + (a1 - a0) * fy;
    };
  };
  const oct = [lat(4, 11), lat(8, 12), lat(16, 13), lat(32, 14), lat(64, 15)];
  const oct2 = [lat(4, 21), lat(8, 22), lat(16, 23), lat(32, 24)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    let fb = 0, rd = 0, tb = 0, f2 = 0, a = 0.5, norm = 0;
    for (let o = 0; o < 4; o++) {
      const per = 4 << o;
      const val = oct[o](u * per, v * per);
      fb += a * val; norm += a;
      const r = 1 - Math.abs(val * 2 - 1); rd += a * r * r;
      f2 += a * oct2[o](u * per, v * per);
      a *= 0.5;
    }
    tb = 0.6 * Math.abs(oct[3](u * 32, v * 32) * 2 - 1) + 0.4 * Math.abs(oct[4](u * 64, v * 64) * 2 - 1);
    fb /= norm; rd /= norm; f2 /= norm;
    const c = (t: number) => Math.round(Math.min(1, Math.max(0, t)) * 255);
    // stretch contrast a little so erosion thresholds bite
    data.set([c((fb - 0.5) * 1.7 + 0.5), c(rd * 1.25), c(tb), c((f2 - 0.5) * 1.7 + 0.5)], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(data, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
