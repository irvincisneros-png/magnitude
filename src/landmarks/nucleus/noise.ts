/**
 * Tileable 3D gradient-noise volume (4 independent channels) baked once at init.
 * The field shader takes its octaves from this texture: one fetch per octave instead of
 * eight hashes, which keeps the raymarch cheap enough for integrated graphics.
 */
import * as THREE from 'three';

/** size³ texels, lattice period `period` cells (must divide size). */
export function makeNoiseVolume(size = 64, period = 16): THREE.Data3DTexture {
  const cells = period;
  const step = size / cells;
  // Seeded PRNG (mulberry32) so every load looks the same.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // random unit gradients per lattice point and channel (Perlin gradient noise: no blocky value-noise cells)
  const grad = new Float32Array(cells * cells * cells * 4 * 3);
  for (let i = 0; i < grad.length; i += 3) {
    const u = rnd() * 2 - 1; const t = rnd() * Math.PI * 2; const k = Math.sqrt(1 - u * u);
    grad[i] = k * Math.cos(t); grad[i + 1] = u; grad[i + 2] = k * Math.sin(t);
  }
  const data = new Uint8Array(size * size * size * 4);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const G = (x: number, y: number, z: number, c: number, dx: number, dy: number, dz: number) => {
    const o = (((((z % cells) * cells + (y % cells)) * cells + (x % cells)) * 4) + c) * 3;
    return grad[o] * dx + grad[o + 1] * dy + grad[o + 2] * dz;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  for (let z = 0; z < size; z++) {
    const gz = z / step; const iz = Math.floor(gz); const rz = gz - iz; const fz = fade(rz);
    for (let y = 0; y < size; y++) {
      const gy = y / step; const iy = Math.floor(gy); const ry = gy - iy; const fy = fade(ry);
      for (let x = 0; x < size; x++) {
        const gx = x / step; const ix = Math.floor(gx); const rx = gx - ix; const fx = fade(rx);
        const o = ((z * size + y) * size + x) * 4;
        for (let c = 0; c < 4; c++) {
          const v = lerp(
            lerp(lerp(G(ix, iy, iz, c, rx, ry, rz), G(ix + 1, iy, iz, c, rx - 1, ry, rz), fx),
                 lerp(G(ix, iy + 1, iz, c, rx, ry - 1, rz), G(ix + 1, iy + 1, iz, c, rx - 1, ry - 1, rz), fx), fy),
            lerp(lerp(G(ix, iy, iz + 1, c, rx, ry, rz - 1), G(ix + 1, iy, iz + 1, c, rx - 1, ry, rz - 1), fx),
                 lerp(G(ix, iy + 1, iz + 1, c, rx, ry - 1, rz - 1), G(ix + 1, iy + 1, iz + 1, c, rx - 1, ry - 1, rz - 1), fx), fy),
            fz);
          data[o + c] = Math.max(0, Math.min(255, Math.round((v * 0.9 + 0.5) * 255)));
        }
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
