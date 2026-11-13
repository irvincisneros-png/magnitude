/**
 * Close-up surface detail around the phage's landing site, and the phages themselves.
 * - Outer-membrane proteins (porin trimers and larger complexes) as 3D relief in a patch around the
 *   contact point, where the zoom-in end looks.
 * - Lipopolysaccharide (LPS): short swaying chains of sugar beads — the "fuzz" phages grab.
 * - A few more T4 phages standing on the cell further away, plus a proxy of the child phage at the
 *   origin that takes over as the phage layer fades out (the hero shot still shows the virus).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../../engine/types';
import { CAP_R, CONTACT_CELL, NM, PAL, toSurface, type Shared } from './layout';
import { pointsGeometry, pointsMaterial } from './points';
import { solidMaterial } from './solid';
import { Bin, TubeBuilder, rng, smooth } from './util';

const COUNTS = {
  low: { prot: 1800, lps: 1600, beads: 6 },
  medium: { prot: 3600, lps: 3600, beads: 7 },
  high: { prot: 6000, lps: 6000, beads: 7 },
};
const PATCH = 0.42;

/** A T4-like phage in its own frame: origin inside the head, tail down −Y, feet at y = −0.075. */
export function phageGeometry(radial = 8) {
  const parts: THREE.BufferGeometry[] = [];
  // prolate icosahedral head (86 × 120 nm), faceted
  const hv: number[] = [];
  const top = [0, 0.042, 0], bot = [0, -0.018, 0];
  const ra: number[][] = [], rb: number[][] = [];
  for (let k = 0; k < 5; k++) {
    const a1 = (k / 5) * Math.PI * 2, a2 = a1 + Math.PI / 5;
    ra.push([Math.cos(a1) * 0.0215, 0.022, Math.sin(a1) * 0.0215]);
    rb.push([Math.cos(a2) * 0.0215, 0.002, Math.sin(a2) * 0.0215]);
  }
  for (let k = 0; k < 5; k++) {
    const k1 = (k + 1) % 5;
    hv.push(...top, ...ra[k1], ...ra[k]);
    hv.push(...ra[k], ...ra[k1], ...rb[k]);
    hv.push(...rb[k], ...ra[k1], ...rb[k1]);
    hv.push(...bot, ...rb[k], ...rb[k1]);
  }
  const head = new THREE.BufferGeometry();
  head.setAttribute('position', new THREE.Float32BufferAttribute(hv, 3));
  head.computeVertexNormals();
  head.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((hv.length / 3) * 2), 2));
  parts.push(head);
  const cols = [[0.5, 0.62, 1.15], [0.4, 0.85, 0.8], [1.0, 0.88, 0.62]];
  // collar, ringed tail sheath, baseplate (lathed)
  const prof: THREE.Vector2[] = [];
  prof.push(new THREE.Vector2(0.0001, -0.016), new THREE.Vector2(0.0085, -0.017), new THREE.Vector2(0.0085, -0.021), new THREE.Vector2(0.0045, -0.022));
  for (let i = 0; i <= 24; i++) {
    const y = -0.023 - (i / 24) * 0.043;
    prof.push(new THREE.Vector2(0.0058 + 0.0009 * Math.abs(Math.sin(i * Math.PI / 2)), y));
  }
  prof.push(new THREE.Vector2(0.017, -0.066), new THREE.Vector2(0.018, -0.069), new THREE.Vector2(0.012, -0.0715), new THREE.Vector2(0.0001, -0.072));
  const lathe = new THREE.LatheGeometry(prof, radial * 2);
  parts.push(lathe);
  // six long tail fibres (thigh + shin, kinked at the knee), feet on the membrane
  const tb = new TubeBuilder();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const c = Math.cos(a), s = Math.sin(a);
    const pts: number[] = [];
    const P = (r: number, y: number) => pts.push(c * r, y, s * r);
    P(0.016, -0.068); P(0.026, -0.062); P(0.036, -0.056); P(0.042, -0.054);
    P(0.047, -0.059); P(0.052, -0.066); P(0.056, -0.072); P(0.058, -0.075);
    tb.add(pts, () => 0.0013, 5);
  }
  // short tail pins
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    tb.add([Math.cos(a) * 0.015, -0.07, Math.sin(a) * 0.015, Math.cos(a) * 0.02, -0.075, Math.sin(a) * 0.02], () => 0.0012, 4);
  }
  parts.push(tb.build());
  for (const p of parts) { if (p.index) { const q = p.toNonIndexed(); parts[parts.indexOf(p)] = q; p.dispose(); } }
  const g = mergeGeometries(parts.map((p) => { const q = new THREE.BufferGeometry(); q.setAttribute('position', p.attributes.position); q.setAttribute('normal', p.attributes.normal); q.setAttribute('uv', p.attributes.uv); const n = p.attributes.position.count, c = cols[parts.indexOf(p)], a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); q.setAttribute('aColor', new THREE.BufferAttribute(a, 3)); return q; }))!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** A porin trimer / membrane-protein blob, unit size, sitting on y = 0. */
function trimerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    let s: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.36, 2);
    s.deleteAttribute('uv'); s.deleteAttribute('normal');
    const m = mergeVertices(s); s.dispose(); s = m;
    const a = (k / 3) * Math.PI * 2;
    const p = s.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const w = 1 + 0.12 * Math.sin(x * 19 + k) * Math.sin(z * 17 - k) * Math.sin(y * 13);
      p.setXYZ(i, x * w + Math.cos(a) * 0.27, y * 0.9 * w + 0.12, z * w + Math.sin(a) * 0.27);
    }
    s.computeVertexNormals();
    parts.push(s);
  }
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}

export class Surface {
  readonly group = new THREE.Group();
  /** Lives in the pivot (layer) frame, not the cell frame. */
  readonly proxy: THREE.Mesh;
  private bin = new Bin();
  private qbin = new Bin();
  private protMat: THREE.ShaderMaterial;
  private phageMat: THREE.ShaderMaterial;
  private proxyMat: THREE.ShaderMaterial;
  private lpsMat: THREE.ShaderMaterial;
  private phageGeo: THREE.BufferGeometry;
  private detail: THREE.Object3D[] = [];
  phageLabel = new THREE.Vector3();

  constructor(shared: Shared) {
    this.protMat = this.bin.add(solidMaterial(shared, {
      tint: PAL.porin.clone(), rim: new THREE.Color(0.6, 1.0, 0.65), rimA: 0.5,
      bumpF: 4, bumpS: 0, wrap: 0.8, trans: 0.8, spec: 0.35, near: 0.04, defines: { ACOLOR: 1 },
    }));
    this.phageMat = this.bin.add(solidMaterial(shared, {
      tint: PAL.phage.clone(), rim: new THREE.Color(0.55, 0.6, 0.95), rimA: 0.4,
      bumpF: 600, bumpS: 0.0004, wrap: 0.6, trans: 0.7, spec: 0.6, near: 0.03, side: THREE.DoubleSide, defines: { ACOLOR: 1 },
    }));
    this.proxyMat = this.bin.add(solidMaterial(shared, {
      tint: PAL.phage.clone(), rim: new THREE.Color(0.55, 0.6, 0.95), rimA: 0.4,
      bumpF: 600, bumpS: 0.0004, wrap: 0.6, trans: 0.7, spec: 0.6, near: 0.03, side: THREE.DoubleSide, defines: { ACOLOR: 1 },
    }));
    this.lpsMat = this.bin.add(pointsMaterial(shared, { alpha: 0.9, maxPx: 120, minPx: 1.2, sway: true }));
    this.phageGeo = this.bin.add(phageGeometry());
    this.proxy = new THREE.Mesh(this.phageGeo, this.proxyMat);
    this.proxy.frustumCulled = false;
  }

  build(q: Quality) {
    this.qbin.dispose();
    this.group.clear();
    this.detail = [];
    const c = COUNTS[q];
    const r = rng(907);
    const p = new THREE.Vector3(), n = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const qt = new THREE.Quaternion(), qs = new THREE.Quaternion(), sc = new THREE.Vector3(), m = new THREE.Matrix4();
    /** Random point in the patch (around the contact, measured along the surface). */
    const patchPoint = (maxR: number) => {
      const rr = maxR * Math.sqrt(r()), a = r() * Math.PI * 2;
      const phi = (rr * Math.sin(a)) / CAP_R;
      p.set(CONTACT_CELL.x + rr * Math.cos(a), Math.cos(phi), Math.sin(phi));
      toSurface(p, n);
      return rr;
    };

    // ---------------------------------------------------------------- membrane proteins
    {
      const geo = this.qbin.add(trimerGeometry());
      const mesh = new THREE.InstancedMesh(geo, this.protMat, c.prot);
      const col = new Float32Array(c.prot * 3);
      for (let i = 0; i < c.prot; i++) {
        patchPoint(PATCH);
        qt.setFromUnitVectors(up, n);
        qs.setFromAxisAngle(up, r() * Math.PI * 2);
        qt.multiply(qs);
        const big = r() < 0.08;
        const s = (big ? 7 + r() * 4 : 4 + r() * 2.5) * NM * 2;
        sc.set(s, s * (big ? 0.9 : 0.55), s);
        p.addScaledVector(n, -0.0008);
        m.compose(p, qt, sc);
        mesh.setMatrixAt(i, m);
        const w = 0.75 + r() * 0.5;
        const tint = big ? [1.1, 1.0, 0.85] : r() < 0.2 ? [0.8, 1.0, 1.25] : [1, 1, 1];
        col[i * 3] = w * tint[0]; col[i * 3 + 1] = w * tint[1]; col[i * 3 + 2] = w * tint[2];
      }
      geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.qbin.add({ dispose: () => mesh.dispose() });
      this.group.add(mesh);
      this.detail.push(mesh);
    }

    // ---------------------------------------------------------------- LPS sugar chains
    {
      const nb = c.lps * c.beads;
      const pos = new Float32Array(nb * 3), col = new Float32Array(nb * 3), size = new Float32Array(nb), seed = new Float32Array(nb), hh = new Float32Array(nb);
      const lean = new THREE.Vector3();
      let k = 0;
      for (let i = 0; i < c.lps; i++) {
        patchPoint(PATCH * 1.05);
        lean.set(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.7).add(n).normalize();
        const sd = r();
        const len = c.beads - Math.floor(r() * 3);
        const w = 0.7 + r() * 0.5;
        for (let b = 0; b < c.beads; b++, k++) {
          const h = b < len ? b * 1.4 * NM * 2 + 0.0008 : 0;
          pos[k * 3] = p.x + lean.x * h; pos[k * 3 + 1] = p.y + lean.y * h; pos[k * 3 + 2] = p.z + lean.z * h;
          const t = b / c.beads;
          col[k * 3] = PAL.lps.r * w * (0.8 + t * 0.6); col[k * 3 + 1] = PAL.lps.g * w * (0.85 + t * 0.3); col[k * 3 + 2] = PAL.lps.b * w * (0.8 + t * 0.7);
          size[k] = b < len ? (2.1 - t * 0.6) * NM * 2 : 0;
          seed[k] = sd;
          hh[k] = h;
        }
      }
      const pts = new THREE.Points(this.qbin.add(pointsGeometry(pos, col, size, seed, hh)), this.lpsMat);
      pts.renderOrder = 10; pts.frustumCulled = false;
      this.group.add(pts);
      this.detail.push(pts);
    }

    // ---------------------------------------------------------------- more phages, further away
    const spots: [number, number][] = [[-0.36, 0.55], [0.3, -0.5], [0.46, 0.95], [-0.02, 1.75], [0.62, -1.4], [-0.5, -2.3]];
    for (const [x, phi] of spots) {
      p.set(x, Math.cos(phi), Math.sin(phi));
      toSurface(p, n);
      const ph = new THREE.Mesh(this.phageGeo, this.phageMat);
      qt.setFromUnitVectors(up, n);
      qs.setFromAxisAngle(up, r() * 6.28);
      ph.quaternion.copy(qt).multiply(qs);
      ph.position.copy(p).addScaledVector(n, 0.075);
      ph.frustumCulled = false;
      this.group.add(ph);
      if (x === 0.3) this.phageLabel.copy(p).addScaledVector(n, 0.1);
    }
  }

  /** zoom: hides the fine patch when it is far below a pixel; proxy: 0..1 visibility of the origin phage. */
  update(zoom: number, proxy: number) {
    const k = 1 - smooth(-0.35, 0.15, zoom);
    for (const o of this.detail) o.visible = k > 0.01;
    this.protMat.uniforms.uFade.value = k;
    this.lpsMat.uniforms.uAlpha.value = 0.9 * k;
    this.proxy.visible = proxy > 0.01;
    this.proxyMat.uniforms.uFade.value = proxy;
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
