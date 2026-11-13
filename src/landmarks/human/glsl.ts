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
import { FEET_H, FIG_YAW, HAND_FRAME, UNIT } from './pose';
import { GROUND_ELEV_M } from './site';

/** Sea level and the ground under the person's feet, in H metres (from the figure's feet anchor
 *  and the measured ground elevation of the standing spot, site.ts). */
export const FRAME = { ground: FEET_H[1], sea: FEET_H[1] - GROUND_ELEV_M };
/** H-frame (x, z) of the standing spot: map metres = H metres − MAP_O (axes not turned). */
export const MAP_O: [number, number] = [FEET_H[0], FEET_H[2]];
/** Extents (half-widths, metres) of the site grids; must match tools/build-woonona.mjs. */
export const SITE_GRID = { fine: 1280, coarse: 10240, cover: 1280, coverMid: 3200 };

export interface Shared {
  uTime: { value: number };
  uSun: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Vector3 };
  uCamM: { value: THREE.Vector3 };
  uLogD: { value: THREE.Vector2 };
  uZoom: { value: number };
  uPx: { value: number };
  uBlur: { value: number };
  uWind: { value: number };
  /** hand frame (columns: along the fingers, skin normal, across) → H frame, for the skin close-up */
  uFigRot: { value: THREE.Matrix3 };
  /** H frame → figure object frame (inverse of the figure's yaw) */
  uFigInv: { value: THREE.Matrix3 };
  uFeet: { value: THREE.Vector4[] };
  /** the figure's sun depth map (object space → clip), for its shadow on the ground */
  uFigShadow: { value: THREE.Texture | null };
  uFigShadowMat: { value: THREE.Matrix4 };
  uFigShadowOn: { value: number };
}

export function makeShared(): Shared {
  // Same Sun as the Earth scene: azimuth 72° (ENE), elevation 22°, a summer morning.
  const az = (72 * Math.PI) / 180, el = (22 * Math.PI) / 180;
  const sun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const c = Math.cos(FIG_YAW), s = Math.sin(FIG_YAW);
  const H = HAND_FRAME;
  return {
    uTime: { value: 0 },
    uSun: { value: sun },
    uSunCol: { value: new THREE.Vector3(1.0, 0.84, 0.66).multiplyScalar(2.6) },
    uCamM: { value: new THREE.Vector3() },
    uLogD: { value: new THREE.Vector2(1, 1) },
    uZoom: { value: 0 },
    uPx: { value: 0.001 },
    uBlur: { value: 0 },
    uWind: { value: 0 },
    uFigRot: { value: new THREE.Matrix3().set(H.x[0], H.y[0], H.z[0], H.x[1], H.y[1], H.z[1], H.x[2], H.y[2], H.z[2]) },
    // inverse of rotation.y(FIG_YAW): x = x' c − z' s, z = x' s + z' c
    uFigInv: { value: new THREE.Matrix3().set(c, 0, -s, 0, 1, 0, s, 0, c) },
    uFeet: { value: [new THREE.Vector4(0, -100, 1, 0), new THREE.Vector4(0, -100, 1, 0)] },
    uFigShadow: { value: null },
    uFigShadowMat: { value: new THREE.Matrix4() },
    uFigShadowOn: { value: 0 },
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
uniform float uWind;
uniform mat3 uFigRot; uniform mat3 uFigInv; uniform vec4 uFeet[2];
uniform sampler2D uFigShadow; uniform mat4 uFigShadowMat; uniform float uFigShadowOn;
#define SEA_Y ${FRAME.sea.toFixed(4)}
#define GROUND_Y ${FRAME.ground.toFixed(4)}
#define MAP_O vec2(${MAP_O[0].toFixed(4)}, ${MAP_O[1].toFixed(4)})
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
    v += a * (w > 0.0 ? mix(0.5, vnoise(p), w) : 0.5); n += a;
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

/** The person's shadow (pM in H metres): their sun depth map, 4 soft taps. */
float figureShadow(vec3 pM) {
  if (uFigShadowOn < 0.5) return 1.0;
  vec3 op = uFigInv * (pM * ${(1 / UNIT).toFixed(6)});
  vec4 sc = uFigShadowMat * vec4(op, 1.0);
  vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) return 1.0;
  float ref = s.z - 0.002;
  float r = 1.6 / 2048.0;
  // an empty texel (depth 1: nothing of the person there) is lit, however far the receiver lies
  vec4 d = vec4(texture2D(uFigShadow, s.xy + vec2(-r, -0.4 * r)).r, texture2D(uFigShadow, s.xy + vec2(0.4 * r, -r)).r,
                texture2D(uFigShadow, s.xy + vec2(r, 0.4 * r)).r, texture2D(uFigShadow, s.xy + vec2(-0.4 * r, r)).r);
  vec4 lit = max(step(vec4(ref), d), step(vec4(0.99999), d));
  return dot(lit, vec4(0.25));
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

/**
 * The real place as textures (map metres q = H.xz − MAP_O): heights and seaward distance (fine 5 m
 * and coarse 40 m), land cover (2.5 m near, 10 m mid). See siteData.ts / tools/build-woonona.mjs.
 */
export const SITE = /* glsl */ `
uniform sampler2D tFine; uniform sampler2D tCoarse;
uniform sampler2D tCov; uniform sampler2D tCov2; uniform sampler2D tCovM; uniform sampler2D tCov2M;
#define FINE_H ${SITE_GRID.fine.toFixed(1)}
#define COARSE_H ${SITE_GRID.coarse.toFixed(1)}
#define COV_H ${SITE_GRID.cover.toFixed(1)}
#define COVM_H ${SITE_GRID.coverMid.toFixed(1)}
float edgeOf(vec2 q) { return max(abs(q.x), abs(q.y)); }
/** (height above sea, seaward distance from the open sea's edge; −1 in lagoons) */
vec2 siteHD(vec2 q) {
  vec4 c = texture2D(tCoarse, q / (2.0 * COARSE_H) + 0.5);
  float b = smoothstep(FINE_H - 160.0, FINE_H - 15.0, edgeOf(q));
  if (b >= 1.0) return c.rg;
  vec2 f = texture2D(tFine, q / (2.0 * FINE_H) + 0.5).rg;
  return mix(f, c.rg, b);
}
/** Land cover: (sand, dune scrub, woodland, rock) and (road, paved path, railway, 1). */
void siteCover(vec2 q, out vec4 a, out vec3 b) {
  float e = edgeOf(q);
  float bm = smoothstep(COV_H - 90.0, COV_H - 10.0, e);
  float bo = smoothstep(COVM_H - 300.0, COVM_H - 20.0, e);
  a = vec4(0.0); b = vec3(0.0);
  if (bm <= 0.0) {
    vec2 uf = q / (2.0 * COV_H) + 0.5;
    a = texture2D(tCov, uf); b = texture2D(tCov2, uf).rgb;
  } else if (bo < 1.0) {
    vec2 um = q / (2.0 * COVM_H) + 0.5;
    a = texture2D(tCovM, um); b = texture2D(tCov2M, um).rgb;
    if (bm < 1.0) {
      vec2 uf = q / (2.0 * COV_H) + 0.5;
      a = mix(texture2D(tCov, uf), a, bm); b = mix(texture2D(tCov2, uf).rgb, b, bm);
    }
    a *= 1.0 - bo; b *= 1.0 - bo;
  }
}
`;

/**
 * Texture noise (fragment only): value noise baked into a tileable 512² RGBA texture (4 independent
 * channels, 16 texels per noise cell), so one filtered fetch replaces 4 hashes and the mipmaps do the
 * anti-aliasing. vnoiseT(p) ≈ vnoise(p); fbmT ≈ fbmAA.
 */
export const NOISE_T = /* glsl */ `
uniform sampler2D tNoise;
float vnoiseT(vec2 p) { return texture2D(tNoise, p * 0.03125).r; }
float fbmT(vec2 p, int oct) {
  float v = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= oct) break;
    vec4 t = texture2D(tNoise, p * 0.03125 + float(i) * 0.37);
    v += a * (i == 0 ? t.r : i == 1 ? t.g : i == 2 ? t.b : t.a); n += a;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5;
  }
  return v / n;
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
