/**
 * Figure2 shaders. Object space = the bake frame (anchor on the back of the right hand at the
 * origin, +Y up, 1 unit = 1.7 m); patterns and the self-shadow map work there, lighting in world.
 *
 * Hooks (see Figure2Options): PRELUDE is pasted after the uniforms of both stages, VERT_OUTRO after
 * gl_Position is written (has `vec4 mv`, `vec3 wp`), FRAG_OUTRO before the colour is written (has
 * `vec3 col`, `vec3 wp`, `vec3 op`). Output is linear HDR radiance: no tone mapping, no sRGB.
 */

export const F2_COMMON = /* glsl */ `
uniform vec3 uF2QO; uniform vec3 uF2QS;
uniform float uF2Time; uniform float uF2Wind; uniform float uF2Breath;
uniform float uF2M2O;           // metres → object units
uniform vec3 uF2Sun;            // world, towards the Sun
uniform vec3 uF2SunCol;
uniform vec3 uF2SkyZen; uniform vec3 uF2SkyHor; uniform vec3 uF2Bounce;
uniform vec3 uF2SunObj;         // object space, towards the Sun
uniform vec3 uF2WindObj;        // object space, horizontal direction the breeze blows to
uniform vec4 uF2Hole;           // xyz centre (object), w radius: fragments inside are discarded
uniform vec3 uF2HatC; uniform vec3 uF2HatA; uniform vec3 uF2HeadTop;
uniform sampler2D uF2Shadow; uniform mat4 uF2ShadowMat; uniform float uF2ShadowOn; uniform float uF2ShadowTexel; uniform float uF2ShadowR;
#define F2PI 3.14159265
float f2h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float f2h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float f2n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(f2h13(i), f2h13(i + vec3(1,0,0)), f.x), mix(f2h13(i + vec3(0,1,0)), f2h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(f2h13(i + vec3(0,0,1)), f2h13(i + vec3(1,0,1)), f.x), mix(f2h13(i + vec3(0,1,1)), f2h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float f2n2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(f2h12(i), f2h12(i + vec2(1, 0)), u.x), mix(f2h12(i + vec2(0, 1)), f2h12(i + vec2(1, 1)), u.x), u.y);
}
`;

export const F2_VERT = /* glsl */ `
attribute vec2 aNrm; attribute vec4 aAttr; attribute vec4 aAux;
varying vec3 vOP; varying vec3 vWP; varying vec3 vWN; varying vec3 vON; varying vec4 vAttr; varying vec4 vAux;
vec3 octDec(vec2 e) {
  vec3 v = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-v.z, 0.0);
  v.x += v.x >= 0.0 ? -t : t; v.y += v.y >= 0.0 ? -t : t;
  return normalize(v);
}
void main() {
  vec3 p = position * uF2QS + uF2QO;
  vec3 n = octDec(aNrm);
  float mat = floor(aAttr.w * 255.0 + 0.5);
  vec3 p0 = p;
  // breathing: the shirt over the chest and belly rises and falls (~14 breaths a minute)
  if (mat > 4.5 && mat < 5.5) p += n * aAux.x * 0.004 * uF2M2O * uF2Breath;
  // sea breeze: cloth hems, sleeves and the outer hat brim flutter
  float fl = aAttr.z;
  if (fl > 0.0 && mat > 0.5) { // (skin's flutter channel holds its hairline distance instead)
    float t = uF2Time;
    vec3 q = p0 / uF2M2O;
    float g = f2n3(q * 7.0 + uF2WindObj * t * 2.2 + vec3(0.0, t * 0.3, 0.0)) - 0.5;
    float r = f2n3(q * 23.0 + uF2WindObj * t * 6.0 + vec3(t * 0.9)) - 0.5;
    float amp = (mat > 5.5 && mat < 8.5) ? 0.0035 : 0.006;
    p += (n * 0.7 + uF2WindObj * 0.5) * fl * (g + 0.35 * r) * amp * uF2M2O * (0.45 + 0.55 * uF2Wind);
  }
  vOP = p0; vON = n; vAttr = aAttr; vAux = aAux;
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
varying vec3 vOP; varying vec3 vWP; varying vec3 vWN; varying vec3 vON; varying vec4 vAttr; varying vec4 vAux;

// (max: n·v and v·h can round to just above 1, and pow() of a negative base is NaN: white sparkles)
float F_s(float vh, float f0) { return f0 + (1.0 - f0) * pow(max(1.0 - vh, 0.0), 5.0); }
float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (F2PI * d * d); }
float vis(float nl, float nv, float a) { float k = a * 0.5; return 0.25 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k)); }
vec3 spec(vec3 n, vec3 v, vec3 l, float rough, float f0) {
  vec3 h = normalize(l + v);
  // smooth normals in creases (mouth seam, ear canal, hat rim) can face away from the eye on a visible
  // surface; with n·v → 0 the visibility term exploded into single white pixels. Fade those out.
  float nvr = dot(n, v);
  float nl = max(dot(n, l), 0.0), nv = max(nvr, 0.12), nh = max(dot(n, h), 0.0);
  float a = rough * rough;
  return vec3(ggx(nh, a) * vis(nl, nv, a) * F_s(max(dot(v, h), 0.0), f0) * nl * smoothstep(-0.02, 0.12, nvr));
}
vec3 skyIrr(vec3 n) {
  float u = n.y * 0.5 + 0.5;
  vec3 sky = mix(uF2SkyHor, uF2SkyZen, smoothstep(0.35, 1.0, u));
  return mix(uF2Bounce, sky, smoothstep(0.0, 0.62, u));
}
vec3 skyRefl(vec3 r) {
  float y = r.y;
  vec3 c = mix(uF2SkyHor, uF2SkyZen * 1.3, pow(clamp(y, 0.0, 1.0), 0.6));
  c += uF2SunCol * 0.05 * pow(max(dot(r, uF2Sun), 0.0), 8.0);
  return y < 0.0 ? mix(uF2SkyHor, uF2Bounce, smoothstep(0.0, -0.25, y)) : c;
}
/**
 * What a glossy surface on the face (lens, frame) mirrors, analytically: the hat brim's dim underside
 * overhead, then a band of sky, the glare off the sea and sand at the horizon, and the sand below.
 * rw: world reflection direction.
 */
vec3 faceEnv(vec3 rw) {
  float y = rw.y;
  vec3 sky = mix(uF2SkyHor * 1.35, uF2SkyZen * 1.25, pow(clamp(y, 0.0, 1.0), 0.45));
  vec3 gnd = mix(uF2Bounce * 2.2 + uF2SkyHor * 0.4, uF2Bounce * 1.1, smoothstep(-0.02, -0.45, y));
  vec3 c = mix(gnd, sky, smoothstep(-0.012, 0.012, y));
  // glare band on the horizon, brightest under the Sun's azimuth
  vec2 hz = normalize(rw.xz + 1e-5), sz = normalize(uF2Sun.xz + 1e-5);
  float az = max(dot(hz, sz), 0.0);
  c += vec3(1.0, 0.93, 0.8) * exp(-abs(y + 0.015) * 30.0) * (0.25 + 1.6 * az * az * az);
  // the brim overhead (object frame: rays that climb more than ~20° above the hat's plane hit it)
  float up = dot(rw * uF2Rot, uF2HatA);
  vec3 brim = vec3(0.075, 0.058, 0.036) * (0.7 + 0.3 * smoothstep(0.9, 0.4, up)) + uF2SunCol * vec3(0.05, 0.035, 0.015) * az;
  return mix(c, brim, smoothstep(0.3, 0.38, up));
}

/** Soft self-shadow from the figure's own depth map (object space). */
float shadowAt(vec3 op, vec3 on) {
  if (uF2ShadowOn < 0.5) return 1.0;
  #ifdef F2_LOW
  float nOff = uF2ShadowTexel * 2.0 + 0.006 * uF2M2O;
#else
  float nOff = uF2ShadowTexel * 2.0 + 0.0015 * uF2M2O;
#endif
  vec4 sc = uF2ShadowMat * vec4(op + on * nOff + uF2SunObj * uF2ShadowTexel, 1.0);
  vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
  if (any(lessThan(s.xy, vec2(0.0))) || any(greaterThan(s.xy, vec2(1.0))) || s.z > 1.0) return 1.0;
  float ref = s.z - 0.0006;
  float acc = 0.0;
#ifdef F2_LOW
  const int NT = 4;
  vec2 taps[4] = vec2[4](vec2(-0.6, -0.3), vec2(0.4, -0.7), vec2(0.6, 0.4), vec2(-0.3, 0.7));
#else
  const int NT = 8;
  vec2 taps[8] = vec2[8](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195),
    vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064));
#endif
  // interleaved gradient noise: the penumbra dither reads as fine grain rather than white-noise speckle
  float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832;
  mat2 R = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  for (int i = 0; i < NT; i++) {
    float d = texture2D(uF2Shadow, s.xy + R * taps[i] * 3.0 * uF2ShadowTexel / (2.0 * uF2ShadowR)).r;
    acc += step(ref, d);
  }
  return acc / float(NT);
}

/** Bump a world normal by the gradient of a height field h (metres) given in screen space. */
vec3 bumpN(vec3 n, vec3 p, float h) {
  vec3 dpx = dFdx(p), dpy = dFdy(p);
  float dhx = dFdx(h), dhy = dFdy(h);
  if (dhx == 0.0 && dhy == 0.0) return n; // flat (no relief at this distance): skip the rest
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  if (abs(det) < 1e-20) return n;
  vec3 g = (dhx * r1 + dhy * r2) / det;
  vec3 b = n - g;
  float bl = length(b);
  return bl > 1e-6 ? b / bl : n;
}

/**
 * Warm fill under the hat: the sunlit straw brim glows through and bounces gold light down onto the face
 * and neck (the AO already removed the sky it hides). op/on: object position and normal.
 */
vec3 brimFill(vec3 op, vec3 on) {
  vec3 d = op - uF2HatC;
  float below = dot(d, uF2HatA);
  float rr = length(d - uF2HatA * below) / uF2M2O;
  float under = (1.0 - smoothstep(0.14, 0.21, rr)) * smoothstep(0.02, -0.04, below / uF2M2O) * (1.0 - smoothstep(-0.3, -0.45, below / uF2M2O));
  float lit = max(dot(uF2SunObj, uF2HatA), 0.0) + 0.15;
  return uF2SunCol * vec3(0.5, 0.33, 0.14) * 0.16 * lit * under * clamp(dot(on, uF2HatA) * 0.7 + 0.3, 0.0, 1.0);
}

/** Soft, irregular hairline: hair cover 0..1 from the baked hairline distance hsd (m, + inside). */
float hairDensity(vec3 qm, float hsd, float fp) {
  float e = hsd + (f2n3(qm * 260.0) - 0.5) * 0.007;
#ifndef F2_LOW
  e += (f2n3(qm * 1900.0) - 0.5) * 0.004 * (1.0 - smoothstep(2e-4, 8e-4, fp));
#endif
  // the edge never gets sharper than about a pixel (no stair-stepping from afar)
  return smoothstep(-0.0065 - fp, 0.0025 + fp, e);
}

/**
 * Short hair strands: the flow direction fl (object, along the surface) and a strand-clump value 0..1
 * (also the fur layers' alpha test). lift: height of this fur layer above the root surface (m).
 */
float hairStrand(vec3 qm, vec3 on, float fp, float lift, out vec3 fl) {
  // it grows out from the crown and lies back and down
  vec3 fo = normalize(qm - uF2HeadTop / uF2M2O);
  fl = normalize(fo - on * dot(fo, on) + 1e-5);
#ifdef F2_LOW
  return 0.5;
#else
  // streaky clumps: noise squashed along the flow (~1 mm across, ~8 mm along), sampled at the root so
  // the fur layers stack into strands that lean with the flow
  vec3 root = qm - on * lift - fl * lift * 1.6;
  vec3 qs = root - fl * dot(root, fl) * 0.88;
  float aa = 1.0 - smoothstep(3e-4, 1.6e-3, fp);
  return mix(0.5, mix(f2n3(qs * 850.0), f2n3(qs * 2600.0 + 7.0), 0.4), aa);
#endif
}

/** Short dark-brown hair: Kajiya–Kay (two shifted lobes) + a sky sheen along the strands. */
vec3 hairShade(vec3 n, vec3 qm, vec3 v, vec3 l, float sh, float ao, vec3 fl, float strand) {
  float tone = 0.5 + 0.25 * sin(dot(qm, vec3(31.0, 47.0, 23.0))) + 0.25 * sin(dot(qm, vec3(-53.0, 29.0, 41.0)));
  vec3 alb = vec3(0.085, 0.052, 0.03) * (0.75 + 0.5 * tone) * (0.55 + 0.9 * strand);
  vec3 Tw = normalize(uF2Rot * fl);
  vec3 T = normalize(Tw - n * dot(Tw, n) + 1e-5);
  vec3 h = normalize(l + v);
  float ndl = dot(n, l);
  float t1 = dot(normalize(T + n * 0.12), h), t2 = dot(normalize(T - n * 0.2), h);
  float s1 = pow(max(1.0 - t1 * t1, 0.0), 45.0);
  float s2 = pow(max(1.0 - t2 * t2, 0.0), 11.0);
  float lit = smoothstep(-0.15, 0.35, ndl) * sh;
  vec3 col = alb * uF2SunCol * clamp(ndl * 0.55 + 0.45, 0.0, 1.0) * sh + alb * skyIrr(n) * ao * 1.25;
  col += uF2SunCol * (s1 * 0.075 * (0.3 + 1.4 * strand) + s2 * vec3(0.5, 0.32, 0.19) * 0.07) * lit;
  // soft sheen of the bright sky along the strands (keeps hair in shade from going flat black)
  float t3 = dot(T, normalize(vec3(0.0, 1.0, 0.0) + v));
  col += uF2SkyZen * pow(max(1.0 - t3 * t3, 0.0), 6.0) * 0.07 * ao * (0.5 + strand);
  // light through the hair when backlit
  col += uF2SunCol * vec3(0.32, 0.2, 0.12) * pow(max(dot(v, -l), 0.0), 6.0) * 0.05 * sh;
  return col;
}

void main() {
  vec3 op = vOP;
  if (uF2Hole.w > 0.0 && length(op - uF2Hole.xyz) < uF2Hole.w) discard;
  float mat = floor(vAttr.w * 255.0 + 0.5);
  vec3 wp = vWP;
  vec3 v = normalize(cameraPosition - wp);
  // vertex normals across thin folds (the ear's helix, the hat rim) can interpolate to ~zero mid-triangle:
  // normalising that gave NaN/huge values (white sparkles once clamped). Fall back to the face normal.
  float nlen = length(vWN);
  vec3 n = vWN / max(nlen, 1e-6);
  vec3 on = normalize(vON + 1e-6);
  // (derivatives taken in uniform control flow: inside the branch they are undefined on some GPUs)
  vec3 gc = cross(dFdx(wp), dFdy(wp));
  if (nlen < 0.35) {
    float gl = length(gc);
    vec3 gn = gl > 1e-24 ? gc / gl : v;
    if (dot(gn, vWN) < 0.0 || (nlen < 0.02 && dot(gn, v) < 0.0)) gn = -gn;
    n = normalize(mix(gn, n, smoothstep(0.05, 0.35, nlen)));
    on = n * uF2Rot;
  }
  bool back = !gl_FrontFacing;
  if (back) { n = -n; on = -on; }
  // interpolated attributes can land a hair below 0 in thin creases: pow() of that was NaN (white pixels)
  float ao = clamp(vAttr.x, 0.0, 1.0);
  float thick = max(vAttr.y, 0.0);
  vec3 l = uF2Sun;
  vec3 qm = op / uF2M2O;                     // object position in metres (pattern space)
  float fp = length(fwidth(qm));             // pixel footprint in metres
  // hair: strands first, so discarded fur fragments skip the shadow lookup and the shading
  float hLayer = 0.0, hStrand = 0.5, hDens = 1.0; vec3 hFl = vec3(0.0, -1.0, 0.0);
  if (mat > 3.5 && mat < 4.5) {
    hLayer = vAux.z;                          // 0 base shell, 1/3 … 1 fur layers (high tier only)
    float hsd = (vAux.y - 0.5) * 0.04;
    // fur clumps under a pixel or two would only sparkle: the base shell carries the look from there
    if (hLayer > 0.01 && fp > 1.4e-3) discard;
    hDens = hsd < 0.012 ? hairDensity(qm, hsd, fp) : 1.0;
    hStrand = hairStrand(qm, on, fp, hLayer * 0.0042 * (0.35 + 0.65 * smoothstep(0.0, 0.012, hsd)), hFl);
    if (hLayer > 0.01) {
      // strands thin out with height and towards the hairline
      float thr = 0.3 + 0.48 * hLayer + (1.0 - hDens) * 0.6 + (1.0 - smoothstep(0.0, 0.01, hsd)) * 0.3 + smoothstep(4e-4, 1.4e-3, fp) * 0.9;
      if (hStrand < thr) discard;
    }
  }
  float sh = shadowAt(op, on);
  vec3 col = vec3(0.0);

  if (mat < 0.5) {
    // ------------------------------------------------------------- skin
    float bl = vAux.x * 2.0 - 1.0;            // brow (+) and lips (−) share a channel
    float brow = max(bl, 0.0), lips = max(-bl, 0.0);
    float red = vAux.y, nail = vAux.z, oil = vAux.w;
    float hsd = (vAttr.z - 0.5) * 0.04;      // hairline distance (m), painted short hair at the edges
    // a lightly tanned young adult: warm, saturated, a little uneven
    vec3 alb = vec3(0.39, 0.212, 0.138);
#ifdef F2_LOW
    float mel = 0.5, blot = 0.5;
#else
    float blot = f2n3(qm * 38.0);
    float mel = blot * 0.6 + f2n3(qm * 140.0) * 0.4;
#endif
    alb *= 0.92 + 0.14 * mel;
    // flushed zones (cheeks, nose, ears, knuckles, elbows), blotchy rather than painted on
    float rz = clamp(red * (0.75 + 0.6 * blot), 0.0, 1.0);
    alb = mix(alb, alb * vec3(1.1, 0.72, 0.7), rz * 0.85);
    alb *= vec3(1.0 + 0.05 * (blot - 0.5), 1.0 - 0.06 * (blot - 0.5), 1.0 - 0.08 * (blot - 0.5));
    // lips: deeper, rosier and a touch cooler than the skin around them; not a coloured coat
    alb = mix(alb, alb * vec3(0.9, 0.66, 0.66), lips * 0.8);
    alb = mix(alb, vec3(0.6, 0.42, 0.36), nail * 0.75);
    float bs = f2n2(vec2(qm.x * 900.0 + qm.z * 300.0, qm.y * 160.0));
    alb = mix(alb, vec3(0.03, 0.019, 0.012), brow * (0.6 + 0.4 * bs));
    float rough = mix(mix(0.6, 0.4, oil), 0.33, nail) - lips * 0.14;
#ifndef F2_LOW
    // fine relief: pores and criss-cross furrows, fading out once they are below a pixel
    float fade = 1.0 - smoothstep(2.5e-4, 1.2e-3, fp);
    float hb = 0.0;
    if (fade > 0.0) {
      float pores = f2n3(qm * 1900.0);
      float furrow = abs(sin(dot(qm, vec3(2100.0, 1300.0, 900.0)) + f2n3(qm * 300.0) * 3.0)) * abs(sin(dot(qm, vec3(-900.0, 1700.0, 1800.0)) + f2n3(qm * 280.0 + 3.0) * 3.0));
      hb = (pores * 2.5e-5 * (1.0 + oil) + (1.0 - furrow) * 1.6e-5) * fade * (1.0 - nail) * (1.0 - lips * 0.6);
    }
    // derivatives must be taken outside the branch (undefined in non-uniform control flow: that gave NaN pixels)
    vec3 nb = bumpN(on, qm, hb);
    if (fade > 0.0) n = normalize(uF2Rot * nb);
#endif
    float ndl = dot(n, l);
    // subsurface: wrap lighting, wider in red, so the terminator goes soft and warm
    vec3 w = vec3(0.4, 0.17, 0.1);
    vec3 diff = clamp((vec3(ndl) + w) / (1.0 + w), 0.0, 1.0);
    diff *= diff * (3.0 - 2.0 * diff) * 0.35 + 0.65 * diff;
    // the shadow edge too goes red (light diffusing under the skin into the shadowed side)
    vec3 shc = mix(vec3(sh), pow(vec3(max(sh, 0.0)), vec3(0.6, 0.95, 1.08)), 0.85);
    col = alb * uF2SunCol * diff * shc;
    // transmitted light through thin parts (ears, fingers, nose edges), seen against the Sun
    float thin = exp(-thick * 0.06 / 0.008);
    float bt = pow(max(dot(v, -l), 0.0), 3.0) * 0.8 + 0.2 * smoothstep(0.0, 0.5, -ndl);
    col += vec3(0.9, 0.2, 0.07) * uF2SunCol * thin * bt * 0.4 * max(sh, 0.4);
    // ambient: occlusion tinted warm (light that reaches a crease has travelled through skin), plus a
    // little of that scattering on the open skin too
    vec3 aot = pow(vec3(ao), vec3(0.7, 1.0, 1.2));
    col += alb * (skyIrr(n) * vec3(1.1, 1.0, 0.95) * 1.05 * aot + brimFill(op, on) * (0.5 + 0.5 * ao));
    // two-lobe specular (oily sheen + broader lobe), Fresnel-weighted sky reflection
#ifdef F2_LOW
    float spm = 1.0;
    col += uF2SunCol * spec(n, v, l, rough * 0.85, 0.028) * (0.45 + 0.3 * oil) * sh;
#else
    float spm = (0.75 + 0.5 * f2n3(qm * 60.0)) * (0.7 + 0.6 * oil);
    col += uF2SunCol * (spec(n, v, l, rough, 0.028) * 0.4 + spec(n, v, l, rough * 0.55, 0.028) * 0.14 * (0.3 + oil)) * sh * spm;
#endif
    float nv = max(dot(n, v), 0.0);
    col += skyRefl(reflect(-v, n)) * F_s(nv, 0.028) * 0.16 * ao * spm;
    // short hair painted onto the skin at the hairline, nape and sideburns (blends into the hair shell)
    if (hsd > -0.012) {
      float dens = hairDensity(qm, hsd, fp);
      if (dens > 0.0) {
        vec3 fl; float st = hairStrand(qm, on, fp, 0.0, fl);
        col = mix(col, hairShade(n, qm, v, l, sh, ao * 0.7, fl, st) * 0.85, dens);
      }
    }
  } else if (mat < 3.5) {
    // ------------------------------------------------------------- eye
    vec3 alb = vec3(0.04, 0.025, 0.018);
    col = alb * (uF2SunCol * max(dot(n, l), 0.0) * sh + skyIrr(n) * ao);
    col += uF2SunCol * spec(n, v, l, 0.08, 0.04) * sh + skyRefl(reflect(-v, n)) * F_s(max(dot(n, v), 0.0), 0.04) * ao;
  } else if (mat < 4.5) {
    // ------------------------------------------------------------- short hair: base shell + fur layers
    // (strand value, flow and the fur alpha test were done before the shadow lookup)
    vec3 hc = hairShade(n, qm, v, l, sh, ao * (0.7 + 0.3 * hLayer), hFl, hStrand);
    if (hLayer > 0.01) col = hc * (1.0 + 0.3 * hLayer);
    else {
      col = hc * 0.85;
      // the scalp shows through only right at the edge
      vec3 skin = vec3(0.39, 0.212, 0.138) * (uF2SunCol * max(dot(n, l), 0.0) * sh + skyIrr(n) * ao);
      col = mix(skin, col, hDens);
    }
  } else if (mat < 5.5 || mat > 10.5) {
    // ------------------------------------------------------------- cloth: cotton T-shirt / boardshorts
    bool tee = mat < 5.5;
    float panel = vAux.y, hem = vAux.z, fold = vAux.w;
    vec3 alb;
    float fade = 1.0 - smoothstep(3e-4, 1.5e-3, fp);
    vec3 an = abs(on);
    vec2 uvw = an.y > 0.7 ? qm.xz : an.x > an.z ? qm.zy : qm.xy;
    float hgt = 0.0;
    if (tee) {
      // heathered blue-grey jersey
      float heather = f2n2(uvw * vec2(700.0, 500.0)) * 0.5 + f2n3(qm * 60.0) * 0.5;
      alb = vec3(0.16, 0.235, 0.33) * (0.92 + 0.14 * heather);
      // knit: tiny interlocking loops
      float knit = sin(uvw.x * 5200.0 + sin(uvw.y * 5200.0) * 1.2) * sin(uvw.y * 2600.0);
      hgt = knit * 3e-5 * fade;
      // stitched hems: a double-needle line just inside every opening
      float st = smoothstep(0.55, 0.62, hem) * (1.0 - smoothstep(0.66, 0.73, hem)) + smoothstep(0.82, 0.86, hem) * (1.0 - smoothstep(0.88, 0.92, hem));
      alb *= 1.0 - 0.18 * st * (0.6 + 0.4 * step(0.5, fract(dot(uvw, vec2(260.0, 260.0)))));
      hgt -= st * 1.2e-4;
    } else {
      // boardshorts: deep navy with a sand-coloured side panel and a faint tonal wave print
      float wave = sin(qm.x * 60.0 + sin(qm.y * 40.0 + qm.z * 30.0) * 2.0) * sin(qm.y * 55.0 - qm.z * 20.0);
      alb = mix(vec3(0.019, 0.032, 0.07), vec3(0.022, 0.037, 0.08), smoothstep(-0.2, 0.6, wave));
      float pe = smoothstep(0.35, 0.65, panel);
      alb = mix(alb, vec3(0.055, 0.12, 0.2), pe);
      float pipe = 1.0 - smoothstep(0.0, 0.1, abs(panel - 0.5));
      alb = mix(alb, vec3(0.7, 0.62, 0.48), pipe * 0.85);
      float weave = sin(uvw.x * 6000.0) * sin(uvw.y * 6000.0);
      hgt = weave * 1.5e-5 * fade;
      float st = smoothstep(0.6, 0.66, hem) * (1.0 - smoothstep(0.7, 0.76, hem));
      alb *= 1.0 - 0.25 * st;
      hgt -= st * 1e-4;
    }
#ifndef F2_LOW
    vec3 nb = bumpN(on, qm, hgt);
    if (fade > 0.0) n = normalize(uF2Rot * nb);
#endif
    if (back) alb *= 0.55;
    float crease = smoothstep(0.5, 0.0, fold) * 0.35;
    float ndl = dot(n, l);
    float diff = clamp((ndl + 0.25) / 1.25, 0.0, 1.0);
    col = alb * uF2SunCol * diff * sh + alb * skyIrr(n) * ao * (1.0 - crease) * 1.15;
    // fibre fuzz: a soft sheen at grazing angles
    float nv = max(dot(n, v), 0.0);
    float fz = pow(max(1.0 - nv, 0.0), tee ? 3.0 : 4.0);
    col += (tee ? alb * 2.2 + 0.015 : alb * 0.5 + 0.004) * fz * (uF2SunCol * max(ndl + 0.3, 0.0) * sh * 0.5 + skyIrr(n) * ao * 0.6);
    col += uF2SunCol * spec(n, v, l, tee ? 0.75 : 0.62, 0.03) * sh * (tee ? 0.25 : 0.35);
    // light through thin cloth when backlit
    col += alb * uF2SunCol * max(-ndl, 0.0) * pow(max(dot(v, -l), 0.0), 2.0) * (tee ? 0.35 : 0.1) * sh;
  } else if (mat < 8.5) {
    // ------------------------------------------------------------- woven straw hat (6 straw, 7 band, 8 lining)
    vec3 d = (op - uF2HatC) / uF2M2O;
    vec3 ax = uF2HatA;
    float ah = dot(d, ax);
    vec3 rv = d - ax * ah;
    float rr = length(rv);
    vec3 e1 = normalize(cross(ax, vec3(0.0, 0.0, 1.0)));
    float ang = atan(dot(rv, cross(ax, e1)), dot(rv, e1));
    // plaited straw: on the brim strands run round in rows; on the crown, round in horizontal rows.
    // basket weave in (along-row arc length, across-row) metres, alternating over/under per cell
    float onBrimF = smoothstep(0.0, 0.05, vAux.y);
    float vrow = mix(ah, rr, onBrimF);               // across rows
    float urow = ang * max(rr, 0.02);                // along rows
    // braided straw: rows of diagonal plaits, the slant alternating row to row (herringbone)
    float cw = 0.0042, chh = 0.0052;
    float rowI = floor(vrow / chh), rf = fract(vrow / chh);
    float dir = mod(rowI, 2.0) * 2.0 - 1.0;
    float su = (urow + dir * rf * chh * 1.1) / cw;
    float segI = floor(su), seg = fract(su);
    float hstraw = pow(max(sin(F2PI * rf), 0.0), 0.6) * (0.55 + 0.45 * sin(F2PI * seg));
    float wv = 1.0 - smoothstep(2.5e-4, 9e-4, fp);
    float fib = mix(0.5, f2h12(vec2(segI, rowI)), 1.0 - smoothstep(4e-4, 1.2e-3, fp));
    vec3 alb = vec3(0.62, 0.47, 0.25) * (0.8 + 0.28 * mix(0.62, hstraw, wv) + 0.14 * (fib - 0.5) * wv);
    alb *= 0.9 + 0.2 * f2n2(vec2(ang * 4.0, rr * 40.0));
    // row-to-row tone (visible from further away than the weave itself)
    alb *= 1.0 + 0.12 * (f2h12(vec2(rowI, 7.0)) - 0.5) * (1.0 - smoothstep(1.5e-3, 5e-3, fp));
    float band = vAux.z;
    alb = mix(alb, vec3(0.022, 0.025, 0.035), smoothstep(0.3, 0.7, band));
    if (mat > 7.5) alb *= vec3(0.6, 0.5, 0.42); // lining: sweat-darkened, warmer
#ifndef F2_LOW
    n = normalize(uF2Rot * bumpN(on, qm, hstraw * 5e-4 * wv * (1.0 - band)));
#endif
    float ndl = dot(n, l);
    col = alb * uF2SunCol * clamp((ndl + 0.1) / 1.1, 0.0, 1.0) * sh + alb * skyIrr(n) * ao * 1.1;
    col += uF2SunCol * spec(n, v, l, 0.55, 0.035) * sh * (1.0 - band * 0.5);
    // translucent brim: sunlight glows through the straw (and leaks through the gaps in the weave)
    float brimT = (vAux.y > 0.02 && band < 0.5) ? 1.0 : 0.0;
    float through = max(-dot(normalize(vWN) * (back ? -1.0 : 1.0), l), 0.0);
    float gaps = smoothstep(0.75, 0.98, 1.0 - hstraw) * wv;
    col += vec3(0.95, 0.68, 0.32) * uF2SunCol * brimT * through * (0.16 + 0.9 * gaps) * (0.35 + 0.65 * pow(max(dot(v, -l), 0.0), 2.0)) * 0.6;
  } else if (mat < 9.5) {
    // ------------------------------------------------------------- glasses frame: thin glossy black acetate
    vec3 alb = vec3(0.016, 0.012, 0.011);
    col = alb * (uF2SunCol * max(dot(n, l), 0.0) * sh + skyIrr(n) * ao);
    float nv = max(dot(n, v), 0.0);
    col += uF2SunCol * (spec(n, v, l, 0.2, 0.05) + spec(n, v, l, 0.42, 0.05) * 0.5) * sh * 0.7;
    col += faceEnv(reflect(-v, n)) * F_s(nv, 0.05) * (0.4 + 0.6 * ao) * 0.85;
  } else {
    // ------------------------------------------------------------- tinted lens: near black, mirrors the world
    float nv = max(dot(n, v), 0.0);
    vec3 r = reflect(-v, n);
    float F = F_s(nv, 0.065);
    col = vec3(0.004, 0.0045, 0.004) * skyIrr(n) * ao;   // what little comes through from behind
    col += faceEnv(r) * F;
    // the Sun: a small hard glint with a soft halo
    float rs = max(dot(r, l), 0.0);
    col += uF2SunCol * (pow(rs, 4000.0) * 90.0 + pow(rs, 350.0) * 1.2) * F * sh;
  }
  FRAG_OUTRO
  gl_FragColor = vec4(col, 1.0);
}`;

/** Depth-only pass for the self-shadow map (object space, low mesh). */
export const F2_SHADOW_VERT = /* glsl */ `
uniform vec3 uF2QO; uniform vec3 uF2QS;
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uF2QS + uF2QO, 1.0); }`;
export const F2_SHADOW_FRAG = /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`;
