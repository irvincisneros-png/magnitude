/** GLSL for the Milky Way landmark. */

/** Galaxy sprites: positions animated on the GPU (see populations.ts for the packing). */
export const galaxyVert = /* glsl */ `
  uniform float uTime;
  uniform float uPxScale;   // drawing-buffer height / (2 tan(fov/2))
  uniform float uCap;       // max sprite size in device px for a 0.01-unit sprite
  uniform float uGain;
  uniform vec3 uGC;
  uniform vec2 uBar;        // cos, sin of the bar angle
  uniform float uLocalRatio;
  attribute vec3 aCol;
  attribute vec4 aPar;
  varying vec3 vCol;
  void main() {
    float size = abs(aPar.x), om = aPar.y, seed = aPar.z, mode = aPar.w;
    float env = 1.0;
    vec3 p;
    if (mode < 0.5) {
      float ph = position.y + om * uTime;
      p = vec3(position.x * cos(ph), position.z, position.x * sin(ph));
    } else if (mode < 1.999) {
      float tau = (mode - 1.0) * 1000.0;
      float life = fract(uTime / tau + seed);
      float ph = position.y + om * (life - 0.5) * tau;
      env = smoothstep(0.0, 0.22, life) * (1.0 - smoothstep(0.78, 1.0, life)) * 1.3;
      p = vec3(position.x * cos(ph), position.z, position.x * sin(ph));
    } else {
      float q = mode - 2.0;
      float th = position.y + om * uTime;
      vec2 e = vec2(position.x * cos(th), position.x * q * sin(th));
      p = vec3(e.x * uBar.x - e.y * uBar.y, position.z, e.x * uBar.y + e.y * uBar.x);
    }
    p += uGC;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 1e-9);
    float px = size * uPxScale / dist;
    float cap = uCap * sqrt(size / 0.01);
    // sprites that would look huge (i.e. very close to the camera) dissolve away; nearby space is
    // shown by the resolved local stars instead
    float fade = 1.0 - smoothstep(cap * 0.55, cap * 1.7, px);
    if (aPar.x < 0.0) { // fine near-Sun sprite: fades in as its coarse counterpart fades out
      float mpx = px * uLocalRatio, mcap = cap * sqrt(uLocalRatio);
      fade *= smoothstep(mcap * 0.55, mcap * 1.7, mpx);
    }
    float drawn = clamp(px, 1.6, cap);
    float energy = min(1.0, (px * px) / (drawn * drawn));   // conserve light for sub-pixel sprites
    gl_PointSize = drawn;
    vCol = aCol * (uGain * env * fade * energy);
    if (mv.z >= 0.0 || fade <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;

export const galaxyFrag = /* glsl */ `
  varying vec3 vCol;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 4.0) - 0.0183;
    vec3 col = vCol * a;
    gl_FragColor = vec4(col, min(1.0, dot(col, vec3(0.25))));
  }`;

/** Dust: multiplies what is already drawn by (1 − extinction), redder light survives better. */
export const dustFrag = /* glsl */ `
  varying vec3 vCol;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 3.0) - 0.0498;
    gl_FragColor = vec4(min(vCol * a, vec3(0.94)), 0.0);
  }`;

/** Resolved stars: brightness from luminosity / distance², compressed for display. */
export const starVert = /* glsl */ `
  uniform float uE;       // exposure (constant: shells are built so L_min ∝ R²)
  uniform float uDpr;
  uniform float uFade;
  uniform float uSpikes;
  uniform float uViewLy;  // view height in light-years
  attribute vec3 aCol;
  attribute float aLum;
  attribute float aShell;
  varying vec3 vCol;
  varying float vI;
  varying float vPx;
  varying float vSpk;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dly = max(-mv.z, 1e-12) * 105700.0;
    float b = aLum / (dly * dly) * uE;
    float I = 0.55 * pow(b, 0.42);
    float px = clamp(2.4 + 2.6 * pow(b, 0.2), 2.4, 60.0) * uDpr;
    float shellFade = aShell > 0.0 ? 1.0 - smoothstep(1.5, 4.0, uViewLy / aShell) : 1.0;
    vI = min(I, 40.0) * uFade * shellFade;
    vCol = aCol;
    vPx = px;
    vSpk = smoothstep(3.0, 18.0, I) * uSpikes;
    gl_PointSize = px;
    if (mv.z >= 0.0 || vI < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;

export const starFrag = /* glsl */ `
  uniform float uDpr;
  varying vec3 vCol;
  varying float vI;
  varying float vPx;
  varying float vSpk;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float rpx = sqrt(r2) * vPx * 0.5 / uDpr;          // radius in CSS px
    float core = exp(-rpx * rpx / 0.9);                 // ~1.6 px wide point
    float halo = exp(-r2 * 6.0) * 0.12 + 0.025 / (1.0 + r2 * 60.0);
    float spk = (exp(-abs(c.x) * vPx * 0.35) * exp(-c.y * c.y * 3.0) + exp(-abs(c.y) * vPx * 0.35) * exp(-c.x * c.x * 3.0)) * vSpk * 0.22;
    float edge = 1.0 - r2;
    float k = (core + (halo + spk) * min(vI, 6.0) / max(vI, 1e-3)) * edge;
    vec3 col = mix(vec3(1.0), vCol, clamp(1.4 - core * 0.6, 0.0, 1.0)) * vI * k;
    gl_FragColor = vec4(col, min(1.0, core * min(vI, 1.0)));
  }`;

/** "You are here" ring, constant screen size. */
export const ringVert = /* glsl */ `
  uniform float uDpr;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 34.0 * uDpr;
  }`;

export const ringFrag = /* glsl */ `
  uniform float uA;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    float ring = smoothstep(0.08, 0.0, abs(r - 0.72)) ;
    float ticks = step(0.86, r) * step(r, 1.0) * (step(abs(c.x), 0.035) + step(abs(c.y), 0.035));
    vec3 col = vec3(1.0, 0.86, 0.55) * (ring * 0.9 + ticks * 0.8) * uA;
    gl_FragColor = vec4(col, 0.0);
  }`;

/** Dashed Sun → centre line. */
export const lineVert = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const lineFrag = /* glsl */ `
  uniform float uA;
  varying float vT;
  void main() {
    float dash = step(0.45, fract(vT * 40.0));
    float ends = smoothstep(0.0, 0.04, vT) * smoothstep(1.0, 0.92, vT);
    gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * dash * ends * uA, 0.0);
  }`;
