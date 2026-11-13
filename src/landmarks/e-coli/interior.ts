/**
 * Inside the envelope: the nucleoid (the bacterial chromosome — no nucleus around it) as a
 * branching, looping mass of DNA bundles in two lobes (the chromosome is being copied), haloed by
 * fine DNA loops; tens of thousands of ribosomes crowding the cytoplasm (sparser inside the
 * nucleoid), and smaller soluble proteins. Everything jostles and fades with depth into the cytoplasm.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON, FRAG, PREMUL } from './glsl';
import { CAP_H, CAP_R, PAL, type Shared } from './layout';
import { pointsGeometry, pointsMaterial } from './points';
import { Bin, TubeBuilder, randDir, rng } from './util';

const COUNTS = {
  low: { strands: 18, radial: 5, dna: 2500, ribo: 14000, prot: 12000 },
  medium: { strands: 22, radial: 6, dna: 4000, ribo: 30000, prot: 34000 },
  high: { strands: 26, radial: 7, dna: 6000, ribo: 46000, prot: 70000 },
};

const nucVert = /* glsl */ `
${COMMON}
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec2 vUv;
void main() {
  vec3 p = position;
  p += normal * (vnoise(p * 90.0 + vec3(0.0, uTime * 0.25, 0.0)) - 0.5) * 0.004;
  p += (vec3(vnoise(p * 9.0 + uTime * 0.08), vnoise(p * 9.0 + 7.0 + uTime * 0.08), vnoise(p * 9.0 - 5.0 - uTime * 0.08)) - 0.5) * 0.008;
  vObj = p; vUv = uv;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const nucFrag = /* glsl */ `
${COMMON}
${FRAG}
uniform vec3 uTint; uniform vec3 uCyto; uniform float uA;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec2 vUv;
void main() {
  vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 v = toC / dist;
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  // supercoiled strands: a twisted rope texture along the bundle
  float tw = 0.5 + 0.5 * sin(vUv.y * 6.2831 * 3.0 - vUv.x * 900.0);
  float h = fbm2o(vObj * 160.0);
  n = bumpN(n, vW, (tw * 0.7 + h * 0.5) * 0.0012);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  vec3 base = uTint * (0.55 + 0.45 * tw) * (0.75 + 0.5 * h);
  vec3 col = sssLight(base, n, v, 0.9, 1.0, 0.4) * 0.8 + uTint * (pow(1.0 - ndv, 2.0) * 0.45 + 0.12);
  float att = exp(-cytoDepth(vObj) * uCytoK * 0.28);
  col = mix(uCyto * 1.5, col, att);
  float a = (0.3 + 0.3 * tw + 0.3 * pow(1.0 - ndv, 2.0)) * (0.5 + 0.5 * att) * uA;
  a *= smoothstep(uD * 0.01, uD * 0.06, dist);
  col = mix(col, uFogCol, fogF(dist));
  gl_FragColor = vec4(col * a, a);
}`;

/** Inside test for the cytoplasm (cell space). */
function capSd(x: number, y: number, z: number, r: number) {
  const dx = x - Math.min(CAP_H, Math.max(-CAP_H, x));
  return Math.hypot(dx, y, z) - r;
}

export class Interior {
  readonly group = new THREE.Group();
  private bin = new Bin();
  private qbin = new Bin();
  private nucMat: THREE.ShaderMaterial;
  private dnaMat: THREE.ShaderMaterial;
  private riboMat: THREE.ShaderMaterial;
  private protMat: THREE.ShaderMaterial;
  /** Label anchors (cell space). */
  nucleoidLabel = new THREE.Vector3(-0.15, 0.04, 0.05);
  riboLabel = new THREE.Vector3(0.3, -0.08, 0.12);

  constructor(shared: Shared) {
    this.nucMat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: nucVert, fragmentShader: nucFrag, ...PREMUL, side: THREE.DoubleSide,
      uniforms: { ...shared, uTint: { value: PAL.dna.clone().multiplyScalar(1.1) }, uCyto: { value: PAL.cytosol.clone() }, uA: { value: 1 } },
    }));
    this.dnaMat = this.bin.add(pointsMaterial(shared, { alpha: 0.4, drift: 0.6, maxPx: 50, cyto: PAL.cytosol, cytoMul: 0.32 }));
    this.riboMat = this.bin.add(pointsMaterial(shared, { alpha: 0.55, drift: 0.35, maxPx: 90, cyto: PAL.cytosol, cytoMul: 1.6 }));
    this.protMat = this.bin.add(pointsMaterial(shared, { alpha: 0.6, drift: 0.9, maxPx: 60, cyto: PAL.cytosol, cytoMul: 1.2 }));
  }

  build(q: Quality) {
    this.qbin.dispose();
    this.group.clear();
    const c = COUNTS[q];
    const r = rng(77);

    // ---------------------------------------------------------------- nucleoid strands
    const tb = new TubeBuilder();
    const nodes: number[] = [];
    const lobes = [new THREE.Vector3(-0.15, 0.005, 0.0), new THREE.Vector3(0.14, -0.01, 0.005)];
    const semi = new THREE.Vector3(0.17, 0.095, 0.1);
    const p = new THREE.Vector3(), d = new THREE.Vector3(), tmp = new THREE.Vector3(), rel = new THREE.Vector3();
    const walk = (start: THREE.Vector3, dir: THREE.Vector3, lobe: THREE.Vector3, steps: number, rad: number, depth: number) => {
      const pts: number[] = [];
      p.copy(start); d.copy(dir);
      for (let i = 0; i < steps; i++) {
        pts.push(p.x, p.y, p.z);
        nodes.push(p.x, p.y, p.z);
        // wander, curling into loops, pulled back inside the lobe
        d.addScaledVector(randDir(r, tmp), 0.38).normalize();
        rel.subVectors(p, lobe).divide(semi);
        const out = rel.length();
        if (out > 0.8) d.addScaledVector(rel.normalize(), -(out - 0.8) * 2.5).normalize();
        p.addScaledVector(d, 0.011 + r() * 0.006);
        if (depth < 2 && r() < 0.1) {
          const s2 = p.clone(), d2 = randDir(r).add(d).normalize();
          const sp = p.clone(), sd = d.clone();
          walk(s2, d2, lobe, 6 + Math.floor(r() * 14), rad * 0.6, depth + 1);
          p.copy(sp); d.copy(sd);
        }
      }
      if (pts.length >= 6) {
        const n = pts.length / 3;
        tb.add(pts, (i) => rad * (0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / n)), c.radial);
      }
    };
    for (let i = 0; i < c.strands; i++) {
      const lobe = lobes[i % 2];
      const st = randDir(r).multiply(semi).multiplyScalar(0.6 * Math.cbrt(r())).add(lobe);
      walk(st, randDir(r), lobe, 30 + Math.floor(r() * 30), 0.0035 + r() * 0.0025, 0);
    }
    // a bridge of DNA between the two lobes
    for (let i = 0; i < 3; i++) {
      const pts: number[] = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        pts.push(-0.1 + 0.2 * t, 0.02 * Math.sin(t * 9 + i * 2) + (i - 1) * 0.02, 0.03 * Math.cos(t * 7 + i));
      }
      tb.add(pts, () => 0.004, c.radial);
    }
    const nucGeo = this.qbin.add(tb.build());
    const nuc = new THREE.Mesh(nucGeo, this.nucMat);
    nuc.renderOrder = 5;
    this.group.add(nuc);
    if (nodes.length > 30) this.nucleoidLabel.set(nodes[30], nodes[31], nodes[32]);

    // occupancy grid of the nucleoid (to keep ribosomes mostly out of it)
    const GX = 48, GY = 16, GZ = 16;
    const occ = new Float32Array(GX * GY * GZ);
    const gi = (x: number, y: number, z: number) => {
      const ix = Math.floor(((x + 0.5) / 1) * GX), iy = Math.floor(((y + CAP_R) / (2 * CAP_R)) * GY), iz = Math.floor(((z + CAP_R) / (2 * CAP_R)) * GZ);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= GX || iy >= GY || iz >= GZ) return -1;
      return ix + GX * (iy + GY * iz);
    };
    for (let i = 0; i < nodes.length; i += 3) {
      for (let k = 0; k < 6; k++) {
        const j = gi(nodes[i] + (r() - 0.5) * 0.04, nodes[i + 1] + (r() - 0.5) * 0.04, nodes[i + 2] + (r() - 0.5) * 0.04);
        if (j >= 0) occ[j] += 0.25;
      }
    }

    // ---------------------------------------------------------------- DNA loops (fine fuzz around the strands)
    {
      const n = c.dna;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
      const nn = nodes.length / 3;
      for (let i = 0; i < n; i++) {
        const k = Math.floor(r() * nn) * 3;
        const g = () => (r() + r() + r() - 1.5) * 0.01;
        pos[i * 3] = nodes[k] + g(); pos[i * 3 + 1] = nodes[k + 1] + g(); pos[i * 3 + 2] = nodes[k + 2] + g();
        const w = 0.75 + r() * 0.45;
        col[i * 3] = PAL.dna.r * w; col[i * 3 + 1] = PAL.dna.g * w * (0.9 + r() * 0.15); col[i * 3 + 2] = PAL.dna.b * w;
        size[i] = 0.0028 + r() * 0.003;
        seed[i] = r();
      }
      const pts = new THREE.Points(this.qbin.add(pointsGeometry(pos, col, size, seed)), this.dnaMat);
      pts.renderOrder = 5.5; pts.frustumCulled = false;
      this.group.add(pts);
    }

    // ---------------------------------------------------------------- ribosomes and proteins
    const fill = (n: number, maxR: number, avoid: number, sz: () => number, colour: (i: number, o: Float32Array) => void, mat: THREE.ShaderMaterial, order: number) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let x = 0, y = 0, z = 0;
        for (let t = 0; t < 60; t++) {
          x = (r() * 2 - 1) * (CAP_H + maxR); y = (r() * 2 - 1) * maxR; z = (r() * 2 - 1) * maxR;
          if (capSd(x, y, z, maxR) > 0) continue;
          const j = gi(x, y, z);
          if (j >= 0 && r() < Math.min(0.9, occ[j] * avoid)) continue;
          break;
        }
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        colour(i, col);
        size[i] = sz();
        seed[i] = r();
              }
      const pts = new THREE.Points(this.qbin.add(pointsGeometry(pos, col, size, seed)), mat);
      pts.renderOrder = order; pts.frustumCulled = false;
      this.group.add(pts);
    };
    const rib = PAL.ribosome;
    this.riboLabel.set(0.4, -0.11, 0.08);
    fill(c.ribo, CAP_R * 0.9, 2.5, () => 0.0085 + r() * 0.0022, (i, o) => {
      const w = 0.75 + r() * 0.5, hue = r();
      o[i * 3] = rib.r * w * (0.85 + hue * 0.3); o[i * 3 + 1] = rib.g * w; o[i * 3 + 2] = rib.b * w * (1.25 - hue * 0.4);
    }, this.riboMat, 4);
    const pr = PAL.protein;
    fill(c.prot, CAP_R * 0.92, 0.3, () => 0.0035 + r() * r() * 0.006, (i, o) => {
      const w = 0.7 + r() * 0.6, k = r();
      // mostly blue-teal soluble proteins, some green and a few warm enzymes
      if (k < 0.12) { o[i * 3] = 0.55 * w; o[i * 3 + 1] = 0.42 * w; o[i * 3 + 2] = 0.2 * w; }
      else if (k < 0.35) { o[i * 3] = 0.2 * w; o[i * 3 + 1] = 0.5 * w; o[i * 3 + 2] = 0.38 * w; }
      else { o[i * 3] = pr.r * w; o[i * 3 + 1] = pr.g * w; o[i * 3 + 2] = pr.b * w; }
    }, this.protMat, 3);
  }

  /** detail: 0 at the zoom-out end → 1 when close. */
  update(zoom: number, zoomIn: number) {
    this.nucMat.uniforms.uA.value = 1 - 0.85 * zoomIn;
    this.dnaMat.uniforms.uAlpha.value = 0.4 * (1 - 0.85 * zoomIn);
    // when far away the grain sizes inflate slightly so the cytoplasm still reads as granular
    const far = Math.min(1, Math.max(0, (zoom - 0.2) / 0.8));
    this.riboMat.uniforms.uSizeMul.value = 1 + far * 0.25;
    this.protMat.uniforms.uSizeMul.value = 1 + far * 0.4;
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
