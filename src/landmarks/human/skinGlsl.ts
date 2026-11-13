/**
 * Procedural human skin, shared by the hand mesh and the close-up skin patch.
 *
 * Heights are in metres on the plane of the back of the hand (H-frame x/z), built from real
 * dimensions: corneocytes (flat dead cells, ~36 µm), the criss-cross micro-relief of furrows
 * (~0.5–0.9 mm apart, ~30 µm deep), hair follicles (~2 mm apart, where the hairs come out),
 * sweat pores, and larger veins and tendons. Each layer fades out once it is smaller than a
 * pixel, so there is no shimmer at any zoom.
 */
import { FOLLICLE } from './figureSdf';

export const SKIN = /* glsl */ `
#define FOLLICLE ${FOLLICLE.toFixed(5)}
#define CELL_S 36e-6

float gMacro = 1.0;
struct SkinS { float h; float cav; float flake; float pore; float vein; float lift; };

/** Voronoi on p (cell units): returns F1, F2-F1 (edge), and the cell's random values. */
vec4 voro(vec2 p, out vec2 cid) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0; vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(ip + g);
    vec2 r = g + 0.15 + 0.7 * o - fp;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; best = ip + g; } else if (d < f2) { f2 = d; }
  }
  cid = best;
  f1 = sqrt(f1); f2 = sqrt(f2);
  return vec4(f1, f2 - f1, hash22(best + 17.0));
}

/** Distance (metres) to a family of wavy parallel lines. */
float lineFam(vec2 p, float ang, float sp, float wob, float seed) {
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-d.y, d.x);
  float along = dot(p, d), across = dot(p, nrm);
  float w = (vnoise(vec2(along / (sp * 5.5), seed)) - 0.5) * wob * sp + (vnoise(vec2(along / (sp * 1.3), seed + 5.0)) - 0.5) * 0.08 * sp;
  float k = (across + w) / sp;
  float id = floor(k + 0.5);
  float strength = 0.3 + 0.7 * hash12(vec2(id, seed));
  // lines break up along their length
  float brk = smoothstep(0.3, 0.62, vnoise(vec2(along / (sp * 1.7), id * 3.1 + seed)));
  return abs(k - id) * sp / max(strength * mix(0.35, 1.0, brk), 0.05);
}

SkinS skin(vec2 p, float fp) {
  SkinS s; s.h = 0.0; s.cav = 0.0; s.flake = 0.0; s.pore = 0.0; s.vein = 0.0; s.lift = 0.0;
  // --- macro: tendons fanning to the knuckles, veins
  {
    float wM = 1.0 - smoothstep(0.0008, 0.004, fp);
    float ten = 0.0;
    for (int i = 0; i < 4; i++) {
      float zi = 0.025 - float(i) * 0.0175;
      float zc = mix(zi * 0.45, zi, smoothstep(-0.06, 0.04, p.x));
      float d = abs(p.y - zc);
      ten += exp(-d * d / 1.6e-5) * smoothstep(-0.09, -0.03, p.x) * (1.0 - smoothstep(0.03, 0.05, p.x));
    }
    float vw = vnoise(p * 70.0) - 0.5;
    float vd = abs(sin((p.y + vw * 0.008) * 160.0 + p.x * 40.0));
    float vein = (1.0 - smoothstep(0.0, 0.25, vd)) * smoothstep(0.4, 0.7, vnoise(p * 45.0 + 3.0)) * smoothstep(-0.075, -0.05, p.x) * (1.0 - smoothstep(0.02, 0.04, p.x));
    s.vein = vein * wM;
    s.h += (ten * 0.0003 + vein * 0.00012) * wM * gMacro;
  }
  // --- primary furrows: rhombic criss-cross micro-relief
  float wF = 1.0 - smoothstep(25e-6, 90e-6, fp);
  if (wF > 0.001) {
    float d1 = lineFam(p, 0.62, 0.00062, 0.5, 1.0);
    float d2 = lineFam(p, -0.58, 0.00075, 0.5, 2.0);
    float d3 = lineFam(p, 1.57, 0.0011, 0.6, 3.0);
    float d4 = lineFam(p, 0.1, 0.0009, 0.7, 4.0);
    float wd = 42e-6 + fp * 0.5;
    float f = max(max(exp(-d1 * d1 / (wd * wd)), exp(-d2 * d2 / (wd * wd))), max(0.45 * exp(-d3 * d3 / (wd * wd)), 0.35 * exp(-d4 * d4 / (wd * wd))));
    // secondary plateaus between them
    vec2 cid;
    vec4 v2 = voro(p / 0.00021, cid);
    float g2 = pow(max(1.0 - smoothstep(0.0, 0.32, v2.y), 1e-6), 2.0) * (1.0 - smoothstep(12e-6, 40e-6, fp));
    s.h -= (f * 26e-6 + g2 * 3.5e-6) * wF;
    s.h += (v2.z - 0.5) * 3e-6 * wF;
    s.cav += (f * 0.5 + g2 * 0.12) * wF;
  }
  // --- hair follicles (same jittered grid as the hairs) and sweat pores
  {
    float wP = 1.0 - smoothstep(30e-6, 120e-6, fp);
    if (wP > 0.001) {
      vec2 q = p / FOLLICLE;
      ivec2 ic = ivec2(floor(q));
      float best = 1e9;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        ivec2 c = ic + ivec2(i, j);
        vec2 jit = pcgF(c);
        vec2 cp = (vec2(c) + 0.15 + 0.7 * jit) * FOLLICLE;
        if (length(cp) < 0.0016) continue;
        best = min(best, length(p - cp));
      }
      float pit = 1.0 - smoothstep(25e-6, 60e-6, best);
      float rq = (best - 75e-6) / 30e-6;
      float rim = exp(-rq * rq);
      s.h += (-pit * 30e-6 + rim * 4e-6) * wP;
      s.pore = max(s.pore, pit * wP);
      // sweat pores
      vec2 q2 = p / 0.00055;
      vec2 i2 = floor(q2), f2 = fract(q2);
      vec2 o = hash22(i2 + 41.0);
      float dS = length((f2 - 0.2 - 0.6 * o)) * 0.00055;
      float sp = (1.0 - smoothstep(8e-6, 18e-6, dS)) * (1.0 - smoothstep(10e-6, 30e-6, fp));
      s.h -= sp * 8e-6;
      s.pore = max(s.pore, sp * 0.6);
    }
  }
  // --- corneocytes: flat overlapping plates of dead cells
  float wC = 1.0 - smoothstep(4e-6, 13e-6, fp);
  if (wC > 0.001) {
    vec2 wp = p + (vec2(vnoise(p / 60e-6), vnoise(p / 60e-6 + 9.0)) - 0.5) * 14e-6;
    vec2 cid;
    vec4 v = voro(wp / CELL_S, cid);
    vec2 r = hash22(cid + 3.7) - 0.5;
    vec2 cc = (cid + 0.15 + 0.7 * hash22(cid)) * CELL_S;
    float tilt = dot(wp - cc, r) / CELL_S * 1.4e-6;
    float groove = pow(max(1.0 - smoothstep(0.0, 0.09, v.y), 1e-6), 1.5);
    float edgeLift = smoothstep(0.86, 0.98, v.z) * smoothstep(0.35, 0.0, v.y) * smoothstep(0.0, 0.5, dot(normalize(wp - cc + 1e-9), normalize(r + 1e-6)) + 0.3);
    float plate = (v.w - 0.5) * 1.0e-6;
    s.h += (tilt + plate - groove * 0.8e-6 + edgeLift * 2.4e-6) * wC;
    s.flake = max(s.flake, edgeLift * wC);
    s.lift = (v.z - 0.5) * wC;
    s.cav += groove * 0.5 * wC;
  }
  return s;
}

/** Skin albedo with melanin and redness variation (linear). */
vec3 skinAlbedo(vec2 p, SkinS s, float fp) {
  vec3 base = vec3(0.39, 0.225, 0.15);
  float mel = fbmAA(p * 180.0, fp * 180.0, 3);
  float red = fbmAA(p * 60.0 + 5.0, fp * 60.0, 2);
  vec3 c = base * mix(0.86, 1.1, mel);
  c = mix(c, c * vec3(1.12, 0.86, 0.85), smoothstep(0.45, 0.8, red) * 0.6);
  c = mix(c, c * vec3(0.78, 0.86, 1.08), s.vein * 0.35);
  c *= 1.0 - s.cav * 0.28;
  c = mix(c, c * vec3(0.55, 0.42, 0.38), s.pore * 0.7);
  // the dead-cell layer seen up close: pale, translucent keratin plates, white where lifted
  float wC = 1.0 - smoothstep(4e-6, 13e-6, fp);
  c = mix(c, vec3(0.60, 0.47, 0.38) * (0.92 + 0.16 * s.lift), wC * 0.38);
  c = mix(c, vec3(0.86, 0.80, 0.72), s.flake * 0.65);
  return c;
}

float ggx(vec3 n, vec3 h, float a) {
  float a2 = a * a;
  float nh = max(dot(n, h), 0.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

/** Skin lighting: warm wrapped diffuse (red light scatters further), sebum specular, sheen, translucency. */
vec3 skinShade(vec3 alb, vec3 n, vec3 v, float sh, float ao, float thin, float cav, float spec) {
  vec3 L = uSun;
  float ndl = dot(n, L);
  vec3 wrap = vec3(0.45, 0.22, 0.14);
  vec3 diff = clamp((vec3(ndl) + wrap) / (1.0 + wrap), 0.0, 1.0);
  diff *= diff * (3.0 - 2.0 * diff) * 0.35 + 0.65 * diff;
  float shs = max(sh, 1e-4);
  vec3 shc = vec3(pow(shs, 0.55), pow(shs, 0.85), sh);
  vec3 col = alb * uSunCol * diff * shc;
  col += alb * skyIrr(n) * ao * 1.35;
  vec3 h = normalize(L + v);
  float nv = max(dot(n, v), 0.02);
  float F = 0.028 + 0.972 * pow(max(1.0 - max(dot(v, h), 0.0), 1e-6), 5.0);
  float s1 = ggx(n, h, 0.34) * 0.75 + ggx(n, h, 0.62) * 0.25;
  col += uSunCol * F * s1 * max(ndl, 0.0) * sh * spec * (1.0 - cav * 0.7) / (4.0 * nv + 0.5) * 2.2;
  // soft sheen from fine vellus hair and the dry outer layer
  float rim = pow(max(1.0 - nv, 1e-6), 4.0);
  col += skyCol(reflect(-v, n)) * rim * 0.12 * ao;
  // light glowing through thin parts (fingers, ear rims) when the sun is behind them
  float back = pow(max(dot(v, -L), 1e-6), 2.5);
  col += vec3(1.0, 0.3, 0.12) * uSunCol * thin * thin * back * 0.05 * (0.4 + 0.6 * sh);
  return col;
}
`;
