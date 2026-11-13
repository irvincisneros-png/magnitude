/**
 * Loads the Woonona Beach data built by tools/build-woonona.mjs (heights, land cover, buildings,
 * trees, pools) and answers height queries. No Three.js here: pure data and maths.
 *
 * "Map metres": the local tangent frame at the standing spot (site.ts): east → +x, north → −z,
 * heights in metres above mean sea level. The scene's H frame is the map frame shifted so the back
 * of the hand is the origin (see terrain.ts).
 */
import { GROUND_ELEV_M } from './site';

export interface Grid { n: number; cell: number; half: number }
export interface SiteData {
  fine: Float32Array; coarse: Float32Array; urban: Float32Array;
  /** Distance (m) from the open sea's edge, measured seaward; −1 in lagoons and creeks. */
  fineSea: Float32Array; coarseSea: Float32Array;
  cover: Uint8Array; cover2: Uint8Array; coverMid: Uint8Array; cover2Mid: Uint8Array;
  G: { fine: Grid; coarse: Grid; cover: Grid; coverMid: Grid };
  bld: Float32Array; trees: Float32Array; pools: number[][];
  measured: Record<string, unknown>;
}

// ------------------------------------------------------------------ minimal PNG decoder (exact bytes, no colour management)
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
async function decodePNG(buf: ArrayBuffer): Promise<{ w: number; h: number; bpp: number; data: Uint8Array }> {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  let p = 8, w = 0, h = 0, ct = 0;
  const parts: Uint8Array[] = [];
  while (p < b.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); ct = b[p + 17]; }
    else if (type === 'IDAT') parts.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  let total = 0; for (const q of parts) total += q.length;
  const z = new Uint8Array(total); let o = 0; for (const q of parts) { z.set(q, o); o += q.length; }
  const raw = await inflate(z);
  const stride = w * bpp, out = new Uint8Array(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, bb = y ? out[dst + i - stride] : 0, c = y && i >= bpp ? out[dst + i - stride - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) { const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c; }
      out[dst + i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}
async function fetchPNG(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`[human] ${url}: ${r.status}`);
  return decodePNG(await r.arrayBuffer());
}
function rgba(p: { w: number; h: number; bpp: number; data: Uint8Array }) {
  if (p.bpp === 4) return p.data;
  const out = new Uint8Array(p.w * p.h * 4);
  for (let k = 0; k < p.w * p.h; k++) { out[k * 4] = p.data[k * 3]; out[k * 4 + 1] = p.data[k * 3 + 1]; out[k * 4 + 2] = p.data[k * 3 + 2]; out[k * 4 + 3] = 255; }
  return out;
}

/** Seaward distance from the land (chamfer transform over cells below sea level connected to the open sea). */
function seaDistance(H: Float32Array, n: number, cell: number) {
  const D = new Float32Array(n * n);
  const sea = new Uint8Array(n * n);
  // flood the open sea from the eastern edge
  const stack: number[] = [];
  for (let j = 0; j < n; j++) { const k = j * n + n - 1; if (H[k] < 0) { sea[k] = 1; stack.push(k); } }
  while (stack.length) {
    const k = stack.pop()!; const i = k % n, j = (k / n) | 0;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const q = jj * n + ii; if (!sea[q] && H[q] < 0) { sea[q] = 1; stack.push(q); }
    }
  }
  const BIG = 1e9;
  for (let k = 0; k < n * n; k++) D[k] = sea[k] ? BIG : 0;
  const c1 = cell, c2 = cell * Math.SQRT2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i; if (!sea[k]) continue;
    let d = D[k];
    if (i > 0) d = Math.min(d, D[k - 1] + c1);
    if (j > 0) { d = Math.min(d, D[k - n] + c1); if (i > 0) d = Math.min(d, D[k - n - 1] + c2); if (i < n - 1) d = Math.min(d, D[k - n + 1] + c2); }
    D[k] = d;
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i; if (!sea[k]) continue;
    let d = D[k];
    if (i < n - 1) d = Math.min(d, D[k + 1] + c1);
    if (j < n - 1) { d = Math.min(d, D[k + n] + c1); if (i < n - 1) d = Math.min(d, D[k + n + 1] + c2); if (i > 0) d = Math.min(d, D[k + n - 1] + c2); }
    D[k] = d;
  }
  for (let k = 0; k < n * n; k++) { if (D[k] >= BIG) D[k] = 5000; if (!sea[k] && H[k] < 0) D[k] = -1; }
  return D;
}

let shared: Promise<SiteData> | null = null;
let users = 0;
/** Loads (once) and returns the site data. */
export function loadSite(assetUrl: (p: string) => string): Promise<SiteData> {
  users++;
  if (!shared) shared = (async () => {
    const [fine, coarse, cover, cover2, coverMid, cover2Mid, feat, fbin] = await Promise.all([
      fetchPNG(assetUrl('height_fine.png')), fetchPNG(assetUrl('height_coarse.png')),
      fetchPNG(assetUrl('cover.png')), fetchPNG(assetUrl('cover2.png')),
      fetchPNG(assetUrl('cover_mid.png')), fetchPNG(assetUrl('cover2_mid.png')),
      fetch(assetUrl('features.json')).then((r) => r.json()),
      fetch(assetUrl('features.bin')).then((r) => r.arrayBuffer()),
    ]);
    const heights = (p: { w: number; h: number; bpp: number; data: Uint8Array }) => {
      const H = new Float32Array(p.w * p.h), B = new Float32Array(p.w * p.h);
      for (let k = 0; k < p.w * p.h; k++) { H[k] = (p.data[k * p.bpp] * 256 + p.data[k * p.bpp + 1]) / 50 - 100; B[k] = p.data[k * p.bpp + 2] / 255; }
      return { H, B };
    };
    const f = heights(fine), c = heights(coarse);
    const g = feat.grids;
    const G = {
      fine: { n: g.fine.n, cell: g.fine.cell, half: (g.fine.n * g.fine.cell) / 2 },
      coarse: { n: g.coarse.n, cell: g.coarse.cell, half: (g.coarse.n * g.coarse.cell) / 2 },
      cover: { n: g.cover.n, cell: g.cover.cell, half: (g.cover.n * g.cover.cell) / 2 },
      coverMid: { n: g.coverMid.n, cell: g.coverMid.cell, half: (g.coverMid.n * g.coverMid.cell) / 2 },
    };
    // features.bin: Int16 records in decimetres (angles and seeds × 1e4), buildings then trees
    const i16 = new Int16Array(fbin);
    const nb = feat.counts.bld, nt = feat.counts.trees;
    const bld = new Float32Array(nb * 8), trees = new Float32Array(nt * 5);
    for (let k = 0; k < nb * 8; k++) { const c = k % 8; bld[k] = c === 4 || c === 7 ? i16[k] / 1e4 : c === 6 ? i16[k] : i16[k] / 10; }
    for (let k = 0; k < nt * 5; k++) { const c = k % 5; trees[k] = c === 4 ? i16[nb * 8 + k] : i16[nb * 8 + k] / 10; }
    return {
      fine: f.H, coarse: c.H, urban: c.B,
      fineSea: seaDistance(f.H, G.fine.n, G.fine.cell), coarseSea: seaDistance(c.H, G.coarse.n, G.coarse.cell),
      cover: rgba(cover), cover2: rgba(cover2), coverMid: rgba(coverMid), cover2Mid: rgba(cover2Mid), G,
      bld, trees, pools: feat.pools, measured: feat.measured,
    };
  })();
  return shared;
}
/** Release one user; the cache is dropped when nobody holds it (dispose). */
export function releaseSite() { users = Math.max(0, users - 1); if (!users) shared = null; }

export function sampleGrid(A: Float32Array, G: Grid, x: number, z: number) {
  const n = G.n;
  const fx = Math.min(Math.max((x + G.half) / G.cell - 0.5, 0), n - 1.001), fz = Math.min(Math.max((z + G.half) / G.cell - 0.5, 0), n - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  return A[j * n + i] * (1 - u) * (1 - v) + A[j * n + i + 1] * u * (1 - v) + A[(j + 1) * n + i] * (1 - u) * v + A[(j + 1) * n + i + 1] * u * v;
}
/** One 8-bit channel of a cover map, bilinear, 0..1 (0 outside). */
export function sampleCover(C: Uint8Array, G: Grid, ch: number, x: number, z: number) {
  const n = G.n;
  const fx = (x + G.half) / G.cell - 0.5, fz = (z + G.half) / G.cell - 0.5;
  if (fx < 0 || fz < 0 || fx > n - 1.001 || fz > n - 1.001) return 0;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const at = (a: number, b: number) => C[((j + b) * n + i + a) * 4 + ch];
  return (at(0, 0) * (1 - u) * (1 - v) + at(1, 0) * u * (1 - v) + at(0, 1) * (1 - u) * v + at(1, 1) * u * v) / 255;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let pad = 0;
/** Height (m above sea level) at map (x, z): the fine map blended into the coarse one. */
export function siteHeight(D: SiteData, x: number, z: number) {
  const e = Math.max(Math.abs(x), Math.abs(z));
  let h: number;
  const fh = D.G.fine.half;
  if (e < fh - 15) {
    h = sampleGrid(D.fine, D.G.fine, x, z);
    const b = smooth(fh - 160, fh - 15, e);
    if (b > 0) h += (sampleGrid(D.coarse, D.G.coarse, x, z) - h) * b;
  } else h = sampleGrid(D.coarse, D.G.coarse, x, z);
  // the feet stand exactly at the measured ground height
  const r2 = x * x + z * z;
  if (r2 < 1600) h += pad * Math.exp(-r2 / 120);
  return h;
}
/** Call once after loading: computes the correction that puts the spot at exactly GROUND_ELEV_M. */
export function padSpot(D: SiteData) { pad = 0; pad = GROUND_ELEV_M - siteHeight(D, 0, 0); return pad; }

/** Land-cover channel (0 sand, 1 scrub, 2 wood, 3 rock) at map (x, z): fine cover blended into the mid one. */
export function coverAt(D: SiteData, ch: number, x: number, z: number) {
  const e = Math.max(Math.abs(x), Math.abs(z));
  const f = D.G.cover.half;
  if (e < f - 90) return sampleCover(D.cover, D.G.cover, ch, x, z);
  const m = sampleCover(D.coverMid, D.G.coverMid, ch, x, z);
  if (e >= f - 10) return m;
  const b = smooth(f - 90, f - 10, e);
  return sampleCover(D.cover, D.G.cover, ch, x, z) * (1 - b) + m * b;
}
