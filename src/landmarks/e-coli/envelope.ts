/**
 * The Gram-negative envelope: a softly wrinkled, translucent outer membrane studded with porins
 * (a seamless cellular pattern that resolves into individual protein knobs when you are close),
 * a fainter inner membrane 16 nm below it (the periplasm between), and — drawn on the back faces —
 * the cytoplasm as an analytic volume, so the body glows thicker where you look through more of it.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON, FRAG, PREMUL } from './glsl';
import { CAP_H, CAP_R, NM, PAL, axisPoint, surfR, type Shared } from './layout';
import { Bin } from './util';

const RES = { low: [150, 112], medium: [210, 160], high: [280, 208] } as const;
/** Porin lattice: cells around the circumference (seamless) and per unit along the profile. */
const PORIN_AROUND = 210;
const PORIN_ALONG = (PORIN_AROUND / (2 * Math.PI * CAP_R));

const vert = /* glsl */ `
${COMMON}
uniform float uUnd;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying float vRad;
void main() {
  vec3 p = position;
  float w = vnoise(p * 14.0 + vec3(0.0, uTime * 0.06, 0.0)) - 0.5;
  w += 0.5 * (vnoise(p * 33.0 - vec3(uTime * 0.05)) - 0.5);
  p += normal * w * uUnd;
  vObj = p;
  vUv = uv;
  vec3 ap = vec3(clamp(p.x, -CAP_H, CAP_H), 0.0, 0.0);
  vRad = length(p.yz) / CAP_R;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// ------------------------------------------------------------------ outer membrane (front faces)
const outerFrag = /* glsl */ `
${COMMON}
${FRAG}
uniform vec3 uTint; uniform vec3 uRim; uniform float uAlpha; uniform float uRimA; uniform float uDetail;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying float vRad;
const float NA = ${PORIN_AROUND.toFixed(1)};
const float NL = ${PORIN_ALONG.toFixed(3)};

// seamless worley over (arc, angle) with the angle wrapping every NA cells
vec3 porins(vec2 q) {
  vec2 i = floor(q); vec2 f = fract(q);
  float d1 = 9.0, d2 = 9.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = i + g; c.y = mod(c.y, NA);
    vec2 o = hash22(c) * 0.8 + 0.1;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash22(c + 17.0).x; } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

void main() {
  vec3 toC = cameraPosition - vW;
  float dist = length(toC);
  vec3 v = toC / dist;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;

  float h = fbm3(vObj * 70.0 + vec3(0.0, 0.0, uTime * 0.04));
  float h2 = vnoise(vObj * 260.0 + h * 2.0);
  vec2 q = vec2(vUv.x * NL, vUv.y * NA);
  float aa = length(fwidth(q));
  float lod = (1.0 - smoothstep(0.18, 0.55, aa)) * smoothstep(0.35, 0.75, vRad) * uDetail;
  float knob = 0.0, groove = 0.0, pid = 0.5;
  if (lod > 0.001) {
    vec3 w = porins(q);
    pid = w.z;
    // trimeric porins: a rounded knob with three dimples
    knob = smoothstep(0.42, 0.08, w.x) * (0.55 + 0.45 * w.z);
    groove = 1.0 - smoothstep(0.0, 0.12, w.y - w.x);
    knob *= lod; groove *= lod;
  }
  float hh = h * 0.6 + h2 * 0.25 * uDetail + knob * 0.9 - groove * 0.3;
  n = bumpN(n, vW, hh * 0.0028);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 2.4);
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (ndv * 1.2 + h * 0.5 + vec3(0.0, 0.33, 0.67)));
  vec3 base = uTint * (0.75 + 0.5 * h) * (1.0 + knob * 0.6 * (0.7 + 0.6 * pid));
  vec3 col = sssLight(base, n, v, 0.7, 0.9, 0.8) * 0.6;
  col += uRim * mix(vec3(1.0), film * 1.4, 0.35) * fr * uRimA;
  col += uRim * knob * 0.05;
  float a = uAlpha * (0.75 + 0.5 * h) + knob * uAlpha * 0.8 + fr * uRimA * 0.7;
  a = min(a, 0.95);
  a *= smoothstep(uD * 0.004, uD * 0.03, dist);
  float f = fogF(dist);
  col = mix(col, uFogCol, f);
  a *= 1.0 - 0.6 * f;
  gl_FragColor = vec4(col * a, a);
}`;

// ------------------------------------------------------------------ back faces: membrane + cytoplasm volume
const backFrag = /* glsl */ `
${COMMON}
uniform vec3 uTint; uniform vec3 uRim; uniform vec3 uCyto; uniform float uVolA; uniform float uGain;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying float vRad;
void main() {
  vec3 toC = cameraPosition - vW;
  float dist = length(toC);
  vec3 v = toC / dist;
  vec3 n = -normalize(vN);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float len = cytoDepth(vObj);
  vec3 mid = vObj - normalize(vObj - uCamObj) * len * 0.5;
  float m = fbm2o(mid * 22.0 + vec3(0.0, uTime * 0.03, 0.0));
  float k = 1.0 - exp(-len * 7.0);
  vec3 vol = uCyto * uGain * (0.55 + 0.9 * m) * (0.6 + 0.8 * k);
  float h = vnoise(vObj * 70.0);
  vec3 mem = uTint * (0.6 + 0.5 * h) * 0.35 + uRim * pow(1.0 - ndv, 3.0) * 0.12;
  float am = 0.10 + 0.25 * pow(1.0 - ndv, 2.0);
  vec3 col = mem * am * (1.0 - k) + vol * k;
  float a = 1.0 - (1.0 - am) * (1.0 - k * uVolA);
  a *= smoothstep(uD * 0.004, uD * 0.03, dist);
  float f = fogF(dist);
  col = mix(col, uFogCol * a, f);
  gl_FragColor = vec4(col * smoothstep(uD * 0.004, uD * 0.03, dist), a);
}`;

// ------------------------------------------------------------------ inner (cytoplasmic) membrane: rim only
const innerFrag = /* glsl */ `
${COMMON}
uniform vec3 uRim; uniform float uA;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying float vRad;
void main() {
  vec3 toC = cameraPosition - vW;
  float dist = length(toC);
  vec3 v = toC / dist;
  vec3 n = normalize(vN);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float h = fbm2o(vObj * 90.0 + uTime * 0.02);
  float fr = pow(1.0 - ndv, 3.5);
  float a = (fr * 0.55 + 0.03 + 0.04 * h) * uA;
  a *= smoothstep(uD * 0.004, uD * 0.03, dist);
  vec3 col = uRim * (0.6 + 0.6 * h);
  gl_FragColor = vec4(col * a, a * 0.6);
}`;

/** Capsule profile: arc position s → (x, r). */
function profile(s: number): [number, number] {
  const q = (Math.PI * CAP_R) / 2;
  if (s < q) { const ph = s / CAP_R; return [-CAP_H - CAP_R * Math.cos(ph), CAP_R * Math.sin(ph)]; }
  if (s < q + 2 * CAP_H) return [-CAP_H + (s - q), CAP_R];
  const ph = (s - q - 2 * CAP_H) / CAP_R;
  return [CAP_H + CAP_R * Math.sin(ph), CAP_R * Math.cos(ph)];
}

/** Capsule shell with the wrinkle displacement baked in; `inset` pulls it inwards (inner membrane). */
export function envelopeGeometry(q: Quality, inset = 0) {
  const [nU, nV] = RES[q];
  const S = Math.PI * CAP_R + 2 * CAP_H;
  const pos = new Float32Array((nU + 1) * (nV + 1) * 3);
  const uv = new Float32Array((nU + 1) * (nV + 1) * 2);
  const p = new THREE.Vector3(), ap = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i <= nU; i++) {
    // denser rings on the caps (they curve), uniform-ish along the body
    const t = i / nU;
    const s = S * (t - 0.035 * Math.sin(2 * Math.PI * t));
    const [x, r] = profile(s);
    for (let j = 0; j <= nV; j++) {
      const th = (j / nV) * Math.PI * 2;
      p.set(x, -r * Math.cos(th), r * Math.sin(th));
      axisPoint(p, ap);
      d.subVectors(p, ap);
      if (d.lengthSq() < 1e-12) d.set(x < 0 ? -1 : 1, 0, 0);
      d.normalize();
      const R = surfR(p) - inset;
      const k = (i * (nV + 1) + j);
      pos[k * 3] = ap.x + d.x * R; pos[k * 3 + 1] = ap.y + d.y * R; pos[k * 3 + 2] = ap.z + d.z * R;
      uv[k * 2] = s; uv[k * 2 + 1] = j / nV;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++) {
    const a = i * (nV + 1) + j, b = a + nV + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // weld the normals across the seam (j = 0 and j = nV are the same points) and at the poles
  const nr = g.attributes.normal as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i <= nU; i++) {
    const i0 = i * (nV + 1), i1 = i0 + nV;
    a.fromBufferAttribute(nr, i0).add(b.fromBufferAttribute(nr, i1)).normalize();
    nr.setXYZ(i0, a.x, a.y, a.z); nr.setXYZ(i1, a.x, a.y, a.z);
  }
  for (const i of [0, nU]) {
    for (let j = 0; j <= nV; j++) nr.setXYZ(i * (nV + 1) + j, i === 0 ? -1 : 1, 0, 0);
  }
  g.computeBoundingSphere();
  return g;
}

export class Envelope {
  readonly group = new THREE.Group();
  readonly outerMat: THREE.ShaderMaterial;
  readonly backMat: THREE.ShaderMaterial;
  readonly innerMat: THREE.ShaderMaterial;
  private bin = new Bin();
  private qbin = new Bin();

  constructor(shared: Shared) {
    this.outerMat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: outerFrag, ...PREMUL, side: THREE.FrontSide,
      uniforms: {
        ...shared, uUnd: { value: 2.5 * NM },
        uTint: { value: PAL.membrane.clone() }, uRim: { value: PAL.membraneRim.clone() },
        uAlpha: { value: 0.1 }, uRimA: { value: 0.75 }, uDetail: { value: 1 },
      },
    }));
    this.backMat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: backFrag, ...PREMUL, side: THREE.BackSide,
      uniforms: {
        ...shared, uUnd: { value: 2.5 * NM },
        uTint: { value: PAL.membrane.clone() }, uRim: { value: PAL.membraneRim.clone() },
        uCyto: { value: PAL.cytosol.clone() }, uVolA: { value: 0.9 }, uGain: { value: 1 },
      },
    }));
    this.innerMat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: innerFrag, ...PREMUL, side: THREE.FrontSide,
      uniforms: { ...shared, uUnd: { value: 2 * NM }, uRim: { value: PAL.inner.clone() }, uA: { value: 0.8 } },
    }));
  }

  build(q: Quality) {
    this.qbin.dispose();
    this.group.clear();
    const outer = this.qbin.add(envelopeGeometry(q));
    const inner = this.qbin.add(envelopeGeometry(q === 'high' ? 'medium' : 'low', 16 * NM));
    const back = new THREE.Mesh(outer, this.backMat); back.renderOrder = 0;
    const inn = new THREE.Mesh(inner, this.innerMat); inn.renderOrder = 6;
    const front = new THREE.Mesh(outer, this.outerMat); front.renderOrder = 9;
    this.group.add(back, inn, front);
    this.outerMat.defines = q === 'low' ? { LOW: 1 } : {};
    this.outerMat.needsUpdate = true;
  }

  /** zoomIn: 0 at the hero view → 1 at the membrane-landscape end. */
  update(zoomIn: number, far: number) {
    // far: 0 → 1 over the zoom-out end, where the rod must still read as a solid little body
    this.outerMat.uniforms.uAlpha.value = 0.07 + 0.55 * zoomIn + 0.3 * far;
    this.outerMat.uniforms.uRimA.value = 0.75 - 0.25 * zoomIn + 0.6 * far;
    this.backMat.uniforms.uGain.value = 1 + 1.2 * far;
    this.innerMat.uniforms.uA.value = 0.8 * (1 - 0.6 * zoomIn);
  }

  dispose() { this.qbin.dispose(); this.bin.dispose(); }
}
