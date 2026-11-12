/**
 * GLSL for the Sun landmark. All colours are linear HDR; the engine tone-maps.
 * Units: sun radius R = 0.5 (diameter = 1 local unit).
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
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.07 + 17.1; a *= 0.5; }
    return v / 0.875;
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
      vec3 o = 0.5 + 0.36 * sin(t * (0.5 + 0.7 * h) + 6.2831 * h.yzx);
      vec3 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h.z; } else if (d < d2) { d2 = d; }
    }
    return vec3(sqrt(d1), sqrt(d2), id);
  }
`;

// ------------------------------------------------------------------ photosphere

export const photoVert = /* glsl */ `
  varying vec3 vObj; varying vec3 vWorld; varying vec3 vWN;
  void main() {
    vObj = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vWN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const photoFrag = /* glsl */ `
  #define NSPOT 16
  uniform float uTime; uniform float uIntensity;
  uniform vec4 uSpots[NSPOT];
  varying vec3 vObj; varying vec3 vWorld; varying vec3 vWN;
  ${NOISE}

  // One granulation scale. Returns brightness factor around 1 and the lane mask.
  float granScale(vec3 p, float F, float t, float footprint, float contrast, float laneW, float depth, out float lanes) {
    float fade = 1.0 - smoothstep(0.3, 0.6, footprint * F);
    lanes = 0.0;
    if (fade <= 0.0) return 1.0;
    vec3 w = worley(p * F, t);
    float edge = smoothstep(0.0, laneW, w.y - w.x);        // 0 in dark lanes
    float body = 1.0 - 0.45 * w.x * w.x;                    // bright, domed centre
    float v = mix(1.0 - depth, 1.0, edge) * body * (0.84 + 0.32 * w.z);
    lanes = (1.0 - edge) * fade;
    return mix(1.0, 1.0 + (v - 0.86) * contrast, fade);
  }

  void main() {
    vec3 n = normalize(vObj);
    vec3 N = normalize(vWN);
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = clamp(dot(N, V), 0.0, 1.0);
    vec3 p = n * 0.5;
    float fp = length(fwidth(p));

    // Convection at three real sizes: supergranules (~30 000 km), mesogranules, granules (~1000 km).
    float lS, lM, lG;
    float g = 1.0;
    g *= granScale(p + 3.1, 46.0, uTime * 0.05, fp, 0.4, 1.1, 0.09, lS);
    g *= granScale(p + 7.7, 220.0, uTime * 0.12, fp, 0.3, 0.6, 0.12, lM);
    #ifdef HIGH
    g *= granScale(p, 1400.0, uTime * 0.35, fp, 0.9, 0.16, 0.42, lG);
    #endif

    // Sunspots: dark umbra, filamentary penumbra; activity drives faculae around them.
    float spot = 1.0; float umbra = 0.0; float act = 0.0;
    for (int i = 0; i < NSPOT; i++) {
      vec4 s = uSpots[i];
      if (s.w <= 0.0) continue;
      vec3 d = n - s.xyz;
      float dist = length(d);
      act += smoothstep(s.w * 6.0, s.w * 1.2, dist);
      if (dist > s.w * 1.5) continue;
      vec3 t1 = normalize(cross(s.xyz, vec3(0.0, 1.0, 0.0)));
      vec3 t2 = cross(s.xyz, t1);
      float ang = atan(dot(d, t2), dot(d, t1));
      vec3 ring = vec3(cos(ang), sin(ang), float(i) * 3.7);
      float edge = s.w * (1.0 + 0.32 * (vnoise(ring * 2.2) - 0.5) + 0.12 * (vnoise(ring * 6.0) - 0.5));
      float rn = dist / edge;
      float fil = vnoise(vec3(ring.xy * 15.0, rn * 2.2 - uTime * 0.02 + float(i)));
      fil = 0.6 * fil + 0.4 * vnoise(vec3(ring.xy * 41.0, rn * 4.0 + float(i) * 2.0));
      float pen = mix(0.36, 0.86, smoothstep(0.2, 0.85, fil)) * mix(0.85, 1.05, rn);
      float uEdge = 0.44 + 0.08 * (vnoise(ring * 3.0 + 9.0) - 0.5);
      float um = 0.05 + 0.05 * vnoise(vec3(n * 4000.0));       // umbral dots
      float u = 1.0 - smoothstep(uEdge - 0.06, uEdge + 0.04, rn);
      float v = mix(pen, um, u);
      v = mix(v, 1.0, smoothstep(0.9, 1.06, rn));
      spot = min(spot, v);
      umbra = max(umbra, u * (1.0 - smoothstep(0.9, 1.06, rn)));
    }
    act = clamp(act, 0.0, 1.0);

    // Wavelength-dependent limb darkening: white-yellow centre, deep orange limb.
    float x = 1.0 - mu;
    vec3 limb = max(1.0 - vec3(0.55, 0.70, 0.85) * x - vec3(0.25, 0.22, 0.12) * x * x, 0.0);
    vec3 base = vec3(1.0, 0.58, 0.25);

    // Faculae: bright magnetic network near active regions, strongest towards the limb.
    float net = max(lS, lM * 0.6);
    float fac = act * (0.25 + 0.75 * net) * (0.15 + pow(x, 1.4)) * 0.55;
    float plage = act * 0.06 * fbm3(n * 30.0);

    g *= 0.9 + 0.2 * fbm3(p * 90.0 + vec3(0.0, uTime * 0.01, 0.0));
    vec3 col = base * limb * g * spot;
    col *= mix(vec3(1.0), vec3(1.0, 0.62, 0.42), umbra);   // umbra is cooler, redder
    col += base * limb * (fac + plage);
    col *= uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }`;

// ------------------------------------------------------------------ corona + chromosphere (camera-facing quad)

export const quadVert = /* glsl */ `
  varying vec3 vWorld; varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const coronaFrag = /* glsl */ `
  uniform vec3 uCenter; uniform mat3 uBodyInv; uniform float uTime;
  uniform float uCorona; uniform float uChromo; uniform float uDetail;
  varying vec3 vWorld;
  ${NOISE}
  void main() {
    vec3 rd = normalize(vWorld - cameraPosition);
    vec3 oc = uCenter - cameraPosition;
    float tc = dot(oc, rd);
    if (tc <= 0.0) discard;
    vec3 P = cameraPosition + rd * tc;
    vec3 dP = P - uCenter;
    float b = length(dP) / 0.5;                 // impact parameter in solar radii
    if (b < 0.985) discard;                     // the disc itself is drawn by the photosphere
    vec3 dir = uBodyInv * (dP / max(length(dP), 1e-6));
    float lat = dir.y;
    float lb = log(b);

    // K-corona: steep falloff, structured into streamers (equator) and plumes (poles).
    float r3 = pow(b, -3.6);
    float sm = vnoise(dir * 2.6 + vec3(0.0, 0.0, uTime * 0.004));
    float md = vnoise(dir * 9.0 + vec3(uTime * 0.006, 3.0, 0.0));
    float fn = vnoise(dir * 34.0 + vec3(0.0, 7.0, 0.0));
    float rays = 0.66 * sm + 0.2 * md + 0.14 * mix(0.5, fn, uDetail);
    float eq = exp(-lat * lat * b / 0.08);                 // helmet streamers taper outwards
    float helmet = eq * smoothstep(0.38, 0.75, sm) * (1.0 + 1.6 * smoothstep(1.2, 3.0, b));
    float plumes = smoothstep(0.6, 0.95, abs(lat)) * smoothstep(0.45, 0.9, vnoise(dir * 70.0)) * 0.45;
    float flow = 0.93 + 0.07 * sin(lb * 14.0 - uTime * 0.35 + md * 7.0);   // blobs streaming outwards
    float structure = (0.3 + 0.7 * rays + 1.1 * helmet + plumes) * flow;
    float corona = r3 * structure * (1.0 - smoothstep(4.0, 5.8, b));
    float fine = md;
    float inner = exp(-(b - 1.0) * 9.0) * (0.6 + 0.6 * fine);   // bright inner corona glow
    vec3 cc = vec3(1.0, 0.9, 0.8) * corona * 0.26 + vec3(1.0, 0.7, 0.45) * inner * 0.22;

    // Chromosphere: a thin pink-red (hydrogen-alpha) rim of spicules just above the limb.
    float h = (b - 1.0) * 0.5 * 1.39e6;         // height above the limb in km
    float spic = vnoise(vec3(dir * 900.0) + vec3(0.0, uTime * 0.2, 0.0));
    float ch = exp(-max(h, 0.0) / (2500.0 + 4000.0 * spic)) * smoothstep(-300.0, 200.0, h);
    vec3 chromo = vec3(1.0, 0.18, 0.22) * ch * 2.2 * uChromo;

    vec3 col = cc * uCorona + chromo;
    gl_FragColor = vec4(col, 0.0);
  }`;

// ------------------------------------------------------------------ prominences (points along magnetic loops)

export const promVert = /* glsl */ `
  attribute vec3 aA; attribute vec3 aB; attribute vec4 aP; attribute vec4 aQ;
  uniform float uTime; uniform float uPx; uniform vec3 uCenter;
  varying float vA; varying vec3 vCol;
  void main() {
    float t = fract(aP.x + uTime * aQ.y);
    vec3 dir = normalize(mix(aA, aB, t));
    vec3 tang = normalize(aB - aA);
    vec3 side = normalize(cross(tang, dir));
    float arch = sin(3.14159265 * t);
    float h = aQ.x * pow(max(arch, 0.0), 0.8);
    float tw = aP.y + t * 7.0 + uTime * 0.05;
    float rad = aP.z * (0.35 + 0.9 * arch) * sqrt(fract(aP.w * 13.7 + 0.31));   // fill the flux rope, not just its skin
    vec3 off = (side * cos(tw) + dir * sin(tw)) * rad;
    off += side * sin(t * 11.0 + uTime * 0.25 + aP.w * 6.28) * aQ.x * 0.06 * arch;
    off += dir * sin(t * 17.0 - uTime * 0.4 + aP.w * 3.1) * aQ.x * 0.03 * arch;
    vec3 pos = dir * (0.5 + h) + off;

    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;

    float px = aQ.z * uPx / max(-mv.z, 1e-5);
    float a = aQ.w * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t);
    a *= 0.35 + 1.3 * smoothstep(0.35, 0.95, 0.5 + 0.5 * sin(t * 23.0 + aP.w * 40.0 + sin(t * 7.0 + uTime * 0.2) * 2.0));   // knots
    // Seen against the bright disc a prominence is a dim 'filament'; above the limb it glows.
    vec3 rd = normalize(wp.xyz - cameraPosition);
    vec3 oc = uCenter - cameraPosition;
    float tc = dot(oc, rd);
    float bb = length(oc - rd * tc);
    if (bb < 0.5) a *= 0.05;
    if (px < 1.5) { a *= px * px / 2.25; px = 1.5; }
    gl_PointSize = min(px, 64.0);
    vA = a;
    float hot = smoothstep(0.25, 0.0, arch) ;
    vCol = mix(vec3(1.0, 0.13, 0.07), vec3(1.0, 0.36, 0.12), hot * 0.6 + 0.3 * fract(aP.w * 7.3));
  }`;

export const promFrag = /* glsl */ `
  uniform float uGain;
  varying float vA; varying vec3 vCol;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float k = exp(-r2 * 4.0);
    gl_FragColor = vec4(vCol * k * vA * uGain, 0.0);
  }`;

// ------------------------------------------------------------------ Earth proxy

export const earthVert = /* glsl */ `
  varying vec3 vObj; varying vec3 vWN; varying vec3 vWorld;
  void main() {
    vObj = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vWN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const earthFrag = /* glsl */ `
  uniform vec3 uLight; uniform vec3 uToSun; uniform float uTime;
  varying vec3 vObj; varying vec3 vWN; varying vec3 vWorld;
  ${NOISE}
  void main() {
    vec3 n = normalize(vObj);
    vec3 N = normalize(vWN);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(N, V), 0.0, 1.0);

    float c = fbm3(n * 2.3 + vec3(4.1, 1.7, 0.3)) + 0.12 * vnoise(n * 9.0);
    float land = smoothstep(0.55, 0.58, c);
    float dry = smoothstep(0.35, 0.75, vnoise(n * 3.1 + 11.0)) * (1.0 - smoothstep(0.35, 0.6, abs(n.y)));
    vec3 landCol = mix(vec3(0.04, 0.07, 0.025), vec3(0.22, 0.15, 0.07), dry);
    vec3 ocean = mix(vec3(0.004, 0.02, 0.07), vec3(0.01, 0.05, 0.12), vnoise(n * 6.0));
    vec3 surf = mix(ocean, landCol, land);
    float ice = smoothstep(0.82, 0.9, abs(n.y) + 0.05 * vnoise(n * 12.0));
    surf = mix(surf, vec3(0.7, 0.75, 0.8), ice);
    float cl = smoothstep(0.5, 0.75, fbm3(n * 5.0 + vec3(uTime * 0.01, 0.0, 0.0)));
    surf = mix(surf, vec3(0.8), cl * 0.85);

    float diff = max(dot(N, uLight), 0.0);
    float wrap = smoothstep(-0.2, 0.4, dot(N, uLight));
    vec3 col = surf * (diff * 2.2 + 0.03);
    // Ocean glint
    vec3 Hh = normalize(uLight + V);
    col += vec3(1.0, 0.9, 0.8) * pow(max(dot(N, Hh), 0.0), 60.0) * (1.0 - land) * (1.0 - cl) * 0.8;
    // Atmosphere: blue rim on the lit side, plus a bright backlit ring from the Sun behind.
    float rim = pow(1.0 - ndv, 2.5);
    col += vec3(0.25, 0.5, 1.0) * rim * (0.25 + 1.6 * wrap);
    float back = pow(1.0 - ndv, 5.0) * smoothstep(-0.3, 0.6, dot(N, uToSun));
    col += vec3(1.0, 0.7, 0.5) * back * 1.6;
    gl_FragColor = vec4(col, 1.0);
  }`;

// ------------------------------------------------------------------ "109 Earths" bead strip

export const beadFrag = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float u = vUv.x * 109.0;
    float id = floor(u);
    vec2 q = vec2(fract(u) - 0.5, vUv.y - 0.5);
    float r = length(q) * 2.0;
    float aa = fwidth(r) * 1.2;
    float disc = 1.0 - smoothstep(0.92 - aa, 0.92 + aa, r);
    float ring = disc * smoothstep(0.92 - 2.5 * aa - 0.12, 0.92 - aa - 0.05, r);
    float tenth = step(8.5, mod(id, 10.0));
    vec3 fill = vec3(0.02, 0.07, 0.22);
    vec3 col = mix(fill, vec3(0.6, 0.85, 1.6) * (1.0 + tenth), ring);
    float a = disc * mix(0.55, 0.9, ring) * uOpacity;
    gl_FragColor = vec4(col * a, a);
  }`;

// ------------------------------------------------------------------ distant glare

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
