/**
 * Real B-DNA from the 1BNA crystal structure (Dickerson dodecamer, public domain).
 * Parses the ATOM records, fits the helical axis, re-registers the 12 base pairs onto an exact
 * 10.5 bp / 3.4 nm screw, adds the missing phosphates at the block seams, and returns one
 * repeating 12-bp "unit" in an axis frame (x, y perpendicular to the axis, z along it; angstroms).
 */

export const RISE_A = 34 / 10.5; // angstrom per base pair: 10.5 bp x 3.238 A = 3.4 nm pitch
export const TWIST = (2 * Math.PI) / 10.5; // radians per base pair
export const BLOCK_BP = 12;
export const BLOCK_RISE_A = BLOCK_BP * RISE_A;
export const BLOCK_TWIST = BLOCK_BP * TWIST;
export const A_PER_UNIT = 20; // 1 local unit = 2 nm = 20 angstrom

export interface UAtom {
  x: number; y: number; z: number; // angstrom, axis frame
  el: 'C' | 'N' | 'O' | 'P';
  name: string;
  res: 'A' | 'T' | 'G' | 'C' | '-';
  chain: string;
  seq: number;
  bb: boolean; // sugar-phosphate backbone
  phos: boolean; // phosphate group
  r: number; // van der Waals radius, angstrom
}

export interface Unit {
  atoms: UAtom[];
  origin: number; // index of the backbone carbon that sits at the world origin
  twistDeg: number; // fitted twist per bp of the raw crystal
  riseA: number; // fitted rise per bp of the raw crystal
  seamGap: number; // mean O3'..O5' gap across the block seam, angstrom
}

const VDW = { C: 1.7, N: 1.55, O: 1.52, P: 1.8 } as const;
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

interface Raw { name: string; res: UAtom['res']; chain: string; seq: number; p: V3; el: UAtom['el'] }

export function parsePdb(text: string): Raw[] {
  const out: Raw[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('ATOM')) continue; // ignore HETATM (water) and everything else
    const alt = line[16];
    if (alt !== ' ' && alt !== 'A') continue;
    const name = line.slice(12, 16).trim();
    const rn = line.slice(17, 20).trim();
    const res = rn === 'DA' ? 'A' : rn === 'DT' ? 'T' : rn === 'DG' ? 'G' : rn === 'DC' ? 'C' : null;
    if (!res) continue;
    let el = (line.slice(76, 78).trim() || name[0]).toUpperCase();
    if (el !== 'C' && el !== 'N' && el !== 'O' && el !== 'P') continue;
    out.push({
      name, res, chain: line[21], seq: parseInt(line.slice(22, 26), 10),
      p: [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))],
      el: el as UAtom['el'],
    });
  }
  return out;
}

const isPhos = (n: string) => n === 'P' || n === 'OP1' || n === 'OP2' || n === 'O1P' || n === 'O2P';
const isBackbone = (n: string) => isPhos(n) || n.includes("'");

function rotZ(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * x - s * y, s * x + c * y];
}

export function buildUnit(raw: Raw[]): Unit {
  const find = (chain: string, seq: number, pred: (r: Raw) => boolean) => raw.filter((r) => r.chain === chain && r.seq === seq && pred(r));
  // base-pair centroids (ring atoms of both partners) and the A-strand C1'
  const cen: V3[] = [];
  const c1: V3[] = [];
  for (let i = 1; i <= BLOCK_BP; i++) {
    const at = [...find('A', i, (r) => !isBackbone(r.name)), ...find('B', 25 - i, (r) => !isBackbone(r.name))];
    const m: V3 = [0, 0, 0];
    for (const a of at) { m[0] += a.p[0]; m[1] += a.p[1]; m[2] += a.p[2]; }
    cen.push([m[0] / at.length, m[1] / at.length, m[2] / at.length]);
    c1.push(find('A', i, (r) => r.name === "C1'")[0].p);
  }
  const mean: V3 = [0, 0, 0];
  for (const c of cen) { mean[0] += c[0] / cen.length; mean[1] += c[1] / cen.length; mean[2] += c[2] / cen.length; }
  // principal axis of the centroids by power iteration
  let d = norm(sub(cen[cen.length - 1], cen[0]));
  for (let it = 0; it < 40; it++) {
    const nd: V3 = [0, 0, 0];
    for (const c of cen) {
      const q = sub(c, mean);
      const k = dot(q, d);
      nd[0] += q[0] * k; nd[1] += q[1] * k; nd[2] += q[2] * k;
    }
    d = norm(nd);
  }
  if (dot(d, sub(cen[cen.length - 1], cen[0])) < 0) d = [-d[0], -d[1], -d[2]];
  const u = norm(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(d, u);
  const toFrame = (p: V3): V3 => { const q = sub(p, mean); return [dot(q, u), dot(q, v), dot(q, d)]; };

  // fitted twist and rise
  const ang = c1.map((p) => { const f = toFrame(p); return Math.atan2(f[1], f[0]); });
  let tw = 0;
  for (let i = 0; i < ang.length - 1; i++) {
    let dA = ang[i + 1] - ang[i];
    while (dA > Math.PI) dA -= 2 * Math.PI;
    while (dA < -Math.PI) dA += 2 * Math.PI;
    tw += dA / (ang.length - 1);
  }
  const cz = cen.map((c) => toFrame(c)[2]);
  const rise = (cz[cz.length - 1] - cz[0]) / (cz.length - 1);
  const zc = cz.reduce((a, b) => a + b, 0) / cz.length;

  // re-register onto an exact 10.5 bp/turn, 3.4 nm/turn screw (small, smooth shear of the crystal)
  const zs = RISE_A / rise;
  const dTw = (TWIST - tw) / RISE_A;
  const atoms: UAtom[] = raw.map((r) => {
    const f = toFrame(r.p);
    const z = zc + (f[2] - zc) * zs;
    const [x, y] = rotZ(f[0], f[1], dTw * (z - zc));
    return {
      x, y, z, el: r.el, name: r.name, res: r.res, chain: r.chain, seq: r.seq,
      bb: isBackbone(r.name), phos: isPhos(r.name), r: VDW[r.el],
    };
  });
  const place = (a: UAtom, k: number): V3 => {
    const [x, y] = rotZ(a.x, a.y, k * BLOCK_TWIST);
    return [x, y, a.z + k * BLOCK_RISE_A];
  };
  const get = (chain: string, seq: number, name: string) => atoms.find((a) => a.chain === chain && a.seq === seq && a.name === name)!;

  // phosphates the crystal lacks at its 5' ends: rebuild them across the seam between block 0 and block 1
  const seams: [UAtom, UAtom][] = [
    [get('A', 12, "O3'"), get('A', 1, "O5'")],
    [get('B', 13, "O5'"), get('B', 24, "O3'")],
  ];
  let gap = 0;
  for (const [a0, b1] of seams) {
    const a = place(a0, 0), b = place(b1, 1);
    gap += len(sub(a, b)) / seams.length;
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const out = norm([mid[0], mid[1], 0]);
    const perp: V3 = [-out[1], out[0], 0];
    const half = len(sub(a, b)) / 2;
    const h = Math.sqrt(Math.max(1.6 * 1.6 - half * half, 0.01));
    const P: V3 = [mid[0] + out[0] * h, mid[1] + out[1] * h, mid[2]];
    const mk = (name: string, el: UAtom['el'], p: V3): UAtom => ({
      x: p[0], y: p[1], z: p[2], el, name, res: '-', chain: a0.chain, seq: 0, bb: true, phos: true, r: VDW[el],
    });
    atoms.push(mk('P', 'P', P));
    for (const sgn of [1, -1]) {
      const dir = norm([out[0] * 0.75 + perp[0] * 0.55 * sgn, out[1] * 0.75 + perp[1] * 0.55 * sgn, 0.12 * sgn]);
      atoms.push(mk(sgn > 0 ? 'OP1' : 'OP2', 'O', [P[0] + dir[0] * 1.48, P[1] + dir[1] * 1.48, P[2] + dir[2] * 1.48]));
    }
  }
  // the world origin sits on the C4' of A6 (a sugar carbon in the backbone)
  const origin = atoms.indexOf(get('A', 6, "C4'"));
  return { atoms, origin, twistDeg: (tw * 180) / Math.PI, riseA: rise, seamGap: gap };
}

/** Per-atom ambient occlusion from the neighbours in the surrounding blocks (periodic, so the unit repeats). */
export function bakeOcclusion(unit: Unit): { ao: Float32Array; dir: Float32Array } {
  const A = unit.atoms;
  const n = A.length;
  const R = 11;
  const pts: V3[] = [];
  for (let k = -2; k <= 2; k++) for (const a of A) {
    const [x, y] = rotZ(a.x, a.y, k * BLOCK_TWIST);
    pts.push([x, y, a.z + k * BLOCK_RISE_A]);
  }
  const self = 2 * n;
  const sumW = new Float32Array(n);
  const dirs = new Float32Array(n * 3);
  let maxW = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[self + i];
    let sw = 0, dx = 0, dy = 0, dz = 0;
    for (let j = 0; j < pts.length; j++) {
      if (j === self + i) continue;
      const q = pts[j];
      const ex = q[0] - p[0], ey = q[1] - p[1], ez = q[2] - p[2];
      const dd = Math.hypot(ex, ey, ez);
      if (dd > R) continue;
      const w = (1 - dd / R) ** 2;
      sw += w; dx += (ex / dd) * w; dy += (ey / dd) * w; dz += (ez / dd) * w;
    }
    sumW[i] = sw;
    const m = Math.hypot(dx, dy, dz) || 1;
    const amt = Math.min(1, m / (sw || 1));
    dirs[i * 3] = (dx / m) * amt; dirs[i * 3 + 1] = (dy / m) * amt; dirs[i * 3 + 2] = (dz / m) * amt;
    if (sw > maxW) maxW = sw;
  }
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) ao[i] = 1 - 0.7 * Math.pow(sumW[i] / maxW, 1.3);
  return { ao, dir: dirs };
}
