/**
 * Analytic environment shared by the grain shaders: the skin below (with the baked shadows and the
 * caustic from the ground-light map), the human scene's sky above and the Sun. Refraction and
 * reflection rays are looked up in this model, since layers share no depth or colour buffers.
 */
import * as THREE from 'three';
import { MAP } from './shape';

export function envUniforms() {
  return {
    tMap: { value: null as THREE.Texture | null },
    uMapMin: { value: new THREE.Vector2(MAP.x0, MAP.z0) },
    uMapSize: { value: new THREE.Vector2(MAP.w, MAP.h) },
    uPx: { value: 0.001 },
    uTime: { value: 0 },
    uZoom: { value: 0 },
  };
}

export const ENV_GLSL = /* glsl */ `
uniform sampler2D tMap; uniform vec2 uMapMin; uniform vec2 uMapSize;
uniform float uPx; uniform float uTime; uniform float uZoom;

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

/** rgb: refracted sunlight through the quartz (× open sun), a: direct-sun visibility. */
vec4 groundMap(vec2 xz) {
  vec2 uv = (xz - uMapMin) / uMapSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return texture2D(tMap, uv);
}
/** Skin as seen through or reflected in a grain (blur 0..1: how out of focus). */
vec3 skinAt(vec2 xz, float blur) {
  vec4 m = groundMap(xz);
  vec3 alb = vec3(1.0);
  float k = 1.0 - blur;
  if (k > 0.01) {
    float pl = vnoise2(xz * 24.0) * 0.6 + vnoise2(xz * 61.0) * 0.4;
    float fur = smoothstep(0.07, 0.0, abs(vnoise2(xz * 4.2 + 3.0) - 0.5));
    alb *= mix(1.0, 0.86 + 0.26 * pl, k) * (1.0 - 0.3 * fur * k);
  }
  return (uSkinLd * m.a + uSkinLa) * alb + uSkinLd * m.rgb;
}
vec3 sunGlow(vec3 d, float sharp) {
  float mu = max(dot(d, uSun), 0.0);
  return uSunCol * (pow(mu, 6000.0) * 40.0 * sharp + pow(mu, 300.0) * 0.5 * sharp + pow(mu, 12.0) * 0.07);
}
vec3 envSharp(vec3 o, vec3 d) {
  if (d.y < -0.002) {
    float t = -o.y / d.y;
    vec3 q = o + d * t;
    vec3 c = skinAt(q.xz, smoothstep(0.5, 3.0, t));
    return mix(c, skyCol(normalize(vec3(d.x, -0.08, d.z))) * 0.75, smoothstep(3.0, 14.0, t));
  }
  return mix(skyCol(d), skinAt(o.xz + d.xz * 3.0, 1.0) * 0.8, smoothstep(0.03, -0.002, d.y) * 0.6) + sunGlow(d, 1.0);
}
vec3 envDiff(vec3 o, vec3 d) {
  float g = smoothstep(-0.3, 0.35, d.y);
  vec3 gr = skinAt(o.xz + d.xz * (o.y / max(-d.y, 0.3)), 1.0);
  vec3 sk = skyIrr(d) * 1.4 + sunGlow(d, 0.0) * 1.5;
  return mix(gr, sk, g);
}
`;
