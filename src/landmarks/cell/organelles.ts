/**
 * Cytoplasm of the keratinocyte: rough → smooth endoplasmic reticulum sheets wrapped around the
 * nucleus, a Golgi stack, mitochondria with cristae, vesicles, keratin filament bundles anchored
 * at desmosomes, and a crowd of drifting ribosomes/protein complexes.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../../engine/types';
import { COMMON, FRAG } from './glsl';
import {
  CELL_C, CELL_R, GOLGI_C, NUC_C, NUC_R, cellRho, cellShape, nucRho, nucShape, type Shared,
} from './layout';
import { pointsGeometry, pointsMaterial } from './points';
import { solidMaterial } from './solid';
import { Bin, TubeBuilder, fbm3, randDir, rng, type Rand } from './util';

const COUNTS = {
  low: { mito: 60, er: 5, erSeg: 56, ves: 140, ker: 30, sub: 1, des: 70, part: 14000 },
  medium: { mito: 90, er: 7, erSeg: 80, ves: 150, ker: 40, sub: 3, des: 110, part: 30000 },
  high: { mito: 95, er: 8, erSeg: 104, ves: 190, ker: 38, sub: 3, des: 140, part: 52000 },
};

// ---------------------------------------------------------------- ER material
const erVert = /* glsl */ `
${COMMON}
attribute float aThr; attribute float aRough; attribute float aEdge;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying float vThr; varying float vRough; varying float vEdge;
void main() {
  vec3 p = position;
  p += normal * (vnoise(p * 40.0 + vec3(0.0, uTime * 0.07, 0.0)) - 0.5) * 0.004;
  vObj = p; vThr = aThr; vRough = aRough; vEdge = aEdge;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const erFrag = /* glsl */ `
${COMMON}
${FRAG}
uniform vec3 uTint; uniform vec3 uRim; uniform float uFade;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying float vThr; varying float vRough; varying float vEdge;
void main() {
  float nz = fbm3(vObj * 26.0 + vThr * 17.0);
  float thr = vThr + (vEdge - 0.12) * 1.5 * step(vEdge, 0.12) - 0.0;
  if (nz > thr) discard;
  float edge = smoothstep(thr - 0.08, thr, nz);
  vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 v = toC / dist;
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  // ribosomes studding the rough ER: one jittered dot per grid cell
  vec3 g = vObj * 420.0; vec3 ci = floor(g);
  vec3 f = fract(g) - 0.5 - (vec3(hash13(ci), hash13(ci + 7.1), hash13(ci + 3.3)) - 0.5) * 0.45;
  float dotR = smoothstep(0.3, 0.12, length(f)) * vRough;
  n = bumpN(n, vW, (edge * 0.8 + dotR * 0.5) * 0.0012);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 2.2);
  vec3 col = sssLight(uTint, n, v, 0.8, 0.9, 0.6) * 0.8;
  col += uRim * (fr * 0.55 + edge * 0.5);
  col = mix(col, vec3(0.75, 0.9, 1.0) * 0.6, dotR * 0.6);
  float a = 0.09 + fr * 0.4 + edge * 0.32 + dotR * 0.22;
  a *= smoothstep(uD * 0.03, uD * 0.18, dist);
  float fo = fogF(dist);
  col = mix(col, uFogCol, fo);
  a *= (1.0 - 0.75 * fo) * uFade;
  gl_FragColor = vec4(col * a, a);
}`;

const premul = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
} as const;

/** Random point in the cytoplasm (inside the membrane, outside the nucleus). */
function cytoPoint(r: Rand, out: THREE.Vector3, maxRho = 0.9, minNuc = 1.12) {
  for (let i = 0; i < 200; i++) {
    randDir(r, out).multiplyScalar(Math.cbrt(r()));
    out.multiply(CELL_R).add(CELL_C);
    if (cellRho(out) < maxRho && nucRho(out) > minNuc) return out;
  }
  return out;
}

export class Organelles {
  readonly group = new THREE.Group();
  private bin = new Bin();
  private qbin = new Bin();
  readonly golgiFrame = new THREE.Matrix4();
  erMat: THREE.ShaderMaterial;
  mitoMat: THREE.ShaderMaterial;
  golgiMat: THREE.ShaderMaterial;
  vesMat: THREE.ShaderMaterial;
  kerMat: THREE.ShaderMaterial;
  desMat: THREE.ShaderMaterial;
  partMat: THREE.ShaderMaterial;
  private golgi: THREE.Mesh;
  private parts: THREE.Object3D[] = [];
  particles?: THREE.Points;
  /** A mitochondrion and an ER point for labels. */
  mitoLabel = new THREE.Vector3();
  erLabel = new THREE.Vector3(NUC_C.x - NUC_R.x * 1.05, NUC_C.y + NUC_R.y * 0.55, NUC_C.z + NUC_R.z * 0.6);
  kerLabel = new THREE.Vector3();

  constructor(shared: Shared) {
    const b = this.bin;
    this.erMat = b.add(new THREE.ShaderMaterial({
      vertexShader: erVert, fragmentShader: erFrag, side: THREE.DoubleSide, ...premul,
      uniforms: { ...shared, uTint: { value: new THREE.Color(0.10, 0.36, 0.52) }, uRim: { value: new THREE.Color(0.35, 0.8, 1.0) }, uFade: { value: 1 } },
    }));
    this.mitoMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.5, 0.15, 0.075), rim: new THREE.Color(1.0, 0.48, 0.25), rimA: 1.0,
      bumpF: 7, bumpS: 0.0006, wrap: 0.8, trans: 1.0, spec: 0.5, near: 0.3, bend: 0.4, drift: 0.0015,
      defines: { CRISTAE: 1, SEED: 1, BEND: 1 },
    }));
    this.golgiMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.95, 0.66, 0.2), rim: new THREE.Color(1.0, 0.85, 0.5), rimA: 0.7,
      bumpF: 160, bumpS: 0.0006, wrap: 0.8, trans: 1.0, spec: 0.5, near: 0.25, side: THREE.DoubleSide,
    }));
    this.vesMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.32, 0.32, 0.34), rimA: 1.1, rim: new THREE.Color(0.55, 0.72, 0.9), bumpF: 3,
      wrap: 0.9, trans: 1.0, spec: 0.6, near: 0.3, drift: 0.0012, emit: 0.0, defines: { ACOLOR: 1, SEED: 1 },
    }));
    this.kerMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.6, 0.55, 0.42), rim: new THREE.Color(0.95, 0.88, 0.7), rimA: 0.45,
      bumpS: 0.0003, wrap: 0.7, trans: 0.8, spec: 0.35, near: 0.2, defines: { FIBRE: 1 },
    }));
    this.desMat = b.add(solidMaterial(shared, {
      tint: new THREE.Color(0.7, 0.64, 0.5), rim: new THREE.Color(0.9, 0.85, 0.72), rimA: 0.5,
      bumpF: 900, bumpS: 0.0002, emit: 0.06, near: 0.2,
    }));
    this.partMat = b.add(pointsMaterial(shared, { alpha: 0.4, maxPx: 30, drift: 2.5 }));

    // Golgi: a fixed stack of 6 curved cisternae with swollen rims.
    const g = b.add(this.golgiGeometry());
    this.golgi = new THREE.Mesh(g, this.golgiMat);
    const axis = GOLGI_C.clone().sub(NUC_C).normalize();
    const qt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    this.golgiFrame.compose(GOLGI_C, qt, new THREE.Vector3(1, 1, 1));
    this.golgi.matrixAutoUpdate = false;
    this.golgi.matrix.copy(this.golgiFrame);
    this.golgi.renderOrder = 2;
    this.group.add(this.golgi);
  }

  private golgiGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      const R = 0.046 - Math.abs(i - 2) * 0.005 - i * 0.0015;
      let s: THREE.BufferGeometry = new THREE.SphereGeometry(1, 64, 20);
      s.deleteAttribute('uv'); s.deleteAttribute('normal');
      const m = mergeVertices(s); s.dispose(); s = m;
      const p = s.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k);
        const rho = Math.hypot(v.x, v.z);
        const th = Math.atan2(v.z, v.x);
        const outline = 1 + 0.14 * (fbm3(Math.cos(th) * 1.5 + i, Math.sin(th) * 1.5, i * 0.7, 2) - 0.5) * 2;
        const rr = R * outline;
        const thick = 0.0016 * (1 + 2.2 * Math.max(0, rho - 0.75) / 0.25);
        const x = v.x * rr, z = v.z * rr;
        const y = v.y * thick + i * 0.0062 + 7.5 * (x * x + z * z);
        p.setXYZ(k, x, y, z);
      }
      s.computeVertexNormals();
      parts.push(s);
    }
    // merge manually (indexed)
    let nv = 0, ni = 0;
    for (const p of parts) { nv += p.attributes.position.count; ni += p.index!.count; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array as Float32Array, ov * 3);
      nrm.set(p.attributes.normal.array as Float32Array, ov * 3);
      const ia = p.index!.array;
      for (let k = 0; k < ia.length; k++) idx[oi + k] = ia[k] + ov;
      ov += p.attributes.position.count; oi += ia.length;
      p.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  build(q: Quality) {
    this.qbin.dispose();
    for (const o of this.parts) this.group.remove(o);
    this.parts = [];
    const c = COUNTS[q];
    const add = (o: THREE.Object3D, order: number) => { o.renderOrder = order; this.group.add(o); this.parts.push(o); };
    add(this.buildER(c.er, c.erSeg), 5);
    add(this.buildMito(c.mito), 2);
    add(this.buildVesicles(c.ves), 2);
    const [ker, des] = this.buildKeratin(c.ker, c.sub, c.des);
    add(ker, 2); add(des, 2);
    this.particles = this.buildParticles(c.part);
    add(this.particles, 6);
  }

  private buildER(nSheets: number, seg: number) {
    const r = rng(5);
    const pos: number[] = [], nrm: number[] = [], thr: number[] = [], rough: number[] = [], edge: number[] = [], idx: number[] = [];
    const v = new THREE.Vector3(), p = new THREE.Vector3(), qt = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < nSheets; i++) {
      const s = 1.17 + i * 0.12;
      const phiLen = 1.6 + r() * 2.2, thLen = 1.0 + r() * 1.1;
      e.set(r() * 6.28, r() * 6.28, r() * 6.28); qt.setFromEuler(e);
      const nu = seg, nv = Math.round(seg * 0.6);
      const base = pos.length / 3;
      const t = i / Math.max(1, nSheets - 1);
      for (let a = 0; a <= nv; a++) {
        for (let bI = 0; bI <= nu; bI++) {
          const u = bI / nu, w = a / nv;
          const phi = u * phiLen, th = Math.PI / 2 - thLen / 2 + w * thLen;
          v.set(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)).applyQuaternion(qt);
          const fold = 1 + 0.09 * (fbm3(v.x * 2.6 + i * 3, v.y * 2.6, v.z * 2.6, 3) - 0.5) * 2
            + 0.025 * Math.sin((v.x * 3 + v.y * 5 + v.z * 2) * 4 + i);
          let rad = s * fold * nucShape(v.x, v.y, v.z);
          p.set(NUC_C.x + NUC_R.x * v.x * rad, NUC_C.y + NUC_R.y * v.y * rad, NUC_C.z + NUC_R.z * v.z * rad);
          for (let k = 0; k < 12 && cellRho(p) > 0.86; k++) {
            rad *= 0.96;
            p.set(NUC_C.x + NUC_R.x * v.x * rad, NUC_C.y + NUC_R.y * v.y * rad, NUC_C.z + NUC_R.z * v.z * rad);
          }
          pos.push(p.x, p.y, p.z);
          nrm.push(0, 0, 0);
          thr.push(0.6 - t * 0.12);
          rough.push(1 - t * 0.85);
          edge.push(Math.min(u, 1 - u, w, 1 - w) * 2);
        }
      }
      for (let a = 0; a < nv; a++) for (let bI = 0; bI < nu; bI++) {
        const i0 = base + a * (nu + 1) + bI, i1 = i0 + nu + 1;
        idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aThr', new THREE.Float32BufferAttribute(thr, 1));
    g.setAttribute('aRough', new THREE.Float32BufferAttribute(rough, 1));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.qbin.add(g);
    return new THREE.Mesh(g, this.erMat);
  }

  private buildMito(n: number) {
    const r = rng(9);
    const g = this.qbin.add(new THREE.CapsuleGeometry(0.5, 1, 8, 18));
    const seeds = new Float32Array(n);
    const mesh = new THREE.InstancedMesh(g, this.mitoMat, n);
    const p = new THREE.Vector3(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), m = new THREE.Matrix4(), d = new THREE.Vector3();
    const gInv = GOLGI_C;
    for (let i = 0; i < n; i++) {
      let tries = 0;
      do { cytoPoint(r, p, 0.84, 1.3); tries++; } while (p.distanceTo(gInv) < 0.08 && tries < 20);
      // lie roughly tangential to the nucleus (they stream along the cytoskeleton)
      const radial = d.subVectors(p, NUC_C).normalize();
      const tang = randDir(r).addScaledVector(radial, -randDir(r).dot(radial) * 0.0);
      tang.addScaledVector(radial, -tang.dot(radial) * 0.8).normalize();
      qt.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tang);
      const w = 0.0095 + r() * 0.0065;
      const L = 0.035 + r() * r() * 0.1;
      sc.set(w, L / 2, w * (0.85 + r() * 0.3));
      m.compose(p, qt, sc);
      mesh.setMatrixAt(i, m);
      seeds[i] = r();
      if (i === 0 || (this.mitoLabel.x > -0.12 && p.x < -0.18 && p.y < -0.05 && p.z > 0)) this.mitoLabel.copy(p);
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.qbin.add({ dispose: () => mesh.dispose() });
    return mesh;
  }

  private buildVesicles(n: number) {
    const r = rng(13);
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 3);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const mg = mergeVertices(g); g.dispose(); g = mg; g.computeVertexNormals();
    this.qbin.add(g);
    const mesh = new THREE.InstancedMesh(g, this.vesMat, n);
    const col = new Float32Array(n * 3), seeds = new Float32Array(n);
    const pal = [
      new THREE.Color(0.42, 0.62, 0.68), new THREE.Color(0.55, 0.45, 0.7), new THREE.Color(0.8, 0.6, 0.32),
      new THREE.Color(0.5, 0.62, 0.5), new THREE.Color(0.62, 0.42, 0.5),
    ];
    const p = new THREE.Vector3(), m = new THREE.Matrix4(), sc = new THREE.Vector3(), qt = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      let s: number;
      let c: THREE.Color;
      if (i < n * 0.25) {
        // budding from the Golgi rims
        const a = r() * Math.PI * 2, rr = 0.04 + r() * 0.02;
        p.set(Math.cos(a) * rr, (r() * 6) * 0.0062 + 7.5 * rr * rr + (r() - 0.5) * 0.01, Math.sin(a) * rr).applyMatrix4(this.golgiFrame);
        s = 0.0022 + r() * 0.0018;
        c = pal[r() < 0.6 ? 2 : 0];
      } else {
        cytoPoint(r, p, 0.88, 1.18);
        s = 0.003 + r() * r() * 0.007;
        c = pal[Math.floor(r() * pal.length)];
      }
      sc.set(s, s, s);
      m.compose(p, qt, sc);
      mesh.setMatrixAt(i, m);
      col.set([c.r, c.g, c.b], i * 3);
      seeds[i] = r();
    }
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.qbin.add({ dispose: () => mesh.dispose() });
    return mesh;
  }

  private buildKeratin(n: number, sub: number, nDes: number): [THREE.Mesh, THREE.InstancedMesh] {
    const r = rng(17);
    const tubes = new TubeBuilder();
    const ends: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
    const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), tmp = new THREE.Vector3();
    const surf = (d: THREE.Vector3, out: THREE.Vector3, k: number) => {
      const s = cellShape(d.x, d.y, d.z) * k;
      return out.set(CELL_C.x + CELL_R.x * d.x * s, CELL_C.y + CELL_R.y * d.y * s, CELL_C.z + CELL_R.z * d.z * s);
    };
    const nsurf = (d: THREE.Vector3, out: THREE.Vector3, k: number) => {
      const s = nucShape(d.x, d.y, d.z) * k;
      return out.set(NUC_C.x + NUC_R.x * d.x * s, NUC_C.y + NUC_R.y * d.y * s, NUC_C.z + NUC_R.z * d.z * s);
    };
    const rad = sub > 1 ? 0.00085 : 0.0016;
    for (let i = 0; i < n; i++) {
      randDir(r, d1);
      d2.copy(d1).addScaledVector(randDir(r, tmp), 0.9).normalize();
      nsurf(d1, a, 1.1 + r() * 0.05);
      surf(d2, b, 0.985);
      const nrm = new THREE.Vector3(d2.x / CELL_R.x, d2.y / CELL_R.y, d2.z / CELL_R.z).normalize();
      ends.push({ p: b.clone(), n: nrm });
      // leave the nucleus tangentially (perinuclear cage), then wander out to the desmosome
      tmp.crossVectors(d1, randDir(r)).normalize();
      c1.copy(a).addScaledVector(tmp, 0.07 + r() * 0.06).addScaledVector(d1, 0.03);
      c2.copy(b).addScaledVector(nrm, -0.06 - r() * 0.05);
      const way = [a.clone(), c1.clone()];
      const mid = new THREE.Vector3().addVectors(c1, c2).multiplyScalar(0.5).addScaledVector(randDir(r, tmp), 0.06);
      way.push(mid, c2.clone(), b.clone());
      const curve = new THREE.CatmullRomCurve3(way, false, 'centripetal');
      const steps = 56;
      for (let s = 0; s < sub; s++) {
        const pts: number[] = [];
        const ph = r() * 10;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          curve.getPoint(t, tmp);
          const w = Math.sin(t * Math.PI) * 0.0035;
          pts.push(tmp.x + Math.sin(t * 13 + ph) * w, tmp.y + Math.sin(t * 11 + ph * 2) * w, tmp.z + Math.cos(t * 12 + ph * 3) * w);
        }
        tubes.add(pts, (k) => rad * (0.6 + 0.4 * Math.sin((k / steps) * Math.PI)), sub > 1 ? 5 : 6, 1);
      }
      if (i === 0 || (this.kerLabel.y < 0.12 && b.y > 0.2 && b.x < -0.1)) this.kerLabel.set(a.x * 0.3 + b.x * 0.7, a.y * 0.3 + b.y * 0.7, a.z * 0.3 + b.z * 0.7);
    }
    // perinuclear cage arcs
    for (let i = 0; i < Math.round(n / 5); i++) {
      const ax = randDir(r), ref = randDir(r).cross(ax).normalize(), ref2 = new THREE.Vector3().crossVectors(ax, ref);
      const len = 1.8 + r() * 2.2, steps = 60, k = 1.08 + r() * 0.06, ph = r() * 6.28;
      for (let s = 0; s < sub; s++) {
        const pts: number[] = [];
        const off = (r() - 0.5) * 0.02;
        for (let j = 0; j <= steps; j++) {
          const t = ph + (j / steps) * len;
          d1.copy(ref).multiplyScalar(Math.cos(t)).addScaledVector(ref2, Math.sin(t)).addScaledVector(ax, off + 0.03 * Math.sin(t * 3)).normalize();
          nsurf(d1, a, k + 0.004 * Math.sin(t * 11 + s));
          pts.push(a.x, a.y, a.z);
        }
        tubes.add(pts, (j) => rad * (0.6 + 0.4 * Math.sin((j / steps) * Math.PI)), sub > 1 ? 5 : 6, 1);
      }
    }
    const kg = this.qbin.add(tubes.build());
    const ker = new THREE.Mesh(kg, this.kerMat);
    ker.frustumCulled = false;

    // desmosomes: at every bundle end, plus extra ones around the membrane
    while (ends.length < nDes) {
      randDir(r, d2);
      ends.push({ p: surf(d2, new THREE.Vector3(), 0.995), n: new THREE.Vector3(d2.x / CELL_R.x, d2.y / CELL_R.y, d2.z / CELL_R.z).normalize() });
    }
    const dg = this.qbin.add(new THREE.CylinderGeometry(1, 1, 1, 20, 1));
    const des = new THREE.InstancedMesh(dg, this.desMat, ends.length);
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), y = new THREE.Vector3(0, 1, 0);
    ends.forEach((e, i) => {
      qt.setFromUnitVectors(y, e.n);
      const s = 0.0035 + r() * 0.003;
      sc.set(s, 0.0012, s * (0.7 + r() * 0.5));
      m.compose(e.p, qt, sc);
      des.setMatrixAt(i, m);
    });
    des.instanceMatrix.needsUpdate = true;
    des.frustumCulled = false;
    this.qbin.add({ dispose: () => des.dispose() });
    return [ker, des];
  }

  private buildParticles(n: number) {
    const r = rng(19);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
    const p = new THREE.Vector3();
    const pal = [new THREE.Color(0.35, 0.7, 0.8), new THREE.Color(0.6, 0.75, 1.0), new THREE.Color(0.95, 0.7, 0.4), new THREE.Color(0.7, 0.55, 0.95)];
    for (let i = 0; i < n; i++) {
      cytoPoint(r, p, 0.97, 1.03);
      pos.set([p.x, p.y, p.z], i * 3);
      const c = pal[r() < 0.7 ? Math.floor(r() * 2) : 2 + Math.floor(r() * 2)];
      const k = 0.35 + 0.65 * r();
      col.set([c.r * k, c.g * k, c.b * k], i * 3);
      size[i] = 0.0005 + r() * r() * 0.0012;
      seed[i] = r();
    }
    const g = this.qbin.add(pointsGeometry(pos, col, size, seed));
    const pts = new THREE.Points(g, this.partMat);
    pts.frustumCulled = false;
    return pts;
  }

  update(z: number) {
    // once the camera is inside the nucleus, the cytoplasm beyond the envelope dissolves away
    const t = Math.min(1, Math.max(0, (z + 1.0) / 0.3));
    const f = t * t * (3 - 2 * t);
    this.group.visible = f > 0.001;
    for (const m of [this.erMat, this.mitoMat, this.golgiMat, this.vesMat, this.kerMat, this.desMat]) m.uniforms.uFade.value = f;
    this.partMat.uniforms.uAlpha.value = 0.4 * f;
    if (this.particles) this.particles.visible = z < 0.95;
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
