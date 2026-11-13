/**
 * Procedural human skin, shared by the hand mesh and the close-up skin patch.
 *
 * Heights are in metres on the plane of the back of the hand (H-frame x/z), built from real
 * dimensions: corneocytes (flat dead cells, ~36 µm), the criss-cross micro-relief of furrows
 * (~0.5–0.9 mm apart, ~30 µm deep), hair follicles (~2 mm apart, where the hairs come out),
 * sweat pores, and larger veins and tendons. Each layer fades out once it is smaller than a
 * pixel, so there is no shimmer at any zoom.
 */
import { FOLLICLE } from './pose';
import { CELL_TILE_N, G_MAX, H_MIN, H_SPAN, PLAT_TILE_N, TEX_SIZE } from './skinTex';

export const SKIN = /* glsl */ `
#define FOLLICLE ${FOLLICLE.toFixed(5)}

float gMacro = 1.0;
uniform sampler2D tCells; uniform sampler2D tPlat;
#define CELL_TILE (${CELL_TILE_N}.0 * 36e-6)
#define PLAT_TILE (${PLAT_TILE_N}.0 * 0.21e-3)
/** h: height (m); g: height gradient (dh/dx, dh/dz) on the back-of-hand plane; shading masks. */
struct SkinS { float h; vec2 g; float cav; float flake; float pore; float vein; float lift; };

/** Wavy parallel lines: distance to the nearest line (m) and its gradient. */
vec3 lineFam(vec2 p, float ang, float sp, float wob, float seed) {
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-d.y, d.x);
  float along = dot(p, d), across = dot(p, nrm);
  float w = (vnoise(vec2(along / (sp * 5.5), seed)) - 0.5) * wob * sp;
  float k = (across + w) / sp;
  float id = floor(k + 0.5);
  float strength = 0.3 + 0.7 * hash12(vec2(id, seed));
  float brk = smoothstep(0.3, 0.62, vnoise(vec2(along / (sp * 1.7), id * 3.1 + seed)));
  float sc = 1.0 / max(strength * mix(0.35, 1.0, brk), 0.05);
  return vec3(abs(k - id) * sp * sc, nrm * sign(k - id) * sc);
}

/** Sample a relief tile (height µm, gradient µm/texel) at uv; returns (h m, dh/du, dh/dv per m). */
vec4 reliefTex(sampler2D t, vec2 uv, float tile, out float aux) {
  vec4 c = texture(t, uv);
  aux = c.a;
  float h = (c.r * ${H_SPAN.toFixed(2)} + ${H_MIN.toFixed(2)}) * 1e-6;
  vec2 g = (c.gb - 0.5) * ${(2 * G_MAX).toFixed(3)} * 1e-6 / (tile / ${TEX_SIZE}.0);
  return vec4(h, g, 0.0);
}

SkinS skin(vec2 p, float fp) {
  SkinS s; s.h = 0.0; s.g = vec2(0.0); s.cav = 0.0; s.flake = 0.0; s.pore = 0.0; s.vein = 0.0; s.lift = 0.0;
  // --- macro: tendons fanning to the knuckles (relief) and veins (colour only)
  {
    float wM = 1.0 - smoothstep(0.0008, 0.004, fp);
    if (wM > 0.001) {
      float mx = smoothstep(-0.09, -0.03, p.x) * (1.0 - smoothstep(0.03, 0.05, p.x));
      for (int i = 0; i < 4; i++) {
        float zi = 0.025 - float(i) * 0.0175;
        float zc = mix(zi * 0.45, zi, smoothstep(-0.06, 0.04, p.x));
        float d = p.y - zc;
        float e = exp(-d * d / 1.6e-5) * mx;
        s.h += e * 0.0003 * wM * gMacro;
        s.g.y += -2.0 * d / 1.6e-5 * e * 0.0003 * wM * gMacro;
      }
      float vd = abs(sin((p.y + (vnoise(p * 70.0) - 0.5) * 0.008) * 160.0 + p.x * 40.0));
      s.vein = (1.0 - smoothstep(0.0, 0.25, vd)) * smoothstep(0.4, 0.7, vnoise(p * 45.0 + 3.0)) * smoothstep(-0.075, -0.05, p.x) * (1.0 - smoothstep(0.02, 0.04, p.x)) * wM;
    }
  }
  // --- primary furrows: criss-cross micro-relief (analytic slope of the deepest one)
  float wF = 1.0 - smoothstep(25e-6, 90e-6, fp);
  if (wF > 0.001) {
    float wd = 42e-6 + fp * 0.5;
    float iw = 1.0 / (wd * wd);
    vec3 L1 = lineFam(p, 0.62, 0.00062, 0.5, 1.0);
    vec3 L2 = lineFam(p, -0.58, 0.00075, 0.5, 2.0);
    vec3 L3 = lineFam(p, 1.57, 0.0011, 0.6, 3.0);
    float f1 = exp(-L1.x * L1.x * iw), f2 = exp(-L2.x * L2.x * iw), f3 = 0.45 * exp(-L3.x * L3.x * iw);
    float f = f1; vec2 gf = -2.0 * L1.x * iw * f1 * L1.yz;
    if (f2 > f) { f = f2; gf = -2.0 * L2.x * iw * f2 * L2.yz; }
    if (f3 > f) { f = f3; gf = -2.0 * L3.x * iw * f3 * L3.yz; }
    s.h -= f * 26e-6 * wF;
    s.g -= gf * 26e-6 * wF;
    s.cav += f * 0.5 * wF;
    // shallow plateaus between the furrows (tile texture, rotated to hide the grid)
    float wPl = 1.0 - smoothstep(12e-6, 40e-6, fp);
    if (wPl > 0.001) {
      mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
      float a;
      vec4 r = reliefTex(tPlat, (R * p) / PLAT_TILE, PLAT_TILE, a);
      s.h += r.x * wF * wPl;
      s.g += (transpose(R) * r.yz) * wF * wPl;
      s.cav += max(0.5 - a, 0.0) * 0.24 * wF * wPl;
    }
  }
  // --- hair follicles (same jittered grid as the hairs) and sweat pores
  {
    float wP = 1.0 - smoothstep(30e-6, 120e-6, fp);
    if (wP > 0.001) {
      vec2 q = p / FOLLICLE;
      ivec2 ic = ivec2(floor(q));
      float best = 1e9; vec2 bv = vec2(0.0);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        ivec2 c = ic + ivec2(i, j);
        vec2 cp = (vec2(c) + 0.15 + 0.7 * pcgF(c)) * FOLLICLE;
        if (length(cp) < 0.0016) continue;
        float l = length(p - cp);
        if (l < best) { best = l; bv = p - cp; }
      }
      vec2 db = bv / max(best, 1e-9);
      float t = clamp((best - 25e-6) / 35e-6, 0.0, 1.0);
      float pit = 1.0 - t * t * (3.0 - 2.0 * t);
      float dpit = -6.0 * t * (1.0 - t) / 35e-6;
      float rq = (best - 75e-6) / 30e-6;
      float rim = exp(-rq * rq);
      float drim = -2.0 * rq / 30e-6 * rim;
      s.h += (-pit * 30e-6 + rim * 4e-6) * wP;
      s.g += (-dpit * 30e-6 + drim * 4e-6) * db * wP;
      s.pore = max(s.pore, pit * wP);
      // sweat pores (shading only)
      vec2 q2 = p / 0.00055;
      vec2 i2 = floor(q2), f2 = fract(q2);
      float dS = length((f2 - 0.2 - 0.6 * hash22(i2 + 41.0))) * 0.00055;
      float sp = (1.0 - smoothstep(8e-6, 18e-6, dS)) * (1.0 - smoothstep(10e-6, 30e-6, fp));
      s.pore = max(s.pore, sp * 0.6);
      s.cav += sp * 0.3;
    }
  }
  // --- corneocytes: flat, overlapping plates of dead cells (tile texture)
  float wC = 1.0 - smoothstep(4e-6, 13e-6, fp);
  if (wC > 0.001) {
    mat2 R = mat2(0.93, 0.37, -0.37, 0.93);
    float a;
    vec4 r = reliefTex(tCells, (R * p) / CELL_TILE, CELL_TILE, a);
    s.h += r.x * wC;
    s.g += (transpose(R) * r.yz) * wC;
    s.flake = max(a - 0.5, 0.0) * 2.0 * wC;
    s.cav += max(0.5 - a, 0.0) * wC;
    s.lift = (r.x * 1e6 / 2.0) * wC;
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
