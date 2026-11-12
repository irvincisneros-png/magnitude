/** GLSL for the universe landmark. */

/**
 * Galaxy sprites. World size → pixels with light conservation for sub-pixel sprites, a cap that
 * dissolves sprites too close to the camera, a soft depth fade, and a gentle redshift/lookback
 * tint: the further a galaxy is from us, the longer ago its light left and the more its light has
 * been stretched towards red by the expansion of space.
 */
export const galaxyVert = /* glsl */ `
  uniform float uTime;
  uniform float uPxScale;    // drawing-buffer height / (2 tan(fov/2))
  uniform float uCap;        // largest sprite, device px
  uniform float uMinPx;
  uniform float uGain;       // boost for unresolved (sub-pixel) galaxies, capped at true surface brightness
  uniform float uAlpha;      // overall fade with zoom
  uniform float uSizeK;      // world-size multiplier (distant populations stand for whole groups)
  uniform float uEnergyPow;  // 2 = strict light conservation for sub-pixel sprites
  uniform float uDepthK;     // fade with distance from the camera, in camera distances
  uniform float uCamDist;    // camera distance in this object's units
  uniform float uRedshift;   // 1 / radius of the observable universe in this object's units
  uniform float uDrift;
  uniform float uFocus;      // soft ball around the origin (scene units) outside which galaxies fade
  attribute vec3 aCol;
  attribute vec4 aPar;       // size, seed, type, axis ratio
  varying vec3 vCol;
  varying vec4 vShape;       // type, axis ratio, angle, drawn px
  void main() {
    float size = aPar.x * uSizeK, seed = aPar.y;
    vec3 p = position + uDrift * aPar.x * vec3(sin(uTime * 0.07 + seed * 40.0), sin(uTime * 0.05 + seed * 73.0), sin(uTime * 0.06 + seed * 19.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 1e-20);
    float px = size * uPxScale / dist;
    float drawn = clamp(px, uMinPx, uCap);
    float energy = min(1.0, uGain * pow(min(1.0, px / drawn), uEnergyPow));
    float capFade = 1.0 - smoothstep(uCap * 0.8, uCap * 2.6, px);
    float dd = dist / (uCamDist * uDepthK);
    float df = 1.0 / (1.0 + dd * dd);
    float rw = length((modelMatrix * vec4(p, 1.0)).xyz) / uFocus;
    df *= exp(-rw * rw);
    float zr = clamp(length(position) * uRedshift, 0.0, 1.0);
    vec3 c = mix(aCol, aCol * vec3(1.35, 0.6, 0.34), zr * 0.9) * (1.0 - 0.55 * zr);
    vCol = c * (uAlpha * energy * capFade * df);
    vShape = vec4(aPar.z, aPar.w, fract(seed * 7.31) * 6.2832, drawn);
    gl_PointSize = drawn;
    if (mv.z >= 0.0 || max(vCol.r, max(vCol.g, vCol.b)) < 2e-5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;

export const galaxyFrag = /* glsl */ `
  varying vec3 vCol;
  varying vec4 vShape;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float type = vShape.x, q = vShape.y, ang = vShape.z, px = vShape.w;
    float detail = smoothstep(3.0, 10.0, px);
    float ca = cos(ang), sa = sin(ang);
    vec2 e = vec2(ca * c.x + sa * c.y, -sa * c.x + ca * c.y);
    e.y /= mix(1.0, max(q, 0.08), detail * step(type, 2.5));
    float r2 = dot(e, e);
    if (r2 > 1.0) discard;
    float r = sqrt(r2);
    // tiny sprites (1-3 px) must stay flat or they vanish between pixel centres
    float small = smoothstep(2.0, 6.0, px);
    float edge = mix(1.0, 1.0 - r2, small);
    float g = exp(-r2 * mix(0.6, 5.0, small));
    vec3 col = vCol;
    float I = g;
    if (type < 0.5) {                       // elliptical: bright cusp, wide faint halo
      float ell = exp(-7.5 * sqrt(r)) * 3.2 + exp(-r2 * 3.0) * 0.25;
      I = mix(g, ell, detail);
    } else if (type < 1.5) {                // spiral: warm bulge, bluish two-armed disc
      float th = atan(e.y, e.x);
      float arm = 0.5 + 0.5 * cos(2.0 * (th + log(r + 0.03) * 2.6) + ang * 3.0);
      arm = pow(arm, 2.5);
      float bul = exp(-r2 * 70.0) * 2.4;
      float disc = exp(-r * 4.2) * (0.35 + 1.1 * arm);
      float sp = bul + disc;
      I = mix(g, sp * 1.1, detail);
      col = mix(col, col * mix(vec3(1.3, 1.0, 0.7), vec3(0.75, 0.9, 1.35), smoothstep(0.0, 0.5, disc / (bul + disc + 1e-3))), detail);
    } else if (type < 2.5) {                // irregular: patchy blue star-forming knots
      float n = vn(e * 3.2 + ang * 9.0) * 0.7 + vn(e * 7.0 - ang * 5.0) * 0.5;
      float irr = exp(-r * 3.0) * (0.25 + 1.6 * n * n);
      I = mix(g, irr, detail);
    }
    col *= I * edge;
    gl_FragColor = vec4(col, min(1.0, dot(col, vec3(0.25))));
  }`;

/** Dust sprites: multiply what is already drawn by (1 − extinction); redder light survives. */
export const dustFrag = /* glsl */ `
  varying vec3 vCol;
  varying vec4 vShape;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 3.0) - 0.0498;
    gl_FragColor = vec4(min(vCol * a, vec3(0.9)), 0.0);
  }`;

/** Laniakea flow lines with bright pulses travelling towards the Great Attractor. */
export const flowVert = /* glsl */ `
  attribute float aT;
  attribute float aSeed;
  varying float vT;
  varying float vSeed;
  void main() {
    vT = aT; vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export const flowFrag = /* glsl */ `
  uniform float uTime;
  uniform float uA;
  varying float vT;
  varying float vSeed;
  void main() {
    float ph = fract(vT * 2.2 - uTime * 0.035 + vSeed * 7.0);
    float pulse = pow(ph, 14.0) * 0.9;
    float ends = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
    vec3 col = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.95, 0.85), vT * 0.8);
    gl_FragColor = vec4(col * (0.03 + pulse) * ends * uA, 0.0);
  }`;

/** "You are here" ring at the origin (constant screen size). */
export const ringVert = /* glsl */ `
  uniform float uDpr;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 30.0 * uDpr;
  }`;

export const ringFrag = /* glsl */ `
  uniform float uA;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    float ring = smoothstep(0.07, 0.0, abs(r - 0.7));
    float ticks = step(0.84, r) * step(r, 1.0) * (step(abs(c.x), 0.035) + step(abs(c.y), 0.035));
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * (ring * 0.9 + ticks * 0.8) * uA, 0.0);
  }`;

/** The cosmic microwave background shell (radius 0.5), seen from outside or inside. */
export const cmbVert = /* glsl */ `
  varying vec3 vDir;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

export const cmbFrag = /* glsl */ `
  uniform sampler2D tMap;
  uniform float uA;
  uniform float uOutside;   // 1 when the camera is outside the shell
  varying vec3 vDir;
  varying vec3 vN;
  varying vec3 vView;
  vec3 planck(float t) {    // the familiar blue → cream → orange → red map, in linear light
    vec3 c0 = vec3(0.0, 0.02, 0.32), c1 = vec3(0.03, 0.28, 1.0), c2 = vec3(0.86, 0.83, 0.72),
         c3 = vec3(1.0, 0.42, 0.04), c4 = vec3(0.6, 0.03, 0.01);
    t = clamp(t * 0.5 + 0.5, 0.0, 1.0) * 4.0;
    if (t < 1.0) return mix(c0, c1, t);
    if (t < 2.0) return mix(c1, c2, t - 1.0);
    if (t < 3.0) return mix(c2, c3, t - 2.0);
    return mix(c3, c4, t - 3.0);
  }
  void main() {
    vec3 d = normalize(vDir);
    vec2 uv = vec2(atan(d.z, d.x) / 6.2832 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1416 + 0.5);
    float t = texture2D(tMap, uv).r * 2.0 - 1.0;
    vec3 col = planck(t * 1.1);
    float ndv = abs(dot(normalize(vN), normalize(vView)));
    // a thin glowing shell looks brighter where we look along it (the limb)
    float limb = mix(1.0, min(4.0, 1.0 / max(ndv, 0.08)), uOutside);
    float face = mix(1.0, gl_FrontFacing ? 0.5 : 0.4, uOutside);
    gl_FragColor = vec4(col * uA * limb * face * 0.03, 0.0);
  }`;

/** Soft glow hugging the shell from outside: brightness from how close each view ray passes the rim. */
export const haloVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const haloFrag = /* glsl */ `
  uniform float uA;
  uniform float uR;          // shell radius in world units
  varying vec3 vWorld;
  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float b = length(cross(cameraPosition, dir)) / uR;   // closest approach of this ray, in shell radii
    float out_ = max(b - 1.0, 0.0);
    float g = exp(-out_ * 28.0) * 0.07 + exp(-out_ * 7.0) * 0.012;
    g *= smoothstep(0.9, 1.0, b);
    gl_FragColor = vec4(vec3(1.0, 0.72, 0.48) * g * uA, 0.0);
  }`;
