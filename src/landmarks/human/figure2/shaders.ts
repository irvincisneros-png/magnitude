/**
 * Figure2 shaders: the photo-textured Rocketbox man (see CREDITS.md). Object space = the bake frame
 * (anchor on the back of the right hand at the origin, +Y up, 1 unit = 1.7 m); lighting in world.
 *
 * Hooks (see Figure2Options): PRELUDE is pasted after the uniforms of both stages, VERT_OUTRO after
 * gl_Position is written (has `vec4 mv`, `vec3 wp`), FRAG_OUTRO before the colour is written (has
 * `vec3 col`, `vec3 wp`, `vec3 op`). Output is linear HDR radiance: no tone mapping, no sRGB.
 *
 * Parts: PART 0 body (shirt, shorts, shoes, arms, legs), 1 head, 2 hair cards (alpha). Albedo comes
 * from the photo textures; a skin mask picks skin vs cloth response (wrap diffuse and translucency,
 * roughness); the baked vertex AO darkens creases and the ground contact.
 *
 * Hair: the cards and the hair painted on the scalp beneath them (mask B) share one model, lit as a
 * volume around the head (a smooth normal from the head centre, strands flowing down from the crown)
 * so the separate cards don't read as flakes: wrapped diffuse with a multiple-scattering fill, a
 * shifted two-lobe Kajiya-Kay highlight (white + hair-coloured), a soft sky sheen and slight tone
 * variation. Card edges use alpha-to-coverage (with MSAA) plus a blended pass for the faint ends.
 *
 * Skin close-up: once a pixel is under ~0.3 mm the bare skin gains procedural detail in the skin
 * patch's own hand frame (skinGlsl.ts: the same follicle grid, criss-cross furrows, tendons, veins,
 * melanin/redness variation), so the photo stays crisp-looking down to the hand-over to the patch.
 */

export const F2_COMMON = /* glsl */ `
uniform vec3 uF2QO; uniform vec3 uF2QS;
uniform float uF2Time;
uniform float uF2M2O;           // metres → object units
uniform vec3 uF2Sun;            // world, towards the Sun
uniform vec3 uF2SunCol;
uniform vec3 uF2SkyZen; uniform vec3 uF2SkyHor; uniform vec3 uF2Bounce;
uniform vec3 uF2SunObj;         // object space, towards the Sun
uniform vec4 uF2Hole;           // xyz centre (object), w radius: fragments inside are discarded
uniform sampler2D uF2Shadow; uniform mat4 uF2ShadowMat; uniform float uF2ShadowOn; uniform float uF2ShadowTexel; uniform float uF2ShadowR;
uniform sampler2D tF2Col; uniform sampler2D tF2Nrm; uniform sampler2D tF2Mask;
uniform float uF2SkinTone;      // albedo scale of the photo skin (matched to the close-up skin patch)
uniform vec3 uF2HeadC; uniform vec3 uF2HeadUp; // object space: the centre of the hair volume, up through the crown
uniform vec3 uF2HandX; uniform vec3 uF2HandZ;  // object space: the skin close-up's hand frame (x along the fingers, z across)
#define F2PI 3.14159265
#define CLOTH_K 0.76
#define HAIR_K 1.6
#define A2C_LO 0.3
#define A2C_HI 0.7
#define SKIN_TINT vec3(0.9, 0.97, 0.94)
`;

export const F2_VERT = /* glsl */ `
attribute vec2 aNrm; attribute vec2 aUv; attribute vec4 aAux;
varying vec3 vOP; varying vec3 vWP; varying vec3 vWN; varying vec3 vON; varying vec2 vUv; varying float vAO;
vec3 octDec(vec2 e) {
  vec3 v = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-v.z, 0.0);
  v.x += v.x >= 0.0 ? -t : t; v.y += v.y >= 0.0 ? -t : t;
  return normalize(v);
}
void main() {
  vec3 p = position * uF2QS + uF2QO;
  vec3 n = octDec(aNrm);
  vOP = p; vON = n; vUv = aUv; vAO = aAux.x;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec3 wp = w.xyz;
  vWP = wp;
  vWN = normalize(mat3(modelMatrix) * n);
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  VERT_OUTRO
}`;

export const F2_FRAG = /* glsl */ `
uniform mat3 uF2Rot; // object → world rotation
varying vec3 vOP; varying vec3 vWP; varying vec3 vWN; varying vec3 vON; varying vec2 vUv; varying float vAO;

float F_s(float vh, float f0) { return f0 + (1.0 - f0) * pow(max(1.0 - vh, 0.0), 5.0); }
float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (F2PI * d * d); }
float vis(float nl, float nv, float a) { float k = a * 0.5; return 0.25 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k)); }
float specL(vec3 n, vec3 v, vec3 l, float rough, float f0) {
  vec3 h = normalize(l + v);
  float nvr = dot(n, v);
  float nl = max(dot(n, l), 0.0), nv = max(nvr, 0.12), nh = max(dot(n, h), 0.0);
  float a = rough * rough;
  return ggx(nh, a) * vis(nl, nv, a) * F_s(max(dot(v, h), 0.0), f0) * nl * smoothstep(-0.02, 0.12, nvr);
}
float f2h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float f2h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float f2vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(f2h12(i), f2h12(i + vec2(1, 0)), u.x), mix(f2h12(i + vec2(0, 1)), f2h12(i + vec2(1, 1)), u.x), u.y);
}
float f2vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(f2h13(i), f2h13(i + vec3(1,0,0)), f.x), mix(f2h13(i + vec3(0,1,0)), f2h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(f2h13(i + vec3(0,0,1)), f2h13(i + vec3(1,0,1)), f.x), mix(f2h13(i + vec3(0,1,1)), f2h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
/** Sky above, the sunlit sand below (world normal). */
vec3 f2SkyIrr(vec3 n) {
  float u = n.y * 0.5 + 0.5;
  vec3 sky = mix(uF2SkyHor, uF2SkyZen, smoothstep(0.35, 1.0, u));
  // brighter sky towards the Sun
  sky += vec3(0.16, 0.11, 0.06) * max(dot(n, uF2Sun), 0.0);
  return mix(uF2Bounce, sky, smoothstep(0.0, 0.62, u));
}
vec3 f2SkyRefl(vec3 r) {
  float y = r.y;
  vec3 c = mix(uF2SkyHor * 1.2, uF2SkyZen * 1.3, pow(clamp(y, 0.0, 1.0), 0.6));
  return y < 0.0 ? mix(uF2SkyHor, uF2Bounce * 1.6, smoothstep(0.0, -0.25, y)) : c;
}

#if PART != 2
// ---- skin close-up detail: a cut-down copy of skinGlsl.ts skin() (same hashes, frame and constants,
// so the figure's hand meets the close-up patch seamlessly); p in metres on the hand frame's plane
#define F2_FOLLICLE 0.0021
uvec2 f2pcg(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}
vec2 f2pcgF(ivec2 c) { return vec2(f2pcg(uvec2(c))) * (1.0 / 4294967296.0); }
vec3 f2LineFam(vec2 p, float ang, float sp, float wob, float seed) {
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-d.y, d.x);
  float along = dot(p, d), across = dot(p, nrm);
  float w = (f2vn(vec2(along / (sp * 5.5), seed)) - 0.5) * wob * sp;
  float k = (across + w) / sp;
  float id = floor(k + 0.5);
  float strength = 0.3 + 0.7 * f2h12(vec2(id, seed));
  float brk = smoothstep(0.3, 0.62, f2vn(vec2(along / (sp * 1.7), id * 3.1 + seed)));
  float sc = 1.0 / max(strength * mix(0.35, 1.0, brk), 0.05);
  return vec3(abs(k - id) * sp * sc, nrm * sign(k - id) * sc);
}
/** Height gradient g (on the plane), and albedo factors; hand: 1 on the back of the hand (tendons, veins). */
vec3 f2SkinDetail(vec2 p, float fp, float hand, out vec2 g) {
  g = vec2(0.0);
  float cav = 0.0, pore = 0.0, vein = 0.0;
  // tendons fanning to the knuckles (relief) and veins (colour): the patch's macro layer
  if (hand > 0.001) {
    float mx = smoothstep(-0.09, -0.03, p.x) * (1.0 - smoothstep(0.03, 0.05, p.x)) * hand;
    for (int i = 0; i < 4; i++) {
      float zi = 0.025 - float(i) * 0.0175;
      float zc = mix(zi * 0.45, zi, smoothstep(-0.06, 0.04, p.x));
      float d = p.y - zc;
      float e = exp(-d * d / 1.6e-5) * mx;
      g.y += -2.0 * d / 1.6e-5 * e * 0.0003;
    }
    float vd = abs(sin((p.y + (f2vn(p * 70.0) - 0.5) * 0.008) * 160.0 + p.x * 40.0));
    vein = (1.0 - smoothstep(0.0, 0.25, vd)) * smoothstep(0.4, 0.7, f2vn(p * 45.0 + 3.0)) * smoothstep(-0.075, -0.05, p.x) * (1.0 - smoothstep(0.02, 0.04, p.x)) * hand;
  }
  // criss-cross furrows (wider fade than the patch: here they only need to read as fine texture)
  // (they fade in from ~0.09 mm per pixel, reaching the patch's full strength by its hand-over at ~25 µm,
  // and are drawn softer than a pixel so the network never reads as a hard grid)
  float wF = 1.0 - smoothstep(25e-6, 90e-6, fp);
  wF *= wF;
  if (wF > 0.001) {
    float wd = 42e-6 + fp * 1.1;
    float iw = 1.0 / (wd * wd);
    vec3 L1 = f2LineFam(p, 0.62, 0.00062, 0.5, 1.0);
    vec3 L2 = f2LineFam(p, -0.58, 0.00075, 0.5, 2.0);
    vec3 L3 = f2LineFam(p, 1.57, 0.0011, 0.6, 3.0);
    float f1 = exp(-L1.x * L1.x * iw), f2 = exp(-L2.x * L2.x * iw), f3 = 0.45 * exp(-L3.x * L3.x * iw);
    float f = f1; vec2 gf = -2.0 * L1.x * iw * f1 * L1.yz;
    if (f2 > f) { f = f2; gf = -2.0 * L2.x * iw * f2 * L2.yz; }
    if (f3 > f) { f = f3; gf = -2.0 * L3.x * iw * f3 * L3.yz; }
    // the furrows are ~30 µm deep: below ~0.1 mm per pixel their slope is averaged away, not sharpened
    g -= gf * 26e-6 * wF;
    cav += f * 0.5 * wF;
  }
  // hair follicles (the hairs' own jittered grid) and sweat pores
  float wP = 1.0 - smoothstep(30e-6, 130e-6, fp);
  if (wP > 0.001) {
    vec2 q = p / F2_FOLLICLE;
    ivec2 ic = ivec2(floor(q));
    float best = 1e9; vec2 bv = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec2 c = ic + ivec2(i, j);
      vec2 cp = (vec2(c) + 0.15 + 0.7 * f2pcgF(c)) * F2_FOLLICLE;
      if (length(cp) < 0.0016) continue;
      float l = length(p - cp);
      if (l < best) { best = l; bv = p - cp; }
    }
    vec2 db = bv / max(best, 1e-9);
    float r0 = 25e-6 + fp * 0.3;
    float t = clamp((best - r0) / 35e-6, 0.0, 1.0);
    float pit = 1.0 - t * t * (3.0 - 2.0 * t);
    float dpit = -6.0 * t * (1.0 - t) / 35e-6;
    g += -dpit * 30e-6 * db * wP * clamp(40e-6 / max(fp, 1e-6), 0.3, 1.0);
    pore = max(pore, pit * wP);
    vec2 q2 = p / 0.00055;
    vec2 i2 = floor(q2), f2 = fract(q2);
    vec3 p3 = fract(vec3(i2 + 41.0, (i2 + 41.0).x) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33);
    vec2 hj = fract((p3.xx + p3.yz) * p3.zy);
    float dS = length(f2 - 0.2 - 0.6 * hj) * 0.00055;
    float sp = (1.0 - smoothstep(8e-6 + fp * 0.2, 18e-6 + fp * 0.4, dS)) * (1.0 - smoothstep(20e-6, 60e-6, fp));
    pore = max(pore, sp * 0.6);
    cav += sp * 0.3;
  }
  return vec3(cav, pore, vein);
}
/** Albedo factor (mean ≈ 1, the photo keeps its colour) from the patch's melanin/redness/vein/pore terms. */
vec3 f2SkinAlbedoK(vec2 p, vec3 cpv, float fp) {
  vec3 k = vec3(1.0);
  // melanin and redness blotches, normalised to their mean so the hand-over colour is unchanged
  float wm = 1.0 - smoothstep(0.6e-3, 2.0e-3, fp);
  float mel = mix(0.5, f2vn(p * 180.0) * 0.6 + f2vn(mat2(1.6, 1.2, -1.2, 1.6) * p * 180.0 + 7.3) * 0.4, wm);
  float red = mix(0.5, f2vn(p * 60.0 + 5.0), wm);
  k *= mix(0.86, 1.1, mel) / 0.98;
  k = mix(k, k * vec3(1.12, 0.86, 0.85), (smoothstep(0.45, 0.8, red) - 0.12) * 0.6);
  k = mix(k, k * vec3(0.78, 0.86, 1.08), cpv.z * 0.35);
  k *= 1.0 - (cpv.x - 0.08) * 0.28;
  k = mix(k, k * vec3(0.55, 0.42, 0.38), cpv.y * 0.7);
  return k;
}
#endif

#if PART != 0
/**
 * Short hair, lit as a volume around the head. nG: the surface normal facing the eye (card or
 * normal-mapped scalp); lumT: the texel's luminance (strand detail to break up the highlight).
 */
vec3 f2Hair(vec3 alb, vec3 nG, vec3 op, vec3 v, vec3 l, float sh, float ao, float lumT) {
  vec3 dO = op - uF2HeadC;
  vec3 nV = normalize(uF2Rot * normalize(dO));
  vec3 up = normalize(uF2Rot * uF2HeadUp);
  // strands run from the crown down the meridians, with a slight twist (and a fallback at the crown)
  vec3 T = up - nV * dot(nV, up) + cross(nV, up) * 0.3;
  T = normalize(T + (length(T) < 0.05 ? cross(nV, vec3(0.0, 0.0, 1.0)) : vec3(0.0)) + 1e-5);
  vec3 n = normalize(mix(nG, nV, 0.8));
  // tone variation: a few lighter, warmer locks and darker roots, ~1–2 cm across
  vec3 q = op / uF2M2O;
  float tv = f2vn3(q * 70.0) * 0.65 + f2vn3(q * 190.0 + 3.1) * 0.35;
  // (and a touch less red than the photo: it reads auburn in full sun)
  alb *= mix(vec3(0.84, 0.86, 0.9), vec3(1.14, 1.08, 1.0), tv) * vec3(0.9, 1.0, 1.1);
  float ndl = dot(n, l);
  float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
  float shs = mix(0.25, 1.0, sh);
  float aoh = mix(1.0, ao, 0.4);
  vec3 col = alb * uF2SunCol * wrap * wrap * shs;
  // light scattered through the neighbouring strands (warm, reaches the shaded side) and the sky
  col += alb * uF2SunCol * 0.1 * mix(0.6, 1.0, sh);
  col += alb * f2SkyIrr(n) * aoh * 2.0;
  // Kajiya-Kay: a white primary lobe shifted to the roots, a hair-coloured secondary towards the tips
  vec3 h = normalize(l + v);
  vec3 T1 = normalize(T + n * 0.12), T2 = normalize(T - n * 0.2);
  float d1 = dot(T1, h), d2 = dot(T2, h);
  float s1 = pow(max(1.0 - d1 * d1, 0.0), 70.0);
  float s2 = pow(max(1.0 - d2 * d2, 0.0), 24.0);
  // (the highlights only sit on strands: the dark gaps and fringes between them get none, or the
  // cards' outlines would sparkle grey against the darker hair beneath)
  float brk = clamp(lumT / 0.012, 0.0, 1.4) * smoothstep(0.002, 0.008, lumT);
  vec3 tint = alb / max(max(alb.r, alb.g), 1e-4);
  float vis = smoothstep(-0.15, 0.35, ndl) * sh;
  col += uF2SunCol * vis * brk * (s1 * 0.035 * vec3(1.0, 0.95, 0.88) + s2 * 0.022 * tint);
  // the sky's own sheen along the strands (soft, so the shaded side isn't flat)
  vec3 hs = normalize(vec3(0.0, 1.0, 0.0) + v);
  float ds = dot(T1, hs);
  col += mix(uF2SkyZen, vec3(dot(uF2SkyZen, vec3(0.33))) * tint, 0.6) * pow(max(1.0 - ds * ds, 0.0), 24.0) * 0.03 * aoh * brk;
  // sunlight through the outline when he is backlit
  col += uF2SunCol * alb * pow(max(dot(v, -l), 0.0), 6.0) * 0.3 * sh * (1.0 - abs(dot(nV, v)));
  return col;
}
#endif

/** Soft self-shadow from the figure's own depth map (object space). */
float shadowAt(vec3 op, vec3 on) {
  if (uF2ShadowOn < 0.5) return 1.0;
  float nOff = uF2ShadowTexel * 2.0 + 0.002 * uF2M2O;
  vec4 sc = uF2ShadowMat * vec4(op + on * nOff + uF2SunObj * uF2ShadowTexel, 1.0);
  vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
  if (any(lessThan(s.xy, vec2(0.0))) || any(greaterThan(s.xy, vec2(1.0))) || s.z > 1.0) return 1.0;
  float ref = s.z - 0.0005;
  float acc = 0.0;
#ifdef F2_LOW
  const int NT = 4;
  vec2 taps[4] = vec2[4](vec2(-0.6, -0.3), vec2(0.4, -0.7), vec2(0.6, 0.4), vec2(-0.3, 0.7));
#else
  const int NT = 8;
  vec2 taps[8] = vec2[8](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195),
    vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064));
#endif
  float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832;
  mat2 R = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  for (int i = 0; i < NT; i++) {
    float d = texture2D(uF2Shadow, s.xy + R * taps[i] * 2.5 * uF2ShadowTexel / (2.0 * uF2ShadowR)).r;
    acc += step(ref, d);
  }
  return acc / float(NT);
}

void main() {
  vec3 op = vOP;
  if (uF2Hole.w > 0.0 && length(op - uF2Hole.xyz) < uF2Hole.w) discard;
  vec4 tc = texture2D(tF2Col, vUv);
#if PART == 2
  // hair cards: OPAQUE_PASS writes the strands with alpha-to-coverage (depth-written; partial
  // coverage from A2C_LO up), the blended pass fills in the faint ends where coverage is partial
  float aCov = smoothstep(A2C_LO, A2C_HI, tc.a);
  float aBl = tc.a * (1.0 - aCov);
#ifdef OPAQUE_PASS
  if (tc.a < A2C_LO) discard;
#else
  if (aBl < 0.02) discard;
#endif
#endif
  vec3 wp = vWP;
  vec3 v = normalize(cameraPosition - wp);
  float nlen = length(vWN);
  vec3 n = vWN / max(nlen, 1e-6);
  vec3 on = normalize(vON + 1e-6);
#if PART == 2
  // the cards' winding is not consistent: light the side that faces the eye
  if (dot(n, v) < 0.0) { n = -n; on = -on; }
#else
  if (!gl_FrontFacing) { n = -n; on = -on; }
#endif
  // derivatives in uniform control flow
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  vec2 dux = dFdx(vUv), duy = dFdy(vUv);
  vec3 dox = dFdx(op), doy = dFdy(op);
#if PART != 2 && !defined(F2_FLAT)
  // tangent-space normal map (derivative frame: no tangents needed)
  vec4 tn = texture2D(tF2Nrm, vUv);
  vec2 nxy = tn.rg * 2.0 - 1.0;
  nxy.y = -nxy.y;
  vec3 nt = vec3(nxy * NRM_STR, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
  {
    vec3 q1perp = cross(dpy, n), q0perp = cross(n, dpx);
    vec3 T = q1perp * dux.x + q0perp * duy.x;
    vec3 B = q1perp * dux.y + q0perp * duy.y;
    float det = max(dot(T, T), dot(B, B));
    float sc = det == 0.0 ? 0.0 : inversesqrt(det);
    vec3 nm = normalize(T * (nt.x * sc) - B * (nt.y * sc) + n * nt.z);
    if (!(any(isnan(nm)))) n = nm;
  }
  float specMap = tn.b;
#else
  float specMap = 0.25;
#endif
  vec3 alb = tc.rgb;
#if PART == 0
  float skin = texture2D(tF2Mask, vUv).r;
  float hairM = 0.0;
#elif PART == 1
  vec3 mk = texture2D(tF2Mask, vUv).rgb;
  float skin = mk.g;
  float hairM = smoothstep(0.15, 0.75, mk.b);
#else
  float skin = 0.0;
  float hairM = 1.0;
#endif
  float lumT = dot(alb, vec3(0.2126, 0.7152, 0.0722));
#if PART == 1
  // only the dark hair texels: the paler hairline fringe stays skin (lit as hair it turns orange)...
  hairM *= 1.0 - smoothstep(0.03, 0.09, lumT);
  // ...except at the back, where the cards hang over the painted hairline: there the scalp is an
  // under-layer coloured as hair (the mask grown a few mm via a coarse mip), so gaps between the
  // cards show hair, never a pale line
  float back = smoothstep(-0.01, -0.04, dot(op - uF2HeadC, vec3(0.0, 0.0, 1.0)));
  float under = smoothstep(0.03, 0.3, textureLod(tF2Mask, vUv, 2.5).b) * back;
  vec3 hairAlb = mix(tc.rgb, vec3(0.020, 0.0097, 0.0052) * (0.8 + 0.4 * f2vn(vUv * 400.0)), under * smoothstep(0.02, 0.06, lumT));
  hairM = max(hairM, under);
#else
  vec3 hairAlb = tc.rgb;
#endif
  // photo albedo → scene albedo: the white cotton reads ~0.5 (not 0.67) so it sits with the sand and
  // doesn't bloom; the skin is matched to the close-up skin layer (uF2SkinTone, set by the scene)
  alb *= mix(vec3(CLOTH_K), uF2SkinTone * SKIN_TINT, skin);
#if PART != 2
  // skin close-up detail: only once a pixel is under ~2 mm, so it costs nothing at normal framing
  float fpm = max(length(dox), length(doy)) / uF2M2O; // metres per pixel
  if (skin > 0.02 && fpm < 2.0e-3) {
    vec3 pm = op / uF2M2O;
    // pick the hand frame's plane most facing the surface (the back of the hand is exactly its xz)
    vec3 an = abs(vec3(dot(on, uF2HandX), on.y, dot(on, uF2HandZ)));
    vec3 ax = uF2HandX, az = uF2HandZ;
    if (an.y < max(an.x, an.z)) { ax = an.x > an.z ? uF2HandZ : uF2HandX; az = vec3(0.0, 1.0, 0.0); }
    vec2 hp = vec2(dot(pm, ax), dot(pm, az));
    float hand = (1.0 - smoothstep(0.07, 0.11, length(pm))) * smoothstep(0.55, 0.85, on.y);
    vec2 g;
    vec3 cpv = f2SkinDetail(hp, fpm, hand, g);
    float wD = skin * (1.0 - smoothstep(0.7e-3, 2.0e-3, fpm));
    alb *= mix(vec3(1.0), f2SkinAlbedoK(hp, cpv, fpm), wD);
    vec3 nd = normalize(n - (uF2Rot * (ax * g.x + az * g.y)) * skin);
    if (!(any(isnan(nd)))) n = nd;
  }
#endif
  float ao = clamp(vAO, 0.0, 1.0);
  ao = mix(1.0, ao, 0.9);
  vec3 l = uF2Sun;
#if PART != 0
  // hair: the cards lie in layers a few millimetres apart over the scalp; sample the shadow from just
  // outside the hair volume (along the head's radius) so the layers don't shadow each other
  vec3 nVo = normalize(op - uF2HeadC);
  float sh = shadowAt(op + nVo * (0.02 * uF2M2O * hairM), normalize(mix(on, nVo, hairM)));
#else
  float sh = shadowAt(op, on);
#endif
  float ndl = dot(n, l);
  vec3 col;
#if PART == 2
  // hair cards: sun-lightened soft ends
  // a few cards (the nape's) are painted paler and redder than the rest: pull their tone towards the
  // scalp's mean (linear luminance ≈ 0.011) so they don't read as a separate band
  // (per card: its average colour from a coarse mip, the gutters are padded with the card's colour)
  vec3 tAvg = textureLod(tF2Col, vUv, 5.0).rgb;
  float lumA = dot(tAvg, vec3(0.2126, 0.7152, 0.0722));
  vec3 albC = tc.rgb * pow(clamp(lumA / 0.011, 0.25, 4.0), -0.7) * pow(clamp(lumT / max(lumA, 1e-4), 0.2, 5.0), -0.15);
  albC = mix(vec3(dot(albC, vec3(0.2126, 0.7152, 0.0722))), albC, 0.8);
  col = f2Hair(albC * HAIR_K * mix(1.08, 1.0, smoothstep(0.25, 0.85, tc.a)), n, op, v, l, sh, ao, lumT);
#else
  // skin: wrap lighting (wider in red) and a warm shadow edge; cloth: near-Lambert
  vec3 w = mix(vec3(0.08), vec3(0.42, 0.2, 0.12), skin);
  vec3 diff = clamp((vec3(ndl) + w) / (1.0 + w), 0.0, 1.0);
  diff = mix(vec3(max(ndl, 0.0)), diff * diff * (3.0 - 2.0 * diff) * 0.35 + 0.65 * diff, max(skin, 0.4));
  vec3 shc = mix(vec3(sh), pow(vec3(max(sh, 0.0)), vec3(0.6, 0.95, 1.08)), 0.85 * skin);
  col = alb * uF2SunCol * diff * shc;
  vec3 aot = mix(vec3(ao), pow(vec3(ao), vec3(0.7, 1.0, 1.2)), skin);
  col += alb * f2SkyIrr(n) * aot * 1.15;
#ifndef F2_LOW
  // light through thin skin (ears, fingers) against the Sun
  col += vec3(0.8, 0.22, 0.08) * uF2SunCol * alb * pow(max(dot(v, -l), 0.0), 4.0) * 0.5 * skin * sh * smoothstep(0.1, -0.4, ndl);
#endif
  float rough = mix(0.82, mix(0.5, 0.36, smoothstep(0.15, 0.6, specMap)), skin);
  float f0 = mix(0.03, 0.028, skin);
  float sp = specL(n, v, l, rough, f0);
  col += uF2SunCol * sp * sh * mix(0.35, 1.0, skin);
  // sky sheen at grazing angles (skin's oily film, cloth's fuzz)
  float fr = F_s(max(dot(n, v), 0.0), 0.028);
  col += f2SkyRefl(reflect(-v, n)) * fr * ao * mix(0.35, 0.7, skin);
#if PART == 1
  // the hair painted on the scalp: the same model as the cards (photo albedo, not the cloth scale)
  if (hairM > 0.001) col = mix(col, f2Hair(hairAlb * HAIR_K, n, op, v, l, sh, ao, lumT), hairM);
#endif
#endif
  // soft knee: sunlit white cloth and glints stay just under the bloom threshold instead of haloing
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (L > 0.68) col *= (0.68 + 0.24 * (1.0 - exp(-(L - 0.68) / 0.24))) / L;
  FRAG_OUTRO
#if PART == 2 && defined(OPAQUE_PASS)
  gl_FragColor = vec4(col, aCov); // alpha-to-coverage (MSAA): dithered, depth-correct soft edges
#elif defined(OPAQUE_PASS)
  gl_FragColor = vec4(col, 1.0);
#else
  gl_FragColor = vec4(col, PART == 2 ? aBl : 1.0);
#endif
}`;

export const F2_SHADOW_VERT = /* glsl */ `
uniform vec3 uF2QO; uniform vec3 uF2QS;
attribute vec2 aUv;
varying vec2 vUv;
void main() { vUv = aUv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uF2QS + uF2QO, 1.0); }`;

export const F2_SHADOW_FRAG = /* glsl */ `
uniform sampler2D tF2Col; uniform float uAlphaTest;
varying vec2 vUv;
void main() { if (uAlphaTest > 0.0 && texture2D(tF2Col, vUv).a < uAlphaTest) discard; gl_FragColor = vec4(1.0); }`;
