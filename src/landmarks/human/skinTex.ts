/**
 * Tileable relief textures for the skin, generated on the CPU at init (no image assets):
 *  - cells: the mosaic of flat dead skin cells (corneocytes), N cells per tile, with each plate's
 *    tilt, grooves between plates and a few lifted, curling edges;
 *  - plateaus: the shallow polygons between the main skin furrows.
 * Channels: R = height, G/B = height gradient (so shaders get crisp normals from one fetch),
 * A = 0.5 ± (lifted flake / groove). Mipmapped, so distant skin filters cleanly.
 */
import * as THREE from 'three';

export const CELL_TILE_N = 14;      // corneocytes per tile edge
export const PLAT_TILE_N = 10;      // plateaus per tile edge
export const TEX_SIZE = 1024;
/** Height range stored in R (µm): value = (h − H_MIN) / H_SPAN. */
export const H_MIN = -2.5, H_SPAN = 6.0;
/** Gradient range stored in G/B (µm per texel): value = g / (2·G_MAX) + 0.5. */
export const G_MAX = 1.2;

function hash2(x: number, y: number): [number, number] {
  let h = Math.imul((x * 374761393) ^ (y * 668265263), 1274126177) >>> 0;
  const a = ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 13), 2246822519) >>> 0;
  return [a, ((h ^ (h >>> 16)) >>> 0) / 4294967296];
}
const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function build(N: number, kind: 'cells' | 'plat'): THREE.DataTexture {
  const S = TEX_SIZE;
  const H = new Float32Array(S * S), A = new Float32Array(S * S);
  const mod = (v: number) => ((v % N) + N) % N;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // gentle periodic domain warp so the polygons are not too regular
    let px = ((x + 0.5) / S) * N, py = ((y + 0.5) / S) * N;
    px += 0.12 * Math.sin((py / N) * Math.PI * 2 * 3 + 1.3) + 0.06 * Math.sin((py / N) * Math.PI * 2 * 7);
    py += 0.12 * Math.sin((px / N) * Math.PI * 2 * 2 + 0.4) + 0.06 * Math.sin((px / N) * Math.PI * 2 * 5 + 2.0);
    const ix = Math.floor(px), iy = Math.floor(py);
    let f1 = 9, f2 = 9, bx = 0, by = 0, cx = 0, cy = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = ix + i, gy = iy + j;
      const o = hash2(mod(gx), mod(gy));
      const ox = gx + 0.15 + 0.7 * o[0], oy = gy + 0.15 + 0.7 * o[1];
      const d = (ox - px) ** 2 + (oy - py) ** 2;
      if (d < f1) { f2 = f1; f1 = d; bx = mod(gx); by = mod(gy); cx = ox; cy = oy; } else if (d < f2) f2 = d;
    }
    const edge = Math.sqrt(f2) - Math.sqrt(f1);
    const r1 = hash2(bx + 101, by + 57), r2 = hash2(bx + 13, by + 211);
    let h: number, a: number;
    if (kind === 'cells') {
      // µm: each plate tilts a little (they overlap like shingles), grooves between, some edges lift
      const tilt = ((px - cx) * (r1[0] - 0.5) + (py - cy) * (r1[1] - 0.5)) * 1.4;
      const groove = Math.pow(1 - sm(0, 0.09, edge), 1.5);
      const dl = Math.hypot(px - cx, py - cy) || 1;
      const dir = ((px - cx) * (r1[0] - 0.5) + (py - cy) * (r1[1] - 0.5)) / (dl * (Math.hypot(r1[0] - 0.5, r1[1] - 0.5) || 1));
      const lift = sm(0.86, 0.98, r2[0]) * sm(0.35, 0, edge) * sm(0, 0.5, dir + 0.3);
      const plate = (r2[1] - 0.5) * 1.0;
      h = tilt + plate - groove * 0.8 + lift * 2.4;
      a = 0.5 + 0.5 * lift - 0.5 * groove * (1 - lift);
    } else {
      // µm: shallow polygonal plateaus between the furrows
      const g2 = Math.pow(1 - sm(0, 0.32, edge), 2);
      h = -g2 * 3.5 + (r1[0] - 0.5) * 3.0;
      a = 0.5 - 0.5 * g2;
    }
    H[x + y * S] = h; A[x + y * S] = a;
  }
  const data = new Uint8Array(S * S * 4);
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = x + y * S;
    const gx = (H[((x + 1) % S) + y * S] - H[((x + S - 1) % S) + y * S]) * 0.5;
    const gy = (H[x + ((y + 1) % S) * S] - H[x + ((y + S - 1) % S) * S]) * 0.5;
    data[i * 4] = q((H[i] - H_MIN) / H_SPAN);
    data[i * 4 + 1] = q(gx / (2 * G_MAX) + 0.5);
    data[i * 4 + 2] = q(gy / (2 * G_MAX) + 0.5);
    data[i * 4 + 3] = q(A[i]);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

let shared: { cells: THREE.DataTexture; plat: THREE.DataTexture; users: number } | null = null;
/** Shared by the hand mesh and the skin patch; released when both are disposed. */
export function acquireSkinTextures() {
  if (!shared) shared = { cells: build(CELL_TILE_N, 'cells'), plat: build(PLAT_TILE_N, 'plat'), users: 0 };
  shared.users++;
  return shared;
}
export function releaseSkinTextures() {
  if (!shared) return;
  if (--shared.users <= 0) { shared.cells.dispose(); shared.plat.dispose(); shared = null; }
}
