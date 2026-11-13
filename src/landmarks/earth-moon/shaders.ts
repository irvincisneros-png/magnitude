/** Earth–Moon shaders. 1 unit = 384,400 km. */

const noise = /* glsl */ `
  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  vec3 hash33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

// ------------------------------------------------------------------ Moon
export const moonVert = /* glsl */ `
  varying vec3 vObj; varying vec3 vNw; varying vec3 vWpos;
  void main() {
    vObj = position;
    vNw = mat3(modelMatrix) * normal;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWpos = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const moonFrag = /* glsl */ `
  precision highp float;
  ${noise}
  uniform vec3 uSun; uniform vec3 uEarthDir; uniform float uEarthLit; uniform float uPx; uniform float uBump;
  uniform vec4 uMare[14]; uniform vec4 uRay[4]; uniform float uOpacity;
  varying vec3 vObj; varying vec3 vNw; varying vec3 vWpos;

  // x = height, y = fresh-ejecta brightness
  vec2 craterLayer(vec3 p, float f, float seed, float dens) {
    vec3 q = p * f; vec3 i = floor(q); float h = 0.0, b = 0.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 g = i + vec3(float(x), float(y), float(z));
      vec3 r = hash33(g + seed);
      if (r.x > dens) continue;
      vec3 c = g + 0.5 + (hash33(g * 1.7 + seed + 3.0) - 0.5) * 0.7;
      float rad = 0.2 + 0.28 * r.z;
      float t = length(q - c) / rad;
      float bowl = -smoothstep(1.0, 0.15, t) * 0.9;
      float rim = 0.45 * exp(-pow((t - 1.02) / 0.16, 2.0));
      h += (bowl + rim) * (0.5 + 0.5 * r.y);
      float fresh = step(0.78, r.y);
      b += fresh * (exp(-pow((t - 1.25) / 0.45, 2.0)) * 0.55 + 0.25 * (1.0 - smoothstep(0.0, 1.0, t)));
    }
    return vec2(h, b);
  }

  float mareMask(vec3 d, float warp) {
    float m = 0.0;
    for (int i = 0; i < 14; i++) {
      vec4 c = uMare[i];
      float a = acos(clamp(dot(d, c.xyz), -1.0, 1.0)) / c.w;
      m = max(m, 1.0 - smoothstep(0.72, 1.0, a + warp));
    }
    return m;
  }

  float rays(vec3 d, vec4 c, float seed) {
    float cd = clamp(dot(d, c.xyz), -1.0, 1.0);
    float ang = acos(cd);
    if (ang > 1.4) return 0.0;
    vec3 b1 = normalize(cross(c.xyz, vec3(0.0, 1.0, 0.0)));
    vec3 b2 = cross(c.xyz, b1);
    vec3 v = d - c.xyz * cd;
    float az = atan(dot(v, b2), dot(v, b1));
    float n = vnoise(vec3(az * 5.0 + seed, seed * 3.0, 0.5)) * 0.65 + vnoise(vec3(az * 17.0, seed, 1.5)) * 0.35;
    float ray = smoothstep(0.52, 0.78, n);
    float fall = exp(-ang * c.w) * smoothstep(0.012, 0.05, ang);
    float spot = exp(-pow(ang / 0.035, 2.0));
    return (ray * fall * 0.7 + spot * 0.8);
  }

  float heightField(vec3 d, out float fresh, float cut) {
    float h = 0.0; fresh = 0.0;
    float R = 0.00452;
    vec2 c0 = craterLayer(d, 2.6, 1.0, 0.30);
    float w0 = smoothstep(0.5, 2.0, uPx / 2.6) * cut;
    h += c0.x * w0 * R / 2.6 * 0.9; fresh += c0.y * w0 * 0.5;
    vec2 c1 = craterLayer(d, 6.0, 7.0, 0.38);
    float w1 = smoothstep(0.8, 2.5, uPx / 6.0);
    h += c1.x * w1 * R / 6.0 * 0.9; fresh += c1.y * w1 * 0.6;
    vec2 c2 = craterLayer(d, 14.0, 17.0, 0.42);
    float w2 = smoothstep(0.9, 2.8, uPx / 14.0);
    h += c2.x * w2 * R / 14.0 * 0.9; fresh += c2.y * w2 * 0.7;
    vec2 c3 = craterLayer(d, 33.0, 29.0, 0.45);
    float w3 = smoothstep(1.0, 3.0, uPx / 33.0);
    h += c3.x * w3 * R / 33.0 * 0.9; fresh += c3.y * w3 * 0.8;
    vec2 c4 = craterLayer(d, 74.0, 41.0, 0.5);
    float w4 = smoothstep(1.0, 3.0, uPx / 74.0);
    h += c4.x * w4 * R / 74.0 * 0.9; fresh += c4.y * w4 * 0.8;
    return h;
  }

  void main() {
    vec3 d = normalize(vObj);
    vec3 Ng = normalize(vNw);
    vec3 V = normalize(cameraPosition - vWpos);
    float large = fbm(d * 2.6 + 1.7);
    float warp = (large - 0.5) * 0.7;
    float mare = mareMask(d, warp);
    // sparse far-side patches
    float farPatch = smoothstep(0.66, 0.74, fbm(d * 3.7 + 9.0)) * 0.55 * smoothstep(-0.4, 0.5, d.z);
    mare = max(mare, farPatch);

    float fresh;
    float h = heightField(d, fresh, 1.0 - 0.0 * mare);
    h *= 1.0 - 0.55 * mare; fresh *= 1.0 - 0.6 * mare;

    float mott = fbm(d * 9.0 + 3.0);
    vec3 high = vec3(0.46, 0.445, 0.425) * (0.82 + 0.34 * mott);
    vec3 low = vec3(0.085, 0.085, 0.098) * (0.8 + 0.4 * fbm(d * 6.0 + 21.0));
    low = mix(low, low * vec3(0.9, 1.0, 1.18), smoothstep(0.4, 0.7, fbm(d * 3.0 + 5.0)) * 0.7); // bluer titanium-rich mare
    vec3 alb = mix(high, low, mare);
    alb *= 1.0 - 0.12 * smoothstep(0.0, -0.0006, h) * smoothstep(0.0, 1.0, uPx / 10.0); // crater floors a touch darker
    float rr = 0.0;
    for (int i = 0; i < 4; i++) rr += rays(d, uRay[i], float(i) * 7.3 + 1.0);
    alb += vec3(1.0, 0.98, 0.94) * (rr * 0.42 * (1.0 - mare * 0.55) + fresh * 0.18);
    alb = clamp(alb, 0.0, 1.0);

    // bump mapping from the crater field
    vec3 n = Ng;
    if (uBump > 0.0) {
      vec3 dpx = dFdx(vWpos), dpy = dFdy(vWpos);
      float dhx = dFdx(h), dhy = dFdy(h);
      vec3 r1 = cross(dpy, Ng), r2 = cross(Ng, dpx);
      float det = dot(dpx, r1);
      vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
      n = normalize(abs(det) * Ng - grad * uBump);
    }

    vec3 L = normalize(uSun);
    float ndl = max(dot(n, L), 0.0) * smoothstep(-0.01, 0.05, dot(Ng, L));
    float ndv = max(dot(Ng, V), 0.02);
    float I = 2.0 * ndl / (ndl + ndv);              // Lommel–Seeliger: flat full Moon
    float sunE = 0.78;
    vec3 shine = vec3(0.72, 0.86, 1.0) * uEarthLit * 0.045 * max(dot(n, uEarthDir), 0.0);
    vec3 col = alb * (sunE * I + shine);
    float edge = smoothstep(0.0, clamp(1.3 / sqrt(max(uPx, 1.0)), 0.0, 1.0), dot(Ng, V));
    float a = edge * uOpacity;
    gl_FragColor = vec4(col * a, a);
  }`;

// ------------------------------------------------------------------ shaded sprite (floor for tiny Moon / Earth)
export const spriteVert = /* glsl */ `
  uniform vec3 uPos; uniform float uR; uniform float uHalo; uniform float uDpr;
  varying float vK;
  void main() {
    gl_Position = projectionMatrix * viewMatrix * vec4(uPos, 1.0);
    gl_PointSize = 2.0 * (uR + uHalo) * uDpr;
    vK = (uR + uHalo) / uR;
  }`;

export const spriteFrag = /* glsl */ `
  uniform vec3 uCol; uniform vec3 uHaloCol; uniform vec3 uL; uniform float uR; uniform float uDpr; uniform float uAmt; uniform float uShine; uniform float uHaloAmt;
  varying float vK;
  void main() {
    vec2 q = (gl_PointCoord * 2.0 - 1.0) * vK;
    float r = length(q);
    float fw = 0.8 / (uR * uDpr);
    float disc = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, r);
    vec3 n = vec3(q.x, -q.y, sqrt(max(0.0, 1.0 - r * r)));
    float ndl = dot(n, uL);
    float I = 2.0 * max(ndl, 0.0) / (max(ndl, 0.0) + max(n.z, 0.05));
    I *= smoothstep(-0.02, 0.05, ndl);
    vec3 c = uCol * (I * 0.8 + uShine * 0.05);
    float halo = exp(-max(r - 1.0, 0.0) * 2.2 * uR / 2.0) * (1.0 - disc) * (1.0 - smoothstep(vK * 0.8, vK, r));
    vec3 outc = c * disc + uHaloCol * halo * uHaloAmt;
    gl_FragColor = vec4(outc * uAmt, 0.0);
  }`;

// ------------------------------------------------------------------ Earth proxy (zoomed-out end)
export const earthVert = /* glsl */ `
  varying vec3 vObj; varying vec3 vNw; varying vec3 vWpos;
  void main() {
    vObj = position; vNw = mat3(modelMatrix) * normal;
    vec4 w = modelMatrix * vec4(position, 1.0); vWpos = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const earthFrag = /* glsl */ `
  precision highp float;
  ${noise}
  uniform vec3 uSun; uniform float uOpacity; uniform float uTime;
  varying vec3 vObj; varying vec3 vNw; varying vec3 vWpos;
  void main() {
    vec3 d = normalize(vObj); vec3 N = normalize(vNw); vec3 V = normalize(cameraPosition - vWpos);
    float c = fbm(d * 2.3 + 4.0) + 0.35 * fbm(d * 6.0);
    float land = smoothstep(0.62, 0.68, c);
    vec3 ocean = vec3(0.012, 0.055, 0.19);
    vec3 ground = mix(vec3(0.07, 0.13, 0.04), vec3(0.28, 0.2, 0.1), smoothstep(0.4, 0.8, fbm(d * 5.0 + 2.0)));
    ground = mix(ground, vec3(0.8, 0.82, 0.85), smoothstep(0.82, 0.92, abs(d.y)));
    vec3 alb = mix(ocean, ground, land);
    float cl = smoothstep(0.55, 0.75, fbm(d * 3.4 + vec3(uTime * 0.01, 3.0, 0.0)));
    alb = mix(alb, vec3(0.92), cl * 0.85);
    float ndl = dot(N, normalize(uSun));
    float day = smoothstep(-0.05, 0.25, ndl);
    vec3 col = alb * max(ndl, 0.0) * 4.2;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 atm = vec3(0.22, 0.45, 1.0) * fres * (0.25 + 1.6 * smoothstep(-0.35, 0.5, ndl));
    col += atm;
    col += vec3(0.9, 0.5, 0.25) * fres * 0.4 * smoothstep(0.25, 0.0, abs(ndl));   // warm terminator rim
    float a = smoothstep(0.0, 0.5, dot(N, V)) * uOpacity;
    gl_FragColor = vec4(col * a, a);
  }`;

// ------------------------------------------------------------------ orbit ribbons
export const ribbonVert = /* glsl */ `
  uniform vec2 uRes; uniform float uHalf; uniform float uNear;
  attribute vec3 aNext; attribute vec3 aInfo;
  varying float vSide; varying float vU;
  vec4 clipTo(vec4 a, vec4 b) {
    if (a.w >= uNear) return a;
    return mix(a, b, (uNear - a.w) / max(b.w - a.w, 1e-9));
  }
  void main() {
    mat4 vp = projectionMatrix * viewMatrix;
    vec4 c0 = vp * vec4(position, 1.0);
    vec4 c1 = vp * vec4(aNext, 1.0);
    if (c0.w < uNear && c1.w < uNear) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vSide = 0.0; vU = 0.0; return; }
    vec4 a0 = clipTo(c0, c1), a1 = clipTo(c1, c0);
    vec4 cC = aInfo.y < 0.5 ? a0 : a1;
    vec2 d = (a1.xy / a1.w - a0.xy / a0.w) * uRes * 0.5;
    float L = length(d);
    d = L > 1e-6 ? d / L : vec2(1.0, 0.0);
    vec2 perp = vec2(-d.y, d.x);
    vec2 off = perp * aInfo.x * uHalf * 2.0 / uRes;
    gl_Position = vec4(cC.xy + off * cC.w, cC.z, cC.w);
    vSide = aInfo.x; vU = aInfo.z;
  }`;

export const ribbonFrag = /* glsl */ `
  uniform float uHalf; uniform float uDpr; uniform float uMoonU; uniform float uAlpha; uniform float uDark;
  uniform float uTicksN; uniform float uTrail; uniform vec3 uCol;
  varying float vSide; varying float vU;
  void main() {
    float d = abs(vSide) * uHalf / uDpr;
    float line = exp(-d * d / 0.30);
    float glow = exp(-d * d / 6.0);
    float b = 0.10, trail = 0.0;
    if (uTrail > 0.0) {
      float behind = fract(uMoonU - vU);
      float ahead = fract(vU - uMoonU);
      trail = exp(-behind * 4.5);
      b = 0.085 + uTrail * (1.3 * trail + 0.5 * exp(-ahead * 40.0));
    }
    float tick = 0.0;
    if (uTicksN > 0.0) {
      float x = vU * uTicksN;
      float fw = max(fwidth(x), 1e-6);
      float along = abs(fract(x + 0.5) - 0.5) / fw / uDpr;
      float wk = abs(fract(x / 7.0 + 0.5) - 0.5) / (fw / 7.0) / uDpr;
      float len = 2.5 + 1.0 * (1.0 - smoothstep(0.5, 1.2, wk));
      tick = (1.0 - smoothstep(0.3, 0.8, along)) * (1.0 - smoothstep(len - 0.8, len, d));
      tick *= smoothstep(4.0, 12.0, 1.0 / fw / uDpr);
    }
    float I = (line * b + glow * 0.10 * b + tick * (0.45 + 0.9 * trail)) * uAlpha;
    vec3 navy = vec3(0.02, 0.06, 0.16);
    vec3 col = mix(uCol, navy, uDark) * I;
    float a = min(1.0, I) * uDark * 0.85;
    gl_FragColor = vec4(col, a);
  }`;

// ------------------------------------------------------------------ satellites
export const satVert = /* glsl */ `
  uniform float uDays; uniform float uDpr; uniform float uOpacity; uniform float uSize;
  uniform vec3 uEx; uniform vec3 uEy; uniform vec3 uP;
  attribute vec4 aOrb; attribute vec3 aRB;
  varying float vB; varying vec3 vC;
  void main() {
    float u = aOrb.w + 6.2831853 * aRB.x * uDays;
    float cn = cos(aOrb.z), sn = sin(aOrb.z), ci = cos(aOrb.y), si = sin(aOrb.y);
    vec3 nd = cn * uEx + sn * uEy;
    vec3 q = -sn * uEx + cn * uEy;
    vec3 pos = aOrb.x * (cos(u) * nd + sin(u) * (ci * q + si * uP));
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
    gl_PointSize = uSize * uDpr * (0.8 + 0.6 * aRB.y);
    vB = aRB.y * uOpacity;
    vC = aRB.z > 1.5 ? vec3(1.0, 0.72, 0.42) : (aRB.z > 0.5 ? vec3(0.6, 0.9, 1.0) : vec3(1.0, 0.96, 0.9));
  }`;

export const dotFrag = /* glsl */ `
  varying float vB; varying vec3 vC;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    float a = exp(-r2 * 4.5) * (1.0 - smoothstep(0.7, 1.0, r2));
    gl_FragColor = vec4(vC * a * vB, 0.0);
  }`;

// ------------------------------------------------------------------ beads (30 Earths)
export const beadVert = /* glsl */ `
  uniform vec3 uDir; uniform float uStep; uniform float uProj; uniform float uOpacity;
  attribute float aK;
  varying float vA;
  void main() {
    vec3 p = uDir * (aK * uStep);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uStep * uProj / max(-mv.z, 1e-4), 1.0, 480.0);
    vA = uOpacity;
  }`;

export const beadFrag = /* glsl */ `
  uniform vec3 uL; varying float vA;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = length(q);
    float fw = max(fwidth(r), 1e-4);
    float disc = 1.0 - smoothstep(1.0 - fw, 1.0, r);
    float rim = smoothstep(1.0 - 2.4 * fw, 1.0 - 1.2 * fw, r) * disc;   // ~1.2 px outline whatever the size
    vec3 n = vec3(q.x, -q.y, sqrt(max(0.0, 1.0 - r * r)));
    float lit = 0.5 + 0.5 * max(dot(n, uL), 0.0);
    float a = (0.035 * disc + 0.22 * rim) * lit;
    gl_FragColor = vec4(vec3(0.42, 0.65, 1.0) * a * vA, 0.0);
  }`;

// ------------------------------------------------------------------ light pulse
export const pulseVert = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB; uniform float uF; uniform float uDir; uniform float uDpr; uniform float uOpacity;
  attribute float aK;
  varying float vB;
  void main() {
    float k = aK / 23.0;
    float s = uF - uDir * aK * 0.0045;
    if (uF < 0.0 || s < 0.0 || s > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vB = 0.0; return; }
    vec3 p = mix(uA, uB, s);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    gl_PointSize = mix(7.0, 2.0, k) * uDpr;
    vB = pow(1.0 - k, 1.6) * uOpacity;
  }`;

export const pulseFrag = /* glsl */ `
  varying float vB;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    float a = (exp(-r2 * 5.0) + 0.6 * exp(-r2 * 22.0)) * (1.0 - smoothstep(0.7, 1.0, r2));
    gl_FragColor = vec4(vec3(1.0, 0.88, 0.58) * a * vB * 1.7, 0.0);
  }`;

// ------------------------------------------------------------------ shadow cones
export const coneVert = /* glsl */ `
  varying float vH; varying vec3 vN; varying vec3 vW;
  void main() {
    vH = position.y;
    vN = mat3(modelMatrix) * normal;
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const coneFrag = /* glsl */ `
  uniform float uOpacity; uniform float uStrength;
  varying float vH; varying vec3 vN; varying vec3 vW;
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    float facing = abs(dot(normalize(vN), V));
    float feather = pow(facing, 2.2);                       // soft, no hard silhouette
    float fall = pow(1.0 - clamp(vH, 0.0, 1.0), 1.2);
    float k = fall * feather * uOpacity * uStrength;
    vec3 glow = vec3(0.45, 0.16, 0.12) * 0.006 * k;        // faint reddish tint
    float a = 0.10 * k;
    gl_FragColor = vec4(glow, a);
  }`;
