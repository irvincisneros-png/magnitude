/**
 * The nucleus: double nuclear envelope with pore complexes, the nucleolus, chromatin as
 * chromosome territories of tangled fibres (heterochromatin denser at the edge and around the
 * nucleolus), fine nucleoplasm proteins near the origin, and the melanin cap that shields the
 * DNA from ultraviolet light.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../../engine/types';
import { NM, NUC_C, NUC_R, NUCLEOLUS_C, NUCLEOLUS_R, PAL, nucRho, nucShape, type Shared } from './layout';
import { shellGeometry, shellMaterial } from './membrane';
import { pointsGeometry, pointsMaterial } from './points';
import { solidMaterial } from './solid';
import { Bin, fbm3, randDir, rng } from './util';

const COUNTS = {
  low: { pores: 700, chrom: 22000, specks: 4000, melano: 90, env: 28 },
  medium: { pores: 1200, chrom: 45000, specks: 9000, melano: 140, env: 40 },
  high: { pores: 1500, chrom: 70000, specks: 16000, melano: 170, env: 56 },
};

/** Radius (local units) of the chromatin-free core that the nucleosome model replaces close up. */
export const INNER_R = 0.075;

export class Nucleus {
  readonly group = new THREE.Group();
  private bin = new Bin();
  private qbin = new Bin();
  envOuter!: THREE.ShaderMaterial;
  envOuterBack!: THREE.ShaderMaterial;
  envInner!: THREE.ShaderMaterial;
  poreMat: THREE.ShaderMaterial;
  nucleolusMat: THREE.ShaderMaterial;
  melanoMat: THREE.ShaderMaterial;
  chromMat: THREE.ShaderMaterial;
  speckMat: THREE.ShaderMaterial;
  pores?: THREE.InstancedMesh;
  chrom?: THREE.Points;
  specks?: THREE.Points;
  melano?: THREE.InstancedMesh;
  private shells: THREE.Mesh[] = [];
  nucleolus: THREE.Mesh;

  constructor(shared: Shared) {
    const b = this.bin;
    const envOpts = {
      tint: PAL.envelope, rim: PAL.envelopeRim, alpha: 0.05, rimA: 0.55,
      bumpF: 60, bumpS: 0.0012, und: 0.004, undF: 9, near: 0.12,
    };
    this.envOuter = b.add(shellMaterial(shared, envOpts, THREE.FrontSide));
    this.envOuterBack = b.add(shellMaterial(shared, envOpts, THREE.BackSide));
    this.envInner = b.add(shellMaterial(shared, { ...envOpts, alpha: 0.03, rimA: 0.3 }, THREE.DoubleSide));

    this.poreMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.32, 0.25, 0.52), rim: new THREE.Color(0.7, 0.58, 0.95), rimA: 0.3,
      emit: 0.1, bumpF: 3, bumpS: 0, near: 0.3, spec: 0.3,
    }));

    // Nucleolus: dense granular body
    const ng = shellGeometry(5, NUCLEOLUS_C, new THREE.Vector3(NUCLEOLUS_R, NUCLEOLUS_R * 0.9, NUCLEOLUS_R),
      (x, y, z) => 0.82 + 0.36 * fbm3(x * 2.2 + 3, y * 2.2, z * 2.2 - 1, 3));
    b.add(ng);
    this.nucleolusMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.30, 0.10, 0.36), rim: new THREE.Color(0.85, 0.45, 0.95), rimA: 0.9,
      bumpF: 380, bumpS: 0.0007, wrap: 0.8, trans: 0.7, spec: 0.2, near: 0.3, emit: 0.05,
    }));
    this.nucleolus = new THREE.Mesh(ng, this.nucleolusMat);
    this.group.add(this.nucleolus);

    this.melanoMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.13, 0.065, 0.03), rim: new THREE.Color(0.7, 0.4, 0.18), rimA: 0.6,
      bumpF: 4, bumpS: 0.0004, spec: 0.6, trans: 0.2, near: 0.15,
    }));

    this.chromMat = b.add(pointsMaterial(shared, { alpha: 0.32, maxPx: 34, drift: 0.15, innerR: INNER_R }));
    this.speckMat = b.add(pointsMaterial(shared, { alpha: 0.5, maxPx: 26, drift: 1.6 }));
  }

  build(q: Quality) {
    this.qbin.dispose();
    for (const o of [...this.shells, this.pores, this.chrom, this.specks, this.melano]) if (o) this.group.remove(o);
    this.shells = [];
    const c = COUNTS[q];
    const qb = this.qbin;

    // Envelope: outer membrane (front + back faces) and the inner membrane ~40 nm inside it.
    const outer = qb.add(shellGeometry(c.env, NUC_C, NUC_R, nucShape));
    const inner = qb.add(shellGeometry(Math.round(c.env * 0.7), NUC_C, NUC_R, nucShape, 0.985));
    const mBack = new THREE.Mesh(outer, this.envOuterBack); mBack.renderOrder = 4;
    const mIn = new THREE.Mesh(inner, this.envInner); mIn.renderOrder = 5;
    const mFront = new THREE.Mesh(outer, this.envOuter); mFront.renderOrder = 7;
    this.shells.push(mBack, mIn, mFront);
    this.group.add(mBack, mIn, mFront);

    this.pores = this.buildPores(c.pores);
    this.group.add(this.pores);
    this.chrom = this.buildChromatin(c.chrom);
    this.group.add(this.chrom);
    this.specks = this.buildSpecks(c.specks);
    this.group.add(this.specks);
    this.melano = this.buildMelano(c.melano);
    this.group.add(this.melano);
  }

  private buildPores(n: number) {
    const r = rng(11);
    const torus = new THREE.TorusGeometry(1, 0.42, 6, 28);
    const p = torus.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const th = Math.atan2(v.y, v.x);
      const cx = Math.cos(th), cy = Math.sin(th);
      const k = 1 + 0.32 * Math.max(0, Math.cos(8 * th)) ** 2;
      const ox = v.x - cx, oy = v.y - cy;
      p.setXYZ(i, cx + ox * k, cy + oy * k, v.z * k);
    }
    torus.computeVertexNormals();
    const plug = new THREE.SphereGeometry(0.38, 8, 6);
    plug.scale(1, 1, 0.7);
    const g = mergeGeometries([torus, plug])!;
    torus.dispose(); plug.dispose();
    this.qbin.add(g);
    const mesh = new THREE.InstancedMesh(g, this.poreMat, n);
    const pts: THREE.Vector3[] = [];
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3();
    const z = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3();
    let tries = 0;
    while (pts.length < n && tries < n * 30) {
      tries++;
      randDir(r, v);
      const rad = nucShape(v.x, v.y, v.z);
      const pos = new THREE.Vector3(v.x * NUC_R.x * rad, v.y * NUC_R.y * rad, v.z * NUC_R.z * rad);
      let ok = true;
      for (const o of pts) if (o.distanceToSquared(pos) < 0.0062 * 0.0062) { ok = false; break; }
      if (!ok) continue;
      pts.push(pos.clone());
      nrm.set(v.x / NUC_R.x, v.y / NUC_R.y, v.z / NUC_R.z).normalize();
      qt.setFromUnitVectors(z, nrm);
      const s = (48 + r() * 8) * NM;
      sc.set(s, s, s);
      pos.add(NUC_C);
      m.compose(pos, qt, sc);
      mesh.setMatrixAt(pts.length - 1, m);
    }
    mesh.count = pts.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.renderOrder = 3;
    return mesh;
  }

  private buildChromatin(n: number) {
    const r = rng(23);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
    const pal = [
      new THREE.Color(0.55, 0.26, 0.95), new THREE.Color(0.82, 0.28, 0.72), new THREE.Color(0.38, 0.36, 1.0),
      new THREE.Color(0.68, 0.32, 0.9), new THREE.Color(0.95, 0.4, 0.62),
    ];
    const terr: { c: THREE.Vector3; col: THREE.Color }[] = [];
    const v = new THREE.Vector3(), p = new THREE.Vector3(), dir = new THREE.Vector3(), tmp = new THREE.Vector3();
    const nucleolusAbs = NUCLEOLUS_C;
    while (terr.length < 46) {
      randDir(r, v).multiplyScalar(Math.cbrt(r()) * 0.85);
      p.set(NUC_C.x + v.x * NUC_R.x, NUC_C.y + v.y * NUC_R.y, NUC_C.z + v.z * NUC_R.z);
      if (p.distanceTo(nucleolusAbs) < NUCLEOLUS_R + 0.02) continue;
      const cc = pal[Math.floor(r() * pal.length)].clone().lerp(pal[Math.floor(r() * pal.length)], r());
      terr.push({ c: p.clone(), col: cc });
    }
    let i = 0;
    const emit = (x: THREE.Vector3, cc: THREE.Color, bright: number, s: number) => {
      if (i >= n) return;
      pos[i * 3] = x.x + (r() - 0.5) * 0.0003; pos[i * 3 + 1] = x.y + (r() - 0.5) * 0.0003; pos[i * 3 + 2] = x.z + (r() - 0.5) * 0.0003;
      col[i * 3] = cc.r * bright; col[i * 3 + 1] = cc.g * bright; col[i * 3 + 2] = cc.b * bright;
      size[i] = s; seed[i] = r();
      i++;
    };
    const step = 0.0009;
    const nWalk = n * 0.8;
    // Territories: tangled fibres confined near each territory centre.
    let t = 0;
    while (i < nWalk) {
      const T = terr[t++ % terr.length];
      p.copy(T.c).addScaledVector(randDir(r, tmp), 0.02 * r());
      randDir(r, dir);
      const len = 900 + Math.floor(r() * 700);
      for (let k = 0; k < len && i < nWalk; k++) {
        dir.addScaledVector(randDir(r, tmp), 0.16);
        tmp.subVectors(T.c, p);
        const dc = tmp.length();
        if (dc > 0.05) dir.addScaledVector(tmp, (dc - 0.05) * 14);
        dir.normalize();
        p.addScaledVector(dir, step);
        const rho = nucRho(p);
        if (rho > 0.96) { tmp.subVectors(NUC_C, p).normalize(); dir.addScaledVector(tmp, 1.2).normalize(); p.addScaledVector(tmp, step); }
        const dn = p.distanceTo(nucleolusAbs);
        if (dn < NUCLEOLUS_R * 1.05) { tmp.subVectors(p, nucleolusAbs).normalize(); dir.addScaledVector(tmp, 1.2).normalize(); p.addScaledVector(tmp, step * 2); }
        const het = rho > 0.86 ? 1.5 : dn < NUCLEOLUS_R * 1.5 ? 1.35 : 1.0;
        emit(p, T.col, het * (0.7 + 0.6 * r()), (38 + r() * 40) * NM);
      }
    }
    // Lamina-associated heterochromatin: clumps hugging the inner envelope.
    while (i < n) {
      randDir(r, v);
      const rad = nucShape(v.x, v.y, v.z) * (0.9 + 0.07 * r());
      p.set(NUC_C.x + v.x * NUC_R.x * rad, NUC_C.y + v.y * NUC_R.y * rad, NUC_C.z + v.z * NUC_R.z * rad);
      if (fbm3(v.x * 6, v.y * 6, v.z * 6, 2) < 0.5) continue;
      emit(p, pal[2], 1.2 + 0.5 * r(), (50 + r() * 60) * NM);
    }
    const g = this.qbin.add(pointsGeometry(pos, col, size, seed));
    const pts = new THREE.Points(g, this.chromMat);
    pts.renderOrder = 6;
    pts.frustumCulled = false;
    return pts;
  }

  private buildSpecks(n: number) {
    const r = rng(31);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
    const v = new THREE.Vector3();
    const a = new THREE.Color(0.55, 0.6, 1.0), b = new THREE.Color(0.9, 0.55, 1.0);
    for (let i = 0; i < n; i++) {
      randDir(r, v).multiplyScalar((0.1 + 0.9 * Math.cbrt(r())) * 0.012);
      pos.set([v.x, v.y, v.z], i * 3);
      const c = a.clone().lerp(b, r()).multiplyScalar(0.4 + 0.6 * r());
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = (2.5 + r() * 4.5) * NM;
      seed[i] = r();
    }
    const g = this.qbin.add(pointsGeometry(pos, col, size, seed));
    const pts = new THREE.Points(g, this.speckMat);
    pts.renderOrder = 6;
    pts.frustumCulled = false;
    return pts;
  }

  private buildMelano(n: number) {
    const r = rng(41);
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 3);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const mg = mergeVertices(g); g.dispose(); g = mg; g.computeVertexNormals();
    this.qbin.add(g);
    const mesh = new THREE.InstancedMesh(g, this.melanoMat, n);
    const v = new THREE.Vector3(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), m = new THREE.Matrix4();
    const qt = new THREE.Quaternion(), e = new THREE.Euler();
    let k = 0;
    while (k < n) {
      randDir(r, v);
      if (v.y < 0.42 + r() * 0.2) continue;
      const rad = nucShape(v.x, v.y, v.z) * (1.07 + 0.16 * r() * r());
      pos.set(NUC_C.x + v.x * NUC_R.x * rad, NUC_C.y + v.y * NUC_R.y * rad, NUC_C.z + v.z * NUC_R.z * rad);
      e.set(r() * 6.28, r() * 6.28, r() * 6.28);
      qt.setFromEuler(e);
      const L = 0.006 + 0.004 * r();
      sc.set(L * 0.5, L * 0.5, L * (0.9 + 0.4 * r()));
      m.compose(pos, qt, sc);
      mesh.setMatrixAt(k++, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.renderOrder = 3;
    return mesh;
  }

  /** z = frame.zoom. */
  update(z: number) {
    const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    if (this.pores) this.pores.visible = z < 0.95 && z > -1.7;
    if (this.melano) this.melano.visible = z > -1.9;
    if (this.specks) {
      const f = 1 - sm(-1.9, -1.35, z);
      this.specks.visible = f > 0.001;
      this.speckMat.uniforms.uAlpha.value = 0.35 * f;
    }
    if (this.chrom) {
      this.chromMat.uniforms.uInnerFade.value = 1 - sm(-1.0, -0.55, z);
      // brighter when seen from inside (fewer layers stack up), calmer from outside
      this.chromMat.uniforms.uAlpha.value = 0.1 + 0.1 * (1 - sm(-1.2, -0.2, z));
    }
    this.nucleolus.visible = z > -2.3;
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
