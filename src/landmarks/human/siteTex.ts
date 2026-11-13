/** GPU textures of the site data (see siteData.ts and the SITE chunk in glsl.ts). */
import * as THREE from 'three';
import type { SiteData } from './siteData';

export interface SiteTextures {
  uniforms: Record<'tFine' | 'tCoarse' | 'tCov' | 'tCov2' | 'tCovM' | 'tCov2M' | 'tNoise', { value: THREE.Texture }>;
  dispose(): void;
}

export function makeSiteTextures(D: SiteData, renderer: THREE.WebGLRenderer | null): SiteTextures {
  const half = THREE.DataUtils.toHalfFloat;
  const fn = D.G.fine.n, cn = D.G.coarse.n;
  const f = new Uint16Array(fn * fn * 2);
  for (let k = 0; k < fn * fn; k++) { f[k * 2] = half(D.fine[k]); f[k * 2 + 1] = half(D.fineSea[k]); }
  const c = new Uint16Array(cn * cn * 4);
  for (let k = 0; k < cn * cn; k++) { c[k * 4] = half(D.coarse[k]); c[k * 4 + 1] = half(D.coarseSea[k]); c[k * 4 + 2] = half(D.urban[k]); c[k * 4 + 3] = half(0); }
  const lin = (t: THREE.DataTexture) => {
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
  };
  const tFine = lin(new THREE.DataTexture(f, fn, fn, THREE.RGFormat, THREE.HalfFloatType));
  const tCoarse = lin(new THREE.DataTexture(c, cn, cn, THREE.RGBAFormat, THREE.HalfFloatType));
  const aniso = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  const cov = (data: Uint8Array, n: number) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  };
  const tex = {
    tFine, tCoarse, tNoise: noiseTexture(aniso),
    tCov: cov(D.cover, D.G.cover.n), tCov2: cov(D.cover2, D.G.cover.n),
    tCovM: cov(D.coverMid, D.G.coverMid.n), tCov2M: cov(D.cover2Mid, D.G.coverMid.n),
  };
  return {
    uniforms: {
      tFine: { value: tex.tFine }, tCoarse: { value: tex.tCoarse }, tCov: { value: tex.tCov }, tCov2: { value: tex.tCov2 },
      tCovM: { value: tex.tCovM }, tCov2M: { value: tex.tCov2M }, tNoise: { value: tex.tNoise },
    },
    dispose() { for (const t of Object.values(tex)) t.dispose(); },
  };
}

/** Tileable value noise, 512² RGBA: 32 cells per side (16 texels each), smoothstep-interpolated, 4 independent channels. */
function noiseTexture(aniso: number) {
  const N = 512, C = 32, out = new Uint8Array(N * N * 4);
  const h = (x: number, y: number, c: number) => {
    let v = Math.imul((x % C) + 1, 374761393) + Math.imul((y % C) + 1, 668265263) + Math.imul(c + 1, 2246822519);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = (x + 0.5) / 16, fy = (y + 0.5) / 16;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let u = fx - ix, v = fy - iy; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    for (let c = 0; c < 4; c++) {
      const a = h(ix, iy, c), b = h(ix + 1, iy, c), d = h(ix, iy + 1, c), e = h(ix + 1, iy + 1, c);
      out[(y * N + x) * 4 + c] = Math.round((a + (b - a) * u + (d - a) * v + (a - b - d + e) * u * v) * 255);
    }
  }
  const t = new THREE.DataTexture(out, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}
