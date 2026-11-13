/**
 * LIGHTING CONSTANTS — retune these to match the human scene (src/landmarks/human/glsl.ts).
 * The ant stands on the back of that person's hand, so its sun direction, sun colour and sky
 * ambient must be the same as the human scene's. Everything else in the ant reads from here.
 */

/** Sun azimuth (degrees from north = −Z, towards east = +X) and elevation above the horizon. */
export const SUN_AZIMUTH_DEG = 72;
export const SUN_ELEVATION_DEG = 22;
/** Sun colour × intensity, linear. */
export const SUN_COLOUR: [number, number, number] = [1.0 * 2.6, 0.84 * 2.6, 0.66 * 2.6];
/** Sky ambient (irradiance) seen by an upward-facing / downward-facing surface, linear. */
export const SKY_AMBIENT_UP: [number, number, number] = [0.16, 0.25, 0.42];
export const SKY_AMBIENT_DOWN: [number, number, number] = [0.07, 0.075, 0.04];
/** Extra sky brightness towards the sun. */
export const SKY_AMBIENT_SUNWARD: [number, number, number] = [0.16, 0.11, 0.06];
/** Lit colour of the skin around the ant (for reflections in the cuticle and bounce light). */
export const SKIN_ALBEDO: [number, number, number] = [0.42, 0.27, 0.22];

export const SUN_DIR: [number, number, number] = (() => {
  const az = (SUN_AZIMUTH_DEG * Math.PI) / 180, el = (SUN_ELEVATION_DEG * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
})();

const v = (a: number[]) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;

/** GLSL: sun, sky colour (same model as the human scene) and sky irradiance. */
export const LIGHT_GLSL = /* glsl */ `
const vec3 uSun = ${v(SUN_DIR)};
const vec3 uSunCol = ${v(SUN_COLOUR)};
const vec3 SKIN_ALB = ${v(SKIN_ALBEDO)};
vec3 skyCol(vec3 d) {
  float mu = dot(d, uSun);
  float y = d.y;
  float yy = max(y, 0.0);
  float t = pow(max(1.0 - yy, 1e-6), 4.0);
  vec3 c = mix(vec3(0.055, 0.15, 0.40), vec3(0.42, 0.52, 0.64), t);
  float sunSide = pow(max(mu * 0.5 + 0.5, 1e-6), 4.0);
  c += vec3(0.42, 0.22, 0.05) * sunSide * t;
  float g = 0.8;
  float mie = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-6), 1.5);
  c += vec3(1.0, 0.72, 0.45) * mie * 0.022 * (0.35 + 0.65 * t);
  c *= 0.9 + 0.12 * mu * mu;
  return c;
}
vec3 skyIrr(vec3 n) {
  float up = n.y * 0.5 + 0.5;
  vec3 c = mix(${v(SKY_AMBIENT_DOWN)}, ${v(SKY_AMBIENT_UP)}, smoothstep(0.0, 1.0, up));
  c += ${v(SKY_AMBIENT_SUNWARD)} * max(dot(n, uSun), 0.0);
  return c;
}
/** What a mirror-like surface sees: sky above, the sunlit skin of the hand below. */
vec3 envCol(vec3 r) {
  vec3 skin = SKIN_ALB * (uSunCol * uSun.y + skyIrr(vec3(0.0, 1.0, 0.0)) * 1.35);
  return mix(skyCol(r), skin * 0.7, smoothstep(0.02, -0.12, r.y));
}
`;
