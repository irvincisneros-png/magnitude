/**
 * Close-up chromatin: "beads on a string". Each nucleosome is a histone octamer (~11 nm disc)
 * wrapped by 1.65 turns of DNA (2 nm wide, 147 base pairs), joined by linker DNA, in irregular
 * zig-zag 10 nm fibres that converge on the origin. One fibre runs through the origin along +X in
 * a nucleosome-free stretch, which is where the DNA double-helix landmark takes over.
 * Built in nanometres, scaled to local units.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { NM, NUCLEOLUS_C, NUCLEOLUS_R, nucRho, type Shared } from './layout';
import { solidMaterial } from './solid';
import { Bin, TubeBuilder, randDir, rng, type Rand } from './util';

const BUDGET = { low: 1000, medium: 1900, high: 2800 };
const FIBRES = { low: { n: 20, len: 460, radial: 5 }, medium: { n: 28, len: 520, radial: 6 }, high: { n: 36, len: 580, radial: 7 } };
const R_WRAP = 4.2;               // DNA superhelix radius (nm)
const PHI_M = 0.825 * Math.PI * 2; // 1.65 turns
const RISE = 2.1;                  // half the axial span of the wrap (nm)
const STEP = 11.5;                 // backbone step between nucleosomes (nm)
const ZIG = 5.5;                   // zig-zag offset (nm)
const MIN_SEP = 10.8;              // closest allowed nucleosome centres (nm)
const CLEAR = 22;                  // nucleosome-free radius around the origin (nm)
const R_MAX = 480;                 // radius of the modelled region (nm)

type V = THREE.Vector3;
interface Nuc { p: V; A: V; U: V; W: V }

class Hash {
  private m = new Map<number, V[]>();
  private key(x: number, y: number, z: number) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }
  add(p: V) {
    const k = this.key(Math.floor(p.x / 12), Math.floor(p.y / 12), Math.floor(p.z / 12));
    let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); } a.push(p);
  }
  free(p: V, d: number) {
    const cx = Math.floor(p.x / 12), cy = Math.floor(p.y / 12), cz = Math.floor(p.z / 12);
    const d2 = d * d;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const a = this.m.get(this.key(cx + x, cy + y, cz + z));
      if (a) for (const o of a) if (o.distanceToSquared(p) < d2) return false;
    }
    return true;
  }
}

/** Grows one fibre of up to `count` nucleosomes from backbone point B along T. */
function chain(r: Rand, hash: Hash, B0: V, T0: V, count: number): Nuc[] {
  const out: Nuc[] = [];
  const B = B0.clone(), T = T0.clone().normalize();
  const N = new THREE.Vector3().crossVectors(T, randDir(r)).normalize();
  const tmp = new THREE.Vector3(), cand = new THREE.Vector3(), Tc = new THREE.Vector3(), Nc = new THREE.Vector3();
  let sign = 1;
  for (let k = 0; k < count; k++) {
    let placed = false;
    for (let attempt = 0; attempt < 9 && !placed; attempt++) {
      Tc.copy(T).addScaledVector(randDir(r, tmp), 0.3 + attempt * 0.25);
      if (B.length() > R_MAX) Tc.addScaledVector(B, -0.5 / B.length());
      Tc.normalize();
      // rotate the zig-zag normal around the fibre by ~ ±(100–150°)
      Nc.copy(N).addScaledVector(Tc, -N.dot(Tc)).normalize();
      const ang = sign * (1.75 + r() * 0.8);
      tmp.crossVectors(Tc, Nc);
      Nc.multiplyScalar(Math.cos(ang)).addScaledVector(tmp, Math.sin(ang)).normalize();
      const Bn = B.clone().addScaledVector(Tc, k === 0 ? 0 : STEP);
      cand.copy(Bn).addScaledVector(Nc, ZIG);
      if (cand.length() < CLEAR || !hash.free(cand, MIN_SEP)) continue;
      placed = true;
      B.copy(Bn); T.copy(Tc); N.copy(Nc);
      const U = Nc.clone().negate();
      const A = new THREE.Vector3().crossVectors(Tc, Nc).normalize();
      const tilt = (r() - 0.5) * 1.0;
      A.multiplyScalar(Math.cos(tilt)).addScaledVector(Tc, Math.sin(tilt)).normalize();
      U.addScaledVector(A, -U.dot(A)).normalize();
      const W = new THREE.Vector3().crossVectors(A, U);
      const p = cand.clone();
      hash.add(p);
      out.push({ p, A, U, W });
    }
    if (!placed) break;
    sign = -sign;
  }
  return out;
}

function wrapPoint(n: Nuc, phi: number, out: V) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return out.copy(n.p).addScaledVector(n.U, R_WRAP * c).addScaledVector(n.W, R_WRAP * s).addScaledVector(n.A, RISE * phi / PHI_M);
}
function wrapTangent(n: Nuc, phi: number, out: V) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return out.set(0, 0, 0).addScaledVector(n.U, -R_WRAP * s).addScaledVector(n.W, R_WRAP * c).addScaledVector(n.A, RISE / PHI_M).normalize();
}

function hermite(pts: number[], E: V, tE: V, S: V, tS: V, spacing: number) {
  const L = E.distanceTo(S);
  const n = Math.max(2, Math.ceil(L / spacing));
  const k = L * 1.1;
  for (let i = 1; i < n; i++) {
    const t = i / n, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    pts.push(
      h00 * E.x + h10 * tE.x * k + h01 * S.x + h11 * tS.x * k,
      h00 * E.y + h10 * tE.y * k + h01 * S.y + h11 * tS.y * k,
      h00 * E.z + h10 * tE.z * k + h01 * S.z + h11 * tS.z * k,
    );
  }
}

/** DNA centre-line (nm) through a fibre; optional via-point (with tangent) inserted after nucleosome `viaAfter`. */
function dnaPath(nucs: Nuc[], spacing: number, lead: number, via?: { after: number; p: V; t: V }) {
  const pts: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), ta = new THREE.Vector3(), tb = new THREE.Vector3();
  const dphi = spacing / R_WRAP;
  // free end leading in
  wrapPoint(nucs[0], -PHI_M, a); wrapTangent(nucs[0], -PHI_M, ta);
  pts.push(a.x - ta.x * lead, a.y - ta.y * lead, a.z - ta.z * lead);
  for (let k = 0; k < nucs.length; k++) {
    const n = nucs[k];
    for (let phi = -PHI_M; phi <= PHI_M + 1e-6; phi += dphi) { wrapPoint(n, phi, a); pts.push(a.x, a.y, a.z); }
    wrapPoint(n, PHI_M, a); wrapTangent(n, PHI_M, ta);
    if (k + 1 < nucs.length) {
      const m = nucs[k + 1];
      wrapPoint(m, -PHI_M, b); wrapTangent(m, -PHI_M, tb);
      if (via && via.after === k) {
        hermite(pts, a, ta, via.p, via.t, spacing);
        pts.push(via.p.x, via.p.y, via.p.z);
        hermite(pts, via.p, via.t, b, tb, spacing);
      } else {
        hermite(pts, a, ta, b, tb, spacing);
      }
    } else {
      pts.push(a.x + ta.x * lead, a.y + ta.y * lead, a.z + ta.z * lead);
    }
  }
  return pts;
}

function histoneGeometry() {
  const g = new THREE.SphereGeometry(1, 20, 12);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // SphereGeometry poles are on Y; make the disc axis Z.
    const x = v.x, y = v.z, z = v.y;
    const th = Math.atan2(y, x);
    const blend = 1 / (1 + Math.exp(-z * 6));
    const lobes = 1 + 0.11 * Math.cos(4 * th + blend * Math.PI / 4) ** 2;
    const rad = 3.25 * lobes;
    p.setXYZ(i, x * rad, y * rad, z * 2.75 * (1 + 0.06 * Math.cos(4 * th)));
  }
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

export class Chromatin {
  readonly group = new THREE.Group();
  private qbin = new Bin();
  private bin = new Bin();
  dnaMat: THREE.ShaderMaterial;
  histMat: THREE.ShaderMaterial;
  private dna?: THREE.Mesh;
  fibreMat: THREE.ShaderMaterial;
  private fibres?: THREE.Mesh;
  private hist?: THREE.InstancedMesh;
  private histGeo: THREE.BufferGeometry;
  /** Position (local units) of the nucleosome nearest the origin, for the label. */
  labelPos = new THREE.Vector3(24 * NM, 6 * NM, 0);

  constructor(shared: Shared) {
    this.dnaMat = this.bin.add(solidMaterial(shared, {
      tint: new THREE.Color(0.4, 0.52, 0.85), rim: new THREE.Color(0.6, 0.78, 1.0), rimA: 0.55,
      bumpS: 0.25 * NM, spec: 0.45, wrap: 0.6, trans: 0.7, near: 0.35, defines: { DNA: 1 },
    }));
    this.histMat = this.bin.add(solidMaterial(shared, {
      tint: new THREE.Color(0.78, 0.34, 0.30), rim: new THREE.Color(1.0, 0.66, 0.55), rimA: 0.7,
      bumpF: 0.42, bumpS: 0.22 * NM, spec: 0.3, wrap: 0.8, trans: 1.0, near: 0.35,
    }));
    this.histGeo = this.bin.add(histoneGeometry());
    this.fibreMat = this.bin.add(solidMaterial(shared, {
      tint: new THREE.Color(0.58, 0.3, 0.8), rim: new THREE.Color(0.95, 0.6, 1.0), rimA: 0.7,
      bumpS: 6 * NM, spec: 0.3, wrap: 0.8, trans: 1.0, near: 0.3, emit: 0.06, defines: { BEADS: 1, ACOLOR: 1 },
    }));
  }

  build(q: Quality) {
    this.qbin.dispose();
    if (this.dna) this.group.remove(this.dna);
    if (this.hist) this.group.remove(this.hist);
    if (this.fibres) this.group.remove(this.fibres);
    this.fibres = this.buildFibres(q);
    this.group.add(this.fibres);
    const r = rng(77);
    const hash = new Hash();
    const budget = BUDGET[q];
    const spacing = q === 'low' ? 3.6 : 3.0;
    const radial = q === 'low' ? 5 : 6;
    const tubes = new TubeBuilder();
    const all: Nuc[] = [];

    // Fibre 0: through the origin along +X (nucleosome-free stretch around the origin).
    const back = chain(r, hash, new THREE.Vector3(-CLEAR - 6, 0, 0), new THREE.Vector3(-1, 0.1, 0.05), 70);
    const fwd = chain(r, hash, new THREE.Vector3(CLEAR + 6, 0, 0), new THREE.Vector3(1, -0.05, 0.1), 70);
    const f0 = [...back.reverse(), ...fwd];
    if (fwd.length) this.labelPos.copy(fwd[0].p).multiplyScalar(NM);
    if (back.length && fwd.length) {
      const pts = dnaPath(f0, spacing, 40, { after: back.length - 1, p: new THREE.Vector3(0, 0, 0), t: new THREE.Vector3(1, 0, 0) });
      tubes.add(pts, () => 1.0, radial, NM);
      all.push(...f0);
    }
    // Other fibres, starting mostly close to the origin.
    let guard = 0;
    while (all.length < budget && guard++ < 4000) {
      const rad = 30 + 420 * r() ** 1.5;
      const B = randDir(r).multiplyScalar(rad);
      const T = randDir(r);
      if (T.dot(B) > 0) T.addScaledVector(B, -1.2 / rad).normalize(); // grow inward-ish first
      const nucs = chain(r, hash, B, T, Math.min(budget - all.length, 25 + Math.floor(r() * 70)));
      if (nucs.length < 4) continue;
      tubes.add(dnaPath(nucs, spacing, 25), () => 1.0, radial, NM);
      all.push(...nucs);
    }

    const dg = this.qbin.add(tubes.build());
    this.dna = new THREE.Mesh(dg, this.dnaMat);
    this.dna.frustumCulled = false;
    this.dna.renderOrder = 2;
    this.hist = new THREE.InstancedMesh(this.histGeo, this.histMat, all.length);
    this.qbin.add({ dispose: () => this.hist?.dispose() });
    const m = new THREE.Matrix4(), s = new THREE.Vector3(NM, NM, NM), pos = new THREE.Vector3();
    all.forEach((n, i) => {
      m.makeBasis(n.U, n.W, n.A);
      m.scale(s);
      pos.copy(n.p).multiplyScalar(NM);
      m.setPosition(pos);
      this.hist!.setMatrixAt(i, m);
    });
    this.hist.instanceMatrix.needsUpdate = true;
    this.hist.frustumCulled = false;
    this.hist.renderOrder = 2;
    this.group.add(this.dna, this.hist);
  }

  /**
   * Micrometre-scale chromatin: long, tangled ~30 nm fibres winding around the nucleosome zone
   * (they are the same strings of beads, seen from further away).
   */
  private buildFibres(q: Quality) {
    const cfg = FIBRES[q];
    const r = rng(303);
    const tubes = new TubeBuilder();
    const p = new THREE.Vector3(), dir = new THREE.Vector3(), tmp = new THREE.Vector3();
    const step = 0.00055;
    for (let i = 0; i < cfg.n; i++) {
      for (let k = 0; k < 50; k++) {
        randDir(r, p).multiplyScalar(0.018 + 0.055 * r());
        if (nucRho(p) < 0.9 && p.distanceTo(NUCLEOLUS_C) > NUCLEOLUS_R * 1.2) break;
      }
      randDir(r, dir);
      const pts: number[] = [];
      for (let k = 0; k < cfg.len; k++) {
        dir.addScaledVector(randDir(r, tmp), 0.2);
        const len = p.length();
        if (len < 0.016) dir.addScaledVector(p, 0.6 / len);
        if (len > 0.085) dir.addScaledVector(p, -0.4 / len);
        if (nucRho(p) > 0.93) dir.addScaledVector(p, -0.6 / len);
        tmp.subVectors(p, NUCLEOLUS_C);
        if (tmp.length() < NUCLEOLUS_R * 1.15) dir.addScaledVector(tmp, 0.8 / tmp.length());
        dir.normalize();
        p.addScaledVector(dir, step);
        pts.push(p.x, p.y, p.z);
      }
      tubes.add(pts, (k) => 12 * NM * Math.min(1, k / 6, (cfg.len - 1 - k) / 6 + 0.2), cfg.radial, 1);
    }
    const g = this.qbin.add(tubes.build());
    // per-fibre tint (different chromosomes): violet ↔ magenta ↔ blue
    const nv = g.attributes.position.count, per = nv / cfg.n;
    const col = new Float32Array(nv * 3);
    const c = new THREE.Color(), A = new THREE.Color(1, 0.85, 1.05), B = new THREE.Color(1.25, 0.8, 0.85), C = new THREE.Color(0.8, 0.95, 1.25);
    for (let i = 0; i < cfg.n; i++) {
      const t = r();
      c.copy(A).lerp(t < 0.5 ? B : C, (t < 0.5 ? t : t - 0.5) * 2).multiplyScalar(0.75 + 0.5 * r());
      for (let k = i * per; k < (i + 1) * per; k++) col.set([c.r, c.g, c.b], k * 3);
    }
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, this.fibreMat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    return m;
  }

  /** fade: nucleosome visibility (dithered); fibreFade: fibre visibility; clear: radius (local) kept free around the origin for the DNA child. */
  update(fade: number, fibreFade: number, clear: number) {
    this.group.visible = fade > 0.001 || fibreFade > 0.001;
    if (this.dna) this.dna.visible = fade > 0.001;
    if (this.hist) this.hist.visible = fade > 0.001;
    if (this.fibres) this.fibres.visible = fibreFade > 0.001;
    this.fibreMat.uniforms.uFade.value = fibreFade;
    this.dnaMat.uniforms.uFade.value = fade;
    this.histMat.uniforms.uFade.value = fade;
    this.dnaMat.uniforms.uClearR.value = clear;
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
