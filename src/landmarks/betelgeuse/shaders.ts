/**
 * GLSL for the Betelgeuse landmark. Linear HDR output; the engine tone-maps.
 * The whole star (photosphere, molecular atmosphere, plumes, dust, envelope) is ONE full-screen
 * analytic pass: per pixel, a ray from the camera is intersected with the star sphere (radius uR,
 * centre uC). That gives a pixel-perfect limb at every magnification, a soft lumpy edge, and an
 * atmosphere integrated along the ray (also correct when the camera is inside the envelope).
 */

export const NOISE = /* glsl */ `
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  vec3 vnoise3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash33(i), hash33(i + vec3(1,0,0)), f.x), mix(hash33(i + vec3(0,1,0)), hash33(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash33(i + vec3(0,0,1)), hash33(i + vec3(1,0,1)), f.x), mix(hash33(i + vec3(0,1,1)), hash33(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  // Animated cellular noise: x = F1, y = F2, z = random value of the nearest cell.
  vec3 worley(vec3 p, float t) {
    vec3 i = floor(p); vec3 f = fract(p);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 h = hash33(i + g);
      vec3 o = 0.5 + 0.38 * sin(t * (0.45 + 0.6 * h) + 6.2831 * h.yzx);
      vec3 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h.z; } else if (d < d2) { d2 = d; }
    }
    return vec3(sqrt(d1), sqrt(d2), id);
  }
`;

export const starVert = /* glsl */ `
  uniform mat4 uProjInv; uniform mat4 uCamWorld;
  varying vec3 vDir;
  void main() {
    vec4 v = uProjInv * vec4(position.xy, 1.0, 1.0);
    vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

export const starFrag = /* glsl */ `
  uniform vec3 uC; uniform mat3 uBody; uniform float uR; uniform float uTime; uniform float uPix;
  uniform vec3 uE3; uniform vec3 uDust; uniform vec3 uDust2;
  uniform vec3 uP1; uniform vec3 uP2; uniform vec3 uP3;
  uniform float uEnv; uniform float uMol; uniform float uGain; uniform float uClose; uniform float uDustAmt;
  varying vec3 vDir;
  ${NOISE}

  // Blackbody-ish colour for a normalised temperature k: 0 ≈ 2400 K (lanes) … 1 ≈ 4400 K (hottest upflows).
  vec3 bb(float k) {
    vec3 c = mix(vec3(1.0, 0.20, 0.035), vec3(1.0, 0.38, 0.10), smoothstep(0.0, 0.45, k));
    c = mix(c, vec3(1.0, 0.55, 0.21), smoothstep(0.4, 0.8, k));
    c = mix(c, vec3(1.0, 0.64, 0.30), smoothstep(0.78, 1.05, k));
    return c;
  }
  float Phi(float x) { return 1.0 / (1.0 + exp(-1.702 * x)); }

  // Normalised temperature of the photosphere at body-frame direction n. fp = pixel footprint in R units.
  float convection(vec3 n, float fp) {
    float t = uTime;
    vec3 w = vnoise3(n * 1.6 + vec3(0.0, 0.0, t * 0.012)) - 0.5;
    vec3 q = n + w * 0.6;
    // A handful of giant cells across the disc (each ~0.4 R wide): hot domed upflows, broad cool lanes.
    vec3 g = worley(q * 2.1, t * 0.05);
    float lane = smoothstep(0.02, 0.62, g.y - g.x);
    float dome = 1.0 - 0.9 * g.x * g.x;
    float k = 0.16 + 0.64 * lane * dome + 0.16 * (g.z - 0.5) * lane;
    // Smaller convection riding on the giant cells.
    #ifdef HIGH
    vec3 m = worley(q * 8.0 + 3.1, t * 0.11);
    float mf = 1.0 - smoothstep(0.25, 0.5, fp * 8.0);
    k += mf * (0.13 * smoothstep(0.0, 0.5, m.y - m.x) * (1.0 - 0.5 * m.x) - 0.06) * (0.3 + 0.7 * lane);
    #else
    k += 0.14 * (vnoise(q * 8.0 + 3.1 + t * 0.02) - 0.5);
    #endif
    // Fine turbulence only when the camera is close (zoom-in end of the range).
    float f1 = 1.0 - smoothstep(0.2, 0.5, fp * 34.0);
    float boost = 1.0 + 0.8 * uClose;
    if (f1 > 0.0) k += f1 * 0.16 * boost * (vnoise(n * 34.0 + w * 3.0 + vec3(t * 0.04, 0.0, 0.0)) - 0.5) * (0.5 + lane);
    #ifdef HIGH
    float f2 = 1.0 - smoothstep(0.2, 0.5, fp * 150.0);
    if (f2 > 0.0) {
      vec3 s = worley(n * 150.0 + w * 9.0 + (vnoise3(n * 60.0) - 0.5) * 1.4, t * 0.3);
      k += f2 * boost * (0.11 * smoothstep(0.0, 0.6, s.y - s.x) * (1.0 - 0.6 * s.x) - 0.045) * (0.35 + lane);
    }
    float f3 = 1.0 - smoothstep(0.2, 0.5, fp * 620.0);
    if (f3 > 0.0) k += f3 * 0.09 * boost * (vnoise(n * 620.0 + (vnoise3(n * 200.0) - 0.5) * 2.5 + vec3(0.0, t * 0.2, 0.0)) - 0.5);
    #endif
    return k;
  }

  // Dust density at world point P (relative to the star centre, in R units r).
  float dust(vec3 dW, vec3 dB, float r) {
    float a1 = smoothstep(0.62, 0.93, dot(dW, uDust)) * uDustAmt;
    float a2 = smoothstep(0.86, 0.985, dot(dW, uDust2));
    float a = a1 + a2;
    if (a <= 0.001) return 0.0;
    float cl = vnoise(dB * 5.0 + vec3(uTime * 0.01, 0.0, 0.0));
    cl = 0.6 * cl + 0.4 * vnoise(dB * 14.0 - vec3(0.0, uTime * 0.015, 0.0));
    float rad = exp(-max(r - 1.0, 0.0) / (0.12 + 0.35 * a2));
    return a * smoothstep(0.3, 0.65, cl + 0.2 * a) * rad;
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vDir);
    vec3 oc = ro - uC;
    float B = dot(oc, rd);
    float tc = -B;
    vec3 Pc = ro + rd * tc;            // true closest approach (may lie behind the camera)
    vec3 dc = Pc - uC;
    float rmin = length(dc);
    float bimp = rmin / uR;
    if (bimp > 9.0) discard;
    vec3 dW = dc / max(rmin, 1e-7);
    vec3 dB = uBody * dW;
    float camDist = max(length(Pc - ro), 1e-5);
    float fpB = uPix * camDist / uR;

    // Lumpy, irregular limb (molecular atmosphere has no sharp edge).
    float eN = 0.7 * vnoise(dB * 2.0 + vec3(0.0, 0.0, uTime * 0.015)) + 0.3 * vnoise(dB * 5.0 - vec3(uTime * 0.02, 0.0, 0.0));
    float edge = 1.0 - 0.03 * eN;
    float fs = 1.0 - smoothstep(0.003, 0.012, fpB * 6.0);
    float spic = 0.5;
    if (fs > 0.0) {
      spic = vnoise(dB * 90.0 + vec3(0.0, 0.0, uTime * 0.05));
      edge -= fs * 0.012 * spic;
    }

    // ---------- atmosphere along the ray
    float h = max(bimp - edge, 0.0);
    // inner molecular layer: short scale height, glowing deep red; radial filaments near the limb
    float H1 = 0.026;
    float sig1 = sqrt(rmin * H1 * uR);
    float streak = 1.0;
    if (fs > 0.0) {
      float s1 = vnoise(dB * 140.0 + vec3(bimp * 9.0, 0.0, uTime * 0.04));
      streak = mix(1.0, 0.35 + 1.3 * s1 * (0.5 + spic), fs * exp(-h / 0.06));
    }
    float plume = pow(max(dot(dW, uP1), 0.0), 7.0) * 1.3 + pow(max(dot(dW, uP2), 0.0), 10.0) * 0.8 + pow(max(dot(dW, uP3), 0.0), 14.0) * 0.5;
    float pl = vnoise(dB * 4.0 + vec3(0.0, uTime * 0.01, 0.0));
    float E1 = exp(-h / (H1 * (1.0 + 1.5 * plume))) * streak * Phi(tc / sig1);
    // extended MOLsphere (to ~1.5 R) with big asymmetric plumes
    float H2 = 0.12 * (1.0 + 3.5 * plume * pl);
    float sig2 = sqrt(rmin * H2 * uR);
    float E2 = exp(-h / H2) * Phi(tc / sig2) * (0.55 + 0.9 * pl) * uMol;
    // vast faint clumpy circumstellar envelope (scattered starlight off dust)
    float E3 = 0.0;
    if (uEnv > 0.001) {
      vec3 Ps = (tc > 0.0 ? Pc : ro) - uC;
      vec3 qn = uBody * (Ps / uR);
      float cl = vnoise(qn * 1.3 + vec3(uTime * 0.004, 0.0, 0.0));
      cl = 0.65 * cl + 0.35 * vnoise(qn * 3.7);
      E3 = pow(max(bimp, 1.0), -2.4) * smoothstep(0.25, 0.85, cl) * (1.0 + 2.5 * plume) * (1.0 - smoothstep(5.0, 9.0, bimp)) * Phi(tc / rmin) * uEnv;
    }
    // dust in front of / beside the limb
    float r0 = max(bimp, 1.0);
    float dAtm = dust(dW, dB, r0 + 0.05);
    float tauA = dAtm * 2.2 * Phi(tc / sig2);
    vec3 atm = vec3(1.25, 0.24, 0.05) * E1 * 0.4 + vec3(1.0, 0.24, 0.06) * E2 * 0.07 + vec3(1.0, 0.45, 0.22) * E3 * 0.07;
    atm *= exp(-tauA);
    atm += vec3(0.16, 0.05, 0.02) * dAtm * E2 * 0.4;   // dust faintly lit by the star
    float aA = clamp(1.0 - exp(-(E1 * 0.6 + E2 * 0.1 * uMol + tauA * 0.8)), 0.0, 1.0);

    // ---------- photosphere
    float disc = B * B - (dot(oc, oc) - uR * uR);
    vec3 col = atm * uGain;
    float alpha = aA;
    if (disc > 0.0) {
      float tHit = -B - sqrt(disc);
      if (tHit > 0.0) {
        vec3 P = ro + rd * tHit;
        vec3 nW = (P - uC) / uR;
        vec3 nB = uBody * nW;
        float mu = clamp(dot(nW, -rd), 0.0, 1.0);
        float fp = uPix * tHit / uR / max(mu, 0.15);
        float k = convection(nB, fp);
        // seen obliquely near the limb, the contrast is washed out by the thick atmosphere
        k = 0.38 + (k - 0.38) * (1.0 + 0.7 * uClose);
        k = mix(0.22, k, smoothstep(0.0, 0.3 * (1.0 - 0.75 * uClose), mu));
        k = clamp(k, 0.0, 1.0);
        float pulse = 1.0 + 0.05 * sin(uTime * 0.35);
        vec3 S = bb(k) * (0.08 + 1.75 * pow(k, 1.6)) * pulse;
        // strong limb darkening, redder towards the edge
        float x = 1.0 - mu;
        S *= (0.16 + 0.84 * pow(mu, 0.5));
        S *= mix(vec3(1.0, 0.6, 0.45), vec3(1.0), pow(mu, 0.4));
        // patchy dust veil (the Great Dimming) just above the surface
        float dS = dust(nW, nB, 1.04);
        float tau = dS * 3.6 * (0.35 + 1.3 * vnoise(nB * 26.0 + vec3(uTime * 0.02)));
        S = S * exp(-tau) + vec3(0.09, 0.028, 0.01) * (1.0 - exp(-tau));
        // soft lumpy edge: fade the surface into the atmosphere
        float wS = 1.0 - smoothstep(edge - 0.02 - 0.015 * x, edge, bimp);
        col = mix(atm, S, wS) * uGain;
        alpha = mix(aA, 1.0, wS);
      }
    }
    gl_FragColor = vec4(col, alpha);   // premultiplied: atmosphere is emission, photosphere is opaque
  }`;

// ------------------------------------------------------------------ the Sun, to scale (point marker)
export const sunVert = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }`;
export const sunFrag = /* glsl */ `
  uniform float uSize; uniform float uCore; uniform float uOpacity;
  void main() {
    vec2 q = (gl_PointCoord * 2.0 - 1.0) * uSize * 0.5;   // pixels from the centre
    float r = length(q);
    float core = exp(-pow(r / max(uCore, 0.7), 2.0) * 1.4);
    float ring = exp(-pow((r - uSize * 0.36) / 0.9, 2.0)) * 0.35;
    vec3 col = vec3(3.0, 2.8, 2.4) * core + vec3(0.6, 0.75, 1.0) * ring;
    float a = clamp(core + ring * 0.6, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(col * uOpacity, a);
  }`;
