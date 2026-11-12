/** Shared GLSL for the cell landmark: noise, soft subsurface-style lighting, depth fog, dithering. */

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uLightDir;
uniform float uFogDensity;
uniform float uFogStart;
uniform vec3 uFogCol;
uniform float uD;
uniform float uPxScale;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
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

/** Depth fog amount 0..1 for a fragment at distance dist from the camera. */
float fogF(float dist) { return 1.0 - exp(-max(dist - uFogStart, 0.0) * uFogDensity); }

/** Interleaved gradient noise, for dithered (screen-door) fades on opaque surfaces. */
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

/** Soft "subsurface" lighting: wrapped key, cool fill, back-light transmission, wet specular. */
vec3 sssLight(vec3 base, vec3 n, vec3 v, float wrap, float trans, float specK) {
  vec3 L = uLightDir;
  float ndl = dot(n, L);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  float fill = clamp(dot(n, vec3(-0.45, -0.7, 0.55)) * 0.5 + 0.5, 0.0, 1.0);
  float back = pow(clamp(dot(v, -L) * 0.5 + 0.5, 0.0, 1.0), 4.0) * trans;
  vec3 h = normalize(L + v);
  float spec = pow(clamp(dot(n, h), 0.0, 1.0), 42.0) * smoothstep(-0.2, 0.3, ndl);
  return base * (0.10 + 0.95 * diff + 0.25 * fill) + fill * vec3(0.010, 0.016, 0.03)
       + base * back * 1.3 + vec3(0.85, 0.92, 1.0) * spec * specK;
}
`;

/** Fragment-only helpers (screen-space derivatives). */
export const FRAG = /* glsl */ `
/** Bump-map a normal from a scalar height using screen-space derivatives (height in world units). */
vec3 bumpN(vec3 n, vec3 wp, float h) {
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - grad);
}

`;
