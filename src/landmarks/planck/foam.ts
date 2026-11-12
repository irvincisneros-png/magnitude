/**
 * Quantum foam: one full-screen pass (a clip-space quad; rays rebuilt from the camera).
 * - Bubbles: exact ray–sphere hits found by a DDA walk through jittered lattices at three
 *   sizes (1, 0.3, 0.09 units), so the froth looks the same however far you dive in.
 *   Each film is shaded with real thin-film interference (three wavelengths), fresnel and a
 *   soft fake environment for pearly highlights. Bubbles too small to resolve turn into a
 *   flickering point shimmer instead of aliasing.
 * - "Throats": a domain-warped double gyroid (a surface full of tunnels) raymarched as a faint
 *   emissive haze between the bubbles.
 * - A soft halo around the origin so the whole froth reads as a shimmer from far away.
 * - At the deep end, coloured static: the picture itself breaks down.
 * Output is premultiplied (rgb = light, a = coverage).
 *
 * A separate backdrop quad (deep indigo-black) is drawn first and fades out towards the
 * zoom-out end so the engine's desert shows through.
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';
import { COMMON } from './glsl';

export const FOAM_R = 3.0; // bounding radius of the froth (local units)

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
  uniform vec4 uScaleW;        // weights of the 1 / 0.3 / 0.09 / 0.027 bubble lattices
  uniform vec4 uMaxN;          // max DDA cells per lattice size
  uniform vec2 uOcc;           // emptiness of the two finest lattices (fuller when deep)
  uniform float uGyro; uniform float uGyroSteps;
  varying vec3 vDir;

  ${COMMON}

  vec3 film(float d, float cosI) {          // soap-like film, n = 1.33; d in nm
    float sinT2 = (1.0 - cosI * cosI) / 1.7689;
    float opd = 2.66 * d * sqrt(1.0 - sinT2);
    return 0.5 - 0.5 * cos(6.2831853 * opd / vec3(650.0, 532.0, 450.0));
  }

  vec3 envLight(vec3 R) {
    float k1 = max(dot(R, vec3(0.48, 0.78, 0.40)), 0.0);
    float k2 = max(dot(R, vec3(-0.76, -0.22, -0.61)), 0.0);
    float k3 = max(dot(R, vec3(0.2, -0.9, 0.38)), 0.0);
    return vec3(0.03, 0.025, 0.08)
      + vec3(1.0, 0.97, 1.05) * (pow(k1, 30.0) * 3.2 + pow(k1, 4.0) * 0.35)
      + vec3(0.55, 0.22, 0.85) * pow(k2, 5.0) * 0.6
      + vec3(0.15, 0.55, 0.65) * pow(k3, 6.0) * 0.45;
  }

  vec3 shadeSurf(vec3 n, vec3 rd, float cosI, float seed, float fl) {
    float th = 160.0 + 430.0 * (0.5 + 0.5 * sin(n.y * 2.6 + 1.6 * sin(n.x * 4.3 + n.z * 2.1 + uTime * 0.7 + seed * 31.0) + seed * 9.0 + uTime * 0.2));
    th *= (1.0 - 0.75 * fl);                    // the film thins just before it pops
    vec3 f = film(th, cosI);
    vec3 pearl = mix(vec3(dot(f, vec3(0.3333))), f, 0.62);
    float F = 0.03 + 0.97 * pow(1.0 - cosI, 3.0);
    return pearl * envLight(reflect(rd, n)) * (0.04 + 1.25 * F);
  }

  // walk one lattice; accumulate light (col) and transmittance (T)
  void lattice(vec3 ro, vec3 rd, float tA, float tB, float S, vec3 off, float lat, float occ, float maxN, float w,
               inout vec3 col, inout float T) {
    if (w < 0.004) return;
    vec3 p = (ro + rd * tA - off) / S;
    vec3 cell = floor(p);
    vec3 stp = sign(rd);
    vec3 inv = 1.0 / max(abs(rd), vec3(1e-5));
    vec3 tMax = (cell + max(stp, 0.0) - p) * stp * inv;   // in cell units, from tA
    for (int i = 0; i < 28; i++) {
      if (float(i) >= maxN) break;
      vec3 cc0 = (cell + 0.5) * S + off;
      float occH = hash13(cell * 2.31 + lat * 5.7 + floor(uTime * 0.05 + hash13(cell + lat)));
      if (occH >= occ && dot(cc0, cc0) < 7.0) {
      vec3 c; float r, a, fl, seed;
      bubbleAt(cell, S, off, lat, uTime, uJit, c, r, a, fl, seed);
      float env = exp(-dot(c, c) * 0.42) * (1.0 - smoothstep(1.9, 2.5, length(c)));
      a *= env * w * (1.0 - smoothstep(maxN * 0.6, maxN, float(i)));
      if (a > 0.002) {
        vec3 oc = ro - c;
        float b = dot(oc, rd);
        float cc = dot(oc, oc) - r * r;
        float tc = -b;
        if (tc > 0.0 || cc < 0.0) {
          a *= exp(-0.7 * max(0.0, tc / uCamD - 0.9));   // depth fog: far froth sinks into the dark
          float h = sqrt(max(dot(oc, oc) - b * b, 0.0));
          float pxw = max(tc, 1e-5) * uPxAng;
          float vis = smoothstep(0.7, 3.0, r / pxw);
          float disc = b * b - cc;
          if (vis > 0.0) {
            if (disc > 0.0) {
              float sq = sqrt(disc);
              float cosI = clamp(sq / r, 0.0, 1.0);
              float t1 = tc - sq, t2 = tc + sq;
              vec3 lit = vec3(0.0);
              if (t1 > 0.0) lit += shadeSurf((oc + rd * t1) / r, rd, cosI, seed, fl);
              if (t2 > 0.0) {
                // far wall, seen through the bubble: cheaper film-only shading
                vec3 n2 = -(oc + rd * t2) / r;
                float th2 = 160.0 + 430.0 * (0.5 + 0.5 * sin(n2.y * 2.6 + seed * 9.0 + uTime * 0.2 + 1.7));
                float F2 = 0.03 + 0.97 * pow(1.0 - cosI, 3.0);
                lit += film(th2, cosI) * vec3(0.10, 0.08, 0.22) * (0.2 + 2.5 * F2);
              }
              lit += vec3(1.1, 1.05, 1.4) * fl * (0.03 + 2.2 * pow(1.0 - cosI, 4.0));
              col += T * lit * a * vis;
              T *= 1.0 - 0.07 * a * vis * (0.6 + pow(1.0 - cosI, 3.0));
            }
            // anti-aliased limb: a soft band where the ray grazes the film
            float band = pxw * 1.3 + r * 0.012;
            float rim = exp(-(h - r) * (h - r) / (band * band));
            col += T * vec3(0.45, 0.42, 0.85) * rim * a * vis * 0.22;
          }
          if (vis < 1.0) {
            // unresolved bubble: a point of flickering light (the shimmer seen from far away)
            float tw = 0.4 + 0.6 * hash13(cell + floor(uTime * 9.0 + seed * 5.0));
            float cov = min(1.0, (r * r) / (pxw * pxw));
            float pt = exp(-h * h / (pxw * pxw * 1.8));
            col += T * vec3(0.62, 0.6, 1.0) * (1.0 - vis) * a * pt * cov * tw * 0.7;
          }
        }
      }
      }
      // next cell (stop past the bound, or where depth fog has eaten everything)
      float tNow = min(tMax.x, min(tMax.y, tMax.z));
      float tW = tA + tNow * S;
      if (tW > tB || tW > 4.0 * uCamD) break;
      vec3 m = step(tMax.xyz, tMax.yzx) * step(tMax.xyz, tMax.zxy);
      cell += m * stp;
      tMax += m * inv;
    }
  }

  float gyroid(vec3 p) {
    p += 0.35 * sin(p.zxy * 1.3 + uTime * vec3(0.21, 0.17, 0.23));
    float g1 = dot(sin(p * 2.6), cos(p.yzx * 2.6));
    vec3 q = p * 3.1 + 1.7;
    float g2 = dot(sin(q * 2.6), cos(q.yzx * 2.6));
    return g1 + 0.35 * g2;
  }

  void main() {
    vec3 ro = uCam;
    vec3 rd = normalize(vDir);
    float b = dot(ro, rd);
    float c = dot(ro, ro) - ${(FOAM_R * FOAM_R).toFixed(3)};
    float disc = b * b - c;
    vec3 col = vec3(0.0);
    float T = 1.0;

    // halo of the whole froth (closest approach of the ray to the origin)
    float h0 = sqrt(max(dot(ro, ro) - b * b, 0.0));
    if (-b > 0.0) col += vec3(0.20, 0.15, 0.48) * exp(-h0 * h0 * 0.9) * uHalo
                      + vec3(0.6, 0.6, 1.0) * exp(-h0 * h0 * 12.0) * uHalo * 0.4;

    if (disc > 0.0) {
      disc = sqrt(disc);
      float tA = max(-b - disc, 0.0);
      float tB = -b + disc;
      if (tB > tA) {
        // throats: faint gyroid haze, front to back
        if (uGyro > 0.001) {
          float n = uGyroSteps;
          float dt = (tB - tA) / n;
          float jt = hash13(vec3(gl_FragCoord.xy, fract(uTime * 3.7) * 61.0));
          for (int i = 0; i < 14; i++) {
            if (float(i) >= n) break;
            vec3 p = ro + rd * (tA + (float(i) + jt) * dt);
            float g = gyroid(p);
            float mem = exp(-g * g * 6.0);
            float env = exp(-dot(p, p) * 0.5);
            vec3 tint = mix(vec3(0.05, 0.025, 0.16), vec3(0.16, 0.22, 0.4), 0.5 + 0.5 * sin(p.y * 1.9 + p.x * 1.1 + uTime * 0.3));
            float dens = mem * env * uGyro;
            col += T * tint * dens * dt * 0.2;
            T *= exp(-dens * dt * 0.35);
          }
        }
        lattice(ro, rd, tA, tB, 1.0, vec3(0.0), 0.0, 0.3, uMaxN.x, uScaleW.x, col, T);
        lattice(ro, rd, tA, tB, 1.0, vec3(0.5), 1.0, 0.45, uMaxN.x, uScaleW.x, col, T);
        lattice(ro, rd, tA, tB, 0.3, vec3(0.11, 0.07, 0.13), 2.0, 0.62, uMaxN.y, uScaleW.y, col, T);
        lattice(ro, rd, tA, tB, 0.09, vec3(0.03, 0.05, 0.02), 3.0, uOcc.x, uMaxN.z, uScaleW.z, col, T);
        lattice(ro, rd, tA, tB, 0.027, vec3(0.013, 0.007, 0.019), 4.0, uOcc.y, uMaxN.w, uScaleW.w, col, T);
      }
    }

    // uncertainty static: sparse coloured flecks that change every frame-ish
    if (uStatic > 0.001) {
      vec2 g = floor(gl_FragCoord.xy / 2.0);
      float tick = floor(uTime * 15.0);
      float k = hash13(vec3(g, tick));
      float fleck = smoothstep(1.0 - 0.005 * uStatic, 1.0, k);
      vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (hash13(vec3(g.yx, tick + 3.0)) + vec3(0.0, 0.33, 0.67)));
      col += mix(vec3(0.7, 0.7, 1.0), hue, 0.6) * fleck * 1.2 * uStatic;
    }

    col *= uBright;
    gl_FragColor = vec4(col, clamp(1.0 - T, 0.0, 1.0));
  }`;

export interface Foam {
  back: THREE.Mesh;
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  backUniforms: Record<string, THREE.IUniform>;
  setQuality(q: Quality): void;
  dispose(): void;
}

export function createFoam(q: Quality): Foam {
  const geo = new THREE.PlaneGeometry(2, 2);
  const camU = { uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() } };
  const backUniforms = { ...camU, uBack: { value: 1 }, uTime: { value: 0 } };
  const backMat = new THREE.ShaderMaterial({
    vertexShader: quadVert, fragmentShader: backFrag, uniforms: backUniforms,
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const back = new THREE.Mesh(geo, backMat);
  back.frustumCulled = false;
  back.renderOrder = -10;

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
    uScaleW: { value: new THREE.Vector4(1, 1, 1, 0) },
    uMaxN: { value: new THREE.Vector4(15, 24, 24, 0) },
    uOcc: { value: new THREE.Vector2(0.78, 0.6) },
    uGyro: { value: 1 },
    uGyroSteps: { value: 12 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: quadVert, fragmentShader: foamFrag, uniforms,
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  const setQuality = (tier: Quality) => {
    const n = uniforms.uMaxN.value as THREE.Vector4;
    if (tier === 'low') { n.set(12, 12, 12, 0); uniforms.uGyroSteps.value = 7; }
    else if (tier === 'medium') { n.set(12, 16, 14, 12); uniforms.uGyroSteps.value = 10; }
    else { n.set(12, 20, 20, 18); uniforms.uGyroSteps.value = 13; }
  };
  setQuality(q);

  return {
    back, mesh, uniforms, backUniforms, setQuality,
    dispose() { geo.dispose(); mat.dispose(); backMat.dispose(); },
  };
}
