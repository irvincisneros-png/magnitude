/**
 * Shared GLSL for the human landmark: uniforms, noise, logarithmic depth, sky, aerial perspective,
 * soft capsule shadows and the morning light. Every material in this scene includes COMMON.
 *
 * Space: shaders work in "H metres": metres relative to the skin point on the back of the hand
 * (the origin). Object `position` attributes are in that space (the scene root only scales by 1/1.7).
 *
 * Depth: the camera's depth range has to span 80 µm skin to a 30 km horizon, so every material
 * writes a logarithmic gl_FragDepth and disables clip-space depth clipping (LOGZ_* macros).
 */
import * as THREE from 'three';
import { FIG_YAW, HAND_H } from './figureSdf';
import { GROUND_ABOVE_SEA } from './terrainHeight';

/** Sea level and the ground under the person's feet, in H metres (filled from the figure's anchor). */
export const FRAME = { ground: -HAND_H[1], sea: -HAND_H[1] - GROUND_ABOVE_SEA };

export interface Shared {
  uTime: { value: number };
  uSun: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Vector3 };
  uCamM: { value: THREE.Vector3 };
  uLogD: { value: THREE.Vector2 };
  uZoom: { value: number };
  uPx: { value: number };
  uBlur: { value: number };
  uCaps: { value: THREE.Vector4[] };
  uWind: { value: number };
  uFigRot: { value: THREE.Matrix3 };
  uFigInv: { value: THREE.Matrix3 };
  uFeet: { value: THREE.Vector4[] };
  uBrim: { value: THREE.Vector4 };
  uFigBound: { value: THREE.Vector4 };
}

export function makeShared(): Shared {
  // Same Sun as the Earth scene: azimuth 72° (ENE), elevation 22°, a summer morning.
  const az = (72 * Math.PI) / 180, el = (22 * Math.PI) / 180;
  const sun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return {
    uTime: { value: 0 },
    uSun: { value: sun },
    uSunCol: { value: new THREE.Vector3(1.0, 0.84, 0.66).multiplyScalar(2.6) },
    uCamM: { value: new THREE.Vector3() },
    uLogD: { value: new THREE.Vector2(1, 1) },
    uZoom: { value: 0 },
    uPx: { value: 0.001 },
    uBlur: { value: 0 },
    uCaps: { value: Array.from({ length: 32 }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uWind: { value: 0 },
    // body/hand frame → world: rotation about Y by FIG_YAW (x' = x c + z s, z' = −x s + z c)
    uFigRot: { value: new THREE.Matrix3().set(Math.cos(FIG_YAW), 0, Math.sin(FIG_YAW), 0, 1, 0, -Math.sin(FIG_YAW), 0, Math.cos(FIG_YAW)) },
    uFigInv: { value: new THREE.Matrix3().set(Math.cos(FIG_YAW), 0, -Math.sin(FIG_YAW), 0, 1, 0, Math.sin(FIG_YAW), 0, Math.cos(FIG_YAW)) },
    uFeet: { value: [new THREE.Vector4(0, -100, 1, 0), new THREE.Vector4(0, -100, 1, 0)] },
    uBrim: { value: new THREE.Vector4(0, -100, 0, 0) },
    uFigBound: { value: new THREE.Vector4(0, -0.6, 0, 1.1) },
  };
}

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uCamM;
uniform vec2 uLogD;
uniform float uZoom;
uniform float uPx;
uniform float uBlur;
uniform vec4 uCaps[32];
uniform float uWind;
uniform mat3 uFigRot; uniform mat3 uFigInv; uniform vec4 uFeet[2]; uniform vec4 uBrim; uniform vec4 uFigBound;
#define SEA_Y ${FRAME.sea.toFixed(4)}
#define GROUND_Y ${FRAME.ground.toFixed(4)}
#define PI 3.14159265

// ---------------------------------------------------------------- hashes & noise
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}
vec2 pcgF(ivec2 c) { return vec2(pcg2d(uvec2(c))) * (1.0 / 4294967296.0); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm2(vec2 p, int oct) {
  float v = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; v += a * vnoise(p); n += a; p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; }
  return v / n;
}
/** fbm whose octaves fade out below a footprint (in the same units as p) to avoid shimmer. */
float fbmAA(vec2 p, float fp, int oct) {
  float v = 0.0, a = 0.5, n = 0.0, s = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float w = 1.0 - smoothstep(0.25, 0.7, fp * s);
    v += a * mix(0.5, vnoise(p), w); n += a;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; s *= 2.0;
  }
  return v / n;
}

// ---------------------------------------------------------------- depth
#define LOGZ_VARY varying float vLogZ;
#ifdef NO_LOGZ
// close-up (skin) regime: everything drawn is within metres, so ordinary depth is precise enough
// and early depth rejection keeps hidden layers from being shaded
#define LOGZ_VERT(mv) vLogZ = -(mv).z;
#define LOGZ_FRAG if (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
#else
#define LOGZ_VERT(mv) vLogZ = -(mv).z; gl_Position.z = 0.0;
#define LOGZ_FRAG if (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); gl_FragDepth = log2(max(vLogZ, 1e-12) * uLogD.x + 1.0) * uLogD.y;
#endif

// ---------------------------------------------------------------- sky and air
vec3 skyCol(vec3 d) {
  float mu = dot(d, uSun);
  float y = d.y;
  float yy = max(y, 0.0);
  float t = pow(max(1.0 - yy, 1e-6), 4.0);
  vec3 c = mix(vec3(0.055, 0.15, 0.40), vec3(0.42, 0.52, 0.64), t);
  float sunSide = pow(max(mu * 0.5 + 0.5, 1e-6), 4.0);
  c += vec3(0.42, 0.22, 0.05) * sunSide * t;
  float g = 0.8;
  float mie = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-6), 1.5);
  c += vec3(1.0, 0.72, 0.45) * mie * 0.022 * (0.35 + 0.65 * t);
  c *= 0.9 + 0.12 * mu * mu;
  float below = smoothstep(0.0, -0.3, y);
  c = mix(c, vec3(0.25, 0.30, 0.34) + vec3(0.2, 0.12, 0.05) * sunSide, below * 0.8);
  return c;
}
/** Aerial perspective for a point pM (H metres) seen from the camera. */
vec3 aerial(vec3 col, vec3 pM) {
  vec3 v = pM - uCamM;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-9);
  float hm = max(0.0, 0.5 * (uCamM.y + pM.y) - SEA_Y);
  float od = dist * exp(-hm / 1400.0) / 21000.0;
  float f = 1.0 - exp(-od);
  vec3 haze = skyCol(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z))) * 1.05;
  return mix(col, haze, f);
}

// ---------------------------------------------------------------- light
vec3 skyIrr(vec3 n) {
  float up = n.y * 0.5 + 0.5;
  vec3 sky = vec3(0.16, 0.25, 0.42);
  vec3 grd = vec3(0.07, 0.075, 0.04);
  vec3 c = mix(grd, sky, smoothstep(0.0, 1.0, up));
  // brighter sky towards the sun
  c += vec3(0.16, 0.11, 0.06) * max(dot(n, uSun), 0.0);
  return c;
}

/** Soft occlusion of the sun ray (ro, rd) by one capsule. */
float capOcc(vec3 ro, vec3 rd, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, oa = ro - a;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa);
  float den = baba - bard * bard;
  float t = den > 1e-9 ? (bard * baoa - baba * rdoa) / den : -rdoa;
  t = max(t, 0.0);
  float h = clamp((baoa + t * bard) / baba, 0.0, 1.0);
  vec3 q = a + ba * h;
  float tt = max(dot(q - ro, rd), 0.0);
  // skip the capsule the point itself lies on
  float hs = clamp(baoa / baba, 0.0, 1.0);
  if (length(oa - ba * hs) < r * 1.15) return 1.0;
  float d = length(ro + rd * tt - q) - r;
  float k = 0.008 + tt * 0.03;
  return smoothstep(-k, k, d);
}
float figureShadow(vec3 p) {
  vec3 rd = uSun;
  // quick reject: the figure lies within ~2 m of the origin
  vec3 oc = p - uFigBound.xyz;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - uFigBound.w * uFigBound.w;
  if (b > 0.0 && cc > 0.0) return 1.0;
  if (b * b - cc < 0.0) return 1.0;
  float s = 1.0;
  for (int i = 0; i < 16; i++) {
    vec4 A = uCaps[i * 2], B = uCaps[i * 2 + 1];
    s = min(s, capOcc(p, rd, A.xyz, B.xyz, mix(A.w, B.w, 0.5)));
  }
  // the sun-hat brim: a disc around the head
  float tb = (uBrim.y - p.y) / max(rd.y, 1e-3);
  if (tb > 0.004) {
    vec2 hq = p.xz + rd.xz * tb - uBrim.xz;
    float k = 0.006 + tb * 0.03;
    s = min(s, smoothstep(uBrim.w - k, uBrim.w + k, length(hq)));
  }
  return s;
}
/** Soft contact darkening under and around the shoes (pM in H metres). */
float footAO(vec3 pM) {
  float a = 1.0;
  for (int i = 0; i < 2; i++) {
    vec2 d = pM.xz - uFeet[i].xy;
    vec2 f = uFeet[i].zw;
    vec2 l = vec2(dot(d, f), dot(d, vec2(-f.y, f.x)));
    float e = length(l / vec2(0.15, 0.06)) - 1.0;
    a *= mix(0.35, 1.0, smoothstep(-0.2, 1.2, e));
  }
  return a;
}
`;

/** Fragment-only: bump a normal from a height field using screen-space derivatives. */
export const BUMP = /* glsl */ `
vec3 bumpN(vec3 n, vec3 wp, float h) {
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  vec3 b = abs(det) * n - grad;
  float l = length(b);
  return (l > 1e-30 && !isnan(l) && !isinf(l)) ? b / l : n;
}
`;
