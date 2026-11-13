/**
 * Small helpers for the E. coli landmark (copied from the cell landmark): seeded random numbers, CPU value noise, a tube builder
 * (parallel-transport frames, many tubes merged into one geometry) and a dispose bin.
 */
import * as THREE from 'three';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rand = () => number;

/** Uniform random unit vector. */
export function randDir(r: Rand, out = new THREE.Vector3()) {
  const u = r() * 2 - 1;
  const t = r() * Math.PI * 2;
  const k = Math.sqrt(1 - u * u);
  return out.set(k * Math.cos(t), u, k * Math.sin(t));
}

function ihash(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth 3D value noise in [0, 1). */
export function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(ihash(ix, iy, iz), ihash(ix + 1, iy, iz), fx), l(ihash(ix, iy + 1, iz), ihash(ix + 1, iy + 1, iz), fx), fy),
    l(l(ihash(ix, iy, iz + 1), ihash(ix + 1, iy, iz + 1), fx), l(ihash(ix, iy + 1, iz + 1), ihash(ix + 1, iy + 1, iz + 1), fx), fy),
    fz,
  );
}
export function fbm3(x: number, y: number, z: number, oct = 3) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { v += a * noise3(x, y, z); n += a; x = x * 2.07 + 1.7; y = y * 2.07 + 9.2; z = z * 2.07 + 3.1; a *= 0.5; }
  return v / n;
}

/** Collects GPU resources so dispose() can free everything. */
export class Bin {
  private items: { dispose(): void }[] = [];
  add<T extends { dispose(): void }>(x: T): T { this.items.push(x); return x; }
  dispose() { for (const x of this.items) x.dispose(); this.items.length = 0; }
}

/**
 * Accumulates tubes (each a polyline) into one indexed geometry. Attributes: position, normal,
 * uv (x = arc length in caller units, y = angle around the tube 0..1).
 */
export class TubeBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  private t = new THREE.Vector3();
  private n = new THREE.Vector3();
  private b = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  /**
   * pts: flat xyz list (≥ 2 points). radius(i) gives the radius at point i.
   * scale multiplies positions on output (e.g. nm → local units); arc is in input units.
   */
  add(pts: number[], radius: (i: number) => number, radial: number, scale = 1, arc0 = 0) {
    const count = pts.length / 3;
    if (count < 2) return;
    const base = this.pos.length / 3;
    const { t, n, b, tmp } = this;
    let arc = arc0;
    for (let i = 0; i < count; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(count - 1, i + 1);
      t.set(pts[i1 * 3] - pts[i0 * 3], pts[i1 * 3 + 1] - pts[i0 * 3 + 1], pts[i1 * 3 + 2] - pts[i0 * 3 + 2]).normalize();
      if (i === 0) {
        tmp.set(Math.abs(t.x) < 0.9 ? 1 : 0, Math.abs(t.x) < 0.9 ? 0 : 1, 0);
        n.crossVectors(t, tmp).normalize();
      } else {
        n.addScaledVector(t, -n.dot(t)).normalize();
        arc += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
      }
      b.crossVectors(t, n);
      const r = radius(i);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const nx = n.x * c + b.x * s, ny = n.y * c + b.y * s, nz = n.z * c + b.z * s;
        this.pos.push((pts[i * 3] + nx * r) * scale, (pts[i * 3 + 1] + ny * r) * scale, (pts[i * 3 + 2] + nz * r) * scale);
        this.nrm.push(nx, ny, nz);
        this.uv.push(arc, j / radial);
      }
    }
    const ring = radial + 1;
    for (let i = 0; i < count - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * ring + j, bb = a + ring;
        this.idx.push(a, bb, a + 1, bb, bb + 1, a + 1);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const nv = this.pos.length / 3;
    g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
