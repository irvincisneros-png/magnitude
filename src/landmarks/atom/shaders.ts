/** GLSL for the carbon-atom landmark. All passes are additive and depth-free. */
import { A0, Z_1S, Z_2P, Z_2S } from './orbitals';

const f = (x: number) => x.toFixed(6);

// ---------------------------------------------------------------- electron sample cloud
/**
 * Instanced camera-facing quads. Each sample is a soft gaussian dot whose energy is conserved
 * as it shrinks below a pixel or swells into an out-of-focus disc near the camera, and which
 * stretches radially into a motion streak while the camera dives (uDolly).
 */
export const cloudVert = /* glsl */ `
  attribute vec3 aPos;
  attribute vec4 aData;            // orbital, sign(psi)*relative density, twinkle phase, random
  uniform float uDensityPow, uFloor;
  uniform float uTime, uSize, uMinPx, uMaxPx, uBokehPx, uDolly, uIntensity, uPhaseRate, uFocus, uBackdrop;
  uniform vec2 uViewport;
  uniform vec3 uColA[4];
  uniform vec3 uColB[4];
  uniform float uGain[4];
  varying vec3 vCol; varying vec2 vUv; varying float vK;

  void main() {
    int o = int(aData.x + 0.5);
    float ph = aData.z * 6.2831853;
    vec3 p = aPos;
    float rr = length(p);
    // gentle scale-free drift: the cloud never stands still
    p += (0.035 * rr) * vec3(
      sin(uTime * 0.21 + ph + p.y * 9.0),
      sin(uTime * 0.17 + ph * 1.7 + p.z * 9.0),
      sin(uTime * 0.19 + ph * 2.3 + p.x * 9.0));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float z = -mv.z;
    if (z <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vCol = vec3(0.0); vUv = vec2(2.0); vK = 0.0; return; }
    vec4 clip = projectionMatrix * mv;

    float pxPerUnit = 0.5 * uViewport.y * projectionMatrix[1][1] / z;
    float sPx = uSize * pxPerUnit;
    float energy = 1.0;
    if (sPx < uMinPx) { energy = (sPx * sPx) / (uMinPx * uMinPx); sPx = uMinPx; }
    if (sPx > uBokehPx) energy *= pow(uBokehPx / sPx, 2.4);   // out-of-focus discs fade
    sPx = min(sPx, uMaxPx);
    // keep the eye on the current scale: cloud far behind the nucleus recedes into a dim backdrop
    energy *= mix(uBackdrop, 1.0, min(1.0, pow(1.6 * uFocus / z, 2.0)));

    // radial motion streak: where will this point be after the camera moves uDolly closer?
    vec2 pxPos = (clip.xy / clip.w) * 0.5 * uViewport;
    float grow = z / max(z - uDolly, 0.3 * z) - 1.0;
    vec2 streak = pxPos * grow;
    float L = length(streak);
    vec2 ax = L > 1e-3 ? streak / L : vec2(1.0, 0.0);
    L = min(L, 0.25 * uViewport.y);
    vec2 ay = vec2(-ax.y, ax.x);
    float k = L / sPx;

    vec2 c = position.xy;
    vec2 off = ax * c.x * (0.5 * sPx + 0.5 * L) + ay * c.y * 0.5 * sPx - ax * 0.5 * L;
    clip.xy += off / (0.5 * uViewport) * clip.w;
    gl_Position = clip;
    vUv = vec2(c.x * (1.0 + k), c.y);
    vK = k;

    // each dot is a place an electron could be found: they flicker in and out
    float tw = 0.5 + 0.5 * sin(uTime * (0.5 + 1.6 * aData.w) + ph);
    float twinkle = 0.2 + 2.6 * tw * tw * tw;
    // the wave's phase turns with time; opposite lobes are always opposite in phase
    float phase = 0.5 + 0.5 * cos(uTime * uPhaseRate + (aData.y < 0.0 ? 3.14159265 : 0.0));
    vec3 col = mix(uColA[o], uColB[o], phase);
    float dens = uFloor + pow(abs(aData.y), uDensityPow);
    vCol = col * dens * uGain[o] * uIntensity * energy * twinkle / (1.0 + 0.6 * k);
  }`;

export const cloudFrag = /* glsl */ `
  varying vec3 vCol; varying vec2 vUv; varying float vK;
  void main() {
    float dx = max(abs(vUv.x) - vK, 0.0);
    float d2 = dx * dx + vUv.y * vUv.y;
    if (d2 >= 1.0) discard;
    float a = exp(-d2 * 4.5) * (1.0 - d2);
    vec3 c = vCol * a;
    gl_FragColor = vec4(c, clamp(dot(c, vec3(0.3)), 0.0, 1.0) * 0.35);
  }`;

// ---------------------------------------------------------------- volumetric |psi|^2 glow
/**
 * Back-faces of a bounding sphere; each pixel marches its ray through the analytic density.
 * Every orbital is centred on the nucleus, so samples are spaced with a sinh map around the
 * ray's closest approach to the origin: dense where the sharp 1s core is, sparse in the tails.
 */
export const volumeVert = /* glsl */ `
  varying vec3 vObj;
  void main() {
    vObj = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export const volumeFrag = /* glsl */ `
  uniform vec3 uCamObj;
  uniform float uR, uTime, uGlow, uPhaseRate, uContrast, uVolScale, uKnee, uIso, uSkin, uBall;
  uniform vec3 uBallCol;
  uniform vec3 uColA[4];
  uniform vec3 uColB[4];
  uniform float uGainV[4];
  varying vec3 vObj;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  // soft body + a glowing translucent 'skin' near one density level (reads like an isosurface,
  // brightest where the ray grazes it, so each lobe gets a natural rim)
  float shape(float x) {
    float y = x * x;
    float l = log(max(x, 1e-6) / uIso) * 3.2;
    return y / (y + uKnee) + uSkin * exp(-l * l);
  }
  float asinh_(float x) { return log(x + sqrt(x * x + 1.0)); }

  void main() {
    vec3 ro = uCamObj;
    vec3 rd = normalize(vObj - ro);
    float b = dot(ro, rd);
    float c = dot(ro, ro) - uR * uR;
    float h = b * b - c;
    if (h <= 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0), t1 = -b + h;
    if (t1 <= t0) discard;

    float tc = -b;                               // closest approach to the nucleus
    float bp = length(ro + rd * tc);
    float w = max(bp, 0.012);
    float u0 = asinh_((t0 - tc) / w), u1 = asinh_((t1 - tc) / w);
    float du = (u1 - u0) / float(STEPS);
    float j = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 91.7);

    float pA = 0.5 + 0.5 * cos(uTime * uPhaseRate);
    vec3 c1 = mix(uColA[0], uColB[0], pA);
    vec3 c2i = mix(uColA[1], uColB[1], pA), c2o = mix(uColA[1], uColB[1], 1.0 - pA);
    vec3 cxp = mix(uColA[2], uColB[2], pA), cxn = mix(uColA[2], uColB[2], 1.0 - pA);
    vec3 cyp = mix(uColA[3], uColB[3], pA), cyn = mix(uColA[3], uColB[3], 1.0 - pA);

    vec3 acc = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      float u = u0 + (float(i) + j) * du;
      float sh = sinh(u);
      float t = tc + w * sh;
      float dt = w * cosh(u) * du;
      vec3 p = ro + rd * t;
      float r = length(p);
      float r1 = ${f(Z_1S / A0)} * r;
      float r2 = ${f(Z_2S / A0)} * r;
      float r3 = ${f(Z_2P / A0)} * r;
      float n1 = exp(-2.0 * r1);
      float q = 2.0 - r2;
      float n2 = q * q * exp(-r2);
      float e3 = exp(-r3);
      float px = ${f(Z_2P / A0)} * p.x, py = ${f(Z_2P / A0)} * p.y;
      // each orbital's density relative to its own brightest region, shaped by a soft
      // saturating curve so the sharp inner peaks do not drown the outer structure
      vec3 e = c1 * (uGainV[0] * (n1 * 3.0) / (n1 * 3.0 + 0.6))
             + (q > 0.0 ? c2i : c2o) * (uGainV[1] * shape(n2 * ${f(1 / 0.0546)}))
             + (p.x > 0.0 ? cxp : cxn) * (uGainV[2] * shape(px * px * e3 * ${f(1 / (4 * Math.exp(-2)))}))
             + (p.y > 0.0 ? cyp : cyn) * (uGainV[3] * shape(py * py * e3 * ${f(1 / (4 * Math.exp(-2)))}));
      // seen from far away the lobes merge into one soft ball (spherically averaged 2s + 2p)
      float sph = r3 * r3 * e3 * ${f(1 / (4 * Math.exp(-2)))};
      e += uBallCol * (uBall * sph / (sph + 0.5));
      acc += e * dt;
    }
    vec3 col = pow(acc * uVolScale, vec3(uContrast)) * uGlow;
    gl_FragColor = vec4(col, clamp(dot(col, vec3(0.3)), 0.0, 1.0) * 0.5);
  }`;

// ---------------------------------------------------------------- nucleus proxy
/** A pin-prick of light at true nuclear size, with a halo that never drops below a few pixels. */
export const nucleusVert = /* glsl */ `
  uniform float uRn, uDpr;
  uniform vec2 uViewport;
  varying vec2 vPx; varying float vRc; varying float vH;
  void main() {
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float z = max(-mv.z, 1e-9);
    vec4 clip = projectionMatrix * mv;
    float pxPerUnit = 0.5 * uViewport.y * projectionMatrix[1][1] / z;
    float rc = uRn * pxPerUnit;
    float hR = max(rc * 1.6, 3.0 * uDpr);
    float quad = max(rc * 1.2, 1.0) + hR * 9.0;
    vec2 off = position.xy * quad;
    clip.xy += off / (0.5 * uViewport) * clip.w;
    gl_Position = clip;
    vPx = off; vRc = rc; vH = hR;
  }`;

export const nucleusFrag = /* glsl */ `
  uniform float uI; uniform vec3 uCore; uniform vec3 uHalo; uniform float uTime;
  varying vec2 vPx; varying float vRc; varying float vH;
  void main() {
    float r = length(vPx);
    float rc = max(vRc, 0.6);
    float core = 1.0 - smoothstep(rc - 0.8, rc + 0.8, r);
    // energy-conserving: a sub-pixel nucleus is a dimmer pixel, not a fat one
    float sub = min(1.0, vRc * vRc / 0.36);
    float shimmer = 0.92 + 0.08 * sin(uTime * 3.1) * sin(uTime * 1.7 + 1.0);
    float halo = exp(-r / vH) * 0.55 + 0.18 / (1.0 + (r / vH) * (r / vH));
    vec3 col = uCore * core * mix(0.35, 1.0, sub) * 14.0 + uHalo * halo;
    col *= uI * shimmer;
    gl_FragColor = vec4(col, clamp(core, 0.0, 1.0) * uI);
  }`;

// ---------------------------------------------------------------- decade rings
/** A hairline ring of radius uRadius (local units) facing the camera, with fine tick marks. */
export const ringVert = /* glsl */ `
  uniform float uRadius;
  varying vec2 vLoc;
  void main() {
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vLoc = position.xy * 1.08;
    c.xy += vLoc * uRadius;
    gl_Position = projectionMatrix * c;
  }`;

export const ringFrag = /* glsl */ `
  uniform float uAlpha, uTime; uniform vec3 uCol;
  varying vec2 vLoc;
  void main() {
    float r = length(vLoc);
    float fw = fwidth(r);
    float line = 1.0 - smoothstep(0.0, 1.2 * fw, abs(r - 1.0));
    float ang = atan(vLoc.y, vLoc.x);
    const float CELL = 6.2831853 / 72.0;                 // 72 fine ticks, every 9th is long
    float a0 = ang + 3.14159265 + 0.5 * CELL;
    float idx = floor(a0 / CELL);
    float da = abs(a0 - (idx + 0.5) * CELL) * r;         // arc distance to nearest tick
    float tl = mod(idx, 9.0) < 0.5 ? 0.04 : 0.014;
    float inTick = (1.0 - smoothstep(0.4 * fw, 1.2 * fw, da))
                 * smoothstep(1.0 - tl - fw, 1.0 - tl, r) * (1.0 - smoothstep(1.0, 1.0 + fw, r));
    // a slow travelling glint makes the ring read as an instrument, not a wireframe
    float glint = 0.6 + 0.4 * pow(0.5 + 0.5 * cos(ang - uTime * 0.25), 8.0);
    float a = (line * 0.9 + inTick * 0.55) * glint * uAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uCol * a, 0.0);
  }`;

/** Pixel-constant text quad pinned to the top of a ring (canvas texture atlas, one row per ring). */
export const tagVert = /* glsl */ `
  uniform float uRadius, uDpr, uRow, uRows;
  uniform vec2 uViewport, uSizePx;
  varying vec2 vUv;
  void main() {
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    c.y += uRadius;
    vec4 clip = projectionMatrix * c;
    vec2 off = vec2(position.x * 0.5 * uSizePx.x, (position.y * 0.5 + 0.5) * uSizePx.y + 6.0 * uDpr);
    clip.xy += off / (0.5 * uViewport) * clip.w;
    gl_Position = clip;
    vUv = vec2(position.x * 0.5 + 0.5, (uRow + position.y * 0.5 + 0.5) / uRows);
  }`;

export const tagFrag = /* glsl */ `
  uniform sampler2D uTex; uniform float uAlpha; uniform vec3 uCol;
  varying vec2 vUv;
  void main() {
    float a = texture2D(uTex, vUv).a * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uCol * a, 0.0);
  }`;
