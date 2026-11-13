/**
 * Meshes every ant part from its SDF (surface nets on a narrow band, vertices projected onto the
 * exact surface, normals from the field gradient), bakes ambient occlusion against the whole rest
 * pose and the skin, a thinness value for translucency and a joint-membrane mask, then scatters
 * the hair roots (fine appressed pubescence and erect setae) over each surface. No Three.js.
 */
import { EYE_C, EYE_R, parts, restPose, restProxy, dirToWorld, toWorld, cross, sub, norm, dot, mul, add, type PartSpec, type SDF, type V3 } from './model';

export interface PartMesh {
  name: string;
  pos: Float32Array; nrm: Float32Array;
  /** ao, thin, membrane, random */
  attr: Float32Array;
  index: Uint32Array;
  /** per hair: root xyz, normal xyz, dir xyz, length, seed, kind (0 appressed, 1 erect) */
  hairs: Float32Array;
}
export interface AntData { parts: PartMesh[]; ms: number }
export const HAIR_STRIDE = 12;

const AO_T = [0.015, 0.04, 0.09, 0.18, 0.32];

function mesh(o: PartSpec, proxy: SDF, frame: ReturnType<PartSpec['frame']>): Omit<PartMesh, 'hairs' | 'name'> {
  const { lo, hi, h, sdf } = o;
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  // narrow band: a coarse pass at 4h decides where the fine field is needed
  const C = 4;
  const cnx = Math.floor((nx - 1) / C) + 2, cny = Math.floor((ny - 1) / C) + 2, cnz = Math.floor((nz - 1) / C) + 2;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++)
    coarse[i + cnx * (j + cny * k)] = sdf(lo[0] + (i + 0.5) * C * h, lo[1] + (j + 0.5) * C * h, lo[2] + (k + 0.5) * C * h);
  const margin = 1.3 * C * h;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = lo[2] + k * h, ck = Math.min(cnz - 1, Math.floor(k / C));
    for (let j = 0; j < ny; j++) {
      const y = lo[1] + j * h, cj = Math.min(cny - 1, Math.floor(j / C));
      for (let i = 0; i < nx; i++) {
        const dc = coarse[Math.min(cnx - 1, Math.floor(i / C)) + cnx * (cj + cny * ck)];
        field[i + nx * (j + ny * k)] = Math.abs(dc) > margin ? dc : sdf(lo[0] + i * h, y, z);
      }
    }
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellV = new Int32Array(cx * cy * cz).fill(-1);
  const P: number[] = [];
  const corner = new Float32Array(8);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cOff = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = field[(i + cOff[c][0]) + nx * ((j + cOff[c][1]) + ny * (k + cOff[c][2]))];
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of E) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += cOff[a][0] + (cOff[b][0] - cOff[a][0]) * t;
      sy += cOff[a][1] + (cOff[b][1] - cOff[a][1]) * t;
      sz += cOff[a][2] + (cOff[b][2] - cOff[a][2]) * t;
      m++;
    }
    cellV[i + cx * (j + cy * k)] = P.length / 3;
    P.push(lo[0] + (i + sx / m) * h, lo[1] + (j + sy / m) * h, lo[2] + (k + sz / m) * h);
  }
  const I: number[] = [];
  const cell = (i: number, j: number, k: number) => cellV[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    I.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const v0 = field[i + nx * (j + ny * k)];
    if (j > 0 && k > 0 && i < cx) {
      const v1 = field[i + 1 + nx * (j + ny * k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k));
    }
    if (i > 0 && k > 0 && j < cy) {
      const v1 = field[i + nx * (j + 1 + ny * k)];
      if ((v0 < 0) !== (v1 < 0)) quad(cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k));
    }
    if (i > 0 && j > 0 && k < cz) {
      const v1 = field[i + nx * (j + ny * (k + 1))];
      if ((v0 < 0) !== (v1 < 0)) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k));
    }
  }
  const nv = P.length / 3;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), attr = new Float32Array(nv * 4);
  const e = h * 0.25;
  const g = [0, 0, 0];
  const grad = (x: number, y: number, z: number) => {
    const a = sdf(x + e, y - e, z - e), b = sdf(x - e, y - e, z + e), c = sdf(x - e, y + e, z - e), d = sdf(x + e, y + e, z + e);
    g[0] = a - b - c + d; g[1] = -a - b + c + d; g[2] = -a + b - c + d;
    return (a + b + c + d) * 0.25;
  };
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = grad(x, y, z);
      const gl = Math.hypot(g[0], g[1], g[2]);
      if (gl < 1e-12) break;
      const step = Math.max(-h, Math.min(h, (d * 4 * e) / gl));
      x -= (g[0] / gl) * step; y -= (g[1] / gl) * step; z -= (g[2] / gl) * step;
    }
    grad(x, y, z);
    const gl = Math.hypot(g[0], g[1], g[2]) || 1;
    const N: V3 = [g[0] / gl, g[1] / gl, g[2] / gl];
    pos.set([x, y, z], v * 3);
    nrm.set(N, v * 3);
    // occlusion: own field close by, the whole rest pose (and the skin) further out
    const pw = toWorld(frame, [x, y, z]);
    const nw = dirToWorld(frame, N);
    let occ = 0, w = 1;
    for (const t of AO_T) {
      const dd = t < 0.05 ? sdf(x + N[0] * t, y + N[1] * t, z + N[2] * t) : Math.min(sdf(x + N[0] * t, y + N[1] * t, z + N[2] * t), proxy(pw[0] + nw[0] * t, pw[1] + nw[1] * t, pw[2] + nw[2] * t));
      occ += w * Math.max(0, t - dd) / t;
      w *= 0.6;
    }
    const di = sdf(x - N[0] * 0.07, y - N[1] * 0.07, z - N[2] * 0.07);
    attr[v * 4] = Math.max(0.05, 1 - occ * 0.5);
    attr[v * 4 + 1] = Math.min(1, Math.max(0, 1 + di / 0.06));
    attr[v * 4 + 2] = o.mem ? o.mem(x, y, z) : 0;
    attr[v * 4 + 3] = hashf(v * 7 + 13);
  }
  const index = new Uint32Array(I.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3], wy = pos[c * 3 + 1] - pos[a * 3 + 1], wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const s = fx * (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) + fy * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) + fz * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]);
    if (s >= 0) { index[t] = a; index[t + 1] = b; index[t + 2] = c; } else { index[t] = a; index[t + 1] = c; index[t + 2] = b; }
  }
  return { pos, nrm, attr, index };
}

function hashf(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function scatterHairs(o: PartSpec, m: Omit<PartMesh, 'hairs' | 'name'>, seed: number): Float32Array {
  const out: number[] = [];
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const { pos, nrm, attr, index } = m;
  const hs = o.hair;
  const isHead = o.name === 'head';
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const A: V3 = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], B: V3 = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], Cc: V3 = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const area = 0.5 * Math.hypot(...cross(sub(B, A), sub(Cc, A)));
    const memb = (attr[a * 4 + 2] + attr[b * 4 + 2] + attr[c * 4 + 2]) / 3;
    if (memb > 0.35) continue;
    for (const kind of [0, 1]) {
      const dens = kind === 0 ? hs.app : hs.erect;
      if (!dens) continue;
      let expect = dens * area;
      while (expect > 0) {
        if (rnd() >= expect) break;
        expect -= 1;
        let u = rnd(), v = rnd();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const p = add(A, add(mul(sub(B, A), u), mul(sub(Cc, A), v)));
        const n = norm(add(add(mul([nrm[a * 3], nrm[a * 3 + 1], nrm[a * 3 + 2]], 1 - u - v), mul([nrm[b * 3], nrm[b * 3 + 1], nrm[b * 3 + 2]], u)), mul([nrm[c * 3], nrm[c * 3 + 1], nrm[c * 3 + 2]], v)));
        if (isHead) {
          const q = Math.hypot((p[0] - EYE_C[0]) / EYE_R[0], (p[1] - EYE_C[1]) / EYE_R[1], (Math.abs(p[2]) - EYE_C[2]) / EYE_R[2]);
          if (q < 1.12) continue; // no hairs on the eyes
        }
        if (kind === 1 && hs.erectWhere && rnd() > hs.erectWhere(p, n)) continue;
        let f = hs.flow(p, n);
        f = sub(f, mul(n, dot(f, n)));
        if (Math.hypot(...f) < 1e-4) f = norm(cross(n, [0, 0, 1]));
        f = norm(f);
        // scatter the direction a little within the surface
        const bt = cross(n, f);
        const sw = (rnd() - 0.5) * (kind === 0 ? 0.5 : 0.9);
        f = norm(add(f, mul(bt, sw)));
        const [l0, l1] = kind === 0 ? hs.appLen : hs.erectLen;
        out.push(p[0], p[1], p[2], n[0], n[1], n[2], f[0], f[1], f[2], l0 + (l1 - l0) * rnd(), rnd(), kind);
      }
    }
  }
  return new Float32Array(out);
}

export function buildAnt(): AntData {
  const t0 = performance.now();
  const rest = restPose();
  const proxy = restProxy(rest);
  const out: PartMesh[] = [];
  parts().forEach((p, i) => {
    const m = mesh(p, proxy, p.frame(rest));
    out.push({ name: p.name, ...m, hairs: scatterHairs(p, m, 1234 + i * 977) });
  });
  return { parts: out, ms: performance.now() - t0 };
}
