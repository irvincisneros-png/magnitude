/**
 * Shared GLSL for the E. coli landmark: noise, soft subsurface-style lighting, depth fog,
 * dithering, and the analytic capsule (the cell body) used to give everything inside the
 * envelope a true sense of depth in the cytoplasm.
 *
 * "Cell space" = the hero group's object space: the rod lies along X, centred at the origin.
 */
import * as THREE from 'three';
import { CAP_H, CAP_R } from './layout';

const f = (x: number) => x.toFixed(5);

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uLightDir;
uniform float uFogDensity;
uniform vec3 uFogCol;
uniform float uD;
uniform float uPxScale;
uniform vec3 uCamObj;     // camera position in cell space
uniform float uCytoK;     // extinction per unit length inside the cytoplasm

const float CAP_H = ${f(CAP_H)};
const float CAP_R = ${f(CAP_R)};

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return v / 0.875;
}
float fbm2o(vec3 p) { return (vnoise(p) * 0.66 + vnoise(p * 2.07 + 3.1) * 0.34); }

float fogF(float dist) { return 1.0 - exp(-max(dist, 0.0) * uFogDensity); }

float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

/** Signed distance to the cell capsule (radius r) in cell space. */
float sdCap(vec3 p, float r) {
  vec3 q = p; q.x -= clamp(q.x, -CAP_H, CAP_H);
  return length(q) - r;
}
/** Ray / capsule entry distance (iq). -1 if missed. Capsule axis along X from -CAP_H to CAP_H. */
float capEnter(vec3 ro, vec3 rd, float ra) {
  vec3 pa = vec3(-CAP_H, 0.0, 0.0), pb = vec3(CAP_H, 0.0, 0.0);
  vec3 ba = pb - pa; vec3 oa = ro - pa;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - ra * ra * baba;
  float h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = (y <= 0.0) ? oa : ro - pb;
    b = dot(rd, oc); c = dot(oc, oc) - ra * ra; h = b * b - c;
    if (h > 0.0) return -b - sqrt(h);
  }
  return -1.0;
}
/** Length of cytoplasm between the camera and point p (cell space). */
float cytoDepth(vec3 p) {
  vec3 d = p - uCamObj; float L = length(d);
  if (sdCap(uCamObj, CAP_R * 0.97) < 0.0) return L;
  float t = capEnter(uCamObj, d / L, CAP_R * 0.97);
  return t < 0.0 ? 0.0 : max(0.0, L - t);
}

/** Soft "subsurface" lighting: wrapped key, cool fill, back-light transmission, wet specular. */
vec3 sssLight(vec3 base, vec3 n, vec3 v, float wrap, float trans, float specK) {
  vec3 L = uLightDir;
  float ndl = dot(n, L);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  float fill = clamp(dot(n, vec3(-0.45, -0.7, 0.55)) * 0.5 + 0.5, 0.0, 1.0);
  float back = pow(clamp(dot(v, -L) * 0.5 + 0.5, 0.0, 1.0), 4.0) * trans;
  vec3 h = normalize(L + v);
  float spec = pow(clamp(dot(n, h), 0.0, 1.0), 42.0) * smoothstep(-0.2, 0.3, ndl);
  return base * (0.10 + 0.95 * diff + 0.25 * fill) + fill * vec3(0.010, 0.02, 0.025)
       + base * back * 1.3 + vec3(0.85, 0.95, 0.9) * spec * specK;
}
`;

/** Fragment-only helpers (screen-space derivatives). */
export const FRAG = /* glsl */ `
vec3 bumpN(vec3 n, vec3 wp, float h) {
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - grad);
}
`;

/** Premultiplied-alpha "over" blending. */
export const PREMUL = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
} as const;
/** Additive colour, alpha untouched. */
export const ADD = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
} as const;
