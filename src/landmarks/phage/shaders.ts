/** GLSL for the phage landmark. Lighting matches the DNA scene (same key light direction). */

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uHaze;
uniform float uD;
uniform vec3 uCutDir;
uniform float uCutR;
uniform vec3 uCutC;      // a point on the cut plane (the head centre)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 waxy(vec3 base, vec3 n, vec3 v, float occ) {
  vec3 L = normalize(vec3(-0.5, 0.72, 0.48));
  float ndl = dot(n, L);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float diff = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  diff = diff * diff * (3.0 - 2.0 * diff);
  vec3 deep = pow(base, vec3(1.9)) * 0.30;
  vec3 col = mix(deep, base * 0.8, diff);
  float thin = pow(1.0 - ndv, 2.4);
  float back = clamp(-ndl * 0.6 + 0.4, 0.0, 1.0);
  col += pow(base, vec3(1.3)) * thin * (0.12 + 0.34 * back);
  vec3 fill = vec3(0.26, 0.36, 0.7) * clamp(dot(n, normalize(vec3(0.6, -0.5, 0.3))) * 0.5 + 0.5, 0.0, 1.0) * 0.12;
  col += base * fill;
  col += vec3(0.40, 0.62, 1.0) * pow(1.0 - ndv, 3.4) * 0.34 * (0.3 + 0.7 * diff);
  vec3 h = normalize(L + v);
  float nh = clamp(dot(n, h), 0.0, 1.0);
  col += vec3(1.0, 0.95, 0.88) * (pow(nh, 18.0) * 0.05 + pow(nh, 110.0) * 0.12) * smoothstep(-0.1, 0.3, ndl);
  return col * occ;
}
/** 0 = cut away. rim = closeness to the cut edge. */
float cutKeep(vec3 wp, out float rim) {
  rim = 0.0;
  if (uCutR <= 0.0) return 1.0;
  vec3 w = wp - uCutC;
  float al = dot(w, uCutDir);
  float rho = length(w - uCutDir * al);
  float e = rho - uCutR;
  if (al > -0.002 && e < 0.0) return 0.0;
  rim = al > -0.02 ? 1.0 - smoothstep(0.0, 0.005, e) : 0.0;
  return 1.0;
}
float fogAmt(float dist) { return 1.0 - exp(-max(0.0, dist - 0.9 * uD) / (2.4 * uD + 0.2)); }
`;

// ---------------------------------------------------------------- protein blobs
export const blobVert = /* glsl */ `
attribute vec3 aOff; attribute vec4 aQuat; attribute vec3 aScale; attribute vec3 aCol;
attribute vec4 aMisc; attribute vec2 aFlex;
uniform float uTime, uJig, uLump, uFlexA;
varying vec3 vWP; varying vec3 vN; varying vec3 vCol; varying vec4 vMisc; varying float vLz;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 p = position; vec3 n = normal;
  float sd = aMisc.x * 6.2831853;
  vec3 k1 = vec3(2.1, 1.3, -1.7), k2 = vec3(-1.4, 2.6, 1.1), k3 = vec3(3.3, -2.2, 2.6);
  float a1 = dot(p, k1) * 1.3 + sd, a2 = dot(p, k2) * 1.3 + sd * 1.7, a3 = dot(p, k3) * 1.3 + sd * 2.3;
  float f = uLump * (0.5 * sin(a1) + 0.32 * sin(a2) + 0.2 * sin(a3));
  vec3 g = uLump * 1.3 * (0.5 * cos(a1) * k1 + 0.32 * cos(a2) * k2 + 0.2 * cos(a3) * k3);
  vec3 pl = p * (1.0 + f);
  vec3 nl = normalize(n - (g - dot(g, n) * n));
  vec3 ps = pl * aScale;
  vec3 ns = normalize(nl / aScale);
  vec3 lp = aOff + qrot(aQuat, ps);
  float t = uTime;
  lp += uJig * vec3(sin(t * (1.7 + aMisc.x) + sd), sin(t * (2.1 + aMisc.x * 1.3) + sd * 2.0), sin(t * (1.9 - aMisc.x) + sd * 3.0));
  lp += aFlex.y * uFlexA * vec3(sin(t * 0.61 + aFlex.x), 0.6 * sin(t * 0.47 + aFlex.x * 1.7), sin(t * 0.53 + aFlex.x * 2.3));
  vec4 wp = modelMatrix * vec4(lp, 1.0);
  vWP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * qrot(aQuat, ns));
  vCol = aCol; vMisc = aMisc; vLz = p.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const blobFrag = /* glsl */ `
precision highp float;
${COMMON}
uniform float uNearFade;
uniform float uFade;
varying vec3 vWP; varying vec3 vN; varying vec3 vCol; varying vec4 vMisc; varying float vLz;
void main() {
  float rim = 0.0;
  if (vMisc.z > 0.5 && cutKeep(vWP, rim) < 0.5) discard;
  float dist = length(cameraPosition - vWP);
  if (uNearFade > 0.0) {
    float k = smoothstep(uNearFade * 0.4, uNearFade, dist);
    if (k < ign(gl_FragCoord.xy)) discard;
  }
  if (uFade < 0.999 && uFade < ign(gl_FragCoord.xy + 17.0)) discard;
  vec3 v = (cameraPosition - vWP) / dist;
  vec3 n = normalize(vN);
  vec3 col;
  if (!gl_FrontFacing) {
    // inside of a cut protein: a flat, slightly glowing section
    col = vCol * 0.55 + vec3(0.25, 0.35, 0.45) * 0.25;
  } else {
    float occ = mix(1.0 - vMisc.y * 0.85, 1.0, smoothstep(-0.9, 0.85, vLz));
    col = waxy(vCol, n, v, occ);
    col += vCol * vMisc.w * 2.0;
  }
  col += vec3(0.55, 0.85, 1.0) * rim * 0.35;
  col = mix(col, uHaze, min(fogAmt(dist), 0.94));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- capsid floor (shell between capsomeres)
export const shellVert = /* glsl */ `
varying vec3 vWP; varying vec3 vN; varying vec3 vObj;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const shellFrag = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uBase; uniform float uGlow; uniform float uFade;
varying vec3 vWP; varying vec3 vN; varying vec3 vObj;
void main() {
  if (uFade < 0.999 && uFade < ign(gl_FragCoord.xy + 17.0)) discard;
  float rim;
  if (cutKeep(vWP, rim) < 0.5) discard;
  float dist = length(cameraPosition - vWP);
  vec3 v = (cameraPosition - vWP) / dist;
  vec3 n = normalize(vN);
  float m = vnoise(vObj * 140.0) * 0.6 + vnoise(vObj * 300.0) * 0.4;
  vec3 col;
  if (gl_FrontFacing) {
    col = waxy(uBase * 0.22, n, v, 0.45);
    col += vec3(1.0, 0.5, 0.22) * uGlow * (0.03 + 0.06 * m * m);   // the packed DNA glowing through the gaps
  } else {
    // inner wall seen from inside the head
    float cells = vnoise(vObj * 60.0);
    col = waxy(uBase * 0.3, -n, v, 0.55 + 0.45 * smoothstep(0.25, 0.75, cells) * (0.7 + 0.3 * m));
    col += vec3(0.9, 0.5, 0.25) * 0.03;
  }
  col += vec3(0.55, 0.85, 1.0) * rim * 0.4;
  col = mix(col, uHaze, min(fogAmt(dist), 0.94));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- DNA strands (cylinder impostor ribbons)
export const strandVert = /* glsl */ `
attribute vec3 aA; attribute vec3 aB; attribute vec2 aS; attribute float aFlag;
uniform float uRad, uPx, uTime;
varying vec3 vWP; varying vec3 vSide; varying vec3 vDir; varying float vU; varying float vS; varying float vFlag; varying float vK;
void main() {
  vec3 A = (modelMatrix * vec4(aA, 1.0)).xyz;
  vec3 B = (modelMatrix * vec4(aB, 1.0)).xyz;
  vec3 d = B - A; float len = length(d); vec3 dir = d / max(len, 1e-6);
  float t = position.x * 0.5 + 0.5;
  vec3 P = mix(A, B, t);
  vec3 toC = cameraPosition - P; float dist = length(toC);
  vec3 side = normalize(cross(dir, toC));
  float w = max(uRad, dist / uPx * 0.9);
  vK = uRad / w;
  P += dir * (position.x * w * 0.6);
  P += side * position.y * w;
  vWP = P; vSide = side; vDir = dir; vU = position.y; vS = mix(aS.x, aS.y, t); vFlag = aFlag;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;
export const strandFrag = /* glsl */ `
precision highp float;
${COMMON}
uniform float uNearFade, uGlowK, uOriginHole, uAlpha;
varying vec3 vWP; varying vec3 vSide; varying vec3 vDir; varying float vU; varying float vS; varying float vFlag; varying float vK;
void main() {
  if (abs(vU) > 1.0) discard;
  float rim;
  if (cutKeep(vWP, rim) < 0.5) discard;
  if (vFlag > 0.5 && length(vWP) < uOriginHole) discard;   // the DNA landmark draws this strand
  float dist = length(cameraPosition - vWP);
  vec3 v = (cameraPosition - vWP) / dist;
  float nk = smoothstep(uNearFade * 0.35, uNearFade, dist);
  if (nk < ign(gl_FragCoord.xy)) discard;
  float h = sqrt(max(1.0 - vU * vU, 0.0));
  vec3 fw = normalize(v - vDir * dot(v, vDir));
  vec3 n = normalize(vSide * vU + fw * h);
  // double-helix grooves, 3.4 nm pitch, fading when the strand is only a few pixels wide
  float psi = atan(vU, h) - 6.2831853 * vS / 0.017;
  float wa = 0.5 + 0.5 * cos(psi), wb = 0.5 + 0.5 * cos(psi + 2.3);
  float groove = max(wa, wb);
  float stripe = mix(0.75, 1.0, smoothstep(0.35, 0.9, groove));
  float bp = floor(vS / 0.0017);
  float hh = hash12(vec2(bp, 7.0));
  vec3 bcol = hh < 0.25 ? vec3(0.12, 0.72, 0.74) : hh < 0.5 ? vec3(0.25, 0.45, 0.95) : hh < 0.75 ? vec3(0.58, 0.34, 0.95) : vec3(0.92, 0.42, 0.78);
  float detail = smoothstep(0.25, 0.8, vK);
  vec3 base = mix(vec3(1.0, 0.6, 0.3), mix(bcol * 0.85, vec3(1.0, 0.62, 0.32), smoothstep(0.4, 0.9, groove)), detail);
  vec3 col = waxy(base, n, v, mix(1.0, stripe, detail));
  col += vec3(1.0, 0.5, 0.2) * uGlowK * (0.4 + 0.6 * h);
  col += vec3(0.55, 0.85, 1.0) * rim * 0.6;
  float fog = fogAmt(dist);
  col = mix(col, uHaze, min(fog, 0.9));
  float a = uAlpha * min(1.0, vK * 1.4 + 0.25) * (1.0 - smoothstep(0.85, 1.0, abs(vU)) * 0.6);
  gl_FragColor = vec4(col * a, a);
}
`;

// ---------------------------------------------------------------- membrane hint
export const memVert = /* glsl */ `
uniform float uCurv, uY;
varying vec3 vWP; varying vec2 vXZ;
void main() {
  vec3 p = position;
  p.y = uY - dot(p.xz, p.xz) * uCurv;
  vXZ = p.xz;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const memFrag = /* glsl */ `
precision highp float;
${COMMON}
uniform float uAlpha, uR, uHalo;
uniform vec4 uShadow[32];
uniform int uShadowN;
uniform vec3 uTint;
varying vec3 vWP; varying vec2 vXZ;
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float worley(vec2 p) {
  vec2 i = floor(p), f = fract(p); float m = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 o = hash22(i + g);
    o = 0.5 + 0.38 * sin(uTime * 0.15 + 6.2831 * o);
    m = min(m, length(g + o - f));
  }
  return m;
}
void main() {
  float rr = length(vXZ);
  float edge = 1.0 - smoothstep(0.2 * uR, 0.75 * uR, rr);
  edge *= edge;
  float a = uAlpha * edge;
  float mainSh = 1.0;
  for (int i = 0; i < 8; i++) {
    vec2 d = vXZ - uShadow[i].xz;
    mainSh *= 1.0 - 0.55 * exp(-dot(d, d) / (uShadow[i].w * uShadow[i].w));
  }
  float halo = uHalo * (1.0 - mainSh) * 0.8;
  if (a < 0.003 && halo < 0.003) discard;
  // outer-membrane proteins (porins) as soft domes, with fine lipopolysaccharide fuzz
  float w = worley(vXZ * 24.0);
  float dome = smoothstep(0.55, 0.05, w);
  float fz = vnoise(vec3(vXZ * 90.0, uTime * 0.05));
  float px = length(fwidth(vXZ)) * 90.0;
  float hgt = dome * 0.006 + fz * 0.002 * (1.0 - smoothstep(0.3, 1.0, px));
  vec3 dx = dFdx(vWP), dy = dFdy(vWP);
  vec3 n0 = normalize(cross(dy, dx));
  if (dot(n0, vec3(0, 1, 0)) < 0.0) n0 = -n0;
  vec3 r1 = cross(dy, n0), r2 = cross(n0, dx);
  float det = dot(dx, r1);
  vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  vec3 n = normalize(abs(det) * n0 - grad);
  float dist = length(cameraPosition - vWP);
  vec3 v = (cameraPosition - vWP) / dist;
  bool below = dot(v, n0) < 0.0;
  if (below) n = -n;
  vec3 base = uTint * (0.75 + 0.35 * dome) * (0.9 + 0.2 * fz);
  vec3 col = waxy(base, n, v, 0.75 + 0.25 * dome);
  float sh = 1.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uShadowN) break;
    vec4 s = uShadow[i];
    vec2 d = vXZ - s.xz;
    sh *= 1.0 - 0.55 * exp(-dot(d, d) / (s.w * s.w));
  }
  col *= sh;
  col = mix(col, uHaze, min(fogAmt(dist), 0.9));
  if (below) { a *= 0.45; halo = 0.0; }
  gl_FragColor = vec4(col * a, a) + vec4(0.0, 0.0, 0.0, halo * (1.0 - a));
}
`;

// ---------------------------------------------------------------- watery medium backdrop
export const backVert = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;
export const backFrag = /* glsl */ `
precision highp float;
uniform float uAlpha, uTime, uTanH, uAspect;
uniform mat3 uCamRot;
varying vec2 vNdc;
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 rd = normalize(uCamRot * vec3(vNdc.x * uTanH * uAspect, vNdc.y * uTanH, -1.0));
  float up = rd.y * 0.5 + 0.5;
  vec3 col = mix(vec3(0.006, 0.014, 0.022), vec3(0.016, 0.042, 0.056), smoothstep(0.1, 0.95, up));
  float m = vnoise(rd * 3.0 + vec3(0.0, uTime * 0.01, 0.0)) * 0.6 + vnoise(rd * 7.0 - vec3(uTime * 0.012)) * 0.4;
  col *= 0.75 + 0.5 * m;
  col += vec3(0.015, 0.04, 0.045) * pow(max(rd.y, 0.0), 3.0) * (0.6 + 0.4 * m);
  col += (hash13(vec3(gl_FragCoord.xy, 1.0)) - 0.5) * 0.003;
  gl_FragColor = vec4(max(col, 0.0) * uAlpha, uAlpha);
}
`;

// ---------------------------------------------------------------- motes
export const moteVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uBox, uDpr, uInten;
varying vec3 vCol; varying float vA;
void main() {
  vec3 p = (aSeed.xyz * 2.0 - 1.0) * uBox;
  float t = uTime * 0.2;
  p += 0.05 * uBox * vec3(sin(t + aSeed.w * 40.0), sin(t * 1.3 + aSeed.w * 61.0), sin(t * 0.8 + aSeed.w * 23.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  float base = 0.6 + 1.8 * fract(aSeed.w * 7.31);
  gl_PointSize = clamp(base * uDpr * (1.0 + 5.0 * exp(-d / (0.22 * uBox))), 1.0, 36.0 * uDpr);
  vCol = fract(aSeed.w * 13.7) > 0.9 ? vec3(1.0, 0.78, 0.5) : vec3(0.5, 0.75, 1.0);
  vA = uInten * exp(-d / (0.6 * uBox)) * (0.35 + 0.65 * fract(aSeed.w * 3.7)) / (1.0 + 4.0 * exp(-d / (0.22 * uBox)));
}
`;
export const moteFrag = /* glsl */ `
precision highp float;
varying vec3 vCol; varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r2 * 3.2) * vA, 0.0);
}
`;

// ---------------------------------------------------------------- spool cross-section on the cut plane
export const secVert = /* glsl */ `
uniform vec3 uCutDir; uniform vec3 uCutC; uniform float uSize; uniform mat4 uInv;
varying vec3 vWP; varying vec3 vLoc;
void main() {
  vec3 n = uCutDir;
  vec3 e1 = normalize(abs(n.y) < 0.95 ? cross(vec3(0.0, 1.0, 0.0), n) : cross(vec3(1.0, 0.0, 0.0), n));
  vec3 e2 = cross(n, e1);
  vec3 wp = uCutC - n * dot(uCutC, n) * 0.0 + (e1 * position.x + e2 * position.y) * uSize;
  vWP = wp;
  vLoc = (uInv * vec4(wp, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const secFrag = /* glsl */ `
precision highp float;
${COMMON}
uniform vec4 uFaces[30];
uniform vec3 uHC;        // head centre (phage-local)
uniform vec4 uSpool;     // r0, phi0, y0, layer spacing
uniform float uOriginHole;
varying vec3 vWP; varying vec3 vLoc;
void main() {
  vec3 rel = vLoc - uHC;
  float pd = -1.0;
  for (int i = 0; i < 30; i++) pd = max(pd, dot(uFaces[i].xyz, rel) - uFaces[i].w);
  if (pd > -0.006) discard;
  vec3 wc = vWP - uCutC;
  float rho2 = length(wc - uCutDir * dot(wc, uCutDir));
  if (rho2 > uCutR) discard;
  float LAY = uSpool.w;
  float rho = length(rel.xz);
  float phi = atan(rel.x, rel.z);
  float j = clamp(floor((rho - uSpool.x) / LAY + 0.5), -7.0, 6.0);
  float rj = uSpool.x + j * LAY;
  float aj = abs(j);
  float dir = mod(aj, 2.0) < 0.5 ? 1.0 : -1.0;
  float yoff = mod(aj, 2.0) * LAY * 0.5;
  float dphi = mod(dir * (phi - uSpool.y) + 3.14159265, 6.2831853) - 3.14159265;
  float yh = uSpool.z + yoff + LAY * dphi / 6.2831853;
  float cell = floor((rel.y - yh) / LAY + 0.5);
  float dy = rel.y - yh - cell * LAY;
  float wob = j < -2.0 ? 0.0012 * sin(phi * 9.0 + cell * 1.7 + j) : 0.0;
  vec2 q = vec2(rho - rj + wob, dy) / (LAY * 0.4);
  float r2 = dot(q, q);
  float dist = length(cameraPosition - vWP);
  vec3 v = (cameraPosition - vWP) / dist;
  // fade the edge of the packed region into the capsid wall
  float edge = smoothstep(-0.006, -0.02, pd);
  vec3 col;
  bool hole = j == 0.0 && cell == 0.0 && abs(dphi) < 1.0 && length(vWP) < uOriginHole;
  if (r2 < 1.0 && rj > 0.012 && !hole) {
    // a strand cut end-on: shaded like a small dome, banded with the DNA base colours
    float h = sqrt(1.0 - r2);
    vec3 e1 = normalize(cross(uCutDir, vec3(0.0, 1.0, 0.0)) + 1e-4);
    vec3 n = normalize(uCutDir * h + (e1 * q.x + cross(uCutDir, e1) * q.y) * 0.8);
    float hh = hash12(vec2(j * 31.0 + cell, floor(phi * 40.0)));
    vec3 bcol = hh < 0.25 ? vec3(0.12, 0.72, 0.74) : hh < 0.5 ? vec3(0.25, 0.45, 0.95) : hh < 0.75 ? vec3(0.58, 0.34, 0.95) : vec3(0.92, 0.42, 0.78);
    vec3 base = mix(bcol, vec3(1.0, 0.62, 0.32), smoothstep(0.35, 0.75, sqrt(r2)));
    col = waxy(base, n, v, 0.7 + 0.3 * h) + vec3(1.0, 0.5, 0.2) * 0.12 * h;
    col *= edge * 0.85 + 0.15;
  } else {
    col = vec3(0.03, 0.02, 0.05) + vec3(0.25, 0.12, 0.05) * 0.08 * exp(-r2 * 0.6);
  }
  col = mix(col, uHaze, min(fogAmt(dist), 0.9));
  gl_FragColor = vec4(col, 1.0);
}
`;
