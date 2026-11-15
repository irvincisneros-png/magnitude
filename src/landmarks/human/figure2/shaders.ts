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
#define F2PI 3.14159265
#define CLOTH_K 0.76
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
  // hair cards: OPAQUE_PASS keeps the solid strands (depth-written), the blended pass adds the soft ends
#ifdef OPAQUE_PASS
  if (tc.a < 0.55) discard;
#else
  if (tc.a >= 0.55 || tc.a < 0.03) discard;
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
#elif PART == 1
  float skin = texture2D(tF2Mask, vUv).g;
#else
  float skin = 0.0;
#endif
  // photo albedo → scene albedo: the white cotton reads ~0.5 (not 0.67) so it sits with the sand and
  // doesn't bloom; the skin is matched to the close-up skin layer (uF2SkinTone, set by the scene)
  alb *= mix(vec3(CLOTH_K), uF2SkinTone * SKIN_TINT, skin);
  float ao = clamp(vAO, 0.0, 1.0);
  ao = mix(1.0, ao, 0.9);
  vec3 l = uF2Sun;
#if PART == 2
  // the cards lie in layers a few millimetres apart: sample the shadow from just outside the hair
  // volume so the layers don't shadow each other (the head beneath still gets the hair's shadow)
  float sh = shadowAt(op + on * 0.014 * uF2M2O, on);
#else
  float sh = shadowAt(op, on);
#endif
  float ndl = dot(n, l);
  vec3 col;
#if PART == 2
  // hair: diffuse with a soft terminator, a Kajiya-like sheen across the card (strands run along v)
  vec3 Tw = normalize(dpx * duy.y - dpy * dux.y + 1e-6);
  vec3 T = normalize(Tw - n * dot(Tw, n) + 1e-6);
  vec3 h = normalize(l + v);
  float t1 = dot(T, h);
  float s1 = pow(max(1.0 - t1 * t1, 0.0), 40.0);
  float lit = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  float aoh = mix(1.0, ao, 0.55);
  alb *= 1.25;
  col = alb * uF2SunCol * lit * sh + alb * f2SkyIrr(n) * aoh * 2.0;
  col += uF2SunCol * s1 * 0.03 * vec3(0.9, 0.75, 0.6) * sh * smoothstep(-0.2, 0.3, ndl);
  // sky sheen on the strands (dark hair in shade is not black) and sunlight through the ends
  col += f2SkyRefl(reflect(-v, n)) * 0.045 * aoh;
  col += uF2SunCol * alb * pow(max(dot(v, -l), 0.0), 6.0) * 0.6 * sh;
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
#endif
  // soft knee: sunlit white cloth and glints stay just under the bloom threshold instead of haloing
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (L > 0.68) col *= (0.68 + 0.24 * (1.0 - exp(-(L - 0.68) / 0.24))) / L;
  FRAG_OUTRO
#ifdef OPAQUE_PASS
  gl_FragColor = vec4(col, 1.0);
#else
  gl_FragColor = vec4(col, PART == 2 ? tc.a : 1.0);
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
