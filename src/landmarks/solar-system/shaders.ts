/** GLSL for the Solar System landmark. All layers are additive HDR, depth-test free, screen-space aware. */

export const quadVert = /* glsl */ `
  varying vec3 vWorld; varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** Same starburst glare as the Sun landmark so the hand-over is seamless. */
export const glareFrag = /* glsl */ `
  uniform float uGlare;
  varying vec2 vUv;
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    if (r > 1.0) discard;
    float ang = atan(q.y, q.x);
    float core = exp(-r * r * 900.0) * 30.0;
    float halo = 0.35 / (1.0 + pow(r * 26.0, 2.0)) + 0.06 / (1.0 + pow(r * 7.0, 2.0));
    float sp = pow(abs(cos(ang * 2.0 + 0.4)), 900.0) + 0.5 * pow(abs(cos(ang * 2.0 + 1.185)), 1400.0);
    float spikes = sp * exp(-r * 7.0) * 0.55;
    float fall = 1.0 - smoothstep(0.7, 1.0, r);
    vec3 col = vec3(1.0, 0.9, 0.76) * (core + halo + spikes) * fall * uGlare;
    gl_FragColor = vec4(col, 0.0);
  }`;

/** The resolved Sun at the bottom of the range: limb-darkened HDR disc. */
export const discFrag = /* glsl */ `
  uniform float uA;
  varying vec2 vUv;
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    if (r > 1.0) discard;
    float mu = sqrt(max(0.0, 1.0 - r * r));
    float limb = 1.0 - 0.62 * (1.0 - mu) - 0.12 * (1.0 - mu) * (1.0 - mu);
    vec3 col = mix(vec3(1.0, 0.62, 0.30), vec3(1.0, 0.93, 0.80), mu) * limb * 4.0;
    gl_FragColor = vec4(col * smoothstep(1.0, 0.9, r) * uA, 0.0);
  }`;

/** Faint in-plane zodiacal dust: a glow that hugs the ecliptic and thins outward. */
export const zodiFrag = /* glsl */ `
  uniform float uA; uniform float uAU; uniform float uTime;
  varying vec3 vWorld;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float r = length(vWorld.xz) / uAU;       // AU
    float I = 0.05 * pow(1.0 + r / 0.30, -2.05);
    float ang = atan(vWorld.z, vWorld.x);
    float m = 0.78 + 0.22 * n2(vec2(ang * 2.2, log(r + 0.05) * 2.0));
    float edge = 1.0 - smoothstep(60.0, 160.0, r);
    vec3 col = mix(vec3(1.0, 0.72, 0.45), vec3(0.75, 0.82, 1.0), smoothstep(0.2, 6.0, r)) * I * m * edge * uA;
    gl_FragColor = vec4(col, 0.0);
  }`;

/** Screen-space ribbon for orbit lines: constant pixel width, soft glow, brighter comet trail behind the planet. */
export const orbitVert = /* glsl */ `
  uniform vec2 uRes; uniform float uHalf; uniform float uTrailLen; uniform float uNear;
  uniform float uPhase[18]; uniform float uAlpha[18];
  attribute vec3 aNext; attribute float aEnd; attribute vec4 aInfo; attribute vec3 aCol;
  varying float vSide; varying vec3 vCol; varying float vTrail; varying float vA; varying float vE; varying float vRing;
  vec4 clipTo(vec4 a, vec4 b) {
    if (a.w >= uNear) return a;
    return mix(a, b, (uNear - a.w) / max(b.w - a.w, 1e-9));
  }
  void main() {
    mat4 vp = projectionMatrix * viewMatrix;
    vec4 c0 = vp * vec4(position, 1.0);
    vec4 c1 = vp * vec4(aNext, 1.0);
    if (c0.w < uNear && c1.w < uNear) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vSide = 0.0; vCol = vec3(0.0); vTrail = 0.0; vA = 0.0; vE = 0.0; vRing = 0.0; return;
    }
    vec4 a0 = clipTo(c0, c1), a1 = clipTo(c1, c0);
    vec4 cC = aEnd < 0.5 ? a0 : a1;
    vec2 d = (a1.xy / a1.w - a0.xy / a0.w) * uRes * 0.5;
    float L = length(d);
    d = L > 1e-6 ? d / L : vec2(1.0, 0.0);
    vec2 perp = vec2(-d.y, d.x);
    vec2 off = perp * aInfo.x * uHalf * 2.0 / uRes;
    gl_Position = vec4(cC.xy + off * cC.w, cC.z, cC.w);
    int idx = int(aInfo.y + 0.5);
    float behind = mod(uPhase[idx] - aInfo.z, 6.2831853);
    float ring = step(aInfo.w, 0.0);
    vTrail = pow(max(0.0, 1.0 - behind / uTrailLen), 2.2) * (1.0 - ring);
    vSide = aInfo.x; vE = aInfo.z; vRing = ring;
    vCol = aCol * abs(aInfo.w);
    vA = uAlpha[idx];
  }`;

export const orbitFrag = /* glsl */ `
  uniform float uHalf; uniform float uDpr;
  varying float vSide; varying vec3 vCol; varying float vTrail; varying float vA; varying float vE; varying float vRing;
  void main() {
    float d = abs(vSide) * uHalf / uDpr;               // css px from the line centre
    if (vRing > 0.5) {
      float fd = fract(vE * 19.0);
      float dash = smoothstep(0.0, 0.1, fd) * (1.0 - smoothstep(0.55, 0.65, fd));
      float line = exp(-d * d / 0.4) + 0.2 * exp(-d * d / 5.0);
      gl_FragColor = vec4(vCol * line * vA * (0.25 + 0.75 * dash), 0.0);
      return;
    }
    float core = exp(-d * d / 0.55);
    float glow = exp(-d * d / 5.5);
    float k = 0.28 + 2.3 * vTrail;
    vec3 col = vCol * (core * k + glow * (0.10 + 0.9 * vTrail)) * vA;
    col += vec3(1.0) * core * vTrail * vTrail * 0.3 * vA;
    gl_FragColor = vec4(col, 0.0);
  }`;

/** Keplerian dust/rock particles: positions solved in the vertex shader from orbital elements. */
export const bodyVert = /* glsl */ `
  uniform float uTime; uniform float uAU; uniform float uDpr; uniform float uSize; uniform float uGain;
  uniform vec3 uEx; uniform vec3 uEy; uniform vec3 uEz;
  attribute vec4 aA;   // a (AU), e, M0, argument of perihelion
  attribute vec4 aB;   // inclination, node, random, size multiplier
  varying float vI;
  void main() {
    float a = aA.x, e = aA.y;
    float M = aA.z + 6.2831853 * uTime * pow(a, -1.5);
    float E = M + e * sin(M);
    for (int k = 0; k < 4; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    float xp = a * (cos(E) - e), yp = a * sqrt(1.0 - e * e) * sin(E);
    float cw = cos(aA.w), sw = sin(aA.w);
    float x1 = xp * cw - yp * sw, y1 = xp * sw + yp * cw;
    float ci = cos(aB.x), si = sin(aB.x);
    float y2 = y1 * ci, z2 = y1 * si;
    float cO = cos(aB.y), sO = sin(aB.y);
    float X = x1 * cO - y2 * sO, Y = x1 * sO + y2 * cO;
    vec3 p = (uEx * X + uEy * Y + uEz * z2) * uAU;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    float sm = aB.w;
    gl_PointSize = min(uSize * sm * uDpr, 120.0);
    vI = uGain * (0.55 + 0.9 * aB.z) / (sm * sm);
  }`;

export const bodyFrag = /* glsl */ `
  uniform vec3 uTint;
  varying float vI;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float f = exp(-r2 * 4.5) * (1.0 - r2);
    gl_FragColor = vec4(uTint * vI * f, 0.0);
  }`;

/** Static sparkle points (Oort cloud). Position is given directly. */
export const dustVert = /* glsl */ `
  uniform float uDpr; uniform float uSize; uniform float uGain;
  attribute float aR;
  varying float vI;
  void main() {
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uDpr * (0.8 + 0.8 * aR);
    vI = uGain * (0.35 + 1.0 * aR * aR);
  }`;

/** Distant backdrop stars: placed on a sphere around the camera. */
export const skyVert = /* glsl */ `
  uniform float uR; uniform float uDpr; uniform float uFade;
  attribute vec4 aSky;  // brightness, tint, size, unused
  varying float vI; varying float vT;
  void main() {
    vec3 v = mat3(viewMatrix) * position * uR;
    gl_Position = projectionMatrix * vec4(v, 1.0);
    gl_PointSize = (1.2 + aSky.z * 1.6) * uDpr;
    vI = aSky.x * 0.55 * uFade; vT = aSky.y;
  }`;
export const skyFrag = /* glsl */ `
  varying float vI; varying float vT;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    vec3 tint = mix(vec3(1.0, 0.82, 0.65), vec3(0.72, 0.82, 1.0), vT);
    gl_FragColor = vec4(tint * vI * exp(-r2 * 3.0), 0.0);
  }`;

/** Real nearby stars, identical brightness law to the Milky Way scene so the hand-over matches. */
export const starVert = /* glsl */ `
  uniform float uE; uniform float uDpr; uniform float uFade; uniform float uSpikes; uniform float uUnitLy;
  attribute vec3 aCol; attribute float aLum;
  varying vec3 vCol; varying float vI; varying float vPx; varying float vSpk;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dly = max(-mv.z, 1e-9) * uUnitLy;
    float b = aLum / (dly * dly) * uE;
    float I = 0.55 * pow(b, 0.42);
    float px = clamp(2.4 + 2.6 * pow(b, 0.2), 2.4, 60.0) * uDpr;
    vI = min(I, 40.0) * uFade;
    vCol = aCol; vPx = px;
    vSpk = smoothstep(3.0, 18.0, I) * uSpikes;
    gl_PointSize = px;
    if (mv.z >= 0.0 || vI < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;

export const starFrag = /* glsl */ `
  uniform float uDpr;
  varying vec3 vCol; varying float vI; varying float vPx; varying float vSpk;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float rpx = sqrt(r2) * vPx * 0.5 / uDpr;
    float core = exp(-rpx * rpx / 0.9);
    float halo = exp(-r2 * 6.0) * 0.12 + 0.025 / (1.0 + r2 * 60.0);
    float spk = (exp(-abs(c.x) * vPx * 0.35) * exp(-c.y * c.y * 3.0) + exp(-abs(c.y) * vPx * 0.35) * exp(-c.x * c.x * 3.0)) * vSpk * 0.22;
    float edge = 1.0 - r2;
    float k = (core + (halo + spk) * min(vI, 6.0) / max(vI, 1e-3)) * edge;
    vec3 col = mix(vec3(1.0), vCol, clamp(1.4 - core * 0.6, 0.0, 1.0)) * vI * k;
    gl_FragColor = vec4(col, 0.0);
  }`;

/** Planet beads: small lit spheres with a halo, constant size in screen pixels. */
export const beadVert = /* glsl */ `
  uniform float uDpr; uniform vec2 uRes;
  attribute vec3 aCol; attribute float aSize; attribute float aFade;
  varying vec3 vCol; varying float vFade; varying vec2 vSun;
  void main() {
    mat4 vp = projectionMatrix * viewMatrix;
    vec4 c = vp * vec4(position, 1.0);
    vec4 o = vp * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 sd = (o.xy / max(o.w, 1e-5) - c.xy / max(c.w, 1e-5)) * uRes;
    vSun = length(sd) > 1e-3 ? normalize(sd) : vec2(0.0, 1.0);
    vCol = aCol; vFade = aFade;
    gl_Position = c;
    gl_PointSize = aSize * 3.2 * uDpr;
  }`;
export const beadFrag = /* glsl */ `
  varying vec3 vCol; varying float vFade; varying vec2 vSun;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0; p.y = -p.y;
    float r = length(p) * 3.2;
    if (r > 3.2) discard;
    float disc = smoothstep(1.0, 0.78, r);
    vec3 n = vec3(p * 3.2, sqrt(max(0.0, 1.0 - r * r)));
    vec3 L = normalize(vec3(vSun * 0.85, 0.5));
    float dif = max(dot(n, L), 0.0) * 0.9 + 0.12;
    float rim = pow(1.0 - n.z, 3.0) * 0.25;
    float halo = exp(-r * r * 0.30) * 0.30 + exp(-r * 0.9) * 0.10;
    halo *= 1.0 - smoothstep(2.2, 3.2, r);
    vec3 col = vCol * (dif * disc * 1.5 + rim * disc) + vCol * halo;
    gl_FragColor = vec4(col * vFade, 0.0);
  }`;

/** Faint comet-shaped heliosphere: fresnel shell. */
export const helioVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying float vT;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalMatrix * normal;
    vV = -mv.xyz;
    vT = position.x;
    gl_Position = projectionMatrix * mv;
  }`;
export const helioFrag = /* glsl */ `
  uniform float uA;
  varying vec3 vN; varying vec3 vV; varying float vT;
  void main() {
    float ndv = abs(dot(normalize(vN), normalize(vV)));
    float f = pow(1.0 - ndv, 2.6);
    vec3 col = mix(vec3(0.30, 0.45, 0.95), vec3(0.55, 0.78, 1.0), f);
    gl_FragColor = vec4(col * (0.002 + 0.10 * f) * uA, 0.0);
  }`;

/** Guide line with a fade along its length (aT 0..1). */
export const guideVert = /* glsl */ `
  attribute float aT; varying float vT;
  void main() { vT = aT; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
export const guideFrag = /* glsl */ `
  uniform float uA; uniform vec3 uCol; varying float vT;
  void main() { gl_FragColor = vec4(uCol * uA * (0.25 + 0.75 * (1.0 - vT)), 0.0); }`;

/** Oort cloud + Hills cloud as analytic haze: a fullscreen ray pass, hollow shells, limb-brightened. */
export const hazeVert = /* glsl */ `
  varying vec2 vN;
  void main() { vN = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
export const hazeFrag = /* glsl */ `
  uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPos;
  uniform float uShell; uniform float uHills; uniform float uAU; uniform float uDpr;
  varying vec2 vN;
  float seg(vec3 o, vec3 d, float R, float f) {
    vec3 sc = vec3(1.0, 1.0 / f, 1.0);
    vec3 op = o * sc, dp = d * sc;
    float A = dot(dp, dp), B = dot(op, dp), C = dot(op, op) - R * R;
    float disc = B * B - A * C;
    if (disc <= 0.0) return 0.0;
    float q = sqrt(disc);
    float t1 = (-B - q) / A, t2 = (-B + q) / A;
    return max(t2, 0.0) - max(t1, 0.0);
  }
  float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    vec4 v = uInvProj * vec4(vN, 1.0, 1.0);
    vec3 d = normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
    vec3 o = uCamPos;
    float RO = 100000.0 * uAU, RI = 30000.0 * uAU;
    float cs = (seg(o, d, RO, 1.0) - seg(o, d, RI, 1.0)) / RO;
    float HO = 20000.0 * uAU, HI = 2000.0 * uAU;
    float ch = (seg(o, d, HO, 0.38) - seg(o, d, HI, 0.38)) / HO;
    // tiny uniform icy specks, tied to direction so they do not swim
    float sp = step(0.9965, h31(floor(d * 900.0))) * 0.5;
    float shell = pow(max(cs, 0.0), 1.8) * 0.018 * uShell;
    float hills = max(ch, 0.0) * 0.03 * uHills;
    vec3 col = vec3(0.50, 0.68, 1.0) * (shell * (1.0 + sp * 1.2) + hills * (1.0 + sp * 1.0));
    gl_FragColor = vec4(col, 0.0);
  }`;

/** Heliotail: particles streaming down the long tail, flowing away from the nose. */
export const tailVert = /* glsl */ `
  uniform float uTime; uniform float uDpr; uniform vec3 uAxis; uniform vec3 uP; uniform vec3 uQ; uniform float uAU; uniform float uGain;
  attribute vec4 aT;   // phase, radial fraction, angle, brightness
  varying float vI;
  void main() {
    float s = fract(aT.x + uTime * 0.012);
    float rad = (110.0 + 220.0 * s) * aT.y * uAU;
    float ang = aT.z * 6.2831853;
    float len = (60.0 + 780.0 * s) * uAU;
    vec3 p = uAxis * len + (uP * cos(ang) + uQ * sin(ang)) * rad;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    gl_PointSize = 1.6 * uDpr;
    vI = uGain * aT.w * smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.55, 1.0, s));
  }`;
