/**
 * Quantum foam: one full-screen pass (a clip-space quad; rays rebuilt from the camera).
 *
 * The froth is a nest of self-similar foam "skins": wobbly shells around the origin, each
 * 0.55× the size of the one outside it, so the picture looks the same however far you dive.
 * Each skin is cut by a 3D power (weighted Voronoi) diagram, so it reads as packed bubbles
 * pressed together: domed cells with thin-film colour, flattened shared walls, bright Plateau
 * borders where walls meet, and junction nodes where three meet. A slow clumping field makes
 * whole patches of cells vanish (dark voids), and every cell has a life: its film drains to
 * dark "black film", the cell pops (only its borders flash), and later a new one forms.
 *
 * Cost control: a ray only tests the few skins near the current zoom (analytic ray–sphere,
 * so pixels that miss do almost nothing), the cell search is 2×2×2, the film colour is a
 * small precomputed lookup texture (spectrally integrated soap-film colours), and skins
 * whose cells are under a couple of pixels are skipped (a soft halo stands in for them).
 *
 * Output is premultiplied (rgb = light, a = coverage). A separate backdrop quad (deep
 * indigo-black) is drawn first and fades out towards the zoom-out end.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON } from './glsl';

export const SHELL_R0 = 2.0;     // outermost skin radius (local units)
export const SHELL_K = 0.55;     // each skin is this much smaller than the one outside it
const CELL = 0.27;               // cell size as a fraction of the skin radius

const quadVert = /* glsl */ `
  uniform mat4 uInvProj; uniform mat4 uCamWorld;
  varying vec3 vDir;
  void main() {
    vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
    vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const backFrag = /* glsl */ `
  precision highp float;
  uniform float uBack; uniform float uTime;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float v = 0.5 + 0.25 * sin(d.x * 3.1 + uTime * 0.05) * sin(d.y * 2.3 - uTime * 0.04) + 0.25 * sin(d.z * 4.0 + d.x * 1.7);
    vec3 col = mix(vec3(0.0008, 0.0006, 0.0025), vec3(0.006, 0.004, 0.016), v);
    col += vec3(0.004, 0.0025, 0.009) * pow(max(0.0, 1.0 - abs(d.y)), 3.0);
    gl_FragColor = vec4(col * uBack, uBack);
  }`;

const foamFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uCam; uniform float uTime; uniform float uPxAng; uniform float uCamD;
  uniform float uJit; uniform float uBright; uniform float uHalo; uniform float uStatic;
  uniform float uK0; uniform float uNS;          // first skin index and skins per ray
  uniform float uVoid;                            // share of the foam that is empty
  uniform sampler2D uFilm;
  varying vec3 vDir;

  ${COMMON}

  float shellR(float k) { return ${SHELL_R0.toFixed(2)} * pow(${SHELL_K.toFixed(2)}, k); }
  vec3 shellC(float k) { return (hash33(vec3(k * 3.7, 1.3, 9.1)) - 0.5) * 0.9 * shellR(k); }

  // ray vs (slightly wobbly) skin: returns entry/exit t (x > y when missed)
  vec2 hitShell(vec3 ro, vec3 rd, float k) {
    float R = shellR(k);
    vec3 oc = ro - shellC(k);
    float b = dot(oc, rd);
    float c = dot(oc, oc) - R * R;
    float h = b * b - c;
    if (h <= 0.0) return vec2(1.0, -1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  vec3 envLight(vec3 R) {
    float k1 = max(dot(R, vec3(0.48, 0.78, 0.40)), 0.0);
    float k2 = max(dot(R, vec3(-0.76, -0.22, -0.61)), 0.0);
    float k1s = k1 * k1; k1s *= k1s; // ^4
    return vec3(0.035, 0.03, 0.09)
      + vec3(1.0, 0.97, 1.05) * (k1s * k1s * k1s * 2.6 + k1s * 0.3)
      + vec3(0.5, 0.2, 0.8) * k2 * k2 * k2 * 0.5;
  }

  // one skin hit: power-diagram cells, film, walls, borders
  void shadeHit(vec3 p, vec3 rd, float t, float k, bool back, inout vec3 col, inout float T) {
    float R = shellR(k);
    float cs = R * ${CELL.toFixed(3)};
    float pxw = t * uPxAng / cs;                  // one pixel in cell units
    float w = smoothstep(0.5, 0.18, pxw);         // skip skins whose cells are tiny
    if (w < 0.01) return;
    w *= exp(-0.55 * max(0.0, t / uCamD - 0.85)) * smoothstep(0.12, 0.45, t / uCamD);  // fog far, fade walls brushing the lens
    w *= 0.25 + 0.75 * smoothstep(0.12, 0.45, R / uCamD);   // inner skins stay dim: keeps the depth readable  // depth fog: far skins sink into the dark
    if (w < 0.01) return;

    vec3 nS = normalize(p - shellC(k));
    float graze = abs(dot(nS, rd));
    w *= smoothstep(0.04, 0.32, graze);            // edge-on skins would smear into streaks
    if (w < 0.01) return;
    vec3 x = p / cs + vec3(k * 17.13, k * 5.71, k * 11.37);
    x += 0.45 * sin(x.yzx * 0.41 + vec3(1.3, 4.1, 2.7));   // smooth warp: big and small cells, no seams
    // 2×2×2 power-diagram search (exact for the nearest site with this jitter), keeping the three nearest sites
    vec3 base = floor(x - 0.5);
    float P1 = 1e9, P2 = 1e9, P3 = 1e9;
    vec3 s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0), i1 = vec3(0.0), i2 = vec3(0.0);
    for (int j = 0; j < 8; j++) {
      vec3 id = base + vec3(float(j & 1), float((j >> 1) & 1), float(j >> 2));
      vec3 h = hash33(id);
      vec3 s = id + 0.5 + (h - 0.5) * (0.4 + 0.12 * uJit * sin(uTime * (1.3 + 2.0 * h.x) + h.y * 30.0));
      vec3 dv = x - s;
      float P = dot(dv, dv) - h.z * h.z * 0.14;    // weights make cells of many sizes
      if (P < P1) { P3 = P2; s3 = s2; P2 = P1; s2 = s1; i2 = i1; P1 = P; s1 = s; i1 = id; }
      else if (P < P2) { P3 = P2; s3 = s2; P2 = P; s2 = s; i2 = id; }
      else if (P < P3) { P3 = P; s3 = s; }
    }
    float e12 = (P2 - P1) / (2.0 * length(s2 - s1));   // distance to the shared wall
    float e13 = (P3 - P1) / (2.0 * length(s3 - s1));

    // life of a cell: film drains, cell pops (borders flash), later reforms; voids come in clumps
    vec3 wc = (s1 - vec3(k * 17.13, k * 5.71, k * 11.37)) * cs / R;   // site in skin-relative units
    vec3 hc = hash33(i1 * 1.71 + k);
    float life = fract(uTime / (4.0 + 5.0 * hc.x) + hc.y);
    float clump = sin(wc.x * 2.1 + sin(wc.y * 1.7 + uTime * 0.06)) * sin(wc.y * 1.9 + wc.z * 1.3) + 0.35 * (hc.z - 0.5);
    float solid1 = step(uVoid - 0.5, clump) * step(life, 0.9);
    if (solid1 < 0.5) return;            // only the nearest site is exact, so decide on it alone
    float any = 1.0;
    float flash = smoothstep(0.86, 0.9, life) * (1.0 - smoothstep(0.9, 0.94, life));

    // walls (Plateau borders) and three-way junctions, anti-aliased to the pixel
    float ew = max(0.013, pxw * 0.9);
    float wall = exp(-e12 * e12 / (ew * ew));
    float node = exp(-(e12 * e12 + e13 * e13) / (ew * ew * 3.0));
    float border = 1.0;
    if (wall > 0.02) {                                         // outer edge of a clump is brighter
      vec3 wc2 = (s2 - vec3(k * 17.13, k * 5.71, k * 11.37)) * cs / R;
      vec3 hc2 = hash33(i2 * 1.71 + k);
      float life2 = fract(uTime / (4.0 + 5.0 * hc2.x) + hc2.y);
      float clump2 = sin(wc2.x * 2.1 + sin(wc2.y * 1.7 + uTime * 0.06)) * sin(wc2.y * 1.9 + wc2.z * 1.3) + 0.35 * (hc2.z - 0.5);
      float solid2 = step(uVoid - 0.5, clump2) * step(life2, 0.9);
      border = solid2 > 0.5 ? 1.0 : 1.6;
    }

    // domed face: tilt the skin normal towards the cell's edges
    vec3 nF = back ? -nS : nS;
    if (dot(nF, rd) > 0.0) nF = -nF;
    vec3 v = (x - s1);
    v -= nS * dot(v, nS);
    vec3 n = normalize(nF + v * 1.25);
    float cosI = abs(dot(n, rd));
    float drain = smoothstep(0.55, 0.88, life);               // black film just before popping
    float thick = (260.0 + 520.0 * hc.z + 140.0 * dot(v, nS.yzx)) * (1.0 - 0.9 * drain);
    float sinT2 = (1.0 - cosI * cosI) * 0.565;
    float opd = 2.66 * thick * sqrt(1.0 - sinT2);
    vec3 film = texture2D(uFilm, vec2(opd / 3200.0, 0.5)).rgb;
    float om = 1.0 - cosI; float F = 0.03 + 0.97 * om * om * om;
    vec3 face = film * envLight(reflect(rd, n)) * (0.03 + 0.9 * F) * solid1;

    vec3 edgeCol = mix(vec3(0.55, 0.5, 1.0), vec3(0.85, 0.9, 1.0), node);
    vec3 edge = edgeCol * (wall * 0.2 * border + node * 0.7) * any;
    edge += vec3(1.2, 1.15, 1.6) * flash * (wall * 1.2 + node * 1.2);

    float tint = back ? 0.55 : 1.0;
    col += T * (face + edge) * w * tint;
    T *= 1.0 - w * (0.05 * solid1 + 0.3 * wall * any);
  }

  void main() {
    vec3 ro = uCam;
    vec3 rd = normalize(vDir);
    vec3 col = vec3(0.0);
    float T = 1.0;

    // halo of the whole froth (closest approach of the ray to the origin)
    float b0 = dot(ro, rd);
    float h0 = sqrt(max(dot(ro, ro) - b0 * b0, 0.0));
    if (-b0 > 0.0) col += vec3(0.20, 0.15, 0.48) * exp(-h0 * h0 * 0.9) * uHalo
                       + vec3(0.6, 0.6, 1.0) * exp(-h0 * h0 * 12.0) * uHalo * 0.4;

    // front walls, outermost skin first, then back walls, innermost first
    for (int i = 0; i < 7; i++) {
      if (float(i) >= uNS) break;
      float k = uK0 + float(i);
      vec2 tt = hitShell(ro, rd, k);
      if (tt.x > 0.0 && tt.y > tt.x) shadeHit(ro + rd * tt.x, rd, tt.x, k, false, col, T);
    }
    for (int i = 6; i >= 0; i--) {
      if (float(i) >= uNS) continue;
      float k = uK0 + float(i);
      vec2 tt = hitShell(ro, rd, k);
      if (tt.y > 0.0 && tt.y > tt.x) shadeHit(ro + rd * tt.y, rd, tt.y, k, true, col, T);
    }

    // uncertainty static at the deep end: sparse coloured flecks
    if (uStatic > 0.001) {
      vec2 g = floor(gl_FragCoord.xy / 2.0);
      float tick = floor(uTime * 15.0);
      float kk = hash13(vec3(g, tick));
      float fleck = smoothstep(1.0 - 0.005 * uStatic, 1.0, kk);
      vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (hash13(vec3(g.yx, tick + 3.0)) + vec3(0.0, 0.33, 0.67)));
      col += mix(vec3(0.7, 0.7, 1.0), hue, 0.6) * fleck * 1.2 * uStatic;
    }

    col *= uBright;
    gl_FragColor = vec4(col, clamp(1.0 - T, 0.0, 1.0));
  }`;

/** Soap-film reflectance colour vs optical path difference (0–3200 nm), integrated over the
 *  visible spectrum with an analytic fit of the CIE 1931 observer, as a 256×1 lookup. */
function filmLut(): THREE.DataTexture {
  const N = 256;
  const g = (l: number, mu: number, s1: number, s2: number) => {
    const t = (l - mu) / (l < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  };
  const xb = (l: number) => 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2);
  const yb = (l: number) => 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1);
  const zb = (l: number) => 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8);
  const rgb: number[] = [];
  let max = 0;
  for (let i = 0; i < N; i++) {
    const opd = (i / (N - 1)) * 3200;
    let X = 0, Y = 0, Z = 0, Yw = 0;
    for (let l = 400; l <= 700; l += 5) {
      const r = Math.sin((Math.PI * opd) / l) ** 2;   // thin film with one half-wave flip
      X += r * xb(l); Y += r * yb(l); Z += r * zb(l); Yw += yb(l);
    }
    X /= Yw; Y /= Yw; Z /= Yw;
    const R = Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z);
    const G = Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z);
    const B = Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z);
    rgb.push(R, G, B);
    max = Math.max(max, R, G, B);
  }
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    data[i * 4] = Math.round((rgb[i * 3] / max) * 255);
    data[i * 4 + 1] = Math.round((rgb[i * 3 + 1] / max) * 255);
    data[i * 4 + 2] = Math.round((rgb[i * 3 + 2] / max) * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, 1);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export interface Foam {
  back: THREE.Mesh;
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  backUniforms: Record<string, THREE.IUniform>;
  /** skins evaluated per ray on this tier */
  shells: number;
  setQuality(q: Quality): void;
  dispose(): void;
}

export function createFoam(q: Quality): Foam {
  const geo = new THREE.PlaneGeometry(2, 2);
  const camU = { uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() } };
  const backUniforms = { ...camU, uBack: { value: 1 }, uTime: { value: 0 } };
  const premult = {
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  } as const;
  const backMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: backFrag, uniforms: backUniforms, ...premult });
  const back = new THREE.Mesh(geo, backMat);
  back.frustumCulled = false;
  back.renderOrder = -10;

  const lut = filmLut();
  const uniforms: Record<string, THREE.IUniform> = {
    ...camU,
    uCam: { value: new THREE.Vector3() },
    uTime: backUniforms.uTime,
    uPxAng: { value: 0.001 },
    uCamD: { value: 1 },
    uJit: { value: 0.3 },
    uBright: { value: 1 },
    uHalo: { value: 0 },
    uStatic: { value: 0 },
    uK0: { value: 0 },
    uNS: { value: 6 },
    uVoid: { value: 0.45 },
    uFilm: { value: lut },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: foamFrag, uniforms, ...premult });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  const foam: Foam = {
    back, mesh, uniforms, backUniforms, shells: 6,
    setQuality(tier: Quality) {
      foam.shells = tier === 'low' ? 4 : tier === 'medium' ? 5 : 6;
      uniforms.uNS.value = foam.shells;
    },
    dispose() { geo.dispose(); mat.dispose(); backMat.dispose(); lut.dispose(); },
  };
  foam.setQuality(q);
  return foam;
}
