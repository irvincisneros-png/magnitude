/**
 * Neighbouring keratinocytes: a disc of epidermis around the hero cell, layered like real skin —
 * columnar basal cells (where new cells are made), polyhedral spinous cells (the hero's layer),
 * flattening granular cells, and the stratum corneum of flat, dead squames with no nucleus.
 * One instanced draw; each cell is shaded with a fake interior (the ray through its own nucleus)
 * so the tissue reads as translucent without sorting. Cells between the camera and the hero shrink
 * away (a cutaway), and the disc dissolves at its rim so the human layer shows around it.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../../engine/types';
import { COMMON, FRAG } from './glsl';
import { PAL, kelvin, type Shared } from './layout';
import { Bin, rng } from './util';

const CFG = {
  low: { radius: 6.5, detail: 2 },
  medium: { radius: 8.5, detail: 3 },
  high: { radius: 10.5, detail: 3 },
};

const vert = /* glsl */ `
${COMMON}
attribute vec3 aCenter; attribute vec3 aScale; attribute float aRot; attribute float aSeed; attribute float aType;
uniform vec3 uCamDir; uniform float uCutR; uniform float uEdgeR; uniform float uFade;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vCamL; varying float vType; varying float vSeed; varying float vEdge;
void main() {
  vec3 c = aCenter;
  float along = dot(c, uCamDir);
  float lat = length(c - uCamDir * along);
  float cut = mix(1.0, smoothstep(uCutR, uCutR + 0.55, lat), smoothstep(-0.6, 0.1, along));
  float rr = length(c.xz);
  vEdge = 1.0 - smoothstep(uEdgeR * 0.55, uEdgeR, rr + aSeed * 0.8);
  // shrink (rather than dither) cells near the camera, at the disc rim, and during the fade-in
  float near = smoothstep(uD * 0.3, uD * 0.75, distance(c, cameraPosition));
  float k = cut * near * smoothstep(0.0, 0.5, vEdge) * smoothstep(aSeed * 0.5, aSeed * 0.5 + 0.5, uFade);
  vec3 p = position;
  p *= 1.0 + 0.10 * (vnoise(p * 1.7 + aSeed * 31.0) - 0.5) + 0.03 * (vnoise(p * 4.0 + aSeed * 9.0 + uTime * 0.05) - 0.5);
  vL = p;
  float cr = cos(aRot), sr = sin(aRot);
  mat3 R = mat3(cr, 0.0, -sr, 0.0, 1.0, 0.0, sr, 0.0, cr);
  vec3 wp = c + R * (p * aScale * k);
  vW = wp;
  vN = normalize(R * (normal / aScale));
  // camera in this cell's unit space
  vCamL = (transpose(R) * (cameraPosition - c)) / max(aScale * k, vec3(1e-4));
  vType = aType; vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const frag = /* glsl */ `
${COMMON}
${FRAG}
uniform vec3 uCyto[4]; uniform vec3 uNucCol; uniform vec3 uRim;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vCamL; varying float vType; varying float vSeed; varying float vEdge;

float chord(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 o = ro - c; float b = dot(o, rd); float k = dot(o, o) - r * r;
  float h = b * b - k; if (h <= 0.0) return 0.0;
  h = sqrt(h);
  return max(0.0, -b + h) - max(0.0, -b - h);
}
void main() {
  vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 v = toC / dist;
  int ty = int(vType + 0.5);
  vec3 cyto = ty == 0 ? uCyto[0] : ty == 1 ? uCyto[1] : ty == 2 ? uCyto[2] : uCyto[3];
  vec3 rd = normalize(vL - vCamL);
  float th = clamp(-2.0 * dot(vL, rd), 0.0, 2.0);
  float h = fbm3(vL * 3.0 + vSeed * 20.0);
  // keratin bundles and organelles as a soft fibrous mottle inside each cell
  float fib = vnoise(vec3(vL.x * 3.0, vL.y * 14.0, vL.z * 3.0) + vSeed * 9.0);
  vec3 inside = cyto * (0.3 + 0.6 * th) * (0.7 + 0.45 * h) * (0.8 + 0.4 * fib);
  if (ty < 3) {
    vec3 nc = vec3(0.04, -0.06, 0.02);
    float nr = ty == 0 ? 0.46 : ty == 1 ? 0.36 : 0.30;
    float nt = chord(vL, rd, nc, nr);
    inside = mix(inside, uNucCol * (0.6 + 0.7 * h), (1.0 - exp(-nt * 2.6)) * 0.85);
  }
  if (ty == 2) { // keratohyalin granules in the granular layer
    float gr = smoothstep(0.72, 0.85, vnoise(vL * 9.0 + vSeed * 5.0));
    inside = mix(inside, vec3(0.06, 0.02, 0.08), gr * 0.7);
  }
  vec3 n = normalize(vN);
  n = bumpN(n, vW, h * 0.004);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 2.5);
  vec3 col = sssLight(inside, n, v, 0.8, 0.7, 0.12);
  col += uRim * fr * 0.4;
  float f = fogF(dist);
  col = mix(col, uFogCol, f);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Tissue {
  readonly group = new THREE.Group();
  private bin = new Bin();
  private qbin = new Bin();
  readonly mat: THREE.ShaderMaterial;
  private mesh?: THREE.Mesh;
  edgeR = 10;

  constructor(shared: Shared) {
    this.mat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        ...shared,
        uCamDir: { value: new THREE.Vector3(0, 0, 1) },
        uCutR: { value: 0.8 },
        uEdgeR: { value: 10 },
        uFade: { value: 1 },
        uCyto: { value: [
          new THREE.Color(0.08, 0.05, 0.12), // basal
          new THREE.Color(0.075, 0.072, 0.135), // spinous
          new THREE.Color(0.12, 0.08, 0.13), // granular
          new THREE.Color(0.25, 0.17, 0.19), // corneum (keratin-filled, paler)
        ] },
        uNucCol: { value: new THREE.Color(0.085, 0.04, 0.16) },
        uRim: { value: new THREE.Color(0.22, 0.32, 0.5) },
        // own fog: tissue fades into the dark extracellular backdrop, not the cytosol
        uFogCol: { value: PAL.outside.clone().multiplyScalar(2.0) },
        uFogDensity: { value: 0.2 },
        uFogStart: { value: 0 },
      },
    }));
  }

  build(q: Quality) {
    this.qbin.dispose();
    if (this.mesh) this.group.remove(this.mesh);
    const cfg = CFG[q];
    this.edgeR = cfg.radius;
    const r = rng(101);

    let base: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, cfg.detail);
    base.deleteAttribute('uv'); base.deleteAttribute('normal');
    const mg = mergeVertices(base); base.dispose(); base = mg;
    const p = base.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const kq = new THREE.Quaternion();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const k = kelvin(v.x, v.y, v.z, 6, kq);
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    base.computeVertexNormals();

    const C: number[] = [], S: number[] = [], Rt: number[] = [], Sd: number[] = [], T: number[] = [];
    const R = cfg.radius;
    const layer = (y: number, spacing: number, hs: [number, number, number], type: number, off: number) => {
      const rowH = spacing * 0.866;
      for (let row = -Math.ceil(R / rowH); row <= Math.ceil(R / rowH); row++) {
        for (let col = -Math.ceil(R / spacing) - 1; col <= Math.ceil(R / spacing) + 1; col++) {
          const x = (col + (row & 1 ? 0.5 : 0) + off) * spacing + (r() - 0.5) * spacing * 0.12;
          const z = (row + off * 0.7) * rowH + (r() - 0.5) * spacing * 0.12;
          if (Math.hypot(x, z) > R) continue;
          const yy = y + (r() - 0.5) * hs[1] * 0.25;
          // the hero cell occupies this slot
          if (type === 1 && Math.abs(yy) < 0.3 && Math.hypot(x, z) < spacing * 0.6) continue;
          // pack tightly, but leave the hero cell's own neighbours clear of its membrane
          const sj = (0.92 + r() * 0.16) * (Math.hypot(x, yy, z) < 1.75 ? 0.9 : 1.14);
          C.push(x, yy, z);
          S.push(hs[0] * sj, hs[1] * (0.9 + r() * 0.2) * 1.12, hs[2] * sj);
          Rt.push(r() * Math.PI * 2);
          Sd.push(r());
          T.push(type);
        }
      }
    };
    layer(-1.42, 0.6, [0.3, 0.42, 0.3], 0, 0.13);
    layer(-0.82, 1.0, [0.5, 0.42, 0.5], 1, 0.5);
    layer(0.0, 1.0, [0.5, 0.42, 0.5], 1, 0.0);
    layer(0.8, 1.04, [0.53, 0.38, 0.53], 1, 0.33);
    layer(1.38, 1.2, [0.64, 0.24, 0.64], 2, 0.1);
    layer(1.72, 1.35, [0.72, 0.15, 0.72], 2, 0.6);
    for (let i = 0; i < 5; i++) layer(1.97 + i * 0.105, 1.6, [0.86, 0.05, 0.86], 3, r());

    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(C), 3));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(S), 3));
    g.setAttribute('aRot', new THREE.InstancedBufferAttribute(new Float32Array(Rt), 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(Sd), 1));
    g.setAttribute('aType', new THREE.InstancedBufferAttribute(new Float32Array(T), 1));
    g.instanceCount = T.length;
    this.qbin.add(g);
    this.qbin.add(base);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    this.mat.uniforms.uEdgeR.value = R;
  }

  update(cam: THREE.Camera, fade: number, d: number) {
    this.group.visible = fade > 0.002;
    const u = this.mat.uniforms;
    u.uFogDensity.value = 0.55 / d;
    u.uFogStart.value = d * 0.5;
    (u.uCamDir.value as THREE.Vector3).copy(cam.position).normalize();
    u.uFade.value = fade;
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
