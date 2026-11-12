/**
 * Procedural cosmic-microwave-background pattern, baked once into an equirectangular texture.
 * Not Planck data: random, roughly Gaussian temperature ripples whose strongest blobs are about a
 * degree across (the size set by sound waves in the early universe), on top of weaker large patches.
 * Sampling 3-D noise on the unit sphere keeps it seamless; the shader indexes by direction.
 */
import * as THREE from 'three';
import { vnoise } from './util';

export function bakeCMB(w: number): THREE.DataTexture {
  const h = w / 2;
  const vals = new Float32Array(w * h);
  // octave frequencies on the unit sphere and their weights: a peak near ~1° blobs (f ≈ 40–70)
  const oct = ([[3, 0.25], [7, 0.3], [14, 0.5], [27, 0.8], [46, 1.0], [78, 0.65]] as [number, number][]).filter(([f]) => f < w / 11);
  let sum = 0, sum2 = 0;
  for (let y = 0; y < h; y++) {
    const lat = ((y + 0.5) / h - 0.5) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    // fewer octaves are needed near the poles where texels crowd together, but keep it simple
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w - 0.5) * Math.PI * 2;
      const dx = cl * Math.cos(lon), dz = cl * Math.sin(lon), dy = sl;
      let v = 0;
      for (let i = 0; i < oct.length; i++) {
        const [f, a] = oct[i];
        v += a * vnoise(dx * f + i * 17.3, dy * f - i * 9.1, dz * f + i * 4.7, 100 + i);
      }
      vals[y * w + x] = v;
      sum += v; sum2 += v * v;
    }
  }
  const n = w * h;
  const mean = sum / n, sd = Math.sqrt(Math.max(1e-9, sum2 / n - mean * mean));
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = Math.max(-1, Math.min(1, (vals[i] - mean) / (2.6 * sd)));
    const b = Math.round((t * 0.5 + 0.5) * 255);
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
