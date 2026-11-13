/** GLSL for the Omega Centauri landmark. */

/** Individual stars: GPU-animated (slow cluster rotation + tiny per-star orbital drift). */
export const starVert = /* glsl */ `
  uniform float uTime;
  uniform float uDpr;
  uniform float uSpin;       // cluster rotation rate (rad/s) at the centre
  uniform float uCamDist;    // camera distance from the origin
  uniform float uGainF;      // gain for faint stars
  uniform float uGainB;      // gain for bright stars
  uniform float uHold;       // 0..1: keep the centre calm when zoomed right in (so the child stays visible)
  uniform float uSpikes;
  uniform float uW;          // light given to each faint star relative to the high tier
  attribute vec3 aCol;
  attribute float aL;
  attribute vec4 aOrb;       // amp, angular rate, phase, twinkle seed
  varying vec3 vCol;
  varying float vI;
  varying float vPx;
  varying float vSpk;
  varying float vSz;
  void main() {
    float r0 = length(position);
    float ang = uSpin * uTime / sqrt(1.0 + r0 * r0 * 16.0);
    float ph = aOrb.z + aOrb.y * uTime;
    vec3 q = position + aOrb.x * vec3(cos(ph), 0.7 * sin(ph * 1.31 + aOrb.w * 6.28), sin(ph));
    float ca = cos(ang), sa = sin(ang);
    vec3 p = vec3(ca * q.x + sa * q.z, q.y, -sa * q.x + ca * q.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = max(length(mv.xyz), 1e-5);
    float ratio = clamp(uCamDist / d, 0.35, 5.0);      // depth cue: nearer stars are brighter
    float boost = pow(ratio, 1.15);
    float gain = mix(uGainF, uGainB, smoothstep(0.1, 1.0, aL));
    float rr = length(p);
    float hold = 1.0 - uHold * 0.7 * (1.0 - smoothstep(0.02, 0.12, rr));
    float tw = 1.0 + 0.1 * sin(uTime * (1.2 + 2.3 * aOrb.w) + aOrb.w * 62.8);
    float nearFade = smoothstep(0.012, 0.07, d);       // never a giant blob in the camera's face
    float wb = smoothstep(0.1, 1.0, aL);
    // density, not additive saturation, builds the core: dim the faint stars where they crowd
    float crowd = mix(0.03, 1.0, smoothstep(0.02, 0.3, rr));
    float I = aL * boost * gain * hold * tw * nearFade * mix(crowd, 1.0, wb);
    float Isz = I / mix(uW, 1.0, wb);
    float px = clamp(2.8 + 5.0 * pow(max(Isz, 0.0), 0.35), 2.8, 40.0) * uDpr;
    vI = I;
    vCol = aCol;
    vPx = px;
    vSpk = smoothstep(6.0, 9.0, aL) * smoothstep(1.5, 5.0, I) * uSpikes;
    vSz = Isz;
    gl_PointSize = px;
    if (mv.z >= 0.0 || I < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;

export const starFrag = /* glsl */ `
  uniform float uDpr;
  varying vec3 vCol;
  varying float vI;
  varying float vPx;
  varying float vSpk;
  varying float vSz;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float rpx = sqrt(r2) * vPx * 0.5 / uDpr;            // radius in CSS px
    float s2 = 0.5 + 0.5 * sqrt(vSz);
    float core = exp(-rpx * rpx / s2);
    float hw = smoothstep(0.6, 4.0, vI);
    float halo = (exp(-r2 * 7.0) * 0.12 + 0.03 / (1.0 + r2 * 40.0)) * hw;
    float spk = (exp(-abs(c.x) * 4.0) * exp(-c.y * c.y * 900.0) + exp(-abs(c.y) * 4.0) * exp(-c.x * c.x * 900.0)) * vSpk * 0.35 * (1.0 - r2) * (1.0 - r2);
    float edge = 1.0 - r2;
    float k = core * edge + halo * edge + spk;
    vec3 col = vCol * vI * k + vec3(1.0) * vI * core * smoothstep(1.0, 9.0, vI) * 0.35;
    gl_FragColor = vec4(col, min(1.0, dot(col, vec3(0.3))));
  }`;

/** Unresolved-star haze: full-screen triangle, ray impact parameter through a flattened Plummer ball. */
export const hazeVert = /* glsl */ `
  uniform float uTan;
  uniform float uAspect;
  varying vec3 vRay;
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vec3 vd = vec3(position.xy * vec2(uTan * uAspect, uTan), -1.0);
    vRay = vd * mat3(viewMatrix);   // view -> world direction
  }`;

export const hazeFrag = /* glsl */ `
  uniform float uGain;
  uniform float uQ;        // axis ratio
  uniform float uA0;       // core scale
  varying vec3 vRay;
  void main() {
    vec3 sc = vec3(1.0, 1.0 / uQ, 1.0);
    vec3 c = cameraPosition * sc;
    vec3 rd = normalize(vRay * sc);
    float cd = dot(c, rd);
    float rho2 = max(dot(c, c) - cd * cd, 0.0);
    float u0 = 1.0 + rho2 / (uA0 * uA0);
    float u1 = 1.0 + rho2 / (0.3 * 0.3);
    float core = 1.0 / (u0 * u0);
    float body = 1.0 / (u1 * sqrt(u1));
    float cut = 1.0 - smoothstep(0.6, 1.6, sqrt(rho2));
    vec3 warm = vec3(1.0, 0.78, 0.5);
    vec3 hot = vec3(1.0, 0.92, 0.78);
    vec3 col = (mix(warm, hot, core) * core + warm * body * 0.07) * cut * uGain;
    gl_FragColor = vec4(col, min(1.0, dot(col, vec3(0.3))));
  }`;
