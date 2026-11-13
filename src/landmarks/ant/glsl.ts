/**
 * Shaders for the ant: chitin cuticle (glossy dark brown-black, fine microsculpture, compound-eye
 * facets, joint membranes, amber translucency where thin parts are back-lit, sky and skin
 * reflections), its pubescence and setae (view-facing tapered ribbons, Kajiya-Kay shading), and the
 * contact decals on the skin (sun shadow + ambient occlusion).
 *
 * World space = landmark units (1 = 4 mm). Object space = millimetres. Shadows come from a list of
 * capsules (updated each frame from the animated rig) traced along the sun direction.
 */
import { LIGHT_GLSL } from './light';
import { EYE_C, EYE_R, GROUND_GLSL } from './model';

export const MAX_CAPS = 27;

const f3 = (a: number[]) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;

export const COMMON = /* glsl */ `
${LIGHT_GLSL}
${GROUND_GLSL}
#define MAX_CAPS ${MAX_CAPS}
uniform float uTime;
uniform vec4 uCaps[${MAX_CAPS * 2}];
uniform float uNCap;
uniform vec4 uBound;
uniform float uPx;
#define PI 3.14159265

float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}

/** Soft occlusion of the sun ray (ro, rd) by one capsule (world units). */
float capOcc(vec3 ro, vec3 rd, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, oa = ro - a;
  float baba = max(dot(ba, ba), 1e-12), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa);
  float den = baba - bard * bard;
  float t = den > 1e-12 ? (bard * baoa - baba * rdoa) / den : -rdoa;
  t = max(t, 0.0);
  float h = clamp((baoa + t * bard) / baba, 0.0, 1.0);
  vec3 q = a + ba * h;
  float tt = max(dot(q - ro, rd), 0.0);
  // skip the capsule the point itself lies on
  float hs = clamp(baoa / baba, 0.0, 1.0);
  if (length(oa - ba * hs) < r * 1.2) return 1.0;
  float d = length(ro + rd * tt - q) - r;
  float k = 0.0009 + tt * 0.02;
  return smoothstep(-k, k, d);
}
/** Sun visibility at p, against the first n capsules. */
float antShadow(vec3 p, float n) {
  vec3 oc = p - uBound.xyz;
  float b = dot(oc, uSun);
  float cc = dot(oc, oc) - uBound.w * uBound.w;
  if ((b > 0.0 && cc > 0.0) || b * b - cc < 0.0) return 1.0;
  float s = 1.0;
  for (int i = 0; i < MAX_CAPS; i++) {
    if (float(i) >= n) break;
    vec4 A = uCaps[i * 2], B = uCaps[i * 2 + 1];
    s = min(s, capOcc(p, uSun, A.xyz, B.xyz, A.w));
  }
  return s;
}
float ggxD(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
`;

/** Funiculus bending (object space, mm): curvature k (rad/mm) in the plane of x and (0, cos φ, sin φ). */
const BEND = /* glsl */ `
uniform vec2 uBend;
void bendPN(inout vec3 p, inout vec3 n) {
  float k = uBend.x;
  vec3 d = vec3(0.0, cos(uBend.y), sin(uBend.y)), e = vec3(0.0, -sin(uBend.y), cos(uBend.y));
  float a = k * p.x, s = sin(a), c = cos(a);
  float qd = dot(p, d), qe = dot(p, e);
  float sx = abs(k) > 1e-5 ? s / k : p.x;
  float sd = abs(k) > 1e-5 ? (1.0 - c) / k : 0.0;
  p = vec3(sx - qd * s, 0.0, 0.0) + d * (sd + qd * c) + e * qe;
  float nd = dot(n, d), ne = dot(n, e);
  n = vec3(n.x * c - nd * s, 0.0, 0.0) + d * (n.x * s + nd * c) + e * ne;
}
`;

export const cuticleVert = /* glsl */ `
attribute vec4 aAttr;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec3 vNObj; varying vec4 vAttr;
#ifdef BEND
${BEND}
#endif
void main() {
  vec3 p = position, n = normal;
  vObj = position; vNObj = normal;
  #ifdef BEND
  bendPN(p, n);
  vNObj = n;
  #endif
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vAttr = aAttr;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const cuticleFrag = /* glsl */ `
${COMMON}
uniform mat4 modelMatrix;
uniform float uShadowN;
varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying vec3 vNObj; varying vec4 vAttr;

vec3 bumpN(vec3 n, vec3 wp, float h) {
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  vec3 b = abs(det) * n - grad;
  float l = length(b);
  return (l > 1e-30 && !isnan(l)) ? b / l : n;
}
/** Cellular microsculpture: ridges between cells of size c (mm). Returns 0 in cell centres … 1 on ridges. */
float cells(vec3 p, float c) {
  vec3 q = p / c;
  vec3 i = floor(q), f = fract(q);
  float d1 = 9.0, d2 = 9.0;
  for (int z = 0; z <= 1; z++) for (int y = 0; y <= 1; y++) for (int x = 0; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)) - (1.0 - step(0.5, f));
    vec3 o = g + hash33(i + g) * 0.8 + 0.1 - f;
    float d = dot(o, o);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return 1.0 - smoothstep(0.0, 0.35, sqrt(d2) - sqrt(d1));
}
vec4 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}

void main() {
  vec3 P = vW;
  vec3 V = normalize(cameraPosition - P);
  vec3 N = normalize(vN);
  float ao = vAttr.x, thin = vAttr.y, mem = clamp(vAttr.z, 0.0, 1.0);
  float fp = max(length(dFdx(vObj)), length(dFdy(vObj))); // mm per pixel
  vec3 o = vObj;

  // ---- material
  #if defined(PART_GASTER)
  vec3 alb = vec3(0.02, 0.0145, 0.0105);
  float rough = 0.21;
  float sheen = 0.9;
  #elif defined(PART_MAND)
  // reddish-brown blade, the toothed margin darker
  float edge = smoothstep(-0.1, -0.165, o.z) + smoothstep(0.3, 0.37, o.x);
  vec3 alb = mix(vec3(0.085, 0.037, 0.014), vec3(0.03, 0.014, 0.008), clamp(edge, 0.0, 1.0));
  float rough = 0.3;
  float sheen = 0.0;
  #elif defined(APPENDAGE)
  vec3 alb = vec3(0.04, 0.026, 0.016);
  float rough = 0.32;
  float sheen = 0.5;
  #else
  vec3 alb = vec3(0.024, 0.0175, 0.013);
  float rough = 0.36;
  float sheen = 0.6;
  #endif
  alb *= 0.85 + 0.3 * vAttr.w * 0.5 + 0.15 * vnoise3(o * 9.0);

  // ---- micro relief (fades out once smaller than a pixel)
  float h = 0.0;
  #if defined(PART_GASTER)
  {
    // imbricate (scale-like) transverse microsculpture and the pits the hairs grow from
    float w = 1.0 - smoothstep(0.003, 0.009, fp);
    if (w > 0.0) {
      float ln = sin(o.x / 0.0065 * 6.2832 + vnoise3(o * 60.0) * 4.0) * 0.5 + 0.5;
      h += ln * 0.0012 * w;
    }
  }
  #elif defined(APPENDAGE)
  {
    float w = 1.0 - smoothstep(0.002, 0.007, fp);
    if (w > 0.0) h += (vnoise3(vec3(o.x * 80.0, o.y * 900.0, o.z * 900.0)) - 0.5) * 0.0012 * w;
  }
  #elif defined(PART_MAND)
  {
    float w = 1.0 - smoothstep(0.002, 0.007, fp);
    if (w > 0.0) h += sin((o.x * 0.8 - o.z) / 0.006 * 6.2832) * 0.0006 * w; // fine longitudinal striae
  }
  #else
  {
    // dense reticulate microsculpture on the head and mesosoma
    float c = 0.014;
    float w = 1.0 - smoothstep(c * 0.25, c * 0.7, fp);
    if (w > 0.0) h += cells(o, c) * 0.0016 * w;
  }
  #endif
  // the membranes are soft and wrinkled
  if (mem > 0.01) {
    float w = 1.0 - smoothstep(0.002, 0.008, fp);
    h += mem * (vnoise3(o * vec3(400.0, 120.0, 120.0)) - 0.5) * 0.002 * w;
    alb = mix(alb, vec3(0.16, 0.11, 0.07), mem * 0.85);
    rough = mix(rough, 0.55, mem);
  }
  if (h != 0.0) N = bumpN(N, P, h * 0.25);

  float eye = 0.0;
  #ifdef PART_HEAD
  {
    // compound eye: ~150 hexagonal facets (ommatidia), each a tiny glossy lens
    vec3 q = (vec3(o.x, o.y, abs(o.z)) - ${f3(EYE_C)}) / ${f3(EYE_R)};
    eye = 1.0 - smoothstep(1.02, 1.12, length(q));
    if (eye > 0.0) {
      vec2 uv = vec2(atan(q.x, max(q.z, 0.08)) * ${EYE_R[0].toFixed(3)}, atan(q.y, max(q.z, 0.08)) * ${EYE_R[1].toFixed(3)});
      float fs = 0.0165;
      vec4 hc = hexCell(uv / fs);
      float wf = 1.0 - smoothstep(fs * 0.25, fs * 0.8, fp);
      vec2 off = hc.xy;
      float r = length(off);
      vec3 nObj = normalize(vNObj + vec3(off.x, off.y, 0.0) * 1.1 * wf * eye);
      N = normalize(mat3(modelMatrix) * nObj);
      float rnd = hash13(vec3(hc.zw, 3.0));
      vec3 eyeAlb = vec3(0.03, 0.028, 0.026) * (0.7 + 0.6 * rnd);
      float border = smoothstep(0.38, 0.5, r) * wf;
      eyeAlb = mix(eyeAlb, vec3(0.008, 0.006, 0.005), border);
      alb = mix(alb, eyeAlb, eye);
      rough = mix(rough, mix(0.07, 0.3, border), eye);
      sheen *= 1.0 - eye;
    }
  }
  #endif

  // ---- light
  float sh = antShadow(P + N * 0.0015, uShadowN);
  vec3 L = uSun;
  float ndl = dot(N, L);
  float nv = max(dot(N, V), 0.02);
  vec3 col = alb * uSunCol * max(ndl, 0.0) * sh;
  col += alb * skyIrr(N) * ao * 1.3;
  // warm light bounced up from the sunlit skin of the hand
  col += alb * SKIN_ALB * uSunCol * uSun.y * max(-N.y, 0.0) * 0.55 * ao;
  // specular: sun (GGX) and the environment (sky above, the skin below)
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);
  float F = 0.045 + 0.955 * pow(1.0 - vh, 5.0);
  float a = rough * rough;
  float k = a * 0.5;
  float G = (nv / (nv * (1.0 - k) + k)) * (max(ndl, 0.0) / (max(ndl, 0.0) * (1.0 - k) + k));
  vec3 spec = uSunCol * F * ggxD(nh, a) * G / (4.0 * nv + 1e-3) * sh;
  col += min(spec, vec3(40.0));
  float Fe = 0.045 + 0.955 * pow(1.0 - nv, 5.0) * (1.0 - rough * 0.6);
  vec3 R = reflect(-V, N);
  col += envCol(R) * Fe * mix(1.0, 0.55, rough) * (0.35 + 0.65 * ao);
  // silky pubescence: a soft pale sheen at grazing angles (the hairs themselves are drawn separately)
  col += vec3(0.42, 0.38, 0.32) * sheen * pow(1.0 - nv, 3.0) * (skyIrr(N) * 0.25 + uSunCol * max(ndl, 0.0) * sh * 0.05) * ao;
  // translucency: thin chitin glows amber when the sun is behind it
  float back = pow(max(dot(V, -L), 0.0), 3.0);
  vec3 amber = vec3(0.55, 0.2, 0.045);
  float tl = thin * thin;
  #ifdef PART_GASTER
  tl = max(tl, 0.25 * pow(1.0 - nv, 2.0)); // the thin edges of the gaster
  #endif
  col += amber * uSunCol * tl * (back * 0.22 + max(-ndl, 0.0) * 0.03) * (1.0 - eye) * (0.35 + 0.65 * sh);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Hairs: tapering view-facing ribbons, appressed pubescence and erect setae. */
export const hairVert = /* glsl */ `
${COMMON}
attribute vec3 aRoot; attribute vec3 aN; attribute vec3 aDir; attribute vec3 aLS;
uniform float uScale; uniform float uShadowN;
varying vec3 vP; varying vec3 vT; varying vec3 vS; varying vec3 vB; varying float vSide; varying float vU; varying float vA; varying float vSh; varying float vKind;
#ifdef BEND
${BEND}
#endif
void main() {
  float t = position.x, side = position.y;
  float L = aLS.x, seed = aLS.y, kind = aLS.z;
  vec3 n = aN, d = aDir;
  // erect setae rise steeply and curve back; the pubescence lies almost flat
  float th0 = kind > 0.5 ? 0.95 + 0.35 * fract(seed * 3.7) : 0.12 + 0.12 * fract(seed * 3.7);
  float thm = th0 * (1.0 - 0.3 * t);
  float tht = th0 * (1.0 - 0.6 * t);
  vec3 c = aRoot - n * 0.002 + L * t * (d * cos(thm) + n * sin(thm));
  vec3 T = d * cos(tht) + n * sin(tht);
  // a slight sway on the long setae
  c += cross(n, d) * L * 0.05 * t * t * sin(uTime * 3.0 + seed * 30.0) * kind;
  #ifdef BEND
  vec3 c2 = c + T * 0.004;
  vec3 dummy = vec3(1.0, 0.0, 0.0);
  bendPN(c, dummy);
  bendPN(c2, dummy);
  T = c2 - c;
  #endif
  vec3 cw = (modelMatrix * vec4(c, 1.0)).xyz;
  vec3 Tw = normalize(mat3(modelMatrix) * T);
  vec3 vd = normalize(cameraPosition - cw);
  vec3 S = normalize(cross(Tw, vd));
  float w = (kind > 0.5 ? 0.0032 : 0.0019) * uScale * mix(1.0, 0.25, pow(t, 1.4));
  float px = length(cameraPosition - cw) * uPx;
  float wEff = max(w, px * 1.1);
  cw += S * side * wEff * 0.5;
  vA = w / wEff;
  vP = cw; vT = Tw; vS = S; vB = normalize(cross(S, Tw)); vSide = side; vU = t; vKind = kind;
  vSh = antShadow(cw, uShadowN);
  gl_Position = projectionMatrix * viewMatrix * vec4(cw, 1.0);
}`;

export const hairFrag = /* glsl */ `
${COMMON}
uniform float uFade;
varying vec3 vP; varying vec3 vT; varying vec3 vS; varying vec3 vB; varying float vSide; varying float vU; varying float vA; varying float vSh; varying float vKind;
void main() {
  float sd = vSide;
  vec3 n = normalize(vS * sd + vB * sqrt(max(1.0 - sd * sd, 0.0)));
  vec3 v = normalize(cameraPosition - vP);
  if (dot(n, v) < 0.0) n = -n;
  vec3 L = uSun;
  vec3 T = normalize(vT);
  vec3 alb = vKind > 0.5 ? vec3(0.2, 0.14, 0.075) : vec3(0.3, 0.26, 0.2);
  alb *= mix(0.8, 1.15, vU);
  float sh = vSh;
  vec3 col = alb * uSunCol * clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0) * sh * 0.8 + alb * skyIrr(n) * 1.1;
  vec3 h = normalize(L + v);
  float th = dot(T, h);
  float s1 = pow(sqrt(max(1.0 - th * th, 1e-12)), 80.0);
  vec3 T2 = normalize(T + n * 0.15);
  float th2 = dot(T2, h);
  float s2 = pow(sqrt(max(1.0 - th2 * th2, 1e-12)), 20.0);
  col += uSunCol * (s1 * 0.35 + s2 * vec3(0.5, 0.36, 0.2) * 0.25) * sh;
  // sunlight through the hair when back-lit: the golden halo of macro photographs
  col += uSunCol * vec3(0.85, 0.6, 0.32) * pow(max(dot(v, -L), 0.0), 4.0) * 0.45 * sh;
  float edge = 1.0 - smoothstep(0.7, 1.0, abs(sd));
  float a = vA * mix(1.0, edge, vA) * uFade * mix(1.0, 0.6, vU);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

/** Contact decals on the skin: the ant's sun shadow and soft occlusion under body and feet. */
export const decalVert = /* glsl */ `
${COMMON}
varying vec3 vW; varying vec2 vXZ;
void main() {
  vec3 p = position;
  p.y = groundYmm(p.xz) + 0.004;
  vXZ = p.xz;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const decalFrag = /* glsl */ `
${COMMON}
uniform vec4 uRect; // xmin, xmax, zmin, zmax (mm)
uniform float uStrength;
varying vec3 vW; varying vec2 vXZ;
void main() {
  vec3 p = vW;
  float sh = antShadow(p, ${MAX_CAPS}.0);
  // ambient occlusion: sphere-capsule approximation for every part close to the skin
  float ao = 1.0;
  vec3 oc = p - uBound.xyz;
  if (dot(oc, oc) < (uBound.w + 0.15) * (uBound.w + 0.15)) {
    for (int i = 0; i < MAX_CAPS; i++) {
      vec4 A = uCaps[i * 2], B = uCaps[i * 2 + 1];
      vec3 ba = B.xyz - A.xyz;
      float hh = clamp(dot(p - A.xyz, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
      vec3 q = A.xyz + ba * hh;
      vec3 dv = q - p;
      float d = max(length(dv), A.w * 1.02);
      float up = clamp(dv.y / d * 0.75 + 0.25, 0.0, 1.0);
      float occ = (A.w * A.w) / (d * d) * up;
      ao *= 1.0 - 0.9 * clamp(occ * 1.6, 0.0, 1.0);
    }
  }
  float a = 1.0 - (1.0 - 0.7 * (1.0 - sh)) * ao;
  // fade at the edges of the patch
  vec2 e = min(vXZ - uRect.xz, uRect.yw - vXZ);
  a *= smoothstep(0.0, 0.3, min(e.x, e.y));
  a *= uStrength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(0.004, 0.007, 0.018) * a, a);
}`;
