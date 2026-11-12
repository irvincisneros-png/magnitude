/**
 * The gluon field: an emission–absorption raymarch inside a bounding sphere.
 * - A breathing, domain-warped noise "storm" with a soft radial profile (the proton's bulk).
 * - Ridged filaments that flicker (transient flux lines in the field).
 * - Three glowing flux tubes from a moving junction to each valence quark (the Y string),
 *   tinted by each quark's colour charge so they mix to white where they meet.
 * - Quarks and the travelling gluon are added analytically (exact line integral of a 1/r²
 *   glow), so they stay sharp points at every zoom: quarks have no measured size.
 * Output is premultiplied (rgb = emitted light, a = 1 − transmittance).
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';

export const FIELD_RADIUS = 0.75;

const vert = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
  }`;

const frag = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform vec3 uCam;
  uniform float uTime;
  uniform vec3 uQ[3];
  uniform vec3 uQC[3];
  uniform vec3 uJ;
  uniform vec3 uSparkP; uniform vec3 uSparkC; uniform float uSpark;
  uniform float uField;   // field density (zoom-faded)
  uniform float uThin;    // 0 = dense storm, 1 = sparse wisps
  uniform float uTube;    // flux tube strength
  uniform float uQuark;   // quark glow strength
  uniform float uHalo;    // faint outer tail (fades as we leave)
  uniform float uPt;      // quark point radius (scales with the view, so always point-like)
  uniform float uView;    // view height in local units
  uniform float uBreath;
  uniform float uWarp;
  uniform float uDeep;    // 0 → 1 as the large-scale storm gives way to view-scale wisps
  uniform float uIn;      // 0 outside, 1 deep inside: only nearby structure is seen
  varying vec3 vPos;

  const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  float segDist(vec3 p, vec3 a, vec3 b, out float h) {
    vec3 pa = p - a, ba = b - a;
    h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
  }

  // Glow of a point source seen along the ray: core ~ ε²/(h²+ε²) (screen-sharp) and a soft
  // gaussian halo of width σ. h = perpendicular distance from the source to the ray.
  // Sources behind the camera or outside [ta, tb] fade out.
  vec2 pointGlow(vec3 ro, vec3 rd, vec3 c, float ta, float tb, float eps, float sig) {
    float tc = dot(c - ro, rd);
    vec3 off = ro + rd * tc - c;
    float h2 = dot(off, off);
    float inside = smoothstep(ta - sig, ta + eps, tc) * smoothstep(tb + sig, tb - eps, tc);
    return vec2(eps * eps / (h2 + eps * eps), exp(-h2 / (sig * sig))) * inside;
  }

  void main() {
    vec3 ro = uCam;
    vec3 rd = normalize(vPos - uCam);
    float b = dot(ro, rd);
    float c = dot(ro, ro) - ${FIELD_RADIUS * FIELD_RADIUS};
    float disc = b * b - c;
    if (disc <= 0.0) discard;
    disc = sqrt(disc);
    float t0 = max(-b - disc, 0.0);
    float t1 = -b + disc;
    if (t1 <= t0) discard;

    float jit = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 97.0);
    vec3 col = vec3(0.0);
    float T = 1.0;
    float span = t1 - t0;
    if (uIn > 0.99) span = min(span, 14.0 * uView);   // deep inside nothing beyond a few view-widths counts
    float tp = t0;
    float br = uBreath;
    float thr = mix(0.49, 0.97, uThin * uThin);
    vec3 flowA = vec3(0.0, uTime * 0.045, uTime * 0.02);
    vec3 flowB = vec3(uTime * 0.07, -uTime * 0.05, 0.0);
    float kV = 0.45 / max(uView, 1e-5);

    if (uField > 0.001 || uTube > 0.001) {
      for (int i = 0; i < STEPS; i++) {
        float x = (float(i) + jit) / float(STEPS);
        float tt = t0 + span * pow(x, uWarp);
        float dt = tt - tp; tp = tt;
        vec3 p = ro + rd * tt;
        float r2 = dot(p, p);

        // --- seething field
        vec4 w = texture(uNoise, p * 0.55 + flowA);
        vec3 pw = p + (w.xyz - 0.5) * 0.42;
        float n1 = texture(uNoise, pw * 1.0 + flowB).r;
        float n2 = texture(uNoise, ROT * pw * 3.1 - flowA * 1.7).g;
        float n = n1 * 0.62 + n2 * 0.38;
        #if OCT > 2
          float n3 = texture(uNoise, ROT * ROT * pw * 7.3 + flowB * 2.3).b;
          n = n * 0.82 + n3 * 0.18;
        #endif
        // view-scale grain near the camera, so the inside never goes smooth and blurry
        float near = exp(-tt / (4.0 * uView)) * (1.0 - smoothstep(0.04, 0.3, uView));
        float nv = texture(uNoise, ROT * p * kV + flowB * 3.0).a;
        n += (nv - 0.5) * 0.55 * near;

        // deep inside, the only structure left is at the view's own scale, close to the camera
        n = mix(n, 0.5 + (nv - 0.5) * 2.6 * near + (n2 - 0.5) * 0.3, uDeep);
        n = (n - 0.5) * 1.7 + 0.5;
        float prof = exp(-r2 / (0.15 * br * br)) * smoothstep(0.7 * br, 0.32, sqrt(r2));
        float lump = smoothstep(thr, thr + 0.22, n);
        float fog = prof * lump;
        float ridge = 1.0 - abs(2.0 * n2 - 1.0);
        float ridgeV = 1.0 - abs(2.0 * nv - 1.0);
        float fil = (pow(ridge, 10.0) * (1.0 - uIn * 0.7) + pow(ridgeV, 9.0) * 4.0 * near) * prof * (0.55 + 0.45 * sin(uTime * 6.0 + n1 * 23.0));
        float tail = exp(-r2 / 0.16) * 0.06 * uHalo * (1.0 - uIn);
        float dens = (fog * 1.0 + tail) * uField;

        // colour follows the local structure (lumps run hot, gaps stay violet), brightness the profile
        float hot = smoothstep(thr - 0.05, thr + 0.45, n) * (1.0 - 0.6 * uDeep);
        vec3 fieldCol = mix(vec3(0.30, 0.05, 0.70), vec3(1.0, 0.12, 0.50), smoothstep(0.0, 0.5, hot));
        fieldCol = mix(fieldCol, vec3(1.35, 0.72, 0.36), smoothstep(0.55, 1.0, hot) * (0.4 + 0.6 * prof));
        vec3 em = fieldCol * (fog * (0.4 + 0.8 * fog) + tail) * uField * 2.2 * (1.0 - 0.3 * uIn) * (0.3 + 1.6 * prof * prof)
                + vec3(1.0, 0.55, 0.65) * fil * 3.0 * uField * (1.0 - uThin * 0.5);

        // --- Y-shaped flux tubes
        if (uTube > 0.001) {
          vec3 tc = vec3(0.0); float ts = 0.0; float tm = 0.0;
          for (int k = 0; k < 3; k++) {
            float h;
            float d = segDist(p, uJ, uQ[k], h);
            float wid = mix(0.032, 0.018, h);
            float fl = 0.55 + 0.6 * n2 + 0.18 * sin(h * 22.0 - uTime * 7.0 + float(k) * 2.1);
            float d2 = d * d / (wid * wid);
            float tb = (exp(-d2) * 0.6 + exp(-d2 * 9.0)) * fl;
            tc += uQC[k] * tb; ts += tb; tm = max(tm, tb);
          }
          vec3 tcol = tc / max(ts, 1e-4);
          em += tcol * tm * 22.0 * uTube;
          dens += ts * 0.3 * uTube;
        }

        // inside: only structure within a few view-widths counts, normalised so the surface
        // brightness stays constant however deep we go (the field thins by threshold, not by dimming)
        float nearW = mix(1.0, exp(-tt / (3.0 * uView)) * 0.13 / (3.0 * uView), uIn);
        em *= nearW; dens *= nearW;
        col += T * em * dt;
        T *= exp(-dens * 1.6 * dt);
        if (T < 0.02) break;
      }
    }

    // --- quarks and the exchanged gluon: exact point glows
    if (uQuark > 0.001) {
      for (int k = 0; k < 3; k++) {
        vec2 g = pointGlow(ro, rd, uQ[k], t0, t1, uPt, min(0.035, uView * 0.12));
        vec3 qc = uQC[k];
        col += (mix(qc, vec3(1.0), 0.35) * g.x * 5.0 + qc * g.y * 1.1) * uQuark;
      }
      if (uSpark > 0.001) {
        vec2 g = pointGlow(ro, rd, uSparkP, t0, t1, uPt * 0.7, min(0.022, uView * 0.08));
        col += (mix(uSparkC, vec3(1.0), 0.5) * g.x * 4.0 + uSparkC * g.y * 0.5) * uSpark * uQuark;
      }
    }

    float a = clamp(1.0 - T, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
  }`;

export function createField(noise: THREE.Data3DTexture, q: Quality) {
  const uniforms = {
    uNoise: { value: noise },
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uQ: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uQC: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] },
    uJ: { value: new THREE.Vector3() },
    uSparkP: { value: new THREE.Vector3() },
    uSparkC: { value: new THREE.Vector3(1, 1, 1) },
    uSpark: { value: 0 },
    uField: { value: 1 },
    uThin: { value: 0 },
    uTube: { value: 1 },
    uQuark: { value: 1 },
    uHalo: { value: 1 },
    uPt: { value: 0.004 },
    uView: { value: 1 },
    uBreath: { value: 1 },
    uWarp: { value: 1 },
    uIn: { value: 0 },
    uDeep: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    defines: defines(q),
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const geo = new THREE.IcosahedronGeometry(FIELD_RADIUS * 1.04, 4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return {
    mesh, uniforms,
    setQuality(qq: Quality) { mat.defines = defines(qq); mat.needsUpdate = true; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

function defines(q: Quality) {
  return q === 'low' ? { STEPS: 28, OCT: 2 } : q === 'medium' ? { STEPS: 40, OCT: 3 } : { STEPS: 54, OCT: 3 };
}
