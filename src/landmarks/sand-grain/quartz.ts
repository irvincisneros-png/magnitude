/**
 * The hero: a sub-rounded, frosted-and-clear quartz grain. Rendered in one pass: frosted micro-relief
 * (LOD by pixel footprint), fresnel reflection of the sky and skin, sharp sun glints off micro-facets,
 * and refraction through the real (baked) body: the refracted ray is marched through the grain's
 * distance grid to its exit point, collecting milky haze and catching light on two fracture planes
 * and a trail of fluid inclusions, then bent out again (per colour on high: dispersion) into the
 * analytic environment (skin with its shadow and caustic, sky, Sun).
 */
import * as THREE from 'three';
import { LIGHT_GLSL } from './light';
import { ENV_GLSL } from './env';
import { CHIP } from './shape';

const vert = /* glsl */ `
varying vec3 vObj; varying vec3 vW; varying vec3 vN;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
precision highp sampler3D;
${LIGHT_GLSL}
${ENV_GLSL}
uniform sampler3D tSdf; uniform float uB; uniform float uN;
varying vec3 vObj; varying vec3 vW; varying vec3 vN;
vec3 vW_;

vec4 sdf(vec3 p) {
  vec3 uvw = ((p + uB) / (2.0 * uB) * (uN - 1.0) + 0.5) / uN;
  return texture(tSdf, uvw);
}
vec3 sdfN(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  float e = 0.012;
  return normalize(k.xyy * sdf(p + k.xyy * e).r + k.yyx * sdf(p + k.yyx * e).r + k.yxy * sdf(p + k.yxy * e).r + k.xxx * sdf(p + k.xxx * e).r);
}
float hg(float c, float g) { return (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5)); }

/** Chipped frosting: a baked tileable Voronoi of tiny conchoidal chips. Each chip is a flat facet
 *  tilted its own way (one-sided shading); w = 0 on the borders between chips. */
uniform sampler3D tChip;
vec4 chips(vec3 p, float f) {
  vec4 c = texture(tChip, p * f / ${CHIP.period.toFixed(1)});
  return vec4(c.xyz * 2.0 - 1.0, c.w);
}
float lodS(float f, float fp) { return 1.0 - smoothstep(0.1, 0.35, fp * f); }

float glint(vec3 p, vec3 N, vec3 V, float cs, float dens, float ex) {
  vec3 q = p / cs;
  vec3 c = floor(q);
  vec3 hh = hash33(c);
  if (hh.x > dens) return 0.0;
  vec3 ctr = c + 0.2 + 0.6 * hash33(c + 17.0);
  float spot = smoothstep(0.32, 0.04, length(q - ctr));
  vec3 fn = normalize(N + (hash33(c + 5.0) - 0.5) * 0.8 + 0.012 * sin(uTime * vec3(2.1, 2.7, 3.3) + hh * 40.0));
  vec3 r = reflect(-V, fn);
  return spot * pow(max(dot(r, uSun), 0.0), ex);
}

// fracture planes (object space): normal, offset, centre, radius
const vec3 C1N = vec3(0.32, 0.82, 0.47); const float C1H = 0.03; const vec3 C1C = vec3(0.05, 0.05, -0.05);
const vec3 C2N = vec3(-0.72, 0.22, 0.66); const float C2H = -0.09; const vec3 C2C = vec3(-0.17, 0.0, 0.12);
const vec3 C3N = vec3(0.6, -0.25, -0.76); const float C3H = 0.06; const vec3 C3C = vec3(0.15, -0.02, -0.1);

vec3 thinFilm(float c) { return 0.55 + 0.45 * cos(6.2832 * (c * 2.3 + vec3(0.0, 0.33, 0.67))); }

void crack(vec3 p, vec3 d, float L, vec3 n, float hh, vec3 cc, float rad, float k, inout vec3 T, inout vec3 cr) {
  n = normalize(n);
  float dn = dot(d, n);
  float tc = (hh - dot(p, n)) / (abs(dn) > 1e-4 ? dn : 1e-4);
  if (tc <= 0.0 || tc >= L) return;
  vec3 pc = p + d * tc;
  float m = smoothstep(rad, rad * 0.7, length(pc - cc) + sin(pc.x * 31.0 + pc.z * 17.0) * sin(pc.y * 23.0 - pc.x * 13.0) * rad * 0.15);
  // the crack face is hackly: break it into bright and dark patches
  float br = 0.75 + 0.55 * sin(dot(pc, vec3(83.0, 61.0, 47.0))) * sin(dot(pc, vec3(-37.0, 71.0, 29.0)));
  vec3 rc = reflect(d, n);
  cr += T * m * br * (skyIrr(rc) * 0.45 + uSunCol * thinFilm(abs(dn) + k) * pow(max(dot(rc, uSun), 0.0), 30.0) * 3.0);
  T *= 1.0 - 0.45 * m;
}

void main() {
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  float fp = dist * uPx;
  vec3 N0 = normalize(vN);
  vec3 p = vObj;
  vW_ = vW;
  vec4 g0 = sdf(p);
  float far = smoothstep(0.3, 1.2, uZoom);

  // mostly frosted (sugar-like), with two or three clear, wave-polished windows
  float fm = g0.a;
  float frost = mix(0.05, 1.0, smoothstep(0.41, 0.5, fm));

  // micro-relief: chips with tilted facets (normal perturbation: no derivative blockiness)
  float w1 = lodS(26.0, fp), w2 = lodS(80.0, fp);
  // chips are only evaluated where frosted and big enough to see
  vec4 c1 = (w1 > 0.01 && fm > 0.4) ? chips(p, 26.0) : vec4(0.0, 0.0, 0.0, 1.0);
  vec4 c2 = (w2 > 0.01 && fm > 0.4) ? chips(p * 1.3 + 2.0, 80.0) : vec4(0.0, 0.0, 0.0, 1.0);
  vec3 tilt = c1.xyz * 0.12 * w1 + c2.xyz * 0.24 * w2;
  float shade = mix(1.0, mix(0.9, 1.0, c2.w), w2) * (0.93 + 0.14 * c1.w);
#if TIER > 0
  float w3 = lodS(240.0, fp);
  vec4 c3 = (w3 > 0.05 && fm > 0.4) ? chips(p * 1.7 + 5.0, 240.0) : vec4(0.0, 0.0, 0.0, 1.0);
  tilt += c3.xyz * 0.2 * w3;
  shade *= mix(1.0, mix(0.9, 1.0, c3.w), w3);
#endif
  tilt *= frost;
  shade = mix(1.0, shade, frost);
  // clear windows: gently wavy polish with a few long collision scratches
  if (frost < 0.97) {
    vec3 wav = (vec3(vnoise3(p * 30.0), vnoise3(p * 30.0 + 7.0), vnoise3(p * 30.0 + 13.0)) - 0.5) * 0.08 * lodS(30.0, fp);
    tilt += wav * (1.0 - frost);
  }
  tilt -= N0 * dot(tilt, N0);
  vec3 N = normalize(N0 + tilt);
  float nv = max(dot(N, V), 1e-3);
  float ndl = dot(N, uSun);
  float clear = 1.0 - frost;

  // ---- transmission through the body: the full refraction march only runs in the clear windows
  vec3 T = vec3(0.55, 0.47, 0.37);
  vec3 scat = (skyIrr(vec3(0.0, 1.0, 0.0)) * 1.3 + uSkinLa * 0.6) * 0.3;
  vec3 cr = vec3(0.0);
  vec3 windowCol = vec3(0.0);
  if (clear > 0.06) {
    vec3 d = refract(-V, N, 1.0 / 1.544);
    float t = 0.008;
    T = vec3(1.0);
    scat = vec3(0.0);
    vec3 amb = skyIrr(vec3(0.0, 1.0, 0.0)) * 1.3 + uSkinLa * 0.6;
    float ph = hg(dot(d, uSun), 0.35) * 4.0 * PI;
    vec3 q = p;
    for (int i = 0; i < STEPS; i++) {
      q = p + d * t;
      vec4 s = sdf(q);
      if (s.r > -0.0015) break;
      float st = clamp(-s.r * 0.85, 0.012, STEPMAX);
      float dens = s.g * 0.6 + 0.03;
      vec3 tr = exp(-dens * st * vec3(1.0, 1.04, 1.1) - st * vec3(0.03, 0.08, 0.2) * s.b);
      scat += T * (1.0 - tr) * vec3(0.96, 0.93, 0.88) * (uSunCol * ph * 0.12 + amb);
      T *= tr;
      t += st;
    }
    float L = t;
    // depth-dependent absorption: a faint warm tint that deepens through thick parts
    T *= exp(-L * vec3(0.12, 0.24, 0.48));
    cr = vec3(0.0);
    crack(p, d, L, C1N, C1H, C1C, 0.26, 0.0, T, cr);
    crack(p, d, L, C2N, C2H, C2C, 0.17, 0.3, T, cr);
    crack(p, d, L, C3N, C3H, C3C, 0.2, 0.6, T, cr);
    // a healed crack: a trail of tiny fluid inclusions (dark rims, bright cores)
    for (int i = 0; i < 5; i++) {
      float fi = float(i) / 4.0;
      vec3 bc = mix(vec3(0.12, -0.12, 0.17), vec3(0.3, 0.04, -0.06), fi) + vec3(sin(fi * 13.0), cos(fi * 9.0), sin(fi * 7.0)) * 0.02;
      float br = 0.004 + 0.004 * fract(fi * 3.7);
      float tb = clamp(dot(bc - p, d), 0.0, L);
      float x = length(p + d * tb - bc) / br;
      if (x < 1.0) {
        float rim = smoothstep(0.45, 0.95, x);
        cr += T * (1.0 - rim) * uSunCol * 0.12;
        T *= 1.0 - 0.5 * rim;
      }
    }

    // exit: bend out of the far surface (per colour = dispersion); total internal reflection stays inside
    vec3 No = sdfN(q);
    vec3 qW = q + (vW - vObj);
    vec3 envT;
  #if TIER > 1
    vec3 dr = refract(d, -No, 1.535), dg = refract(d, -No, 1.544), db = refract(d, -No, 1.553);
    if (dot(dg, dg) < 0.5) {
      envT = envDiff(qW, -reflect(d, -No)) * 0.4;
    } else {
      envT = envSharp(qW, dg);
      // dispersion: a coloured fringe from one extra look-up along the red/blue split
      vec3 e2 = envSharp(qW, normalize(dr * 2.0 - db));
      envT.r = mix(envT.r, e2.r, 0.5);
      envT.b = mix(envT.b, e2.b * 0.5 + envT.b * 0.5, 0.5);
    }
  #else
    vec3 dg = refract(d, -No, 1.544);
    if (dot(dg, dg) < 0.5) envT = envDiff(qW, -reflect(d, -No)) * 0.4;
    else envT = envSharp(qW, dg);
  #endif
    float edge = pow(1.0 - nv, 1.6);
    T *= mix(vec3(1.0), vec3(0.4, 0.34, 0.28), edge * 0.7);
    T *= mix(vec3(1.0), vec3(1.0, 0.86, 0.66), g0.b * 0.4);
    windowCol = T * envT + scat + cr;


  }
  // ---- frosted body: bright diffuse, light scattered inside and glowing through
  vec3 alb = vec3(0.88, 0.83, 0.74) * mix(vec3(1.0), vec3(1.0, 0.82, 0.6), g0.b * 0.6);
  float wrapD = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  vec3 body = alb * (uSunCol * wrapD * 0.34 + skyIrr(N) * 1.15 + uSkinLd * max(-N.y, 0.0) * 0.45) * shade;
  body += alb * uSunCol * 0.08 * pow(max(dot(-V, uSun), 0.0), 2.0) * (0.35 + 0.65 * (1.0 - max(ndl, 0.0))) * shade * shade;
  // a frosted grain is still translucent: its fractures and depth show faintly through
  vec3 behind = mix((uSkinLd + uSkinLa) * 0.9, skyIrr(-V) * 1.4, smoothstep(-0.3, 0.35, -V.y));
  vec3 frostCol = body * 0.82 + (T * behind * 0.6 + cr + scat * 0.4) * 0.3;

  vec3 col = mix(frostCol, windowCol, clear);

  // ---- reflection: fresnel only at grazing angles, roughened (no mirror)
  float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = envDiff(vW, R);
  if (clear > 0.03) refl = mix(refl, envSharp(vW, R), clear * 0.55);
  col = mix(col, refl, F * mix(0.45, 0.9, clear));

  // sun specular: small and sharp on the windows, broad and weak on the frost
  vec3 hv = normalize(uSun + V);
  float Fh = 0.04 + 0.96 * pow(1.0 - max(dot(V, hv), 0.0), 5.0);
  col += uSunCol * Fh * ggx(max(dot(N, hv), 0.0), mix(0.04, 0.4, frost)) * max(ndl, 0.0) * mix(1.0, 0.5, frost) / (4.0 * nv + 0.4);

  // iron-oxide coating in the hollows between chips
  float stc = smoothstep(0.35, 0.85, g0.b) * (1.0 - c2.w * 0.5) * frost * 0.45;
  col = mix(col, vec3(0.45, 0.22, 0.07) * (uSunCol * max(ndl, 0.0) * 0.7 + skyIrr(N) * 1.2), stc);

  // micro-facet glints: small and sharp, kept alive (bigger, brighter) as the grain shrinks away
  float cs = max(0.0045, fp * 2.0);
  float ex = mix(420.0, 160.0, far);
  float gl = glint(p, N0, V, cs, 0.1 + 0.4 * frost, ex) + glint(p + 0.37, N0, V, cs * 2.3, 0.06 + 0.3 * frost, ex) * 0.7;
  col += uSunCol * gl * 28.0 * (1.0 + 5.0 * far);

  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

export function quartzMaterial(uniforms: Record<string, THREE.IUniform>, tier: number) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    defines: { TIER: tier, STEPS: tier === 0 ? 6 : tier === 1 ? 7 : 8, STEPMAX: tier === 0 ? "0.2" : "0.17" },
  });
}
