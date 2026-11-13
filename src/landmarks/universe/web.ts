/**
 * Procedural cosmic web (a statistical model, NOT a map of real galaxies).
 *
 * Method: a jittered-grid Voronoi tessellation stands in for the pattern gravity builds. In
 * simulations such as the Millennium Run, matter drains out of underdense regions (VOIDS, the
 * Voronoi cell interiors) onto flattened WALLS (cell faces), along the walls into FILAMENTS (cell
 * edges) and finally into dense NODES (cell vertices) where galaxy clusters sit. Each galaxy is
 * projected exactly onto the face / edge / vertex nearest a random point, the projection is
 * accepted only if it really lies on the Voronoi skeleton (no other seed is closer), and it is then
 * scattered by a small thickness. Two scales are nested: fine filaments (~110 Mly cells, typical
 * void size) whose density is modulated by a coarser web (~600 Mly cells, supercluster complexes),
 * so there is structure at every zoom.
 *
 * Coordinates are Mly in the galactic frame (see util.ts).
 */
import { COL, PopBuilder, Rng, T_ELL, T_GLOW, T_IRR, T_SPI, add, cross, dot, galDir, hash3, len, norm, scl, smooth, sub, vnoise, type Pop, type V3 } from './util';

/** Fine (void-sized) and coarse (supercluster-complex) cell sizes, Mly. */
/** Cell sizes of the nested webs, Mly: voids, superclusters, supercluster complexes, and a modulator. */
export const LEVEL_S = [110, 420, 1600, 6000];

/** The Local Void: a real ~150 Mly empty region next to the Local Sheet, on the supergalactic-north side. */
export const SGP: V3 = galDir(47.37, 6.32);          // supergalactic north pole, galactic frame
export const LOCAL_VOID: V3 = scl(SGP, 85);
export const LOCAL_VOID_R = 72;

class Voronoi {
  /** nearest seeds after a query, sorted by distance */
  n: V3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  nd = [0, 0, 0, 0];
  /** filament direction / wall normal from the last projection */
  dir: V3 = [0, 1, 0];
  /** 0..1 hash identifying the last filament (edge) found */
  edgeKey = 0;
  private bd = new Float64Array(4);
  private bp = new Float64Array(12);
  constructor(readonly S: number, readonly key: number) {}

  /** Fill n[0..3] / nd[0..3] with the four nearest seeds to p (jittered grid, one seed per cell). */
  query(p: V3) {
    const S = this.S, key = this.key;
    const px = p[0] / S, py = p[1] / S, pz = p[2] / S;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    const bd = this.bd, bp = this.bp;
    bd[0] = bd[1] = bd[2] = bd[3] = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const ix = cx + dx, iy = cy + dy, iz = cz + dz;
      let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ Math.imul(key, 0x165667b1);
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
      const sx = ix + (h >>> 0) / 4294967296;
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
      const sy = iy + (h >>> 0) / 4294967296;
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h ^= h >>> 13;
      const sz = iz + (h >>> 0) / 4294967296;
      const ex = sx - px, ey = sy - py, ez = sz - pz;
      const d = ex * ex + ey * ey + ez * ez;
      if (d >= bd[3]) continue;
      let i = 3;
      while (i > 0 && bd[i - 1] > d) { bd[i] = bd[i - 1]; bp[i * 3] = bp[i * 3 - 3]; bp[i * 3 + 1] = bp[i * 3 - 2]; bp[i * 3 + 2] = bp[i * 3 - 1]; i--; }
      bd[i] = d; bp[i * 3] = sx; bp[i * 3 + 1] = sy; bp[i * 3 + 2] = sz;
    }
    for (let i = 0; i < 4; i++) {
      const v = this.n[i];
      v[0] = bp[i * 3] * S; v[1] = bp[i * 3 + 1] * S; v[2] = bp[i * 3 + 2] * S;
      this.nd[i] = Math.sqrt(bd[i]) * S;
    }
  }

  /** F2 − F1 at p: 0 on a wall, ~S/2 deep inside a void. */
  wallDist(p: V3) { this.query(p); return this.nd[1] - this.nd[0]; }

  /** Is p really equidistant (within tol) to its supposed seeds, i.e. no other seed is nearer? */
  private valid(p: V3, r: number) { this.query(p); return this.nd[0] >= r - this.S * 2e-3; }

  /** Project x onto the nearest node (Voronoi vertex). */
  node(x: V3): V3 | null {
    this.query(x);
    const a: V3 = [this.n[0][0], this.n[0][1], this.n[0][2]];
    const B = sub(this.n[1], a), C = sub(this.n[2], a), D = sub(this.n[3], a);
    const det = dot(B, cross(C, D));
    if (Math.abs(det) < 1e-9 * this.S ** 3) return null;
    const y = scl(add(add(scl(cross(C, D), dot(B, B)), scl(cross(D, B), dot(C, C))), scl(cross(B, C), dot(D, D))), 1 / (2 * det));
    if (len(y) > this.S * 1.6) return null;
    const v = add(a, y);
    return this.valid(v, len(y)) ? v : null;
  }

  /** Project x onto the nearest filament (Voronoi edge). */
  filament(x: V3): V3 | null {
    this.query(x);
    const a: V3 = [this.n[0][0], this.n[0][1], this.n[0][2]];
    const u = sub(this.n[1], a), v = sub(this.n[2], a);
    const w = cross(u, v);
    const ww = dot(w, w);
    if (ww < 1e-12) return null;
    const cc = add(a, scl(add(scl(cross(v, w), dot(u, u)), scl(cross(w, u), dot(v, v))), 1 / (2 * ww)));
    const dir = norm(w);
    this.dir = dir;
    // identify this edge by the midpoint of its three seeds (independent of where on it we landed)
    this.edgeKey = hash3(Math.round((a[0] + this.n[1][0] + this.n[2][0]) / this.S * 3), Math.round((a[1] + this.n[1][1] + this.n[2][1]) / this.S * 3), Math.round((a[2] + this.n[1][2] + this.n[2][2]) / this.S * 3), this.key + 5);
    const p = add(cc, scl(dir, dot(sub(x, cc), dir)));
    const r = len(sub(p, a));
    if (r > this.S * 1.6) return null;
    return this.valid(p, r) ? p : null;
  }

  /** Project x onto the nearest wall (Voronoi face). */
  wall(x: V3): V3 | null {
    this.query(x);
    const a: V3 = [this.n[0][0], this.n[0][1], this.n[0][2]];
    const nrm = norm(sub(this.n[1], a));
    this.dir = nrm;
    const m = scl(add(a, this.n[1]), 0.5);
    const p = sub(x, scl(nrm, dot(sub(x, m), nrm)));
    return this.valid(p, len(sub(p, a))) ? p : null;
  }
}

type Kind = 'node' | 'fil' | 'wall' | 'field';
function pickKind(rng: Rng, mix: [number, number, number]): Kind {
  const u = rng.next();
  if (u < mix[0]) return 'node';
  if (u < mix[0] + mix[1]) return 'fil';
  if (u < mix[0] + mix[1] + mix[2]) return 'wall';
  return 'field';
}

/** One galaxy (type, colour, real size in Mly) for an environment. Clusters are full of old red ellipticals. */
function galaxyFor(rng: Rng, kind: Kind, pb: PopBuilder, p: V3, bright = 1) {
  const u = rng.next();
  const pEll = kind === 'node' ? 0.62 : kind === 'fil' ? 0.25 : kind === 'wall' ? 0.15 : 0.05;
  const pIrr = kind === 'node' ? 0.05 : kind === 'fil' ? 0.18 : kind === 'wall' ? 0.3 : 0.55;
  const seed = rng.next();
  if (u < pEll) {
    const sz = 0.03 + 0.12 * rng.next() ** 3;
    pb.push(p, tintC(COL.ell, bright, rng), sz, seed, T_ELL, 0.55 + 0.45 * rng.next());
  } else if (u < pEll + pIrr) {
    pb.push(p, tintC(COL.irr, bright * 0.9, rng), 0.012 + 0.03 * rng.next(), seed, T_IRR, 0.5 + 0.5 * rng.next());
  } else {
    const q = Math.max(0.12, rng.next()); // |cos i| is uniform for random inclinations
    pb.push(p, tintC(COL.spi, bright, rng), 0.04 + 0.08 * rng.next() ** 2, seed, T_SPI, q);
  }
}
const tintC = (c: V3, k: number, rng: Rng): V3 => {
  const w = 1 + rng.gauss() * 0.12;
  return [c[0] * k * w, c[1] * k * w, c[2] * k * w];
};

export interface WebOptions {
  count: number;
  seed: number;
  /** Random point inside the population's region (before projection). */
  where: (rng: Rng) => V3;
  /** Which skeleton carries the galaxies: fine (galaxies) or mid (whole groups, used far away). */
  level: 0 | 1 | 2;
  /** Strength of the coarser web's modulation 0..1. */
  coarse: number;
  /** Extra acceptance test (e.g. carve the Local Void), on the final position. */
  accept?: (p: V3, rng: Rng) => boolean;
  /** Point type override (far populations are soft glows standing for whole groups). */
  glow?: boolean;
  mix?: [number, number, number];
  /** Emit a small run of galaxies per projection (cheaper; reads as groups when resolved). Default true. */
  multi?: boolean;
  /** Diffuse-glow sprites per galaxy (0 = none): soft haze laid exactly on the skeleton. */
  haze?: number;
}

const LEVELS = LEVEL_S.map((S, i) => new Voronoi(S, 11 + i * 12));

/** Node richness: some nodes are rich clusters, most are poor groups. */
function richness(v: Voronoi, p: V3) {
  const S = v.S;
  return hash3(Math.round(p[0] / S * 4), Math.round(p[1] / S * 4), Math.round(p[2] / S * 4), v.key + 9) ** 2.2;
}

/**
 * Incremental builder: call step(ms) repeatedly (e.g. once per frame or between timeouts) until it
 * returns true, so a few hundred thousand galaxies never block the page for long. Each successful
 * projection seeds several galaxies (a cluster at a node, a short run along a filament, a patch of a
 * wall), which keeps the cost per galaxy low.
 */
export class WebBuilder {
  readonly pb: PopBuilder;
  /** soft glow sprites along filaments / around nodes (light from countless faint galaxies) */
  readonly haze: PopBuilder;
  private rng: Rng;
  private web: Voronoi;
  private coarseWeb: Voronoi;
  private mix: [number, number, number];
  private guard: number;
  constructor(private o: WebOptions) {
    this.pb = new PopBuilder(o.count);
    this.haze = new PopBuilder(Math.max(1, Math.round(o.count * (o.haze ?? 0))));
    this.rng = new Rng(o.seed);
    this.web = LEVELS[o.level];
    this.coarseWeb = LEVELS[o.level + 1];
    this.mix = o.mix ?? [0.24, 0.46, 0.2];
    this.guard = o.count * 40;
  }
  get done() { return this.pb.count >= this.o.count || this.guard <= 0; }

  /** Work for about `ms` milliseconds; returns true when finished. */
  step(ms: number): boolean {
    const t0 = performance.now();
    let k = 0;
    while (!this.done) {
      this.one();
      if ((++k & 63) === 0 && performance.now() - t0 > ms) break;
    }
    return this.done;
  }

  build(): Pop { while (!this.step(1e9)); return this.pb.build(); }

  private glow(p0: V3, size: number, c: V3, k: number) {
    const o = this.o;
    if (!o.haze || this.haze.count >= this.haze.pos.length / 3) return;
    const p = this.warp(p0);
    if (o.accept && !o.accept(p, this.rng)) return;
    this.haze.push(p, [c[0] * k, c[1] * k, c[2] * k], size, this.rng.next(), T_GLOW, 1);
  }
  /** How many haze sprites to lay for one projection (expected value = haze fraction × k). */
  private hazeN(k: number) { const c = (this.o.haze ?? 0) * 1.6 * k; return Math.floor(c) + (this.rng.next() < c % 1 ? 1 : 0); }

  /** Smooth warp of space so Voronoi edges bend into curving filaments (same field for galaxies and haze). */
  private warp(p: V3): V3 {
    const S = this.web.S, f = 1.4 / S, a = 0.09 * S;
    return [
      p[0] + a * vnoise(p[0] * f, p[1] * f, p[2] * f, 61),
      p[1] + a * vnoise(p[0] * f, p[1] * f, p[2] * f, 62),
      p[2] + a * vnoise(p[0] * f, p[1] * f, p[2] * f, 63),
    ];
  }

  private emit(p0: V3, kind: Kind, bright: number) {
    const o = this.o, rng = this.rng;
    if (this.pb.count >= o.count) return;
    const p = this.warp(p0);
    if (o.accept && !o.accept(p, rng)) return;
    if (o.glow) {
      const c = kind === 'node' ? COL.ell : kind === 'field' ? COL.irr : rng.next() < 0.5 ? COL.spi : COL.ell;
      this.pb.push(p, tintC(c, bright, rng), 1, rng.next(), T_GLOW, 1);
    } else {
      galaxyFor(rng, kind, this.pb, p, bright);
    }
  }

  private one() {
    const o = this.o, rng = this.rng, web = this.web, S = web.S;
    this.guard--;
    let x = o.where(rng);
    const kind = pickKind(rng, this.mix);
    // larger-scale structure: most galaxies start near the coarser web's filaments and walls, so
    // fine filaments bunch into superclusters around even bigger voids
    if (rng.next() < o.coarse) {
      const cw = this.coarseWeb;
      const onFil = rng.next() < 0.7;
      const c = onFil ? cw.filament(x) : cw.wall(x);
      if (!c) return;
      x = add(c, rng.gauss3(cw.S * (onFil ? 0.075 : 0.04)));
    }
    if (kind === 'node') {
      const v = web.node(x);
      if (!v) return;
      const rich = richness(web, v);
      if (rng.next() > 0.12 + 0.88 * rich) return;
      // a cluster or group: a tight core and a long tail (roughly an NFW / King profile)
      const m = o.multi === false ? 1 : 1 + Math.floor(rich * 4 * rng.next());
      for (let i = 0; i < m; i++) {
        const u = rng.next();
        const r = S * (0.025 + 0.05 * rich) * Math.min(5, u / Math.max(0.05, 1 - u));
        this.emit(add(v, scl(rng.dir(), r)), kind, 0.55 + 0.2 * rich);
      }
      for (let h = this.hazeN(1); h > 0; h--) this.glow(add(v, rng.gauss3(S * 0.02)), S * (0.05 + 0.05 * rich), [0.95, 0.85, 0.75], 0.55);
    } else if (kind === 'fil') {
      const f = web.filament(x);
      if (!f) return;
      const dir = web.dir;
      // a few filaments are thick and rich, most are thin and faint
      const fr = web.edgeKey;
      if (rng.next() > 0.12 + 0.88 * fr * fr) return;
      // beads: galaxy groups strung along the filament
      const bead = smooth(-0.25, 0.55, vnoise(f[0] / S * 6, f[1] / S * 6, f[2] / S * 6, 5));
      if (rng.next() > 0.22 + 0.78 * bead) return;
      for (let i = 0; i < (o.multi === false ? 1 : 3); i++) this.emit(add(add(f, scl(dir, (rng.next() - 0.5) * S * 0.1)), rng.gauss3(S * 0.028)), kind, 1);
      for (let h = this.hazeN(1.3); h > 0; h--) this.glow(add(f, scl(dir, (rng.next() - 0.5) * S * 0.2)), S * 0.045, [0.82, 0.86, 1.0], 1.0);
    } else if (kind === 'wall') {
      const w = web.wall(x);
      if (!w) return;
      const patch = smooth(-0.1, 0.7, vnoise(w[0] / S * 3, w[1] / S * 3, w[2] / S * 3, 8));
      if (rng.next() > 0.15 + 0.85 * patch) return;
      const n = web.dir;
      for (let i = 0; i < (o.multi === false ? 1 : 2); i++) {
        const j = rng.gauss3(S * 0.05);
        const jn = dot(j, n);
        this.emit(add(add(w, sub(j, scl(n, jn))), rng.gauss3(S * 0.012)), kind, 0.8);
      }
      for (let h = this.hazeN(0.5); h > 0; h--) this.glow(add(w, rng.gauss3(S * 0.03)), S * 0.07, [0.7, 0.78, 1.0], 0.35);
    } else {
      if (web.wallDist(x) < S * 0.18) return;
      if (rng.next() > 0.35) return;
      this.emit(x, kind, 0.55);
    }
  }
}

export const buildWeb = (o: WebOptions): Pop => new WebBuilder(o).build();
