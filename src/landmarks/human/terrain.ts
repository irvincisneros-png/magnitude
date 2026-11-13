/**
 * The place: terrain (one radial mesh from the person's feet out to 30 km, heights baked on the
 * CPU), the ocean (Gerstner swell that shoals and breaks on the beaches and rock platform, foam,
 * sun glint, sky reflection, turquoise shallows) and boulders on the rock platform.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { BUMP, COMMON, FRAME, type Shared } from './glsl';
import { FEET_H } from './figureSdf';
import { GROUND_ABOVE_SEA, PERSON_AT, fbm2, rawHeight, smoothstep, type Sample } from './terrainHeight';

/** Feet position in H metres: the terrain frame is the H frame shifted to the feet (axes not turned). */
const HX = -FEET_H[0], HZ = -FEET_H[2];
/** Terrain height in H metres at H-frame (x, z). */
export function heightH(x: number, z: number, s?: Sample): number {
  return rawHeight(x + HX, z + HZ, s).y - GROUND_ABOVE_SEA + FRAME.ground;
}

const DEPTH = { near: 450, far: 16000, res: 256 };

const terrainVert = /* glsl */ `
${COMMON}
attribute vec3 aInfo;
varying vec3 vP; varying vec3 vN; varying vec3 vInfo;
LOGZ_VARY
void main() {
  vP = position; vN = normal; vInfo = aInfo;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const terrainFrag = /* glsl */ `
${COMMON}
${BUMP}
varying vec3 vP; varying vec3 vN; varying vec3 vInfo;
LOGZ_VARY
void main() {
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  float dist = length(uCamM - p);
  float fp = max(length(dFdx(p)), length(dFdy(p)));
  fp = max(fp, dist * uPx) * (1.0 + 60.0 * uBlur);
  vec3 n = normalize(vN);
  float hs = p.y - SEA_Y;
  float e = vInfo.x, W = vInfo.y, esc = vInfo.z;
  vec3 q = p + vec3(${HX.toFixed(4)}, 0.0, ${HZ.toFixed(4)}); // body frame (stable noise origin)
  float slope = 1.0 - n.y;

  // --- material weights
  float nB = fbmAA(q.xz * 0.05, fp * 0.05, 4);
  float rock = smoothstep(0.5, 0.68, slope + (nB - 0.5) * 0.3);
  rock = max(rock, W * smoothstep(3.5, 1.5, hs) * smoothstep(9.0, 2.0, e));
  float sand = (1.0 - W) * smoothstep(95.0, 65.0, e + (nB - 0.5) * 30.0) * smoothstep(11.0, 7.0, hs);
  sand *= 1.0 - rock;
  float forest = smoothstep(0.25, 0.6, esc + (nB - 0.5) * 0.5) * smoothstep(25.0, 70.0, hs);
  float scrub = smoothstep(0.62, 0.72, fbmAA(q.xz * 0.012 + 3.0, fp * 0.012, 3)) * smoothstep(40.0, 120.0, e) * (1.0 - forest);
  scrub = max(scrub, (1.0 - W) * smoothstep(80.0, 105.0, e) * smoothstep(150.0, 120.0, e) * 0.85);
  float urban = smoothstep(500.0, 900.0, e) * (1.0 - smoothstep(0.05, 0.3, esc)) * smoothstep(0.35, 0.5, fbmAA(q.xz * 0.0011, fp * 0.0011, 3));

  // --- albedos (linear)
  float g1 = fbmAA(q.xz * 0.9, fp * 0.9, 4);
  float g2 = fbmAA(q.xz * 9.0, fp * 9.0, 3);
  vec3 grass = mix(vec3(0.05, 0.08, 0.026), vec3(0.092, 0.112, 0.04), g1);
  // drier, straw-coloured patches (summer kikuyu and couch grass)
  float dry = smoothstep(0.5, 0.72, fbmAA(q.xz * 0.09 + 7.0, fp * 0.09, 4));
  grass = mix(grass, vec3(0.17, 0.14, 0.065) * (0.85 + 0.3 * g2), dry * 0.7);
  grass = mix(grass, vec3(0.16, 0.14, 0.06), smoothstep(0.62, 0.8, g2) * 0.4); // dry patches
  grass *= 0.8 + 0.4 * fbmAA(q.xz * 40.0, fp * 40.0, 3);
  grass *= 0.75 + 0.45 * fbmAA(q.xz * 0.045 + 2.0, fp * 0.045, 4);
  // mown / wind-combed sheen moving across the headland
  float gust = fbmAA(q.xz * 0.11 + vec2(uTime * 0.18, uTime * 0.05), fp * 0.11, 2);
  grass *= 0.9 + 0.28 * smoothstep(0.45, 0.75, gust);
  vec3 rockA = mix(vec3(0.07, 0.062, 0.055), vec3(0.13, 0.11, 0.085), fbmAA(q.xz * 0.6 + q.y * 0.4, fp * 0.6, 4));
  float lichen = smoothstep(0.66, 0.8, vnoise3(q * 1.3) * 0.6 + vnoise3(q * 4.1) * 0.4) * smoothstep(2.0, 4.0, hs);
  rockA = mix(rockA, vec3(0.26, 0.15, 0.06), lichen * 0.45);
  rockA = mix(rockA, rockA * 0.55, smoothstep(1.8, 0.6, hs)); // wet, weedy rock near the waterline
  float strata = fbmAA(vec2(q.y * 1.1 + nB * 3.0, dot(q.xz, vec2(0.7, 0.7)) * 0.04), fp * 1.1, 3);
  float joint = smoothstep(0.9, 0.99, abs(sin(dot(q.xz, vec2(0.6, 0.8)) * 0.9 + nB * 9.0 + vnoise(q.xz * 0.3) * 3.0)));
  rockA *= (0.75 + 0.5 * strata) * (1.0 - 0.3 * joint * smoothstep(0.5, 0.8, slope) * (1.0 - smoothstep(0.3, 1.5, fp)));
  // scrub and tussock on the steep slope below the crest
  rock = max(rock, smoothstep(0.3, 0.42, slope) * smoothstep(0.58, 0.7, vnoise3(q * 0.22) * 0.65 + vnoise3(q * 0.7) * 0.35));
  float steepGrass = smoothstep(0.18, 0.4, slope) * (1.0 - rock);
  grass = mix(grass, vec3(0.05, 0.065, 0.025) * (0.7 + 0.6 * g2), steepGrass * 0.7);
  vec3 sandA = mix(vec3(0.42, 0.35, 0.24), vec3(0.5, 0.43, 0.31), g2);
  float wet = smoothstep(1.4, 0.4, hs);
  sandA = mix(sandA, sandA * vec3(0.5, 0.48, 0.45), wet);
  vec3 forestA = mix(vec3(0.018, 0.032, 0.014), vec3(0.04, 0.055, 0.022), fbmAA(q.xz * 0.02, fp * 0.02, 4));
  vec3 scrubA = mix(vec3(0.035, 0.05, 0.02), vec3(0.06, 0.07, 0.035), g1);
  // suburbs: roofs, gardens and streets on a rotated grid
  vec2 sg = mat2(0.94, 0.34, -0.34, 0.94) * q.xz;
  vec2 cell = floor(sg / vec2(22.0, 16.0));
  vec2 fc = fract(sg / vec2(22.0, 16.0));
  float hc = hash12(cell);
  float roof = step(0.25, hc) * step(0.18, fc.x) * step(fc.x, 0.78) * step(0.2, fc.y) * step(fc.y, 0.75);
  vec3 roofA = mix(vec3(0.2, 0.16, 0.14), vec3(0.24, 0.1, 0.06), hash12(cell + 7.0)) * (0.6 + 0.6 * hash12(cell + 3.0));
  vec3 town = mix(vec3(0.05, 0.065, 0.032), roofA, roof);
  float street = step(fract(sg.x / 154.0), 0.06) + step(fract(sg.y / 112.0), 0.07);
  town = mix(town, vec3(0.09, 0.09, 0.085), clamp(street, 0.0, 1.0));
  town = mix(town, vec3(0.075, 0.08, 0.065) * (0.8 + 0.4 * hash12(floor(q.xz / 60.0))), smoothstep(0.25, 1.1, fp)); // blends to a mottled tone from afar

  vec3 alb = grass;
  alb = mix(alb, scrubA, scrub);
  alb = mix(alb, forestA, forest);
  alb = mix(alb, town, urban * (1.0 - forest));
  alb = mix(alb, sandA, sand);
  alb = mix(alb, rockA, rock);

  // --- detail normals
  float hb = (fbmAA(q.xz * 3.0 + q.y * 2.0, fp * 3.0, 4) - 0.5) * 0.25 * rock + (g2 - 0.5) * 0.02 * (1.0 - rock);
  n = bumpN(n, p, hb);
  float ndl = dot(n, uSun);
  float sh = figureShadow(p + n * 0.02);
  // grass is a translucent canopy: soft wrap and glow towards the low Sun
  float wrapK = mix(0.25, 0.0, rock);
  vec3 col = alb * uSunCol * clamp((ndl + wrapK) / (1.0 + wrapK), 0.0, 1.0) * sh;
  col += alb * skyIrr(n) * 1.2 * mix(0.75, 1.0, rock);
  float back = pow(max(dot(v, -uSun), 1e-6), 3.0) * (1.0 - rock) * (1.0 - sand) * (1.0 - urban);
  col += vec3(0.12, 0.2, 0.03) * uSunCol * back * 0.25 * sh;
  // wet sand reflects the sky
  float Fw = 0.02 + 0.98 * pow(max(1.0 - max(dot(n, v), 0.0), 1e-6), 5.0);
  col = mix(col, skyCol(reflect(-v, n)) * 0.9, Fw * wet * sand * 0.6);
  // swash: thin sheets of foam running up the beach
  // a single lacy swash edge that runs up and down the wet sand
  float reach = 0.15 + 0.25 * (sin(uTime * 0.45 + q.z * 0.02) * 0.5 + 0.5);
  float swash = (1.0 - smoothstep(0.0, 0.06, abs(hs - reach))) * smoothstep(0.35, 0.65, g2) * sand;
  col = mix(col, vec3(0.75) * (uSunCol * max(dot(vec3(0, 1, 0), uSun), 0.0) + skyIrr(vec3(0, 1, 0))), swash * 0.4);
  col *= footAO(p);
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

const oceanVert = /* glsl */ `
${COMMON}
uniform sampler2D tDepthN; uniform sampler2D tDepthF;
varying vec3 vP; varying vec3 vWN; varying float vDepth; varying float vPhase; varying float vCrest;
LOGZ_VARY
float depthAt(vec2 xz) {
  vec2 un = xz / ${(DEPTH.near * 2).toFixed(1)} + 0.5;
  vec2 uf = xz / ${(DEPTH.far * 2).toFixed(1)} + 0.5;
  float inN = step(0.0, un.x) * step(un.x, 1.0) * step(0.0, un.y) * step(un.y, 1.0);
  float hn = texture2D(tDepthN, un).r, hf = texture2D(tDepthF, uf).r;
  float b = smoothstep(0.42, 0.5, max(abs(un.x - 0.5), abs(un.y - 0.5)));
  return -mix(hn, hf, max(1.0 - inN, b));
}
void gerst(vec2 xz, vec2 d, float lam, float A, float Q, float ph, inout vec3 disp, inout vec3 dx, inout vec3 dz, out float phase) {
  float k = 6.2832 / lam, w = sqrt(9.81 * k);
  phase = k * dot(d, xz) - w * uTime + ph;
  float c = cos(phase), s = sin(phase);
  disp += vec3(Q * A * d.x * c, A * s, Q * A * d.y * c);
  // derivatives for the normal
  dx += vec3(-Q * A * d.x * d.x * k * s, A * d.x * k * c, -Q * A * d.x * d.y * k * s);
  dz += vec3(-Q * A * d.x * d.y * k * s, A * d.y * k * c, -Q * A * d.y * d.y * k * s);
}
void main() {
  vec3 p = position;
  float depth = depthAt(p.xz);
  vDepth = depth;
  float dCam = length(uCamM - p);
  float shoal = (1.0 + 0.8 * smoothstep(9.0, 2.5, depth)) * smoothstep(0.05, 1.6, depth);
  vec3 disp = vec3(0.0), dx = vec3(1.0, 0.0, 0.0), dz = vec3(0.0, 0.0, 1.0);
  float ph0, ph;
  vec2 d0 = normalize(vec2(-0.94, -0.34));
  float fade = 1.0 - smoothstep(600.0, 2500.0, dCam);
  float groupA = 0.55 + 0.9 * vnoise(p.xz / 260.0 + vec2(uTime * 0.01, 0.0));
  gerst(p.xz, d0, 72.0, 0.5 * shoal * fade * groupA, 0.55, 0.0, disp, dx, dz, ph0);
  gerst(p.xz, normalize(vec2(-0.82, -0.57)), 33.0, 0.2 * shoal * fade, 0.6, 1.7, disp, dx, dz, ph);
  gerst(p.xz, normalize(vec2(-0.99, 0.12)), 13.0, 0.07 * fade * (1.0 - smoothstep(150.0, 700.0, dCam)), 0.7, 4.1, disp, dx, dz, ph);
  gerst(p.xz, normalize(vec2(-0.6, -0.8)), 6.0, 0.03 * fade * (1.0 - smoothstep(60.0, 300.0, dCam)), 0.7, 2.3, disp, dx, dz, ph);
  p += disp;
  vPhase = ph0;
  vCrest = disp.y;
  vWN = normalize(cross(dz, dx));
  vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const oceanFrag = /* glsl */ `
${COMMON}
varying vec3 vP; varying vec3 vWN; varying float vDepth; varying float vPhase; varying float vCrest;
LOGZ_VARY
float ggxD(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
vec2 ripple(vec2 xz, float fp) {
  vec2 g = vec2(0.0);
  float amp = 1.0, fr = 0.35;
  for (int i = 0; i < 4; i++) {
    float w = 1.0 - smoothstep(0.15, 0.6, fp * fr);
    vec2 q = xz * fr + vec2(uTime * 0.31, uTime * 0.11) * (1.0 + float(i) * 0.6);
    float e = 0.15;
    float h = vnoise(q), hx = vnoise(q + vec2(e, 0.0)), hz = vnoise(q + vec2(0.0, e));
    g += vec2(hx - h, hz - h) / e * amp * w;
    fr *= 2.3; amp *= 0.55;
    xz = mat2(0.8, 0.6, -0.6, 0.8) * xz;
  }
  return g;
}
void main() {
  vec3 p = vP;
  vec3 v = normalize(uCamM - p);
  float dist = length(uCamM - p);
  float fp = max(max(length(dFdx(p)), length(dFdy(p))), dist * uPx) * (1.0 + 40.0 * uBlur);
  vec3 n = normalize(vWN);
  vec2 rg = ripple(p.xz, fp);
  n = normalize(n + vec3(-rg.x, 0.0, -rg.y) * 0.09);
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
  vec3 lit = uSunCol * max(uSun.y, 0.0) * 0.55 + skyIrr(vec3(0, 1, 0));
  vec3 col = body * lit * (1.0 - F) + refl * F;
  // light through the thin crests of the swell
  float crest = smoothstep(0.1, 0.6, vCrest);
  col += vec3(0.02, 0.12, 0.09) * uSunCol * crest * pow(max(dot(v, -uSun) * 0.5 + 0.5, 1e-6), 3.0) * 0.4;
  // sun glint (rougher in the distance, where many tiny facets average out)
  vec3 h = normalize(uSun + v);
  float a = clamp(0.06 + fp * 0.04 + 0.05 * smoothstep(400.0, 8000.0, dist), 0.06, 0.35);
  float nh = max(dot(n, h), 0.0);
  float spec = ggxD(nh, a) * F / (4.0 * nv + 1e-3) * max(dot(n, uSun), 0.0);
  col += uSunCol * spec * 2.0;
  // foam: breaking waves over the shallows, wash around the rocks, sparse whitecaps offshore
  float fn = vnoise(p.xz * 0.9 + uTime * 0.05) * 0.5 + vnoise(p.xz * 3.1 - uTime * 0.08) * 0.3 + vnoise(p.xz * 9.0) * 0.2;
  float brk = smoothstep(0.72, 0.98, sin(vPhase + 0.6) * 0.5 + 0.5) * smoothstep(2.6, 1.0, depth) * smoothstep(0.05, 0.4, depth);
  float shore = smoothstep(0.18, 0.0, depth) * smoothstep(0.3, 0.7, fn);
  float trail = smoothstep(0.3, 0.9, sin(vPhase - 0.4) * 0.5 + 0.5) * smoothstep(3.0, 0.6, depth) * 0.2;
  float caps = smoothstep(0.88, 0.96, vnoise(p.xz / 7.0 + vec2(uTime * 0.12, 0.0))) * smoothstep(0.55, 0.85, fn) * smoothstep(5.0, 20.0, depth) * 0.45;
  float fm = brk * (0.45 + fn) + trail * fn + shore * (0.3 + fn) + caps * fn;
  float foam = smoothstep(0.5, 0.9, fm) * (0.55 + 0.45 * smoothstep(0.3, 0.7, fn));
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
  float lichen = smoothstep(0.6, 0.72, vnoise3(vL * 5.0 + 4.0)) * smoothstep(1.8, 3.0, hs) * smoothstep(0.2, 0.7, n.y);
  alb = mix(alb, vec3(0.34, 0.18, 0.05), lichen * 0.7);
  float barn = smoothstep(0.5, 0.9, b3) * smoothstep(0.3, 0.9, hs) * smoothstep(2.0, 1.2, hs);
  alb = mix(alb, vec3(0.3, 0.28, 0.24), barn * 0.6);
  alb = mix(alb, alb * 0.45, smoothstep(0.9, 0.2, hs)); // wet and weedy at the waterline
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
  low: { rings: 190, segs: 200, oRings: 130, oSegs: 160, rocks: 90 },
  medium: { rings: 250, segs: 280, oRings: 170, oSegs: 220, rocks: 180 },
  high: { rings: 310, segs: 340, oRings: 210, oSegs: 280, rocks: 260 },
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
  private depthN: THREE.DataTexture;
  private depthF: THREE.DataTexture;
  private rockBase: THREE.BufferGeometry;

  constructor(shared: Shared) {
    this.depthN = this.bakeDepth(DEPTH.near);
    this.depthF = this.bakeDepth(DEPTH.far);
    this.terrainMat = new THREE.ShaderMaterial({ vertexShader: terrainVert, fragmentShader: terrainFrag, uniforms: { ...shared } });
    this.oceanMat = new THREE.ShaderMaterial({
      vertexShader: oceanVert, fragmentShader: oceanFrag,
      uniforms: { ...shared, tDepthN: { value: this.depthN }, tDepthF: { value: this.depthF } },
    });
    this.rockMat = new THREE.ShaderMaterial({ vertexShader: rockVert, fragmentShader: rockFrag, uniforms: { ...shared } });
    this.rockBase = makeRockGeometry();
  }

  /** Height of the ground above sea level on a grid around the person (metres), for the ocean. */
  private bakeDepth(half: number) {
    const N = DEPTH.res;
    const data = new Uint16Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) * 2 * half, z = ((j + 0.5) / N - 0.5) * 2 * half;
      data[i + j * N] = THREE.DataUtils.toHalfFloat(heightH(x, z) - FRAME.sea);
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  build(q: Quality) {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    const cfg = TIER[q];
    const s: Sample = { y: 0, e: 0, W: 0, esc: 0 };
    // ---- terrain
    {
      const R = rings(cfg.rings, 0.35, 32000);
      const S = cfg.segs;
      const nv = 1 + (R.length - 1) * S;
      const pos = new Float32Array(nv * 3), info = new Float32Array(nv * 3);
      // centre the rings on the feet
      const cx = -HX, cz = -HZ;
      const put = (k: number, x: number, z: number) => {
        const y = heightH(x, z, s);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        info[k * 3] = s.e; info[k * 3 + 1] = s.W; info[k * 3 + 2] = s.esc;
      };
      put(0, cx, cz);
      for (let i = 1; i < R.length; i++) for (let j = 0; j < S; j++) {
        const a = ((j + (i & 1) * 0.5) / S) * Math.PI * 2;
        put(1 + (i - 1) * S + j, cx + Math.cos(a) * R[i], cz + Math.sin(a) * R[i]);
      }
      const idx = ringIndex(R.length, S);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
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
      const cx = 22 - PERSON_AT[0] - HX, cz = -PERSON_AT[1] - HZ;
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
    // ---- boulders on the rock platform and at the cliff foot
    {
      const n = cfg.rocks;
      const T = new Float32Array(n * 4), Qa = new Float32Array(n * 4), Sc = new Float32Array(n * 3);
      let seed = 9157;
      const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const qq = new THREE.Quaternion(), ax = new THREE.Vector3();
      let k = 0, tries = 0;
      while (k < n && tries < n * 60) {
        tries++;
        const zb = (rnd() - 0.5) * 520;
        const xb = 22 + (rnd() - 0.5) * 220 + (Math.abs(zb) > 120 ? -150 : 0);
        const smp = rawHeight(xb - PERSON_AT[0], zb - PERSON_AT[1], s);
        const hs = smp.y;
        if (smp.W < 0.5 || hs > 6 || hs < -1.2 || smp.e > 12 || smp.e < -70) continue;
        // bigger blocks at the cliff foot, cobbles out on the platform
        const nearCliff = smoothstep(-25, 0, smp.e);
        const size = (0.35 + Math.pow(rnd(), 2.2) * 2.6) * (0.6 + nearCliff * 1.2);
        const x = xb - PERSON_AT[0] - HX, z = zb - PERSON_AT[1] - HZ;
        T.set([x, heightH(x, z) - size * 0.25, z, rnd()], k * 4);
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
    this.depthN.dispose(); this.depthF.dispose();
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
    // a few flat joint faces, typical of columnar latite
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
  // IcosahedronGeometry is non-indexed; weld coincident vertices so the noise keeps it closed
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
