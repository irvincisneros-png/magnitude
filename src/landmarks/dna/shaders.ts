/** GLSL for the DNA landmark. */

const NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
`;

/** Waxy, subsurface-flavoured lighting shared by the atom impostors and the fibre LOD. */
const LIGHT = /* glsl */ `
vec3 waxy(vec3 base, vec3 n, vec3 v, float occ) {
  vec3 L = normalize(vec3(-0.5, 0.72, 0.48));
  float ndl = dot(n, L);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float diff = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  diff = diff * diff * (3.0 - 2.0 * diff);
  vec3 deep = pow(base, vec3(1.9)) * 0.30;               // saturated, darker terminator (subsurface bleed)
  vec3 col = mix(deep, base * 0.78, diff);
  float thin = pow(1.0 - ndv, 2.4);
  float back = clamp(-ndl * 0.6 + 0.4, 0.0, 1.0);
  col += pow(base, vec3(1.3)) * thin * (0.10 + 0.32 * back);   // light glowing through the thin rim
  vec3 fill = vec3(0.26, 0.36, 0.7) * clamp(dot(n, normalize(vec3(0.6, -0.5, 0.3))) * 0.5 + 0.5, 0.0, 1.0) * 0.10;
  col += base * fill;
  col += vec3(0.40, 0.58, 1.0) * pow(1.0 - ndv, 3.6) * 0.30 * (0.3 + 0.7 * diff);   // cool rim light
  vec3 h = normalize(L + v);
  float nh = clamp(dot(n, h), 0.0, 1.0);
  col += vec3(1.0, 0.95, 0.88) * (pow(nh, 20.0) * 0.06 + pow(nh, 120.0) * 0.14) * smoothstep(-0.1, 0.3, ndl);
  return col * occ;
}
`;

export const atomVert = /* glsl */ `
attribute vec3 aC; attribute vec3 aN; attribute vec3 aB;
attribute vec3 aLoc;      // section x, y (units) and arc length s
attribute vec4 aInfo;     // radius, ambient occlusion, seed, origin flag
attribute vec3 aCol; attribute vec3 aOcc;
uniform float uTime, uTwist, uWave, uJig, uRad, uOrigin, uGhostK;
varying vec3 vView; varying vec3 vCenter; varying float vR;
varying vec3 vCol; varying vec3 vOccV; varying float vAO; varying float vArc;

void main() {
  float th = uTwist * sin(uTime * 0.23) + uWave * sin(aLoc.z * 0.9 - uTime * 0.5);   // slow twisting
  float cs = cos(th), sn = sin(th);
  vec2 xy = vec2(cs * aLoc.x - sn * aLoc.y, sn * aLoc.x + cs * aLoc.y);
  float breathe = 1.0 + 0.012 * sin(uTime * 0.7 + aLoc.z * 0.35);                      // gentle breathing
  xy *= breathe;
  vec3 T = cross(aN, aB);
  vec3 lp = aC + xy.x * aN + xy.y * aB;
  float sd = aInfo.z * 6.2831853;
  lp += uJig * vec3(sin(uTime * (2.3 + aInfo.z) + sd), sin(uTime * (1.9 + aInfo.z * 1.3) + sd * 2.0), sin(uTime * (2.7 - aInfo.z) + sd * 3.0));
  vec2 ox = vec2(cs * aOcc.x - sn * aOcc.y, sn * aOcc.x + cs * aOcc.y);
  vec3 occW = ox.x * aN + ox.y * aB + aOcc.z * T;
  vOccV = mat3(modelViewMatrix) * occW;

  float r = aInfo.x * uRad;
  if (aInfo.w > 0.5) r *= uOrigin;
  vec4 mv = modelViewMatrix * vec4(lp, 1.0);
  vec3 c = mv.xyz;
  float d = length(c);
  vCenter = c; vR = r; vCol = aCol; vAO = aInfo.y; vArc = aLoc.z;
  if (r < 1e-5 || d < r * 1.06) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vView = c; return; }
  float S = r * d / sqrt(d * d - r * r) * 1.08 * uGhostK;
  vec3 pv = c + vec3(position.xy * S, 0.0);
  vView = pv;
  gl_Position = projectionMatrix * vec4(pv, 1.0);
}
`;

export const solidFrag = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
uniform float uD, uSolidA, uArcEnd, uGhost;
uniform vec3 uHaze;
varying vec3 vView; varying vec3 vCenter; varying float vR;
varying vec3 vCol; varying vec3 vOccV; varying float vAO; varying float vArc;
${NOISE}
${LIGHT}
void main() {
    vec3 rd = normalize(vView);
  float b = dot(rd, vCenter);
  float disc = b * b - (dot(vCenter, vCenter) - vR * vR);
  if (disc < 0.0) discard;
  float t = b - sqrt(disc);
  if (t <= 0.0) discard;
  vec3 hit = rd * t;
  vec3 n = normalize(hit - vCenter);
  vec3 v = -rd;
  float occDir = 1.0 - length(vOccV) * 0.85 * smoothstep(-0.25, 0.85, dot(n, normalize(vOccV + 1e-5)));
  float occ = mix(1.0, vAO * occDir, 0.92);
  vec3 col = waxy(vCol, n, v, occ);

  // depth haze: the helix recedes into the nucleoplasm in both directions
  float fogD = 1.0 - exp(-max(0.0, t - 0.8 * uD) / (1.5 * uD + 1.2));
  float arcF = smoothstep(0.55, 1.0, abs(vArc) / uArcEnd);
  float fog = max(fogD, arcF);
  col = mix(col, uHaze, min(fog, 0.92));
  float a = (1.0 - smoothstep(0.72, 1.0, fog)) * uSolidA * pow(1.0 - uGhost, 3.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
  vec4 clip = projectionMatrix * vec4(hit, 1.0);
  gl_FragDepth = a < 0.995 ? 1.0 : clip.z / clip.w * 0.5 + 0.5;   // translucent fades never occlude
}
`;

/** Zoom-in end: every atom becomes a soft, translucent glow so the camera never sits inside an opaque ball. */
export const ghostFrag = /* glsl */ `
precision highp float;
uniform float uGhost, uInten, uD;
varying vec3 vView; varying vec3 vCenter; varying float vR;
varying vec3 vCol; varying vec3 vOccV; varying float vAO; varying float vArc;
void main() {
  vec3 rd = normalize(vView);
  float b = dot(rd, vCenter);
  float cc = dot(vCenter, vCenter);
  float rho2 = max(cc - b * b, 0.0) / (vR * vR);
  float q = sqrt(max(1.0 - rho2, 0.0));
  float glow = exp(-rho2 * 3.6) * (0.2 + 0.8 * q * q);
  float d = sqrt(cc);
  float near = smoothstep(2.0 * vR, 6.0 * vR, d);        // atoms around the camera dissolve to nothing
  float far = exp(-d / (2.2 * uD + 0.35));
  vec3 col = vCol * (0.55 + 0.9 * vAO) * glow * near * far * uGhost * uInten;
  gl_FragColor = vec4(col, glow * 0.0);
}
`;

// ---------------------------------------------------------------- fibre LOD (tube)
export const tubeVert = /* glsl */ `
attribute vec3 aP; attribute vec3 aN; attribute vec3 aB; attribute vec2 aUT;
uniform float uPxScale;
varying vec3 vN; varying vec3 vView; varying vec2 vUT; varying float vK;
void main() {
  float c = cos(aUT.y), s = sin(aUT.y);
  vec3 dirW = c * aN + s * aB;
  vec4 mvC = modelViewMatrix * vec4(aP, 1.0);
  float dist = max(-mvC.z, 1e-3);
  float r = max(0.4, dist / uPxScale * 1.15);
  vK = 0.4 / r;
  vec4 mv = modelViewMatrix * vec4(aP + dirW * r, 1.0);
  vN = normalize(mat3(modelViewMatrix) * dirW);
  vView = mv.xyz; vUT = aUT;
  gl_Position = projectionMatrix * mv;
}
`;

export const tubeFrag = /* glsl */ `
precision highp float;
uniform float uD, uAlpha, uHalf, uPhA, uPhB, uBright;
uniform vec3 uHaze;
varying vec3 vN; varying vec3 vView; varying vec2 vUT; varying float vK;
${NOISE}
${LIGHT}
float wrapA(float a) { return a - 6.2831853 * floor((a + 3.1415927) / 6.2831853) - 0.0; }
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vView);
  float psi = vUT.y - 6.2831853 * vUT.x / 1.7;
  float da = wrapA(psi - uPhA), db = wrapA(psi - uPhB);
  float wa = exp(-da * da / 0.30), wb = exp(-db * db / 0.30);
  float w = max(wa, wb);
  float bp = floor(vUT.x / 0.17);
  float h = hash12(vec2(bp, 3.0));
  vec3 bcol = h < 0.25 ? vec3(0.12, 0.72, 0.74) : h < 0.5 ? vec3(0.25, 0.45, 0.95) : h < 0.75 ? vec3(0.58, 0.34, 0.95) : vec3(0.92, 0.42, 0.78);
  float groove = smoothstep(0.0, 1.0, w);
  vec3 base = mix(bcol * 0.8, vec3(1.0, 0.64, 0.34), groove);
  float occ = mix(0.55, 1.0, groove);
  vec3 col = waxy(base, n, v, occ) * uBright;
  float dist = length(vView);
  float fog = 1.0 - exp(-max(0.0, dist - 0.8 * uD) / (6.0 * uD + 40.0));
  col = mix(col, uHaze, min(fog, 0.8));
  float ends = 1.0 - smoothstep(0.6, 1.0, abs(vUT.x) / uHalf);
  float a = uAlpha * ends * min(1.0, vK + 0.15) * (1.0 - 0.6 * fog);
  gl_FragColor = vec4(col * a, a);
}
`;

// ---------------------------------------------------------------- motes (water and ions)
export const moteVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uBox, uDpr, uInten;
varying vec3 vCol; varying float vA;
void main() {
  vec3 p = (aSeed.xyz * 2.0 - 1.0) * uBox;
  float t = uTime * 0.25;
  p += 0.05 * uBox * vec3(sin(t + aSeed.w * 40.0), sin(t * 1.3 + aSeed.w * 61.0), sin(t * 0.8 + aSeed.w * 23.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  float k = 0.5 * projectionMatrix[1][1];
  float base = 0.5 + 1.6 * fract(aSeed.w * 7.31);
  gl_PointSize = clamp((0.035 * 2.0 * projectionMatrix[1][1] * 450.0 / max(d, 1e-3)) * 0.0 + base * uDpr * (1.0 + 4.0 * exp(-d / (0.25 * uBox))), 1.0, 40.0 * uDpr);
  vCol = fract(aSeed.w * 13.7) > 0.93 ? vec3(1.0, 0.8, 0.45) : vec3(0.5, 0.72, 1.0);
  vA = uInten * exp(-d / (0.6 * uBox)) * (0.35 + 0.65 * fract(aSeed.w * 3.7)) / (1.0 + 3.0 * exp(-d / (0.25 * uBox)));
}
`;
export const moteFrag = /* glsl */ `
precision highp float;
varying vec3 vCol; varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 3.2);
  gl_FragColor = vec4(vCol * g * vA, 0.0);
}
`;

// ---------------------------------------------------------------- backdrop
export const backVert = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.999, 1.0); }
`;
export const backFrag = /* glsl */ `
precision highp float;
uniform vec2 uViewport; uniform float uAlpha, uTime;
${NOISE}
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  vec2 q = (uv - 0.5) * vec2(uViewport.x / uViewport.y, 1.0);
  float r = length(q);
  float m = vn(q * 3.0 + uTime * 0.02) * 0.6 + vn(q * 7.0 - uTime * 0.015) * 0.4;
  vec3 col = mix(vec3(0.032, 0.016, 0.055), vec3(0.008, 0.004, 0.018), smoothstep(0.0, 0.85, r));
  col *= 0.8 + 0.4 * m;
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.004;
  gl_FragColor = vec4(max(col, 0.0) * uAlpha, uAlpha);
}
`;
