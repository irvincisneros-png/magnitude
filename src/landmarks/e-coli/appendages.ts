/**
 * Flagella and pili.
 * Flagella: 7 long, rigid left-handed helices (pitch ~2.2 µm, 20 nm thick) on flexible hooks,
 * from scattered points on the body, gathering into a bundle trailing behind the cell. Each is a
 * rigid helix spun about its own axis by its motor — which is exactly what makes the helical wave
 * travel down it.
 * Pili (type 1 fimbriae): a few hundred thin, short, gently swaying hairs bristling from the surface.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { CAP_H, CAP_R, CONTACT_CELL, NM, PAL, toSurface, type Shared } from './layout';
import { solidMaterial } from './solid';
import { Bin, TubeBuilder, randDir, rng } from './util';

const COUNTS = {
  low: { flag: 7, fRad: 6, fSeg: 34, pili: 110, pRad: 5 },
  medium: { flag: 7, fRad: 8, fSeg: 44, pili: 160, pRad: 6 },
  high: { flag: 7, fRad: 10, fSeg: 56, pili: 210, pRad: 6 },
};
const PITCH = 1.1;       // 2.2 µm
const AMP = 0.09;        // helix radius 180 nm
const F_RAD = 10 * NM;   // 20 nm thick
const P_RAD = 3.5 * NM;  // 7 nm thick
/** Keep-clear zone for the phage standing at the contact point (cell space). */
const ZONE = CONTACT_CELL.clone().add(new THREE.Vector3(0, 0.06, 0));

interface Flag { mesh: THREE.Mesh; base: THREE.Quaternion; phase: number; speed: number }

export class Appendages {
  readonly group = new THREE.Group();
  private bin = new Bin();
  private qbin = new Bin();
  private flagMat: THREE.ShaderMaterial;
  private piliMat: THREE.ShaderMaterial;
  private flags: Flag[] = [];
  private qr = new THREE.Quaternion();
  private ax = new THREE.Vector3(1, 0, 0);
  /** Label anchors (cell space). */
  flagLabel = new THREE.Vector3(-1.1, 0, 0.1);
  piliLabel = new THREE.Vector3(-0.2, 0.3, 0.05);

  constructor(shared: Shared) {
    this.flagMat = this.bin.add(solidMaterial(shared, {
      tint: PAL.flagellum.clone().multiplyScalar(0.75), rim: new THREE.Color(0.6, 0.8, 0.6), rimA: 0.45,
      bumpF: 900, bumpS: 0.0008, wrap: 0.7, trans: 0.6, spec: 0.3, near: 0.02, defines: { FIBRE: 1 },
    }));
    this.piliMat = this.bin.add(solidMaterial(shared, {
      tint: PAL.pilus.clone().multiplyScalar(0.7), rim: new THREE.Color(0.6, 1.0, 0.65), rimA: 0.8,
      bumpF: 1500, bumpS: 0.0004, wrap: 0.8, trans: 1.0, spec: 0.4, near: 0.02, sway: 0.08,
      defines: { SEED: 1, SWAY: 1, FIBRE: 1 },
    }));
  }

  build(q: Quality) {
    this.qbin.dispose();
    this.group.clear();
    this.flags = [];
    const c = COUNTS[q];
    this.buildFlagella(c.flag, c.fRad, c.fSeg);
    this.buildPili(c.pili, c.pRad);
  }

  private buildFlagella(n: number, radial: number, segPerTurn: number) {
    const r = rng(311);
    const hooks = new TubeBuilder();
    const b = new THREE.Vector3(), nr = new THREE.Vector3(), s0 = new THREE.Vector3(), a = new THREE.Vector3();
    const Q = new THREE.Vector3(), t = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    const bez = new THREE.CubicBezierCurve3(b, p1, p2, s0);
    let made = 0;
    for (let tries = 0; tries < 400 && made < n; tries++) {
      // base anywhere on the rear two-thirds, all round the body
      const x = -CAP_H - CAP_R * 0.6 + r() * (CAP_H * 1.5 + CAP_R * 0.6);
      const th = r() * Math.PI * 2;
      b.set(x, Math.cos(th), Math.sin(th));
      toSurface(b, nr);
      if (b.distanceTo(CONTACT_CELL) < 0.28) continue;
      s0.copy(b).addScaledVector(nr, 0.1).add(t.set(-0.05, 0, 0));
      Q.set(-CAP_H - CAP_R - 0.75, (r() - 0.5) * 0.14, (r() - 0.5) * 0.14);
      a.subVectors(Q, s0).normalize();
      const L = 1.7 + r() * 1.0;
      // the helix envelope must clear the body and the phage
      let ok = true;
      for (let k = 1; k <= 30 && ok; k++) {
        t.copy(s0).addScaledVector(a, (L * k) / 30);
        const xx = t.x - Math.min(CAP_H, Math.max(-CAP_H, t.x));
        const sd = Math.hypot(xx, t.y, t.z) - CAP_R;
        const amp = AMP * Math.min(1, (L * k) / 30 / 0.4);
        if (sd < amp + 0.025 || t.distanceTo(ZONE) < 0.22) ok = false;
      }
      if (!ok) continue;
      // hook: from the base along the normal, turning to meet the helix axis
      p1.copy(b).addScaledVector(nr, 0.05);
      p2.copy(s0).addScaledVector(a, -0.05);
      const hp: number[] = [];
      for (const v of bez.getPoints(14)) hp.push(v.x, v.y, v.z);
      hooks.add(hp, (i) => F_RAD * (i < 3 ? 1.3 : 1), radial);

      // helix about local +X
      const turns = L / PITCH;
      const segs = Math.ceil(turns * segPerTurn);
      const pts: number[] = [];
      for (let k = 0; k <= segs; k++) {
        const xx = (k / segs) * L;
        const A = AMP * Math.min(1, xx / 0.4) ** 1.5 * (1 - 0.15 * (xx / L));
        const ph = (xx / PITCH) * Math.PI * 2;
        pts.push(xx, A * Math.cos(ph), -A * Math.sin(ph));
      }
      const tb = new TubeBuilder();
      tb.add(pts, (i) => F_RAD * (i > segs - 3 ? 0.6 : 1), radial);
      const g = this.qbin.add(tb.build());
      const mesh = new THREE.Mesh(g, this.flagMat);
      mesh.position.copy(s0);
      const base = new THREE.Quaternion().setFromUnitVectors(this.ax, a);
      mesh.quaternion.copy(base);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.flags.push({ mesh, base, phase: r() * 6.28, speed: 2.6 + r() * 0.5 });
      if (made === 0) this.flagLabel.copy(s0).addScaledVector(a, L * 0.6);
      made++;
    }
    const hg = this.qbin.add(hooks.build());
    const hm = new THREE.Mesh(hg, this.flagMat);
    hm.frustumCulled = false;
    this.group.add(hm);
  }

  private buildPili(n: number, radial: number) {
    const r = rng(523);
    const tb = new TubeBuilder();
    const seeds: number[] = [], lens: number[] = [];
    const b = new THREE.Vector3(), nr = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3(), tmp = new THREE.Vector3();
    let made = 0;
    for (let tries = 0; tries < n * 20 && made < n; tries++) {
      if (made < 16) {
        // a ring of pili around the phage (seen at the zoom-in end)
        const ang = r() * Math.PI * 2, rr = 0.17 + r() * 0.2;
        b.set(CONTACT_CELL.x + Math.cos(ang) * rr, CONTACT_CELL.y, CONTACT_CELL.z + Math.sin(ang) * rr);
      } else {
        const x = (r() * 2 - 1) * (CAP_H + CAP_R * 0.9);
        const th = r() * Math.PI * 2;
        b.set(x, Math.cos(th), Math.sin(th));
      }
      toSurface(b, nr);
      if (b.distanceTo(CONTACT_CELL) < 0.16) continue;
      const len = made < 16 ? 0.06 + r() * 0.1 : 0.05 + r() * r() * 0.2;
      d.copy(nr).addScaledVector(randDir(r, tmp), 0.45).normalize();
      if (d.dot(nr) < 0.4) d.addScaledVector(nr, 0.5).normalize();
      const steps = 12;
      const pts: number[] = [];
      p.copy(b).addScaledVector(nr, -0.004);
      let ok = true;
      for (let k = 0; k <= steps; k++) {
        pts.push(p.x, p.y, p.z);
        if (p.distanceTo(ZONE) < 0.13) ok = false;
        d.addScaledVector(randDir(r, tmp), 0.2).normalize();
        p.addScaledVector(d, len / steps);
      }
      if (!ok) continue;
      const before = tb.pos.length / 3;
      tb.add(pts, (i) => P_RAD * (i === steps ? 1.6 : i === steps - 1 ? 1.25 : 1), radial);
      const added = tb.pos.length / 3 - before;
      const sd = r();
      for (let k = 0; k < added; k++) { seeds.push(sd); lens.push(len); }
      if (made === 40) this.piliLabel.set(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
      made++;
    }
    const g = this.qbin.add(tb.build());
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    g.setAttribute('aLen', new THREE.Float32BufferAttribute(lens, 1));
    const m = new THREE.Mesh(g, this.piliMat);
    m.frustumCulled = false;
    this.group.add(m);
  }

  update(time: number) {
    for (const f of this.flags) {
      // left-handed helix turning counter-clockwise (seen from behind) pushes the cell forward
      this.qr.setFromAxisAngle(this.ax, f.phase + time * f.speed * Math.PI * 2 * 0.5);
      f.mesh.quaternion.copy(f.base).multiply(this.qr);
    }
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
