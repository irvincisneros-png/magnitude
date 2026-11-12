/**
 * Earth shaders.
 *
 * The globe, its clouds and its atmosphere are ray-traced per pixel on one full-screen pass,
 * so the sphere is mathematically exact at every zoom (from 800 m above Wollongong out to a
 * 5-pixel dot). All maths is written relative to the anchor at the origin, which keeps it
 * precise to well under a metre close in: for a point p, |p − C|² − R² = p·p + p.y exactly.
 *
 * Units: 1 local unit = 1.27e7 m (Earth's diameter). Earth centre C = (0, −0.5, 0), R = 0.5.
 */

export const UNIT_M = 1.27e7;

const common = /* glsl */ `
  #define PI 3.14159265
  #define R_E 0.5
  #define UNIT_M 1.27e7
  // Atmosphere (Bruneton/Hillaire-style coefficients, converted to per-unit).
  #define H_R (8000.0 / UNIT_M)
  #define H_M (1200.0 / UNIT_M)
  #define ATM_TOP (100000.0 / UNIT_M)
  const vec3 BETA_R = vec3(4.2e-6, 13.0e-6, 33.1e-6) * UNIT_M; // red slightly lowered: reads as sky blue, not lavender
  const float BETA_M_S = 4.0e-6 * UNIT_M;
  const float BETA_M_E = 4.4e-6 * UNIT_M;
  const vec3 BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6) * UNIT_M;
  // Artistic clarity: a little less haze than the physical values so the ground reads at grazing angles.
  #define SCAT_SCALE 0.6
  #define EXT_SCALE 0.8
  #define OZ_C (25000.0 / UNIT_M)
  #define OZ_W (15000.0 / UNIT_M)
  #define OZ_COL (15000.0 / UNIT_M)
`;

export const planetVert = /* glsl */ `
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  varying vec3 vDir;
  void main() {
    vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
    v.xyz /= v.w;
    vDir = (uCamWorld * vec4(v.xyz, 0.0)).xyz;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const planetFrag = /* glsl */ `
  precision highp float;
  precision highp int;
  ${common}
  uniform vec3 uCamPos;
  uniform vec3 uSun;          // unit vector towards the Sun (local frame)
  uniform float uSunE;        // solar irradiance scale
  uniform vec3 uEast, uUp, uNorth; // anchor basis in geo coordinates
  uniform vec3 uPole;         // spin axis in local coordinates
  uniform float uPixAng;      // radians per pixel
  uniform float uTime;
  uniform float uCloudRot;    // cloud drift (radians of longitude)
  uniform float uCloudFade;   // cloud layer opacity (fades when the camera dips to cloud height)
  uniform float uDetail;      // 0..1 how much procedural close-up detail to use
  uniform vec4 uRegion;       // lon0 (deg), lat0 top (deg), span (deg), texel (units)
  uniform float uGlobalTexel; // global texel size in units
  uniform sampler2D tDay, tNight, tClouds, tSurf, tRegDay, tRegSurf;
  varying vec3 vDir;

  // ------------------------------------------------------------ precise sphere maths
  // q(p) = |p - C|^2 - R^2 for C = (0,-R,0)
  float qf(vec3 p) { return dot(p, p) + 2.0 * R_E * p.y; }
  float heightOf(vec3 p) {
    vec3 d = p + vec3(0.0, R_E, 0.0);
    return qf(p) / (length(d) + R_E);
  }
  // Ray vs sphere of radius R+a centred on C. dR2 = (R+a)^2 - R^2. Returns false on a miss.
  bool shell(vec3 o, vec3 d, float dR2, out float t0, out float t1) {
    float b = dot(d, o) + R_E * d.y;
    float c = qf(o) - dR2;
    float disc = b * b - c;
    if (disc < 0.0) { t0 = t1 = -1.0; return false; }
    float s = sqrt(disc);
    float q = b > 0.0 ? -b - s : -b + s;
    float ta = c / q, tb = q;
    t0 = min(ta, tb); t1 = max(ta, tb);
    return true;
  }

  // ------------------------------------------------------------ hashing / noise
  uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v;
  }
  vec3 h3(vec3 i) { return vec3(pcg3d(uvec3(ivec3(i) + 32768))) * (2.0 / 4294967295.0) - 1.0; }
  // 3-channel value noise in [-1, 1]
  vec3 vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), u.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), u.x), u.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), u.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), u.x), u.y), u.z);
  }
  const mat3 OCT_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  // Scale-adaptive fbm: octaves start at frequency f0 and stop once they get smaller than ~2 px.
  vec3 afbm(vec3 p, float f0, float fp, float gain) {
    vec3 s = vec3(0.0); float a = 1.0, norm = 0.0, f = f0;
    for (int i = 0; i < DETAIL_OCT; i++) {
      float w = 1.0 - smoothstep(0.1, 0.3, f * fp);
      norm += a;
      if (w <= 0.0) break;
      s += a * w * vnoise3(p * f + float(i) * 17.31);
      p = OCT_ROT * p;
      a *= gain; f *= 2.03;
    }
    return s / max(norm, 1e-4);
  }

  // ------------------------------------------------------------ atmosphere
  float chapman(float X, float mu) {
    float c = sqrt(1.5707963 * X);
    return c / ((c - 1.0) * mu + 1.0);
  }
  // Optical depth from radius r (height h) to space towards a direction with cosine mu.
  float odToSpace(float h, float r, float mu, float H) {
    if (mu >= 0.0) return H * exp(-h / H) * chapman(r / H, mu);
    float sinZ = sqrt(max(1.0 - mu * mu, 0.0));
    float ht = h - r * (1.0 - sinZ);          // tangent height
    float Xt = (R_E + ht) / H;
    float a = 2.0 * H * exp(min(-ht / H, 60.0)) * sqrt(1.5707963 * Xt);
    return a - H * exp(-h / H) * chapman(r / H, -mu);
  }
  vec3 sunTrans(float h, float r, float mu) {
    float dR = odToSpace(h, r, mu, H_R);
    float dM = odToSpace(h, r, mu, H_M);
    float air = dR / max(H_R * exp(-h / H_R), 1e-12);
    float dO = OZ_COL * (1.0 - smoothstep(OZ_C - OZ_W, OZ_C + OZ_W, h)) * min(air, 40.0);
    return exp(-(BETA_R * dR + BETA_M_E * dM + BETA_O * dO));
  }
  float phaseR(float c) { return 0.0596831 * (1.0 + c * c); }
  float phaseM(float c) {
    const float g = 0.76;
    float k = 1.0 + g * g - 2.0 * g * c;
    return 0.1193662 * (1.0 - g * g) * (1.0 + c * c) / ((2.0 + g * g) * pow(k, 1.5));
  }

  // ------------------------------------------------------------ textures
  vec2 geoUV(vec3 g) {
    return vec2(atan(g.y, g.x) / (2.0 * PI) + 0.5, asin(clamp(g.z, -1.0, 1.0)) / PI + 0.5);
  }
  vec3 toGeo(vec3 n) { return uEast * n.x + uUp * n.y - uNorth * n.z; }

  struct Grad { vec2 dx; vec2 dy; };
  Grad seamGrad(vec2 uv) {
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    vec2 w = vec2(fract(uv.x + 0.5), uv.y);
    vec2 dx2 = dFdx(w), dy2 = dFdy(w);
    if (dot(dx2, dx2) + dot(dy2, dy2) < dot(dx, dx) + dot(dy, dy)) { dx = dx2; dy = dy2; }
    return Grad(dx, dy);
  }
  vec2 regionUV(vec2 uv) {
    float lon = uv.x * 360.0 - 180.0, lat = uv.y * 180.0 - 90.0;
    return vec2((lon - uRegion.x) / uRegion.z, 1.0 - (uRegion.y - lat) / uRegion.z);
  }

  float cloudCover(vec2 uv, Grad g, vec3 gr, float fp, float wdC) {
    float c = textureGrad(tClouds, uv, g.dx, g.dy).r;
    float cov = smoothstep(0.16, 0.92, c);
    #if DETAIL_OCT > 0
    if (wdC > 0.0) {
      // erode the soft 20 km texels into billows; thin cloud breaks up, thick cloud survives
      vec3 n = afbm(gr * 0.5, 600.0, fp, 0.55);
      float e = clamp(n.x * 0.6 + 0.45, 0.0, 1.0) * 0.5;
      float c2 = clamp((cov - e) / max(1.0 - e, 0.05), 0.0, 1.0);
      c2 = smoothstep(0.0, 0.85, c2) * (0.85 + 0.3 * n.y);
      // sparse fair-weather wisps where the map is clear (only once well zoomed in)
      float wz = smoothstep(4.0, 30.0, (2.0 / 2048.0 * PI * R_E) / fp);
      if (wz > 0.0) {
        vec3 w3 = afbm(gr * 0.5 + 3.7, 2500.0, fp, 0.62);
        float wisp = smoothstep(0.08, 0.6, w3.y + 0.35 * w3.z) * smoothstep(-0.1, 0.4, n.z);
        c2 = max(c2, wisp * 0.8 * uDetail * wz);
      }
      cov = mix(cov, c2, wdC);
    }
    #endif
    return clamp(cov, 0.0, 1.0);
  }

  // ------------------------------------------------------------ ocean waves (local tangent plane, metres)
  vec3 waves(vec2 xm, float fpm, float t, out float unresolved) {
    vec2 s = vec2(0.0); unresolved = 0.0;
    float lam = 210.0;
    float warp = 0.0;
    for (int i = 0; i < 9; i++) {
      float ang = -1.85 + 0.9 * sin(float(i) * 2.4) + 0.35 * float(i & 1) + 0.6 * sin(float(i) * 5.1);
      vec2 dir = vec2(cos(ang), sin(ang));
      float k = 2.0 * PI / lam;
      float w = sqrt(9.81 * k);
      float slope = 0.022 + 0.007 * float(i);
      float res = 1.0 - smoothstep(0.22, 0.6, fpm / lam);
      float ph = dot(dir, xm) * k - w * t + float(i) * 1.7 + warp;
      s += dir * cos(ph) * slope * res;
      unresolved += 0.5 * slope * slope * (1.0 - res);
      warp = 1.3 * sin(ph * 0.37 + dot(xm, dir.yx) * k * 0.21);
      lam *= 0.66;
    }
    return normalize(vec3(-s.x, 1.0, -s.y));
  }

  void main() {
    vec3 rd = normalize(vDir);
    vec3 ro = uCamPos;
    float hc0 = heightOf(ro);
    if (hc0 < 0.0) ro += normalize(ro + vec3(0.0, R_E, 0.0)) * (-hc0 + 2.0 / UNIT_M); // under the ground: lift to the surface

    float ta0, ta1;
    bool inAtm = shell(ro, rd, ATM_TOP * (2.0 * R_E + ATM_TOP), ta0, ta1);
    float tg0, tg1;
    bool hitG = shell(ro, rd, 0.0, tg0, tg1) && tg0 > 0.0;
    const float CLOUD_H = 2500.0 / UNIT_M;
    float tc0, tc1;
    bool hitC = shell(ro, rd, CLOUD_H * (2.0 * R_E + CLOUD_H), tc0, tc1);
    float tCloud = tc0 > 0.0 ? tc0 : tc1; // from below the layer, use the far root
    hitC = hitC && tCloud > 0.0 && (!hitG || tCloud < tg0) && uCloudFade > 0.001;

    // Surface coordinates (computed for every pixel so derivatives stay well defined)
    vec3 P = ro + rd * max(tg0, 0.0);
    vec3 n = normalize(P + vec3(0.0, R_E, 0.0));
    vec3 g = toGeo(n);
    vec2 uv = geoUV(g);
    Grad gd = seamGrad(uv);
    vec3 Pc = ro + rd * max(tCloud, 0.0);
    vec3 nc = normalize(Pc + vec3(0.0, R_E, 0.0));
    vec2 uvc = geoUV(toGeo(nc)) + vec2(uCloudRot / (2.0 * PI), 0.0);
    Grad gdc = seamGrad(uvc);

    if (!inAtm || ta1 <= 0.0) { gl_FragColor = vec4(0.0); return; }

    vec3 L = uSun;
    vec3 V = -rd;
    float tStart = max(ta0, 0.0);
    float tEnd = hitG ? tg0 : ta1;

    // ---------------------------------------------------------------- surface
    vec3 surf = vec3(0.0);
    float alphaSurf = 0.0;
    float rot = uCloudRot;
    mat2 cr = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)); // geo -> cloud-texture frame

    if (hitG) {
      float cosI = max(dot(n, V), 0.02);
      float fp = tg0 * uPixAng / sqrt(cosI);         // pixel footprint (units)
      float fpm = fp * UNIT_M;
      float mu = dot(n, L);

      // Which imagery covers this pixel, and how magnified is it?
      vec2 ruv0 = regionUV(uv);
      float rw = smoothstep(0.0, 0.05, min(min(ruv0.x, 1.0 - ruv0.x), min(ruv0.y, 1.0 - ruv0.y)));
      float texel = mix(uGlobalTexel, uRegion.w, rw);
      float wd = smoothstep(1.0, 4.0, texel / fp) * uDetail;   // texture magnified -> add detail
      vec3 dn = vec3(0.0);
      #if DETAIL_OCT > 0
      if (wd > 0.0) dn = afbm(P, 0.7 / texel, fp, 0.6);
      #endif
      // Domain-warp the lookups by up to ~1 texel so magnified pixels become organic shapes.
      float cl = max(cos(asin(clamp(g.z, -1.0, 1.0))), 0.2);
      vec2 warp = vec2(dn.x / cl, dn.y) * (texel / R_E) / vec2(2.0 * PI, PI) * 1.1 * wd;
      uv += warp;
      vec2 ruv = ruv0 + warp * vec2(360.0, 180.0) / uRegion.z;

      // Global + regional (500 m) imagery
      vec3 day = textureGrad(tDay, uv, gd.dx, gd.dy).rgb;
      vec3 sf = textureGrad(tSurf, uv, gd.dx, gd.dy).rgb;
      if (rw > 0.0) {
        vec2 k = vec2(360.0, 180.0) / uRegion.z;
        vec3 rday = textureGrad(tRegDay, ruv, gd.dx * k, gd.dy * k).rgb;
        vec3 rsf = textureGrad(tRegSurf, ruv, gd.dx * k, gd.dy * k).rgb;
        day = mix(day, rday, rw); sf = mix(sf, rsf, rw);
      }
      float nightTex = textureGrad(tNight, uv, gd.dx, gd.dy).r;

      // Relief normal from the elevation channel
      vec3 eastL = normalize(cross(uPole, n) + 1e-7);
      vec3 northL = cross(n, eastL);
      vec3 nn = n;
      {
        float du = rw > 0.5 ? 1.0 / 2048.0 : 1.0 / 4096.0;
        float hE, hW, hN, hS;
        if (rw > 0.5) {
          vec2 k = vec2(360.0, 180.0) / uRegion.z;
          hE = textureGrad(tRegSurf, ruv + vec2(du, 0.0), gd.dx * k, gd.dy * k).g;
          hW = textureGrad(tRegSurf, ruv - vec2(du, 0.0), gd.dx * k, gd.dy * k).g;
          hN = textureGrad(tRegSurf, ruv + vec2(0.0, du), gd.dx * k, gd.dy * k).g;
          hS = textureGrad(tRegSurf, ruv - vec2(0.0, du), gd.dx * k, gd.dy * k).g;
        } else {
          hE = textureGrad(tSurf, uv + vec2(du, 0.0), gd.dx, gd.dy).g;
          hW = textureGrad(tSurf, uv - vec2(du, 0.0), gd.dx, gd.dy).g;
          hN = textureGrad(tSurf, uv + vec2(0.0, du * 2.0), gd.dx, gd.dy).g;
          hS = textureGrad(tSurf, uv - vec2(0.0, du * 2.0), gd.dx, gd.dy).g;
        }
        float spanM = rw > 0.5 ? uRegion.z / 2048.0 * 111000.0 : 360.0 / 4096.0 * 111000.0;
        float ex = rw > 0.5 ? 2.0 : 6.0;
        vec2 sl = vec2((hE - hW) / (2.0 * spanM * cl), (hN - hS) / (2.0 * spanM)) * 6400.0 * ex;
        nn = normalize(n - sl.x * eastL - sl.y * northL);
      }

      // Water fraction with a fractal coastline when magnified
      float m = sf.r;
      float aa = clamp(fp / texel, 0.03, 0.5);
      float mDet = m + dn.z * 0.22 * wd;
      float water = smoothstep(0.5 - aa, 0.5 + aa, mix(m, mDet, wd));

      // Cloud shadow (sampled where the sun ray crosses the cloud layer)
      vec3 Ps = P + L * (CLOUD_H / max(mu, 0.08));
      vec3 ns = normalize(Ps + vec3(0.0, R_E, 0.0));
      vec3 gs = toGeo(ns);
      vec2 uvs = geoUV(gs) + vec2(uCloudRot / (2.0 * PI), 0.0);
      vec3 gsr = vec3(cr * gs.xy, gs.z);
      float shadowCov = cloudCover(uvs, gd, gsr, fp * 4.0, wd) * uCloudFade; // coarser detail is enough for soft shadows
      float sh = 1.0 - 0.75 * shadowCov;

      vec3 Ts = sunTrans(0.0, R_E, mu);
      float daylight = smoothstep(-0.12, 0.08, mu);
      vec3 skyAmb = uSunE * vec3(0.030, 0.050, 0.095) * smoothstep(-0.2, 0.35, mu);

      // ---- land
      vec3 alb = day;
      #if DETAIL_OCT > 0
      if (wd > 0.0) {
        vec3 fn = afbm(P + 11.3, 4.0 / texel, fp, 0.58);
        float lum = dot(alb, vec3(0.3, 0.5, 0.2));
        // canopy, paddocks and bare ground, keeping the photo's overall brightness and hue
        float clear = smoothstep(0.05, 0.45, fn.y + (lum - 0.05) * 5.0);
        vec3 forest = vec3(0.020, 0.036, 0.016), grass = vec3(0.085, 0.10, 0.045), soil = vec3(0.17, 0.14, 0.09);
        vec3 tint = mix(forest, mix(grass, soil, smoothstep(0.0, 0.6, fn.z)), clear);
        vec3 detailCol = mix(alb, tint * (lum / max(dot(tint, vec3(0.3, 0.5, 0.2)), 1e-4)), 0.55);
        detailCol *= 0.8 + 0.55 * smoothstep(-0.35, 0.35, fn.x); // clumps of canopy and shade
        // towns: the night-lights map doubles as an urban mask; streets and roofs once they resolve
        float urb = smoothstep(0.2, 0.75, nightTex) * 0.6;
        vec2 xm = mat2(0.92, 0.39, -0.39, 0.92) * (P.xz * UNIT_M);
        vec2 cell = floor(xm / 16.0);
        vec3 hc = h3(vec3(cell, 7.0)) * 0.5 + 0.5;
        vec3 roofCol = mix(vec3(0.20, 0.17, 0.15), vec3(0.24, 0.11, 0.07), hc.y) * (0.6 + 0.7 * hc.z);
        float isRoof = step(0.42, hc.x) * (1.0 - smoothstep(0.2, 0.7, fn.y));
        vec3 town = mix(vec3(0.05, 0.065, 0.035), roofCol, isRoof); // gardens and street trees between roofs
        town = mix(vec3(0.10, 0.10, 0.085), town, 1.0 - smoothstep(6.0, 20.0, fpm));
        detailCol = mix(detailCol, town, urb);
        // beach on the land side of the shoreline
        float beach = smoothstep(0.40, 0.49, mDet) * (1.0 - water);
        detailCol = mix(detailCol, vec3(0.42, 0.37, 0.27) * (0.9 + 0.2 * fn.z), beach * 0.85);
        alb = mix(alb, detailCol, wd);
      }
      #endif
      float ndl = max(dot(nn, L), 0.0);
      vec3 land = alb * 1.35 * (uSunE / PI * Ts * ndl * sh + skyAmb * 0.8);

      // ---- ocean
      float unres;
      vec2 xm = P.xz * UNIT_M;
      vec3 wn = waves(xm, fpm, uTime, unres);
      vec3 wN = normalize(n + (eastL * wn.x - northL * wn.z) * 1.0); // local tangent tilt (x east, z south)
      wN = normalize(mix(n, wN, smoothstep(0.0, 1.0, uDetail)));
      vec3 H = normalize(L + V);
      float a2 = 0.0016 + 2.0 * unres + 0.012;
      float nh = max(dot(wN, H), 0.0);
      float dd = nh * nh * (a2 - 1.0) + 1.0;
      float D = a2 / (PI * dd * dd);
      float vh = max(dot(V, H), 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
      float nv = max(dot(wN, V), 0.02), nl = max(dot(wN, L), 0.0);
      float kG = sqrt(a2) * 0.5;
      float G = nv / (nv * (1.0 - kG) + kG) * nl / (nl * (1.0 - kG) + kG);
      vec3 spec = uSunE * Ts * sh * D * F * G / (4.0 * nv + 1e-4);
      float Fv = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
      vec3 skyRefl = uSunE * vec3(0.03, 0.06, 0.125) * daylight * (0.6 + 0.4 * sh);
      vec3 waterBody = mix(vec3(0.0035, 0.010, 0.026), vec3(0.010, 0.032, 0.040), smoothstep(0.80, 0.97, sf.b));
      vec3 ocean = waterBody * (uSunE / PI * Ts * max(mu, 0.0) * sh * 0.8 + skyAmb) * (1.0 - Fv) + skyRefl * Fv + spec;
      // surf and whitecaps when close
      #if DETAIL_OCT > 0
      if (wd > 0.0) {
        float shore = smoothstep(0.56, 0.5, mDet) * water;
        float bands = smoothstep(0.55, 0.95, sin(mDet * 46.0 - uTime * 0.9 + dn.y * 3.0) * 0.5 + 0.5);
        float foam = shore * (0.35 + 0.65 * bands) * smoothstep(0.3, 0.7, dn.z * 0.5 + 0.5 + 0.3);
        float caps = smoothstep(0.80, 0.95, vnoise3(vec3(xm / 9.0, uTime * 0.25)).x * 0.5 + 0.5) * (1.0 - smoothstep(1.5, 6.0, fpm));
        foam = clamp(foam + caps * 0.5, 0.0, 1.0) * wd;
        ocean = mix(ocean, vec3(0.5) * (uSunE / PI * Ts * max(mu, 0.0) * sh + skyAmb), foam);
      }
      #endif

      surf = mix(land, ocean, water);
      // city lights on the night side
      vec3 lights = vec3(1.0, 0.64, 0.32) * (pow(nightTex, 1.7) * 3.2 + smoothstep(0.55, 1.0, nightTex) * 2.5) * (1.0 - water * 0.9);
      surf += lights * (1.0 - daylight) * (1.0 - 0.8 * shadowCov);
      surf += alb * vec3(0.010, 0.013, 0.020) * (1.0 - daylight); // faint moonlit/airglow ground on the night side
      alphaSurf = 1.0;
    }

    // ---------------------------------------------------------------- clouds
    float ca = 0.0;
    vec3 cloudRad = vec3(0.0);
    if (hitC) {
      float cosI = max(abs(dot(nc, V)), 0.02);
      float fp = tCloud * uPixAng / sqrt(cosI);
      vec3 gc = toGeo(nc);
      vec3 gcr = vec3(cr * gc.xy, gc.z);
      float wdC = smoothstep(1.0, 4.0, (2.0 / 2048.0 * PI * R_E) / fp) * uDetail;
      ca = cloudCover(uvc, gdc, gcr, fp, wdC) * uCloudFade;
      float muc = dot(nc, L);
      vec3 Tc = sunTrans(CLOUD_H, R_E + CLOUD_H, muc);
      float lit = smoothstep(-0.08, 0.35, muc);
      float shade = 0.72 + 0.28 * smoothstep(0.2, 0.9, ca);
      float fwd = 1.0 + 0.6 * pow(max(dot(rd, L), 0.0), 8.0);
      cloudRad = vec3(0.6) * (uSunE / PI * Tc * (0.25 + 0.75 * lit) * lit * shade * fwd + uSunE * vec3(0.03, 0.045, 0.075) * smoothstep(-0.2, 0.3, muc));
      if (dot(nc, V) < 0.0) cloudRad *= 0.55; // seen from underneath: shadowed cloud bases
      if (hitG) surf = mix(surf, cloudRad, ca);
      else { surf = cloudRad * ca; alphaSurf = ca; }
    }

    // ---------------------------------------------------------------- atmosphere march
    float seg = max(tEnd - tStart, 0.0);
    vec3 T = vec3(1.0), S = vec3(0.0);
    float camH = heightOf(ro);
    float expo = camH < ATM_TOP ? 2.0 : 1.0;
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float cv = dot(rd, L);
    float pR = phaseR(cv), pM = phaseM(cv);
    float prev = 0.0;
    for (int i = 0; i < ATM_STEPS; i++) {
      float x1 = pow((float(i) + 1.0) / float(ATM_STEPS), expo);
      float xm_ = pow((float(i) + jit) / float(ATM_STEPS), expo);
      float ds = (x1 - prev) * seg; prev = x1;
      vec3 p = ro + rd * (tStart + xm_ * seg);
      float h = max(heightOf(p), 0.0);
      float r = R_E + h;
      vec3 up = (p + vec3(0.0, R_E, 0.0)) / r;
      float mus = dot(up, L);
      float dR = exp(-h / H_R), dM = exp(-h / H_M);
      float dO = max(0.0, 1.0 - abs(h - OZ_C) / OZ_W);
      vec3 ext = (BETA_R * dR + BETA_M_E * dM) * EXT_SCALE + BETA_O * dO;
      vec3 Ts = sunTrans(h, r, mus);
      vec3 scat = (BETA_R * dR * pR + BETA_M_S * dM * pM) * Ts * SCAT_SCALE;
      vec3 ms = (BETA_R * dR + BETA_M_S * dM) * vec3(0.008, 0.016, 0.030) * smoothstep(-0.25, 0.3, mus);
      vec3 stepT = exp(-ext * ds);
      S += T * (scat + ms) * (1.0 - stepT) / max(ext, vec3(1e-6));
      T *= stepT;
    }
    S *= uSunE;

    vec3 col = surf * T + S;
    float alpha = hitG ? 1.0 : clamp(1.0 - dot(T, vec3(0.333)) * (1.0 - alphaSurf) + 0.0, 0.0, 1.0);

    // the Sun's disc seen from inside the air
    if (!hitG && camH < ATM_TOP) {
      float sd = smoothstep(0.99998, 0.999992, cv);
      col += T * sd * 60.0 * (1.0 - ca);
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

export const starVert = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  uniform float uDist;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec3 v = mat3(viewMatrix) * position * uDist;
    gl_Position = projectionMatrix * vec4(v, 1.0);
    gl_PointSize = size * uScale;
  }
`;

export const starFrag = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    float a = exp(-r2 * 5.0) * (1.0 - smoothstep(0.7, 1.0, r2));
    gl_FragColor = vec4(vColor * a * uOpacity, 0.0);
  }
`;
