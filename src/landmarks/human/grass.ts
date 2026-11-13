/**
 * Coastal grass around the person: instanced, curved, tapering blades that bend in gusts of the
 * onshore breeze, glow when the low Sun shines through them, and take the person's soft shadow.
 * Dense near the feet, sparser further out, where the terrain shader's grass takes over.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON, type Shared } from './glsl';
import { FEET_H } from './figureSdf';
import { heightH } from './terrain';
import { fbm2, rawHeight, smoothstep, type Sample } from './terrainHeight';

const vert = /* glsl */ `
${COMMON}
attribute vec3 aPos; attribute vec4 aP;
uniform float uShow;
uniform vec3 uFeetC;
varying vec3 vP; varying vec3 vN; varying float vT; varying float vSeed; varying float vSh; varying float vSide; varying float vDry;
LOGZ_VARY
void main() {
  float t = position.x, side = position.y;
  float H = aP.x * uShow, w = aP.y, yaw = aP.z, seed = aP.w;
  vec2 dir = vec2(cos(yaw), sin(yaw));
  float lean = 0.15 + 0.55 * fract(seed * 7.31);
  // gusts roll in from the sea (east → west)
  vec2 wd = normalize(vec2(-1.0, 0.25));
  float gust = vnoise(aPos.xz * 0.35 - wd * uTime * 1.1) ;
  float flutter = sin(uTime * (2.4 + fract(seed * 3.3)) + seed * 30.0) * 0.12;
  float wind = (0.25 + 0.9 * gust * gust) * (0.6 + 0.6 * uWind) + flutter;
  vec2 bend = dir * lean + wd * wind;
  float b = length(bend);
  vec2 bd = bend / max(b, 1e-4);
  b = min(b, 1.3);
  // arc of constant length
  float ang = b * t;
  vec3 c = aPos + vec3(bd.x, 0.0, bd.y) * H * (b * t * t * 0.5) + vec3(0.0, 1.0, 0.0) * H * t * (1.0 - ang * ang * 0.17);
  vec3 across = normalize(vec3(-dir.y, 0.0, dir.x));
  float width = w * pow(max(1.0 - t, 1e-6), 0.7) * (1.0 - 0.3 * t);
  c += across * side * width * 0.5;
  vec3 up = normalize(vec3(bd.x * sin(ang), cos(ang), bd.y * sin(ang)));
  vec3 n = normalize(cross(across, up));
  // a little cupping across the blade
  n = normalize(n + across * side * 0.35);
  vP = c; vN = n; vT = t; vSeed = seed; vSide = side;
  vSh = figureShadow(aPos + vec3(0.0, H * t, 0.0)) * mix(footAO(aPos), 1.0, t * 0.6);
  vec2 qq = aPos.xz - uFeetC.xz;
  vDry = smoothstep(0.5, 0.72, fbmAA(qq * 0.09 + 7.0, 0.0, 4));
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const frag = /* glsl */ `
${COMMON}
varying vec3 vP; varying vec3 vN; varying float vT; varying float vSeed; varying float vSh; varying float vSide; varying float vDry;
LOGZ_VARY
void main() {
  vec3 v = normalize(uCamM - vP);
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float k = fract(vSeed * 13.7);
  float dry = clamp(vDry * 0.85 + smoothstep(0.8, 1.0, k) * 0.6, 0.0, 1.0);
  vec3 tipC = mix(vec3(0.085, 0.125, 0.04), vec3(0.21, 0.17, 0.08), dry);
  vec3 baseC = mix(vec3(0.025, 0.045, 0.014), vec3(0.06, 0.05, 0.025), dry);
  vec3 alb = mix(baseC, tipC, smoothstep(0.0, 0.85, vT));
  alb *= 0.85 + 0.3 * fract(vSeed * 31.1);
  float ao = mix(0.35, 1.0, smoothstep(0.0, 0.7, vT));
  float ndl = dot(n, uSun);
  vec3 col = alb * uSunCol * clamp(abs(ndl) * 0.8 + 0.2 * ndl, 0.0, 1.0) * vSh * ao;
  col += alb * skyIrr(n) * ao * 1.25;
  // transmitted sunlight through the blade (the low Sun is in front of the person)
  float tr = pow(max(dot(v, -uSun), 1e-6), 2.0) * 0.6 + 0.15 * max(-ndl, 0.0);
  col += vec3(0.16, 0.26, 0.03) * uSunCol * tr * vSh * smoothstep(0.1, 0.9, vT) * 0.5;
  // waxy sheen
  vec3 h = normalize(uSun + v);
  col += uSunCol * pow(max(dot(n, h), 1e-6), 40.0) * 0.08 * vSh;
  col = aerial(col, vP);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

const TIER = { low: { inner: 12000, outer: 6000 }, medium: { inner: 28000, outer: 14000 }, high: { inner: 30000, outer: 14000 } };

export class Grass {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private mesh?: THREE.Mesh;
  private uShow = { value: 1 };
  private feet: Float32Array | null = null;

  constructor(shared: Shared) {
    this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide, uniforms: { ...shared, uShow: this.uShow, uFeetC: { value: new THREE.Vector3(FEET_H[0], 0, FEET_H[2]) } } });
  }

  setFeet(f: Float32Array, q: Quality) { this.feet = f; this.build(q); }

  build(q: Quality) {
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    const cfg = TIER[q];
    const SEG = 4;
    const base: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) base.push(i / SEG, -1, 0, i / SEG, 1, 0);
    base.push(1, 0, 0);
    for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    idx.push((SEG - 1) * 2, (SEG - 1) * 2 + 1, SEG * 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
    g.setIndex(idx);
    const total = cfg.inner + cfg.outer;
    const P = new Float32Array(total * 3), A = new Float32Array(total * 4);
    let seed = 4241;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const cx = FEET_H[0], cz = FEET_H[2];
    const s: Sample = { y: 0, e: 0, W: 0, esc: 0 };
    let k = 0;
    for (let n = 0; n < total * 3 && k < total; n++) {
      const r = 11 * Math.pow(rnd(), 0.72);
      const a = rnd() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      rawHeight(x - FEET_H[0], z - FEET_H[2], s);
      if (s.e < 17 + rnd() * 3) continue; // not over the cliff edge
      if (this.feet && this.onShoe(x, z)) continue;
      const y = heightH(x, z);
      // patchy: tussocks taller near the cliff edge, shorter (grazed) further back
      const tall = Math.exp(-((s.e - 15) ** 2) / 20);
      const tuft = 0.4 + 1.2 * fbm2(x / 1.4 + 3, z / 1.4, 3);
      const h = (0.05 + Math.pow(rnd(), 1.6) * 0.14) * (1 + tall * 1.4) * tuft * (1 - 0.6 * smoothstep(7, 11, r));
      P.set([x, y - 0.01, z], k * 3);
      A.set([h, (0.0035 + rnd() * 0.003) * (1 + 0.6 * smoothstep(2, 8, r)), rnd() * Math.PI * 2, rnd()], k * 4);
      k++;
    }
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(P, 3));
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(A, 4));
    g.instanceCount = k;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
  }

  private onShoe(x: number, z: number) {
    const f = this.feet!;
    for (let i = 0; i < 2; i++) {
      const dx = x - f[i * 4], dz = z - f[i * 4 + 1];
      const along = dx * f[i * 4 + 2] + dz * f[i * 4 + 3];
      const across = -dx * f[i * 4 + 3] + dz * f[i * 4 + 2];
      if ((along / 0.16) ** 2 + (across / 0.065) ** 2 < 1) return true;
    }
    return false;
  }

  update(zoom: number) {
    const show = THREE.MathUtils.smoothstep(zoom, -1.6, -1.1) * (1 - THREE.MathUtils.smoothstep(zoom, 1.7, 2.2));
    this.uShow.value = show;
    this.group.visible = show > 0.01;
  }

  dispose() { this.mesh?.geometry.dispose(); this.mat.dispose(); }
}
