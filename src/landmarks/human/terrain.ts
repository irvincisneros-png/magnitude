/**
 * The place, from real data: Woonona Beach and the northern Illawarra coast (siteData.ts).
 * Terrain (one radial mesh from the person's feet out to 32 km, heights from the elevation data),
 * land cover from OpenStreetMap (sand, dune scrub, woodland, rock platform, roads, paths, railway),
 * the ocean (swell plus surf that follows the real shoreline: breaking lines run parallel to the
 * beach because their phase is driven by the distance from the sea's edge), and boulders on the
 * rock platform at Collins Point around the Woonona Rock Pool.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { BUMP, COMMON, FRAME, MAP_O, NOISE_T, SITE, type Shared } from './glsl';
import { coverAt, siteHeight, sampleCover, type SiteData } from './siteData';
import type { SiteTextures } from './siteTex';
import { fbm2, vnoise2 } from './terrainHeight';

/** Terrain height in H metres at H-frame (x, z). */
export function heightH(D: SiteData, x: number, z: number): number {
  return siteHeight(D, x - MAP_O[0], z - MAP_O[1]) + FRAME.sea;
}

const terrainVert = /* glsl */ `
${COMMON}
varying vec3 vP; varying vec3 vN;
LOGZ_VARY
void main() {
  vP = position; vN = normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const terrainFrag = /* glsl */ `
${COMMON}
${BUMP}
${SITE}
${NOISE_T}
varying vec3 vP; varying vec3 vN;
LOGZ_VARY
void main() {
  vec3 p = vP;
  float hs = p.y - SEA_Y;
  // the seabed well below the surface is hidden by the (opaque) sea: skip it (log depth defeats early-z)
  if (hs < -1.3) discard;
  vec3 v = normalize(uCamM - p);
  float dist = length(uCamM - p);
  float fp = max(length(dFdx(p)), length(dFdy(p)));
  fp = max(fp, dist * uPx) * (1.0 + 60.0 * uBlur);
  vec3 n = normalize(vN);
  vec2 q = p.xz - MAP_O; // map metres (stable noise origin)
  float slope = 1.0 - n.y;
  vec4 cA; vec3 cB; siteCover(q, cA, cB);
  float e = edgeOf(q);
  float urbanW = texture2D(tCoarse, q / (2.0 * COARSE_H) + 0.5).b;

  // --- material weights (each material's texture is only evaluated where it shows)
  float nB = fbmT(q * 0.05, 2);
  float nC = fbmT(q * 0.37 + 5.0, 2);
  float rockP = smoothstep(0.35, 0.65, cA.a + (nC - 0.5) * 0.5);                  // the latite platform and reefs
  // escarpment cliffs: the steepest slopes, and the pale sandstone band just below the plateau's brow
  float cliff = max(smoothstep(0.5, 0.7, slope + (nB - 0.5) * 0.3) * smoothstep(20.0, 60.0, hs),
                    smoothstep(0.16, 0.3, slope + (nC - 0.5) * 0.12) * smoothstep(230.0, 290.0, hs) * smoothstep(420.0, 380.0, hs));
  float sand = max(smoothstep(0.3, 0.6, cA.r + (nC - 0.5) * 0.25), smoothstep(1.7, 0.9, hs + (nB - 0.5) * 0.6));
  sand *= 1.0 - rockP;
  // a ragged edge where the scrub meets the sand: runners and tussocks, not a soft gradient
  float rag = cA.g > 0.02 && cA.g < 0.98 ? (vnoiseT(q * 1.4 + 3.0) - 0.5) * 0.45 + (vnoiseT(q * 4.3) - 0.5) * 0.25 : 0.0;
  float scrub = smoothstep(0.42, 0.5, cA.g + (nC - 0.5) * 0.3 + rag) * (1.0 - sand);
  float forest = max(smoothstep(0.35, 0.6, cA.b), smoothstep(45.0, 120.0, hs + (nB - 0.5) * 50.0) * (1.0 - 0.7 * urbanW)) * (1.0 - sand);
  float town = e > 2900.0 ? urbanW * smoothstep(2900.0, 3200.0, e) * (1.0 - forest) : 0.0;
  float road = smoothstep(0.3, 0.6, cB.r), path = smoothstep(0.35, 0.65, cB.g) * (1.0 - road), rail = smoothstep(0.3, 0.6, cB.b);
  float rock = max(rockP, cliff);
  float canN = scrub + forest > 0.001 ? fbmT(q * 0.75 + 2.0, 2) : 0.5;
  float grassW = (1.0 - rock) * (1.0 - sand) * (1.0 - road) * (1.0 - forest * 0.95) * (1.0 - scrub * 0.95) * (1.0 - town);

  // --- albedos (linear)
  float g2 = fbmT(q * 9.0, 2);
  vec3 alb = vec3(0.0);
  if (grassW > 0.001) {
    float g1 = fbmT(q * 0.9, 2);
    vec3 grass = mix(vec3(0.05, 0.08, 0.026), vec3(0.092, 0.112, 0.04), g1);
    float dry = smoothstep(0.5, 0.72, fbmT(q * 0.09 + 7.0, 2));
    grass = mix(grass, vec3(0.17, 0.14, 0.065) * (0.85 + 0.3 * g2), dry * 0.6);
    grass *= 0.8 + 0.4 * (fp < 0.04 ? vnoiseT(q * 40.0) : 0.5);
    grass *= 0.75 + 0.45 * vnoiseT(q * 0.045 + 2.0);
    float gust = vnoiseT(q * 0.11 + vec2(uTime * 0.18, uTime * 0.05));
    grass *= 0.9 + 0.28 * smoothstep(0.45, 0.75, gust);
    // gardens, driveways and shade between the houses
    if (urbanW > 0.01 && e < 3300.0) {
      float yard = fbmT(q * 0.21 + 3.0, 2);
      grass = mix(grass, vec3(0.035, 0.04, 0.022), smoothstep(0.55, 0.72, yard) * urbanW * 0.7);
      grass = mix(grass, vec3(0.2, 0.19, 0.17), smoothstep(0.78, 0.86, vnoiseT(q * 0.33 + 9.0)) * urbanW * 0.5);
    }
    alb = grass;
  }
  if (scrub > 0.001) {
    // dune thicket (coast banksia, tea-tree, wattle): clumps of leaves with deep shade between them
    float sc1 = canN, sc2 = fbmT(q * 6.0, 2);
    vec3 scrubA = mix(vec3(0.028, 0.042, 0.019), vec3(0.07, 0.078, 0.038), sc1) * (0.45 + 0.9 * sc2);
    scrubA = mix(scrubA, vec3(0.1, 0.095, 0.06), smoothstep(0.7, 0.85, vnoiseT(q * 0.35 + 5.0)) * 0.5); // grey-leaved banksia
    alb = mix(alb, scrubA, scrub);
  }
  // pigface (Carpobrotus) mats and spinifex runners on the sand at the dune's foot
  float foot = cA.r > 0.15 && hs > 1.5 && hs < 4.0 ? smoothstep(0.02, 0.2, cA.g) * (1.0 - smoothstep(0.55, 0.9, cA.g)) : 0.0;
  float mats = 0.0;
  if (foot > 0.001) {
    mats = smoothstep(0.55, 0.68, vnoiseT(q * 0.45 + 11.0) + (vnoiseT(q * 2.6) - 0.5) * 0.3) * foot;
  }
  if (forest > 0.001) {
    vec3 forestA = mix(vec3(0.016, 0.03, 0.013), vec3(0.042, 0.055, 0.024), fbmT(q * 0.02, 2)) * (0.7 + 0.6 * fbmT(q * 0.13, 2));
    alb = mix(alb, forestA, forest);
  }
  if (town > 0.001) {
    vec2 sg = mat2(0.94, 0.34, -0.34, 0.94) * q;
    vec2 cell = floor(sg / vec2(22.0, 16.0));
    vec2 fc = fract(sg / vec2(22.0, 16.0));
    float hc = hash12(cell);
    float roof = step(0.25, hc) * step(0.18, fc.x) * step(fc.x, 0.78) * step(0.2, fc.y) * step(fc.y, 0.75);
    vec3 roofA = mix(vec3(0.2, 0.16, 0.14), vec3(0.24, 0.1, 0.06), hash12(cell + 7.0)) * (0.6 + 0.6 * hash12(cell + 3.0));
    vec3 townA = mix(vec3(0.05, 0.065, 0.032), roofA, roof);
    float street = step(fract(sg.x / 154.0), 0.06) + step(fract(sg.y / 112.0), 0.07);
    townA = mix(townA, vec3(0.09, 0.09, 0.085), clamp(street, 0.0, 1.0));
    townA = mix(townA, vec3(0.075, 0.08, 0.065) * (0.8 + 0.4 * hash12(floor(q / 60.0))), smoothstep(0.25, 1.1, fp));
    alb = mix(alb, townA, town);
  }
  float wet = 0.0;
  if (sand > 0.001) {
    vec3 sandA = mix(vec3(0.43, 0.35, 0.22), vec3(0.52, 0.43, 0.29), g2);
    sandA *= 0.88 + 0.24 * fbmT(q * 0.6 + 1.0, 2);
    // footprints and wind ripples on the dry sand
    wet = smoothstep(0.85, 0.25, hs + (nC - 0.5) * 0.2);
    sandA *= 1.0 + (1.0 - wet) * 0.12 * (fbmT(vec2(q.x * 3.1 + q.y * 1.2, q.y * 0.6), 2) - 0.5);
    // the line of dried weed and shell left by the last high tide
    sandA *= 1.0 - 0.35 * smoothstep(0.12, 0.0, abs(hs - 1.05 - (nC - 0.5) * 0.2)) * smoothstep(0.3, 0.7, vnoiseT(q * 1.7));
    sandA = mix(sandA, sandA * vec3(0.5, 0.48, 0.45), wet);
    sandA = mix(sandA, sandA * vec3(0.55, 0.62, 0.6), smoothstep(0.0, -1.0, hs)); // seabed under the water
    alb = mix(alb, sandA, sand);
  }
  if (mats > 0.001) {
    vec3 pig = mix(vec3(0.045, 0.075, 0.025), vec3(0.09, 0.1, 0.04), vnoiseT(q * 3.0));
    pig = mix(pig, vec3(0.32, 0.05, 0.2), smoothstep(0.82, 0.9, vnoiseT(q * 7.0 + 5.0)) * 0.8); // magenta flowers
    alb = mix(alb, pig, mats);
  }
  if (rock > 0.001) {
    // dark latite on the platform; pale Hawkesbury sandstone in the escarpment cliffs
    vec3 rockA = mix(vec3(0.06, 0.055, 0.05), vec3(0.12, 0.1, 0.08), fbmT(q * 0.6, 3));
    if (rockP > 0.001) {
      float pool = smoothstep(0.62, 0.75, vnoiseT(q * 0.45) * 0.6 + vnoiseT(q * 1.7) * 0.4);
      rockA = mix(rockA, rockA * 0.5, smoothstep(1.4, 0.4, hs));            // wet, weedy rock near the waterline
      rockA = mix(rockA, vec3(0.05, 0.07, 0.03), smoothstep(1.0, 0.5, hs) * smoothstep(0.4, 0.7, nC) * 0.6); // weed
      rockA = mix(rockA, skyCol(vec3(0.0, 1.0, 0.0)) * 0.25, pool * smoothstep(1.3, 0.8, hs) * smoothstep(-0.2, 0.3, hs) * 0.6); // rock pools
      float joint = smoothstep(0.9, 0.99, abs(sin(dot(q, vec2(0.6, 0.8)) * 0.9 + nB * 9.0 + vnoiseT(q * 0.3) * 3.0)));
      rockA *= 1.0 - 0.35 * joint * (1.0 - smoothstep(0.3, 1.5, fp));
    }
    vec3 sst = mix(vec3(0.2, 0.15, 0.1), vec3(0.34, 0.26, 0.17), fbmT(vec2(hs * 0.15, dot(q, vec2(0.7, 0.7)) * 0.01), 3));
    rockA = mix(rockA, sst, cliff * (1.0 - rockP));
    alb = mix(alb, rockA, rock);
  }
  if (road + path + rail > 0.001) {
    vec3 roadA = vec3(0.055, 0.056, 0.058) * (0.85 + 0.3 * vnoiseT(q * 2.0));
    vec3 pathA = vec3(0.3, 0.29, 0.26) * (0.85 + 0.25 * g2);
    vec3 railA = vec3(0.1, 0.09, 0.08) * (0.8 + 0.4 * vnoiseT(q * 1.3));
    alb = mix(alb, roadA, road);
    alb = mix(alb, pathA, path);
    alb = mix(alb, railA, rail);
  }
  float rough = rock + scrub * 0.6 + forest * 0.5;

  // --- detail normals
  float hb = (g2 - 0.5) * 0.02 * (1.0 - rock);
  if (rock > 0.001) hb += (fbmT(q * 3.0 + p.y * 2.0, 3) - 0.5) * 0.25 * rock;
  if (scrub + forest > 0.001) hb += (scrub + forest) * (canN - 0.5) * 0.6;
  n = bumpN(n, p, hb);
  float ndl = dot(n, uSun);
  float sh = figureShadow(p + n * 0.02);
  float veg = (1.0 - rock) * (1.0 - sand) * (1.0 - road) * (1.0 - path);
  float wrapK = 0.25 * veg;
  vec3 col = alb * uSunCol * clamp((ndl + wrapK) / (1.0 + wrapK), 0.0, 1.0) * sh;
  col += alb * skyIrr(n) * 1.2 * mix(0.75, 1.0, rough);
  float back = pow(max(dot(v, -uSun), 1e-6), 3.0) * veg * (1.0 - town);
  col += vec3(0.12, 0.2, 0.03) * uSunCol * back * 0.25 * sh;
  if (sand * wet > 0.001) {
    // wet sand reflects the sky; a lacy sheet of swash runs up and down it
    float Fw = 0.02 + 0.98 * pow(max(1.0 - max(dot(n, v), 0.0), 1e-6), 5.0);
    col = mix(col, skyCol(reflect(-v, n)) * 0.9, Fw * wet * sand * 0.6);
  }
  if (sand > 0.001 && hs < 0.6) {
    float reach = 0.12 + 0.3 * (sin(uTime * 0.45 + q.y * 0.02) * 0.5 + 0.5);
    float swash = (1.0 - smoothstep(0.0, 0.06, abs(hs - reach))) * smoothstep(0.35, 0.65, g2) * sand * (1.0 - rockP);
    col = mix(col, vec3(0.75) * (uSunCol * max(uSun.y, 0.0) + skyIrr(vec3(0, 1, 0))), swash * 0.4);
  }
  col *= footAO(p);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

const oceanVert = /* glsl */ `
${COMMON}
${SITE}
uniform vec2 uSwell;
varying vec3 vP; varying vec3 vWN; varying float vDepth; varying float vPhase; varying float vCrest; varying float vInland; varying float vShore;
LOGZ_VARY
void gerst(vec2 xz, vec2 d, float lam, float A, float Q, float ph, inout vec3 disp, inout vec3 dx, inout vec3 dz, out float phase) {
  float k = 6.2832 / lam, w = sqrt(9.81 * k);
  phase = k * dot(d, xz) - w * uTime + ph;
  float c = cos(phase), s = sin(phase);
  disp += vec3(Q * A * d.x * c, A * s, Q * A * d.y * c);
  dx += vec3(-Q * A * d.x * d.x * k * s, A * d.x * k * c, -Q * A * d.x * d.y * k * s);
  dz += vec3(-Q * A * d.x * d.y * k * s, A * d.y * k * c, -Q * A * d.y * d.y * k * s);
}
void main() {
  vec3 p = position;
  vec2 q = p.xz - MAP_O;
  vec2 hd = siteHD(q);
  float depth = -hd.x;
  vDepth = depth;
  float inland = step(hd.y, -0.5);
  vInland = inland;
  float dCam = length(uCamM - p);
  float shoal = (1.0 + 0.8 * smoothstep(9.0, 2.5, depth)) * smoothstep(0.05, 1.6, depth) * (1.0 - inland);
  vec3 disp = vec3(0.0), dx = vec3(1.0, 0.0, 0.0), dz = vec3(0.0, 0.0, 1.0);
  float ph0, ph;
  float fade = 1.0 - smoothstep(600.0, 2500.0, dCam);
  // near the beach the swell has refracted to run straight at the sand: there its crests follow the
  // distance from the water's edge (shoreward direction = −∇distance), offshore they are plane waves
  float sd = hd.y;
  float wS = smoothstep(14.0, 5.0, depth) * (1.0 - inland);
  vec2 g = wS > 0.0 ? vec2(siteHD(q + vec2(5.0, 0.0)).y - sd, siteHD(q + vec2(0.0, 5.0)).y - sd) : -uSwell;
  vec2 sdir = -g / max(length(g), 1e-4);
  float groupA = 0.3 + 1.2 * vnoise(q / 210.0 + vec2(uTime * 0.012, 0.0)) * vnoise(q / 90.0 + 3.0);
  // crests bent and broken by slowly varying phase (a real swell is never a ruled grid)
  float warp = vnoise(q / 380.0 + 7.0) * 5.0 + vnoise(q / 140.0) * 1.6;
  gerst(q, uSwell, 85.0, 0.33 * shoal * fade * groupA * (1.0 - 0.8 * wS), 0.45, warp, disp, dx, dz, ph0);
  {
    float k = 6.2832 / 60.0, w = sqrt(9.81 * k);
    float phs = -k * sd - w * uTime + vnoise(q / 180.0) * 2.0;
    float A = 0.5 * shoal * fade * groupA * wS, Q = 0.6;
    float c = cos(phs), s = sin(phs);
    disp += vec3(Q * A * sdir.x * c, A * s, Q * A * sdir.y * c);
    vPhase = mix(ph0, phs, smoothstep(0.2, 0.6, wS));
  }
  vShore = sd;
  gerst(q, normalize(uSwell + vec2(0.3, -0.45)), 47.0, 0.16 * shoal * fade, 0.5, 1.7, disp, dx, dz, ph);
  gerst(q, normalize(uSwell + vec2(-0.2, 0.4)), 29.0, 0.1 * shoal * fade, 0.5, 0.6, disp, dx, dz, ph);
  gerst(q, normalize(vec2(-0.99, 0.12)), 13.0, 0.07 * fade * (1.0 - smoothstep(150.0, 700.0, dCam)) * (1.0 - inland), 0.7, 4.1, disp, dx, dz, ph);
  gerst(q, normalize(vec2(-0.6, -0.8)), 6.0, 0.03 * fade * (1.0 - smoothstep(60.0, 300.0, dCam)) * (1.0 - inland * 0.8), 0.7, 2.3, disp, dx, dz, ph);
  p += disp;
  vCrest = disp.y;
  vWN = normalize(cross(dz, dx));
  vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const oceanFrag = /* glsl */ `
${COMMON}
${NOISE_T}
varying vec3 vP; varying vec3 vWN; varying float vDepth; varying float vPhase; varying float vCrest; varying float vInland; varying float vShore;
LOGZ_VARY
float ggxD(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
vec2 ripple(vec2 xz, float fp) {
  vec2 g = vec2(0.0);
  float amp = 1.0, fr = 0.35;
  for (int i = 0; i < 4; i++) {
    float w = 1.0 - smoothstep(0.15, 0.6, fp * fr);
    vec2 q = xz * fr + vec2(uTime * 0.31, uTime * 0.11) * (1.0 + float(i) * 0.6);
    float e = 0.15;
    float h = vnoiseT(q), hx = vnoiseT(q + vec2(e, 0.0)), hz = vnoiseT(q + vec2(0.0, e));
    g += vec2(hx - h, hz - h) / e * amp * w;
    fr *= 2.3; amp *= 0.55;
    xz = mat2(0.8, 0.6, -0.6, 0.8) * xz;
  }
  return g;
}
void main() {
  // under the land: the terrain hides it, so skip the shading (log depth defeats early-z)
  if (vDepth < -0.25 && vInland < 0.5) discard;
  vec3 p = vP;
  vec2 q = p.xz - MAP_O;
  vec3 v = normalize(uCamM - p);
  float dist = length(uCamM - p);
  float fp = max(max(length(dFdx(p)), length(dFdy(p))), dist * uPx) * (1.0 + 40.0 * uBlur);
  vec3 n = normalize(vWN);
  vec2 rg = ripple(q, fp);
  n = normalize(n + vec3(-rg.x, 0.0, -rg.y) * mix(0.09, 0.03, vInland));
  float depth = max(vDepth, 0.0);
  float nv = max(dot(n, v), 0.001);
  float F = 0.02 + 0.98 * pow(max(1.0 - nv, 1e-6), 5.0);
  vec3 refl = skyCol(reflect(-v, n));
  // water body: deep blue-green, turquoise over sand, the sea floor showing through the shallows
  vec3 deep = vec3(0.004, 0.022, 0.036);
  vec3 shallow = vec3(0.02, 0.11, 0.1);
  vec3 body = mix(shallow, deep, smoothstep(1.0, 14.0, depth));
  vec3 floorC = vec3(0.3, 0.26, 0.19) * exp(-depth * vec3(0.55, 0.16, 0.11));
  body += floorC * 0.5 * smoothstep(6.0, 0.5, depth);
  body = mix(body, vec3(0.02, 0.025, 0.012), vInland * 0.8); // tannin-stained lagoon water
  vec3 lit = uSunCol * max(uSun.y, 0.0) * 0.55 + skyIrr(vec3(0, 1, 0));
  vec3 col = body * lit * (1.0 - F) + refl * F;
  float crest = smoothstep(0.1, 0.6, vCrest);
  col += vec3(0.02, 0.12, 0.09) * uSunCol * crest * pow(max(dot(v, -uSun) * 0.5 + 0.5, 1e-6), 3.0) * 0.4;
  vec3 h = normalize(uSun + v);
  float a = clamp(0.06 + fp * 0.04 + 0.05 * smoothstep(400.0, 8000.0, dist), 0.06, 0.35);
  float nh = max(dot(n, h), 0.0);
  float spec = ggxD(nh, a) * F / (4.0 * nv + 1e-3) * max(dot(n, uSun), 0.0);
  // sun glitter: bright, but bounded so that looking into the Sun the bloom stays a glow, not a white-out
  col += uSunCol * min(spec * 2.0, 0.5);
  // foam: lines of breaking surf along the real shore, wash at the waterline, whitecaps offshore
  float fn = vnoiseT(q * 0.9 + uTime * 0.05) * 0.5 + vnoiseT(q * 3.1 - uTime * 0.08) * 0.3 + vnoiseT(q * 9.0) * 0.2;
  float peaks = 0.45 + 0.55 * smoothstep(0.25, 0.7, vnoiseT(q / 55.0 + vec2(0.0, uTime * 0.02)));
  float brk = smoothstep(0.6, 0.95, sin(vPhase + 0.6) * 0.5 + 0.5) * smoothstep(2.8, 1.1, depth) * smoothstep(0.05, 0.4, depth) * peaks;
  float shore = smoothstep(0.22, 0.0, depth) * smoothstep(0.3, 0.7, fn);
  float trail = smoothstep(0.3, 0.9, sin(vPhase - 0.4) * 0.5 + 0.5) * smoothstep(3.2, 0.6, depth) * 0.25;
  float caps = smoothstep(0.9, 0.97, vnoiseT(q / 7.0 + vec2(uTime * 0.12, 0.0))) * smoothstep(0.55, 0.85, fn) * smoothstep(5.0, 20.0, depth) * 0.25 * (1.0 - smoothstep(0.3, 1.5, fp));
  float fm = (brk * (0.45 + fn) + trail * fn + shore * (0.3 + fn) + caps * fn) * (1.0 - vInland);
  float foam = smoothstep(0.5, 0.9, fm) * (0.55 + 0.45 * smoothstep(0.3, 0.7, fn));
  // far away the surf zone reads as a soft white band
  foam = max(foam, smoothstep(2.6, 1.0, depth) * smoothstep(0.05, 0.3, depth) * smoothstep(0.12, 0.8, fp) * (0.35 + 0.35 * smoothstep(0.5, 0.9, sin(vPhase + 0.6) * 0.5 + 0.5)) * peaks * (1.0 - vInland));
  vec3 foamC = vec3(0.8, 0.82, 0.82) * (uSunCol * max(dot(n, uSun), 0.0) * 0.8 + skyIrr(vec3(0, 1, 0)) * 1.4);
  col = mix(col, foamC, foam);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

const rockVert = /* glsl */ `
${COMMON}
attribute vec4 aT; attribute vec4 aQ; attribute vec3 aS;
varying vec3 vP; varying vec3 vN; varying vec3 vL;
LOGZ_VARY
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 lp = position * aS;
  vL = position + aT.w * 13.0;
  vec3 p = qrot(aQ, lp) + aT.xyz;
  vN = normalize(qrot(aQ, normal / aS));
  vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const rockFrag = /* glsl */ `
${COMMON}
${BUMP}
varying vec3 vP; varying vec3 vN; varying vec3 vL;
LOGZ_VARY
void main() {
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  float fp = max(length(dFdx(p)), length(dFdy(p))) * (1.0 + 40.0 * uBlur);
  vec3 n = normalize(vN);
  float hs = p.y - SEA_Y;
  float b1 = vnoise3(vL * 3.0), b2 = vnoise3(vL * 11.0), b3 = vnoise3(vL * 37.0);
  float w2 = 1.0 - smoothstep(0.02, 0.08, fp), w3 = 1.0 - smoothstep(0.006, 0.025, fp);
  n = bumpN(n, p, b1 * 0.06 + b2 * 0.015 * w2 + b3 * 0.004 * w3);
  vec3 alb = mix(vec3(0.06, 0.055, 0.05), vec3(0.12, 0.1, 0.08), b1);
  float barn = smoothstep(0.5, 0.9, b3) * smoothstep(0.3, 0.9, hs) * smoothstep(2.0, 1.2, hs);
  alb = mix(alb, vec3(0.3, 0.28, 0.24), barn * 0.6);
  alb = mix(alb, alb * 0.45, smoothstep(0.9, 0.2, hs));
  float ndl = dot(n, uSun);
  vec3 col = alb * uSunCol * max(ndl, 0.0) + alb * skyIrr(n) * 1.1;
  vec3 h = normalize(uSun + v);
  float wet = smoothstep(1.2, 0.3, hs);
  col += uSunCol * pow(max(dot(n, h), 1e-6), mix(20.0, 120.0, wet)) * mix(0.03, 0.4, wet) * max(ndl, 0.0);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

const TIER = {
  low: { rings: 170, segs: 190, oRings: 120, oSegs: 150, rocks: 90 },
  medium: { rings: 190, segs: 210, oRings: 140, oSegs: 180, rocks: 180 },
  high: { rings: 200, segs: 230, oRings: 150, oSegs: 200, rocks: 260 },
};

/** Radial ring radii: dense under the person's feet, geometric out to the horizon. */
function rings(n: number, r0: number, r1: number) {
  const out: number[] = [0];
  for (let i = 0; i < n; i++) out.push(r0 * Math.pow(r1 / r0, i / (n - 1)));
  return out;
}

export class Terrain {
  readonly group = new THREE.Group();
  private terrainMat: THREE.ShaderMaterial;
  private oceanMat: THREE.ShaderMaterial;
  private rockMat: THREE.ShaderMaterial;
  private meshes: THREE.Mesh[] = [];
  private rockBase: THREE.BufferGeometry;

  constructor(shared: Shared, private D: SiteData, tex: SiteTextures) {
    this.terrainMat = new THREE.ShaderMaterial({ vertexShader: terrainVert, fragmentShader: terrainFrag, uniforms: { ...shared, ...tex.uniforms } });
    // the swell arrives from the east-south-east, square to Woonona Beach (which faces ~E by S)
    const az = ((Number((D.measured as { faceBearingDeg?: number }).faceBearingDeg) || 100) * Math.PI) / 180;
    const swell = new THREE.Vector2(-Math.sin(az), Math.cos(az)).normalize(); // travelling towards the shore
    this.oceanMat = new THREE.ShaderMaterial({
      vertexShader: oceanVert, fragmentShader: oceanFrag,
      uniforms: { ...shared, ...tex.uniforms, uSwell: { value: swell } },
    });
    this.rockMat = new THREE.ShaderMaterial({ vertexShader: rockVert, fragmentShader: rockFrag, uniforms: { ...shared } });
    this.rockBase = makeRockGeometry();
  }

  build(q: Quality) {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const cfg = TIER[q], D = this.D;
    const cx = MAP_O[0], cz = MAP_O[1];
    // ---- terrain
    {
      const R = rings(cfg.rings, 0.35, 32000);
      const S = cfg.segs;
      const nv = 1 + (R.length - 1) * S;
      const pos = new Float32Array(nv * 3);
      const put = (k: number, x: number, z: number) => {
        // the dune thicket and the woodland are a canopy over the ground: hummocks of coastal scrub
        // (wind-pruned low towards the sea) and woodland crowns, kept off the sand and the tracks
        const mx = x - MAP_O[0], mz = z - MAP_O[1];
        let can = 0;
        const r = Math.hypot(mx, mz);
        if (r < 3300) {
          const sc = coverAt(D, 1, mx, mz), wd = coverAt(D, 2, mx, mz);
          if (sc + wd > 0.02) {
            const open = 1 - Math.min(1, coverAt(D, 0, mx, mz) * 1.6);
            const hum = 0.55 + 0.45 * fbm2(mx / 2.8 + 3.1, mz / 2.8, 3) + 0.25 * vnoise2(mx / 0.9, mz / 0.9);
            const lee = 0.6 + 0.4 * Math.min(1, Math.max(0, (-mx - 8) / 60));
            const scR = sc + (vnoise2(mx / 1.6 + 7.0, mz / 1.6) - 0.5) * 0.45; // ragged outline
            can = (THREE.MathUtils.smoothstep(scR, 0.38, 0.62) * 1.7 * lee * hum + THREE.MathUtils.smoothstep(wd, 0.25, 0.75) * (7 + 5 * fbm2(mx / 9, mz / 9, 3))) * open;
            if (r < 6) can *= THREE.MathUtils.smoothstep(r, 3, 6);
          }
        }
        pos[k * 3] = x; pos[k * 3 + 1] = heightH(D, x, z) + can; pos[k * 3 + 2] = z;
      };
      put(0, cx, cz);
      for (let i = 1; i < R.length; i++) for (let j = 0; j < S; j++) {
        const a = ((j + (i & 1) * 0.5) / S) * Math.PI * 2;
        put(1 + (i - 1) * S + j, cx + Math.cos(a) * R[i], cz + Math.sin(a) * R[i]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(ringIndex(R.length, S), 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.terrainMat);
      m.frustumCulled = false; m.renderOrder = 1;
      this.meshes.push(m);
    }
    // ---- ocean: a flat radial sheet at sea level (hidden under the land by depth)
    {
      const R = rings(cfg.oRings, 8, 34000);
      const S = cfg.oSegs;
      const nv = 1 + (R.length - 1) * S;
      const pos = new Float32Array(nv * 3);
      pos.set([cx, FRAME.sea, cz], 0);
      for (let i = 1; i < R.length; i++) for (let j = 0; j < S; j++) {
        const a = (j / S) * Math.PI * 2, k = 1 + (i - 1) * S + j;
        pos[k * 3] = cx + Math.cos(a) * R[i]; pos[k * 3 + 1] = FRAME.sea; pos[k * 3 + 2] = cz + Math.sin(a) * R[i];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(ringIndex(R.length, S), 1));
      const m = new THREE.Mesh(g, this.oceanMat);
      m.frustumCulled = false; m.renderOrder = 1;
      this.meshes.push(m);
    }
    // ---- boulders on the rock platform (mapped rock cover, above the low-tide line)
    {
      const n = cfg.rocks;
      const T = new Float32Array(n * 4), Qa = new Float32Array(n * 4), Sc = new Float32Array(n * 3);
      let seed = 9157;
      const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const qq = new THREE.Quaternion(), ax = new THREE.Vector3();
      const pl = (D.measured as { platformXZ?: number[] }).platformXZ ?? [0, 0];
      let k = 0, tries = 0;
      while (k < n && tries < n * 80) {
        tries++;
        const mx = pl[0] + (rnd() - 0.5) * 360, mz = pl[1] + (rnd() - 0.5) * 360;
        if (sampleCover(D.cover, D.G.cover, 3, mx, mz) < 0.6) continue;
        const hs = siteHeight(D, mx, mz);
        if (hs < -0.6 || hs > 3) continue;
        const size = 0.3 + Math.pow(rnd(), 2.4) * 2.2;
        const x = mx + MAP_O[0], z = mz + MAP_O[1];
        T.set([x, heightH(D, x, z) - size * 0.25, z, rnd()], k * 4);
        ax.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        qq.setFromAxisAngle(ax, rnd() * Math.PI * 2);
        Qa.set([qq.x, qq.y, qq.z, qq.w], k * 4);
        Sc.set([size * (0.8 + rnd() * 0.6), size * (0.45 + rnd() * 0.35), size * (0.8 + rnd() * 0.6)], k * 3);
        k++;
      }
      const g = new THREE.InstancedBufferGeometry();
      g.index = this.rockBase.index;
      g.setAttribute('position', this.rockBase.attributes.position);
      g.setAttribute('normal', this.rockBase.attributes.normal);
      g.setAttribute('aT', new THREE.InstancedBufferAttribute(T, 4));
      g.setAttribute('aQ', new THREE.InstancedBufferAttribute(Qa, 4));
      g.setAttribute('aS', new THREE.InstancedBufferAttribute(Sc, 3));
      g.instanceCount = k;
      const m = new THREE.Mesh(g, this.rockMat);
      m.frustumCulled = false; m.renderOrder = 1;
      this.meshes.push(m);
    }
    for (const m of this.meshes) this.group.add(m);
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.rockBase.dispose();
    this.terrainMat.dispose(); this.oceanMat.dispose(); this.rockMat.dispose();
  }
}

function ringIndex(nRings: number, S: number) {
  const idx: number[] = [];
  for (let j = 0; j < S; j++) idx.push(0, 1 + ((j + 1) % S), 1 + j);
  for (let i = 1; i < nRings - 1; i++) for (let j = 0; j < S; j++) {
    const a = 1 + (i - 1) * S + j, b = 1 + (i - 1) * S + ((j + 1) % S);
    const c = a + S, d = b + S;
    idx.push(a, b, d, a, d, c);
  }
  return new Uint32Array(idx);
}

/** A weathered boulder: an icosphere pushed by layered, partly faceted noise. */
function makeRockGeometry() {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 4);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const merged = mergeVerts(g); g.dispose(); g = merged;
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const f1 = fbm2(v.x * 1.3 + v.z * 0.7 + 3, v.y * 1.3 - v.z * 0.4, 4);
    const f2 = Math.abs(fbm2(v.x * 3.1 + 9, v.y * 3.1 + v.z * 2.0, 3) - 0.5);
    let r = 0.78 + 0.45 * f1 - 0.3 * f2;
    for (const [nx, ny, nz, d] of [[0.2, 1, 0.1, 0.62], [0.9, -0.2, 0.3, 0.8], [-0.5, 0.1, -0.85, 0.82]]) {
      const l = Math.hypot(nx, ny, nz);
      const k = (v.x * nx + v.y * ny + v.z * nz) / l;
      if (k * r > d) r = Math.min(r, d / Math.max(k, 1e-3));
    }
    v.multiplyScalar(r);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function mergeVerts(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const map = new Map<string, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
    let k = map.get(key);
    if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
