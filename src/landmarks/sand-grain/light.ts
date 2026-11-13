/**
 * The light of the sand-grain scene. It MUST match the `human` landmark (src/landmarks/human/glsl.ts),
 * whose skin is drawn underneath this layer: same Sun direction and colour, same sky gradient and
 * sky ambient. If the human scene is retuned, change the constants in this block only.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------ retune here
/** Sun azimuth (degrees, from −Z towards +X) and elevation, as in human/glsl.ts makeShared(). */
export const SUN_AZ_DEG = 72;
export const SUN_EL_DEG = 22;
/** Linear sun colour × intensity (human: (1.0, 0.84, 0.66) × 2.6). */
export const SUN_COL: [number, number, number] = [2.6, 2.184, 1.716];
/** Sky ambient (human skyIrr): zenith-side colour, ground-side colour, extra towards the sun. */
export const SKY_AMB_UP: [number, number, number] = [0.16, 0.25, 0.42];
export const SKY_AMB_DOWN: [number, number, number] = [0.07, 0.075, 0.04];
export const SKY_AMB_SUN: [number, number, number] = [0.16, 0.11, 0.06];
/** Average skin albedo (human skinAlbedo base) and how much the skin under the grain receives. */
export const SKIN_ALB: [number, number, number] = [0.39, 0.225, 0.15];
// ------------------------------------------------------------------

export function sunDir(): THREE.Vector3 {
  const az = (SUN_AZ_DEG * Math.PI) / 180, el = (SUN_EL_DEG * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Skin brightness split into direct sun (Ld) and sky ambient (La), approximating human skinShade on flat skin. */
export function skinLight() {
  const s = sunDir();
  const ndl = s.y;
  const wrap = [0.45, 0.22, 0.14];
  const amb = [0, 1, 2].map((i) => SKY_AMB_UP[i] + SKY_AMB_SUN[i] * ndl);
  const Ld = [0, 1, 2].map((i) => {
    let d = Math.min(1, Math.max(0, (ndl + wrap[i]) / (1 + wrap[i])));
    d = d * d * (3 - 2 * d) * 0.35 + 0.65 * d;
    return SKIN_ALB[i] * SUN_COL[i] * d;
  });
  const La = [0, 1, 2].map((i) => SKIN_ALB[i] * amb[i] * 1.35);
  return { Ld: new THREE.Vector3(...Ld), La: new THREE.Vector3(...La) };
}

export function lightUniforms() {
  const { Ld, La } = skinLight();
  return {
    uSun: { value: sunDir() },
    uSunCol: { value: new THREE.Vector3(...SUN_COL) },
    uAmbUp: { value: new THREE.Vector3(...SKY_AMB_UP) },
    uAmbDown: { value: new THREE.Vector3(...SKY_AMB_DOWN) },
    uAmbSun: { value: new THREE.Vector3(...SKY_AMB_SUN) },
    uSkinLd: { value: Ld },
    uSkinLa: { value: La },
  };
}

/** Shared GLSL: light uniforms, the human scene's sky model, noise. */
export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uSun; uniform vec3 uSunCol;
uniform vec3 uAmbUp; uniform vec3 uAmbDown; uniform vec3 uAmbSun;
uniform vec3 uSkinLd; uniform vec3 uSkinLa;
#define PI 3.14159265

// the human scene's sky gradient (human/glsl.ts skyCol)
vec3 skyCol(vec3 d) {
  float mu = dot(d, uSun);
  float yy = max(d.y, 0.0);
  float t = pow(max(1.0 - yy, 1e-6), 4.0);
  vec3 c = mix(vec3(0.055, 0.15, 0.40), vec3(0.42, 0.52, 0.64), t);
  float sunSide = pow(max(mu * 0.5 + 0.5, 1e-6), 4.0);
  c += vec3(0.42, 0.22, 0.05) * sunSide * t;
  float g = 0.8;
  float mie = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-6), 1.5);
  c += vec3(1.0, 0.72, 0.45) * mie * 0.022 * (0.35 + 0.65 * t);
  c *= 0.9 + 0.12 * mu * mu;
  float below = smoothstep(0.0, -0.3, d.y);
  c = mix(c, vec3(0.25, 0.30, 0.34) + vec3(0.2, 0.12, 0.05) * sunSide, below * 0.8);
  return c;
}
// sky ambient (human/glsl.ts skyIrr)
vec3 skyIrr(vec3 n) {
  vec3 c = mix(uAmbDown, uAmbUp, smoothstep(0.0, 1.0, n.y * 0.5 + 0.5));
  return c + uAmbSun * max(dot(n, uSun), 0.0);
}

float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
/** fade for a feature of frequency f (cycles per unit) at pixel footprint fp (units) */
float lod(float f, float fp) { return 1.0 - smoothstep(0.06, 0.2, fp * f); }

float ggx(float nh, float a) {
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
`;
