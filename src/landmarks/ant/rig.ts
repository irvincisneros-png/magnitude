/**
 * The ant as a jointed rig: every part is a rigid mesh (+ its hairs) on its own joint. The body
 * sways and shifts its weight, the head turns, the mandibles work, the gaster pulses, the antennae
 * sweep and tap the skin; legs follow by two-bone IK with the feet pinned to the skin (no sliding).
 * Left parts are the right-side meshes mirrored. Also maintains the shadow capsules (world units).
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import type { AntData, PartMesh } from './build';
import { HAIR_STRIDE } from './build';
import { cuticleFrag, cuticleVert, decalFrag, decalVert, hairFrag, hairVert, MAX_CAPS } from './glsl';
import {
  ANKLE_H, FUNI_DIR, FUNI_L, GASTER_J, HEAD_PITCH, HINGE, LEGS, MAND_OPEN, MAND_PITCH, NECK, SCAPE_DIR, SCAPE_L, SOCKET,
  TRUNK_O, UNIT_MM, groundY, restPose, type Basis,
} from './model';

const MM = 1 / UNIT_MM;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const basisMat = (b: Basis) => new THREE.Matrix4().makeBasis(v3(b.x), v3(b.y), v3(b.z)).setPosition(v3(b.o));
/** Mirror a rotation through the z = 0 plane. */
const mirrorQ = (q: THREE.Quaternion, out: THREE.Quaternion) => out.set(-q.x, -q.y, q.z, q.w);
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

export interface Shared {
  uTime: { value: number };
  uCaps: { value: THREE.Vector4[] };
  uNCap: { value: number };
  uBound: { value: THREE.Vector4 };
  uPx: { value: number };
}

interface Node { joint: THREE.Group; inner: THREE.Group; hair?: THREE.Mesh; hairSrc: Float32Array; hairMat: THREE.ShaderMaterial }

const HAIR_SEG = 5;
const TIER_HAIR = { low: 4, medium: 2, high: 1 };
const TIER_SHADOW = { low: 5, medium: 17, high: MAX_CAPS };

export class AntRig {
  readonly root = new THREE.Group();
  readonly shared: Shared = {
    uTime: { value: 0 },
    uCaps: { value: Array.from({ length: MAX_CAPS * 2 }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uNCap: { value: MAX_CAPS },
    uBound: { value: new THREE.Vector4(-0.8, 0.12, 0.05, 0.78) },
    uPx: { value: 0.001 },
  };
  private uShadowN = { value: MAX_CAPS as number };
  private uHairFade = { value: 1 };
  private mats: THREE.ShaderMaterial[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private nodes = new Map<string, Node>();
  private tier: Quality = 'high';
  ready = false;

  // joints
  private trunk!: THREE.Group; private head!: THREE.Group; private gaster!: THREE.Group; private gasterInner!: THREE.Group;
  private mand: THREE.Group[] = []; private scape: THREE.Group[] = []; private funi: THREE.Group[] = [];
  private femur: THREE.Group[] = []; private tibia: THREE.Group[] = []; private tarsus: THREE.Group[] = [];
  private funiBend: { value: THREE.Vector2 }[] = [];
  // rest data
  private qHeadRest = new THREE.Quaternion().setFromAxisAngle(Z, HEAD_PITCH);
  private qMandRest = new THREE.Quaternion();
  private qScapeRest = new THREE.Quaternion(); private qFuniRest = new THREE.Quaternion();
  private dScape = new THREE.Vector3(); private dFuni = new THREE.Vector3();
  private anchors: THREE.Vector3[] = [];
  private decal!: THREE.Mesh;
  private decalMat!: THREE.ShaderMaterial;
  // temporaries
  private t = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(), m: new THREE.Matrix4(), m2: new THREE.Matrix4() };
  /** Antenna tips (root space, mm) for the labels / checks. */
  readonly tips = [new THREE.Vector3(), new THREE.Vector3()];
  private nearest = 1e9;

  constructor() {
    this.root.scale.setScalar(MM);
    const rest = restPose();
    // rest frames of the antenna in head space
    const headW = basisMat(rest.head);
    const inv = headW.clone().invert();
    const sc = inv.clone().multiply(basisMat(rest.scape));
    const fu = inv.clone().multiply(basisMat(rest.funiculus));
    this.qScapeRest.setFromRotationMatrix(sc);
    this.qFuniRest.setFromRotationMatrix(fu);
    this.dScape.copy(X).applyQuaternion(this.qScapeRest);
    this.dFuni.copy(X).applyQuaternion(this.qFuniRest);
    this.qMandRest.setFromAxisAngle(Y, MAND_OPEN).multiply(new THREE.Quaternion().setFromAxisAngle(Z, MAND_PITCH));
    for (const s of [1, -1]) for (const L of LEGS) {
      const x = L.foot[0], z = L.foot[1] * s;
      this.anchors.push(new THREE.Vector3(x, groundY(x, z) + ANKLE_H, z));
    }
    void SCAPE_DIR; void FUNI_DIR;
    this.buildDecal();
  }

  private cutMat(defines: Record<string, string>, bend?: { value: THREE.Vector2 }) {
    const m = new THREE.ShaderMaterial({
      vertexShader: cuticleVert, fragmentShader: cuticleFrag, defines,
      uniforms: { ...this.shared, uShadowN: this.uShadowN, ...(bend ? { uBend: bend } : {}) },
    });
    this.mats.push(m);
    return m;
  }
  private hairMat(bend?: { value: THREE.Vector2 }) {
    const m = new THREE.ShaderMaterial({
      vertexShader: hairVert, fragmentShader: hairFrag, defines: bend ? { BEND: '' } : {},
      uniforms: { ...this.shared, uShadowN: this.uShadowN, uScale: { value: MM }, uFade: this.uHairFade, ...(bend ? { uBend: bend } : {}) },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mats.push(m);
    return m;
  }

  private buildDecal() {
    const R = { x0: -7.8, x1: -0.7, z0: -2.7, z1: 3.2 };
    const g = new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0, 72, 60);
    g.rotateX(-Math.PI / 2);
    g.translate((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
    g.computeBoundingSphere();
    this.geos.push(g);
    this.decalMat = new THREE.ShaderMaterial({
      vertexShader: decalVert, fragmentShader: decalFrag,
      uniforms: { ...this.shared, uRect: { value: new THREE.Vector4(R.x0, R.x1, R.z0, R.z1) }, uStrength: { value: 1 } },
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    });
    this.mats.push(this.decalMat);
    this.decal = new THREE.Mesh(g, this.decalMat);
    this.decal.renderOrder = 1;
    this.root.add(this.decal);
  }

  private partGeo(p: PartMesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3));
    g.setAttribute('aAttr', new THREE.BufferAttribute(p.attr, 4));
    g.setIndex(new THREE.BufferAttribute(p.index, 1));
    g.computeBoundingSphere();
    this.geos.push(g);
    return g;
  }

  /** Builds the hair mesh of a node for the current tier. */
  private buildHair(n: Node) {
    if (n.hair) { n.inner.remove(n.hair); n.hair.geometry.dispose(); this.geos.splice(this.geos.indexOf(n.hair.geometry), 1); n.hair = undefined; }
    const src = n.hairSrc;
    const step = TIER_HAIR[this.tier];
    const count = Math.floor(src.length / HAIR_STRIDE / step);
    if (!count) return;
    const base: number[] = [], bi: number[] = [];
    for (let i = 0; i <= HAIR_SEG; i++) base.push(i / HAIR_SEG, -1, 0, i / HAIR_SEG, 1, 0);
    for (let i = 0; i < HAIR_SEG; i++) { const a = i * 2; bi.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
    g.setIndex(bi);
    const R = new Float32Array(count * 3), N = new Float32Array(count * 3), D = new Float32Array(count * 3), LS = new Float32Array(count * 3);
    const c = new THREE.Vector3();
    let rmax = 0;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < count; k++) {
      const o = k * step * HAIR_STRIDE;
      R.set([src[o], src[o + 1], src[o + 2]], k * 3);
      N.set([src[o + 3], src[o + 4], src[o + 5]], k * 3);
      D.set([src[o + 6], src[o + 7], src[o + 8]], k * 3);
      LS.set([src[o + 9], src[o + 10], src[o + 11]], k * 3);
      if (k % 7 === 0) pts.push(new THREE.Vector3(src[o], src[o + 1], src[o + 2]));
    }
    for (const p of pts) c.add(p);
    c.multiplyScalar(1 / Math.max(pts.length, 1));
    for (const p of pts) rmax = Math.max(rmax, p.distanceTo(c));
    g.setAttribute('aRoot', new THREE.InstancedBufferAttribute(R, 3));
    g.setAttribute('aN', new THREE.InstancedBufferAttribute(N, 3));
    g.setAttribute('aDir', new THREE.InstancedBufferAttribute(D, 3));
    g.setAttribute('aLS', new THREE.InstancedBufferAttribute(LS, 3));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(c, rmax + 0.25);
    this.geos.push(g);
    n.hair = new THREE.Mesh(g, n.hairMat);
    n.hair.renderOrder = 3;
    n.inner.add(n.hair);
  }

  /** Creates the meshes from the worker's data. */
  setData(d: AntData, tier: Quality) {
    this.tier = tier;
    this.uShadowN.value = TIER_SHADOW[tier];
    const byName = new Map(d.parts.map((p) => [p.name, p]));
    const geoOf = new Map<string, THREE.BufferGeometry>();
    const geo = (name: string) => { let g = geoOf.get(name); if (!g) { g = this.partGeo(byName.get(name)!); geoOf.set(name, g); } return g; };
    const matHead = this.cutMat({ PART_HEAD: '' }), matTrunk = this.cutMat({}), matGaster = this.cutMat({ PART_GASTER: '' });
    const matMand = this.cutMat({ PART_MAND: '' }), matApp = this.cutMat({ APPENDAGE: '' });
    const hairPlain = this.hairMat();
    const mk = (key: string, part: string, parent: THREE.Object3D, mat: THREE.ShaderMaterial, mirrored: boolean, hm = hairPlain) => {
      const joint = new THREE.Group(), inner = new THREE.Group();
      if (mirrored) inner.scale.set(1, 1, -1);
      joint.add(inner);
      parent.add(joint);
      const mesh = new THREE.Mesh(geo(part), mat);
      inner.add(mesh);
      const n: Node = { joint, inner, hairSrc: byName.get(part)!.hairs, hairMat: hm };
      this.nodes.set(key, n);
      this.buildHair(n);
      return n;
    };
    this.trunk = mk('trunk', 'trunk', this.root, matTrunk, false).joint;
    this.head = mk('head', 'head', this.trunk, matHead, false).joint;
    this.head.position.fromArray(NECK);
    const gN = mk('gaster', 'gaster', this.trunk, matGaster, false);
    this.gaster = gN.joint; this.gasterInner = gN.inner;
    this.gaster.position.fromArray(GASTER_J);
    [1, -1].forEach((s, i) => {
      const m = mk(`mand${i}`, 'mandible', this.head, matMand, s < 0).joint;
      m.position.set(HINGE[0], HINGE[1], HINGE[2] * s);
      this.mand.push(m);
      const sc = mk(`scape${i}`, 'scape', this.head, matApp, s < 0).joint;
      sc.position.set(SOCKET[0], SOCKET[1], SOCKET[2] * s);
      this.scape.push(sc);
      const bend = { value: new THREE.Vector2(-0.35, 0) };
      this.funiBend.push(bend);
      const fu = mk(`funi${i}`, 'funiculus', sc, this.cutMat({ APPENDAGE: '', BEND: '' }, bend), s < 0, this.hairMat(bend)).joint;
      fu.position.set(SCAPE_L, 0, 0);
      this.funi.push(fu);
      LEGS.forEach((L) => {
        this.femur.push(mk(`femur-${L.name}${i}`, `femur-${L.name}`, this.root, matApp, s < 0).joint);
        this.tibia.push(mk(`tibia-${L.name}${i}`, `tibia-${L.name}`, this.root, matApp, s < 0).joint);
        this.tarsus.push(mk(`tarsus-${L.name}${i}`, `tarsus-${L.name}`, this.root, matApp, s < 0).joint);
      });
    });
    this.ready = true;
    this.pose(0);
  }

  setQuality(q: Quality) {
    this.tier = q;
    this.uShadowN.value = TIER_SHADOW[q];
    if (this.ready) for (const n of this.nodes.values()) this.buildHair(n);
  }

  /** zoom-dependent switches. */
  setZoom(zoom: number) {
    const f = 1 - smooth(0.75, 1.15, zoom);
    this.uHairFade.value = f;
    for (const n of this.nodes.values()) if (n.hair) n.hair.visible = f > 0.002;
  }

  // ------------------------------------------------------------------ animation
  private antenna(i: number, s: number, time: number, headM: THREE.Matrix4) {
    const { a, b, q, q2, q3 } = this.t;
    const m = aM1, m2 = aM2;
    const ph = i * 2.7;
    // slow exploring sweeps, plus bursts of quick taps on the skin
    const sweep = Math.sin(time * 0.55 + ph) * 0.5 + Math.sin(time * 0.23 + ph * 1.7) * 0.5;
    const burst = smooth(0.15, 0.6, Math.sin(time * 0.31 + ph * 0.6 + 1.0));
    const tapPh = time * 2 * Math.PI * 2.6 + ph;
    const tap = Math.pow(Math.max(0, Math.sin(tapPh)), 3) * burst;
    let yawS = 0.18 * sweep + 0.06 * Math.sin(time * 1.3 + ph);
    let pitS = 0.12 * Math.sin(time * 0.41 + ph + 2.0) - 0.05 * burst;
    let yawF = 0.12 * Math.sin(time * 0.7 + ph + 0.5);
    let pitF = 0.08 * Math.sin(time * 0.9 + ph) - (0.32 * tap + 0.12 * burst);
    const bendK = -0.35 - 0.25 * tap - 0.1 * Math.sin(time * 1.1 + ph);
    const scape = this.scape[i], funi = this.funi[i];
    for (let it = 0; it < 5; it++) {
      // scape and funiculus orientation in head space (right-side terms, then mirrored)
      a.crossVectors(this.dScape, Y).normalize();
      q.setFromAxisAngle(Y, -yawS).multiply(q2.setFromAxisAngle(a, pitS)).multiply(this.qScapeRest);
      a.crossVectors(this.dFuni, Y).normalize();
      q2.setFromAxisAngle(Y, -yawF).multiply(q3.setFromAxisAngle(a, pitF)).multiply(this.qFuniRest);
      // funiculus local = scape⁻¹ · funiculus
      q3.copy(q).invert().multiply(q2);
      if (s > 0) { scape.quaternion.copy(q); funi.quaternion.copy(q3); } else { mirrorQ(q, scape.quaternion); mirrorQ(q3, funi.quaternion); }
      scape.updateMatrix(); funi.updateMatrix();
      this.funiBend[i].value.set(bendK, 0);
      // tip of the bent funiculus, in root space
      const ak = bendK * FUNI_L;
      b.set(Math.sin(ak) / bendK, (1 - Math.cos(ak)) / bendK, 0);
      m.multiplyMatrices(headM, scape.matrix);
      m2.multiplyMatrices(m, funi.matrix);
      b.applyMatrix4(m2);
      const ground = groundY(b.x, b.z) + 0.03;
      const dist = b.length();
      let ok = true;
      if (b.y < ground) { pitF += (ground - b.y) / FUNI_L * 1.1; ok = false; }
      if (dist < 0.88) { yawS += (0.88 - dist) / 1.6; ok = false; }
      if (ok) break;
    }
    this.tips[i].copy(b);
    this.nearest = Math.min(this.nearest, b.length());
  }

  /** Poses the whole ant for time t (seconds). */
  pose(time: number) {
    if (!this.ready) return;
    const { a, b, c, d, e, q, m } = this.t;
    this.nearest = 1e9;
    // body: a slow weight shift and the faintest breathing sway
    const shift = Math.sin(time * 0.37) * 0.6 + Math.sin(time * 0.13 + 1.0) * 0.4;
    this.trunk.position.set(TRUNK_O[0] + 0.012 * Math.sin(time * 0.29), TRUNK_O[1] + 0.008 * Math.sin(time * 0.8) - 0.006 * Math.abs(shift), TRUNK_O[2] + 0.025 * shift);
    this.trunk.quaternion.setFromEuler(tmpE.set(0.03 * shift, 0.015 * Math.sin(time * 0.21), 0.012 * Math.sin(time * 0.33 + 0.4)));
    this.trunk.updateMatrix();
    // head: looks about, now and then dips towards the skin
    const look = Math.sin(time * 0.27) * 0.7 + Math.sin(time * 0.71 + 2.0) * 0.3;
    const dip = smooth(0.6, 0.95, Math.sin(time * 0.19 + 0.8));
    q.setFromAxisAngle(Y, 0.16 * look).multiply(this.t.q2.setFromAxisAngle(Z, 0.05 * Math.sin(time * 0.5 + 1.0) - 0.1 * dip)).multiply(this.qHeadRest);
    this.head.quaternion.copy(q).multiply(this.t.q3.setFromAxisAngle(X, 0.05 * look));
    this.head.updateMatrix();
    const headM = m.multiplyMatrices(this.trunk.matrix, this.head.matrix);
    // mandibles: open a little, close, and work now and then
    const work = Math.max(0, Math.sin(time * 0.45 + 0.3)) ** 6;
    const open = 0.05 + 0.18 * work * (0.6 + 0.4 * Math.sin(time * 7.0));
    this.mand.forEach((j, i) => {
      const s = i === 0 ? 1 : -1;
      this.t.q2.setFromAxisAngle(Y, -open).multiply(this.qMandRest);
      if (s > 0) j.quaternion.copy(this.t.q2); else mirrorQ(this.t.q2, j.quaternion);
    });
    // gaster: breathing pulse (telescoping tergites) and a slight bob
    const pulse = Math.sin(time * 2 * Math.PI / 2.4);
    this.gaster.quaternion.setFromAxisAngle(Z, 0.035 * Math.sin(time * 0.43) + 0.01 * pulse);
    this.gasterInner.scale.set(1 + 0.012 * pulse, 1 + 0.02 * pulse, 1 + 0.016 * pulse);
    // antennae
    this.antenna(0, 1, time, headM);
    this.antenna(1, -1, time + 1.3, headM);
    // legs: hips move with the body, feet stay pinned; the left foreleg lifts now and then
    const liftPh = (time % 11.0) / 1.8;
    const lift = liftPh < 1 ? Math.sin(liftPh * Math.PI) ** 2 : 0;
    let k = 0;
    for (const s of [1, -1]) for (const L of LEGS) {
      const T = a.set(L.coxaB[0], L.coxaB[1], L.coxaB[2] * s).applyMatrix4(this.trunk.matrix);
      const A = b.copy(this.anchors[k]);
      const lifting = L.name === 'fore' && s < 0 ? lift : 0;
      if (lifting > 0) A.add(c.set(0.08, 0.2, 0.06).multiplyScalar(lifting));
      const pole = c.set(L.pole[0], L.pole[1], L.pole[2] * s);
      // two-bone IK
      d.subVectors(A, T);
      const D = Math.min(d.length(), L.Lf + L.Lt - 1e-4);
      d.normalize();
      const along = (L.Lf * L.Lf - L.Lt * L.Lt + D * D) / (2 * D);
      const hgt = Math.sqrt(Math.max(0, L.Lf * L.Lf - along * along));
      e.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
      const K = e.multiplyScalar(hgt).addScaledVector(d, along).add(T);
      this.aimJoint(this.femur[k], T, d.subVectors(K, T), pole);
      this.aimJoint(this.tibia[k], K, d.subVectors(A, K), pole);
      const tdir = c.set(L.tarDir[0], L.tarDir[1] - 0.9 * lifting, L.tarDir[2] * s);
      this.aimJoint(this.tarsus[k], A, tdir, Y);
      // capsules: femur, tibia, tarsus
      this.setCap(5 + k, T, K, 0.05);
      this.setCap(11 + k, K, A, 0.038);
      this.setCap(21 + k, A, d.copy(A).addScaledVector(tdir.normalize(), L.Ltar), 0.022);
      k++;
    }
    // body capsules
    const tm = this.trunk.matrix;
    this.setCap(0, a.set(0.22, 0, 0).applyMatrix4(headM), b.set(0.66, 0, 0).applyMatrix4(headM), 0.25);
    this.setCap(1, a.set(0.5, 0.02, 0).applyMatrix4(tm), b.set(-0.05, 0.02, 0).applyMatrix4(tm), 0.24);
    this.setCap(2, a.set(-0.1, 0, 0).applyMatrix4(tm), b.set(-0.45, 0, 0).applyMatrix4(tm), 0.19);
    this.setCap(3, a.set(-0.7, -0.1, 0).applyMatrix4(tm), b.set(-0.7, 0.2, 0).applyMatrix4(tm), 0.06);
    this.gaster.updateMatrix();
    const gm = this.t.m2.multiplyMatrices(tm, this.gaster.matrix);
    this.setCap(4, a.set(-0.45, 0.04, 0).applyMatrix4(gm), b.set(-0.92, 0.04, 0).applyMatrix4(gm), 0.41);
    for (let i = 0; i < 2; i++) {
      const sc = this.t.m2.multiplyMatrices(headM, this.scape[i].matrix);
      a.set(0, 0, 0).applyMatrix4(sc);
      b.set(SCAPE_L, 0, 0).applyMatrix4(sc);
      this.setCap(17 + i * 2, a, b, 0.033);
      this.setCap(18 + i * 2, b, this.tips[i], 0.035);
    }
  }

  private aimJoint(j: THREE.Group, o: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3) {
    const m = tmpM;
    const X1 = tmpA.copy(dir).normalize();
    const Y1 = tmpB.copy(up).addScaledVector(X1, -up.dot(X1)).normalize();
    const Z1 = tmpC.crossVectors(X1, Y1);
    m.makeBasis(X1, Y1, Z1);
    j.quaternion.setFromRotationMatrix(m);
    j.position.copy(o);
  }

  private setCap(i: number, a: THREE.Vector3, b: THREE.Vector3, r: number) {
    const c = this.shared.uCaps.value;
    c[i * 2].set(a.x * MM, a.y * MM, a.z * MM, r * MM);
    c[i * 2 + 1].set(b.x * MM, b.y * MM, b.z * MM, 0);
  }

  /** Smallest distance (mm) from the origin to an antenna tip this frame. */
  get nearestTip() { return this.nearest; }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
const aM1 = new THREE.Matrix4(), aM2 = new THREE.Matrix4();
const tmpM = new THREE.Matrix4(), tmpE = new THREE.Euler();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
