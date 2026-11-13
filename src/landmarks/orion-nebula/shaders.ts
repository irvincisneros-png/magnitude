/**
 * GLSL for the Orion Nebula: ONE instanced sprite program draws cloud puffs (glowing gas and/or
 * absorbing dust), stars and proplyds, all sorted far → near on the CPU (index attribute only).
 * Blending is premultiplied "over": rgb = emission (+ faint dust colour), alpha = dust opacity, so
 * glowing gas adds light and dust darkens everything behind it, including the parent layers.
 * Records live in a float texture: 5 texels per sprite (see model.ts).
 */

export const vert = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D uData;
  uniform float uTime;
  uniform float uTanHalf;
  uniform float uGain;        // emission gain (zoom-dependent)
  uniform float uDust;        // dust opacity gain
  uniform float uStar;        // star brightness gain
  uniform float uProp;        // proplyd visibility
  uniform float uSpikes;
  uniform float uDpr;
  uniform vec3 uGroup;        // fade per group: nebula, surroundings, fine near-origin detail
  uniform vec2 uViewport;     // drawing-buffer size in px
  uniform vec2 uBig;          // dissolve sprites whose radius exceeds this fraction of the half-view
  uniform vec3 uT;            // Trapezium, local coordinates
  attribute float aIdx;
  varying vec2 vUv;
  varying vec3 vEmit;
  varying vec3 vRim;
  varying vec4 vP;            // cloud: abs, erode, kind, noise scale | star: I, px, kind, spikes
  varying vec4 vN;            // noise offset xy, light direction (sprite frame) zw

  vec4 fetchT(int t) { return texelFetch(uData, ivec2(t & 4095, t >> 12), 0); }

  void main() {
    int base = int(aIdx + 0.5) * 5;
    vec4 d0 = fetchT(base), d1 = fetchT(base + 1), d2 = fetchT(base + 2), d3 = fetchT(base + 3), d4 = fetchT(base + 4);
    float kind = d1.w;
    float seed = d4.x;
    vec2 corner = position.xy;
    vUv = corner;
    vec3 P = d0.xyz;
    float R = d0.w;
    vEmit = vec3(0.0); vRim = vec3(0.0); vN = vec4(0.0);
    vec4 hide = vec4(2.0, 2.0, 2.0, 1.0);

    if (kind < 0.5) {
      // ------------------------------------------------ cloud puff
      float ph = seed * 6.2832;
      P += R * 0.22 * vec3(sin(uTime * 0.031 + ph), sin(uTime * 0.027 + ph * 1.7), sin(uTime * 0.023 + ph * 2.3));
      vec4 mv = modelViewMatrix * vec4(P, 1.0);
      float dist = -mv.z;
      float frac = R / max(dist * uTanHalf, 1e-7);
      float g = d4.w < 0.5 ? uGroup.x : (d4.w < 1.5 ? uGroup.y : uGroup.z);
      float fade = (1.0 - smoothstep(uBig.x, uBig.y, frac)) * g * smoothstep(R * 1.0, R * 2.5, dist);
      vec3 ax = d1.xyz;
      float st = length(ax);
      vec2 u; float su = 1.0;
      if (st > 0.001) {
        vec3 av = mat3(modelViewMatrix) * (ax / st);
        float l2 = length(av.xy);
        u = l2 > 1e-4 ? av.xy / l2 : vec2(1.0, 0.0);
        su = 1.0 + (st - 1.0) * l2;
      } else {
        float a = d4.y + uTime * 0.01 * (fract(seed * 7.13) - 0.5);
        u = vec2(cos(a), sin(a));
      }
      vec2 v = vec2(-u.y, u.x);
      vec4 tv = modelViewMatrix * vec4(uT, 1.0);
      vec2 L = tv.xy - mv.xy;
      float ll = length(L);
      L = ll > 1e-6 ? L / ll : vec2(0.0, 1.0);
      // dust lit from behind (Trapezium beyond the clump, seen from the camera) gets a silver
      // lining and a faint forward-scattered glow
      vec3 toT = normalize(tv.xyz - mv.xyz), toC = normalize(-mv.xyz);
      float back = smoothstep(0.1, -0.7, dot(toT, toC));
      mv.xy += (corner.x * u * su + corner.y * v) * R;
      gl_Position = projectionMatrix * mv;
      vEmit = (d2.rgb + d3.rgb * (0.05 * back)) * (uGain * fade);
      vRim = d3.rgb * ((0.3 + 0.5 * back) * uGain * fade);
      vP = vec4(min(d2.a * uDust, 0.97) * fade, d3.w, 0.0, d4.z);
      vN = vec4(fract(seed * 13.7), fract(seed * 29.3), dot(L, u), dot(L, v));
      if (fade < 0.002 || dist <= 0.0) gl_Position = hide;
    } else if (kind < 1.5) {
      // ------------------------------------------------ star (screen-sized, HDR)
      vec4 mv = modelViewMatrix * vec4(P, 1.0);
      float dist = max(-mv.z, 1e-7);
      float I = d4.w * pow(clamp(1.6 / dist, 0.25, 30.0), 0.7) * uStar;
      I *= 1.0 + 0.16 * sin(uTime * (1.7 + 3.1 * fract(seed * 5.1)) + seed * 40.0) * sin(uTime * 0.73 + seed * 9.0);
      I = min(I, 40.0);
      float px = clamp(2.6 + 3.2 * pow(I, 0.36), 2.6, 52.0) * uDpr;
      gl_Position = projectionMatrix * mv;
      gl_Position.xy += corner * (px / uViewport) * gl_Position.w;
      vEmit = d2.rgb;
      vP = vec4(I, px, 1.0, smoothstep(2.5, 12.0, I) * uSpikes);
      if (mv.z >= 0.0 || I < 0.004) gl_Position = hide;
    } else {
      // ------------------------------------------------ proplyd: oriented teardrop, min size on screen
      vec4 mv = modelViewMatrix * vec4(P, 1.0);
      float dist = max(-mv.z, 1e-7);
      vec3 av = mat3(modelViewMatrix) * d1.xyz;
      float l2 = length(av.xy);
      vec2 u = l2 > 1e-4 ? av.xy / l2 : vec2(1.0, 0.0);
      vec2 v = vec2(-u.y, u.x);
      float pxTrue = R / (dist * uTanHalf) * uViewport.y * 0.5;
      float px = max(pxTrue, 9.0 * uDpr);
      gl_Position = projectionMatrix * mv;
      gl_Position.xy += (corner.x * u + corner.y * v) * (px / uViewport) * gl_Position.w * 2.0;
      vEmit = d2.rgb * d4.w * uProp * min(1.0, uGain * 1.4);
      vP = vec4(0.0, px, 2.0, 0.0);
      if (mv.z >= 0.0 || uProp < 0.002) gl_Position = hide;
    }
  }`;

export const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D uNoise;
  uniform float uTime;
  uniform float uDpr;
  uniform vec3 uDustCol;
  varying vec2 vUv;
  varying vec3 vEmit;
  varying vec3 vRim;
  varying vec4 vP;
  varying vec4 vN;

  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    float kind = vP.z;
    if (kind < 0.5) {
      float fall = 1.0 - r2;
      float ns = vP.w;
      vec2 nuv = vUv * (0.3 * abs(ns)) + vN.xy + vec2(uTime * 0.0011, -uTime * 0.0007);
      vec4 nz = texture2D(uNoise, nuv);
      float n = ns < 0.0 ? nz.g : nz.r;     // ridged (filaments) or billowy
      #ifdef HQ
        n = n * 0.78 + texture2D(uNoise, nuv * 3.3 + vec2(0.37, 0.71)).b * 0.3 - 0.04; // fine grain
      #endif
      float erode = vP.y;
      // noise-eroded mask: the edge is cut where the noise is thin, so it is ragged, not Gaussian
      float m = n + fall * 0.95 - 1.0;
      float hard = smoothstep(-0.02, 0.2, m) * (0.45 + 0.55 * n);
      float dens = mix(fall * fall, hard, erode);
      float a = vP.x * dens;
      vec3 col = vEmit * dens * (0.7 + 0.7 * n) + uDustCol * a;
      if (dot(vRim, vRim) > 0.0) {
        // ionisation front: a thin bright line on the edge of a dust clump that faces the Trapezium
        float edge = smoothstep(-0.03, 0.04, m) * (1.0 - smoothstep(0.05, 0.16, m));
        vec2 dir = vUv / max(sqrt(r2), 1e-3);
        float face = max(0.0, dot(dir, vN.zw));
        col += vRim * edge * (0.08 + 0.92 * face * face);
      }
      gl_FragColor = vec4(col, a);
    } else if (kind < 1.5) {
      float I = vP.x, px = vP.y;
      float rpx = sqrt(r2) * px * 0.5 / uDpr;
      float core = exp(-rpx * rpx / 1.1);
      float halo = exp(-r2 * 7.0) * 0.14 + 0.03 / (1.0 + r2 * 70.0);
      vec2 c = vUv;
      float spk = (exp(-abs(c.x) * px * 0.4) * exp(-c.y * c.y * 2.5) + exp(-abs(c.y) * px * 0.4) * exp(-c.x * c.x * 2.5)) * vP.w * 0.18;
      float k = (core + (halo + spk) * min(I, 6.0) / max(I, 1e-3)) * (1.0 - r2);
      vec3 col = mix(vec3(1.0), vEmit, clamp(1.3 - core * 0.6, 0.0, 1.0)) * I * k;
      gl_FragColor = vec4(col, min(1.0, core * min(I, 1.0)) * 0.5);
    } else {
      // proplyd, in its own frame: x points away from the Trapezium
      vec2 q = vUv;
      vec2 c = vec2(-0.42, 0.0);
      vec2 d = q - c;
      float rr = length(d);
      float towardT = clamp(-d.x / max(rr, 1e-3), -1.0, 1.0);
      float bow = exp(-pow((rr - 0.2) / 0.06, 2.0)) * smoothstep(-0.1, 0.8, towardT);
      float along = d.x / 1.3;
      float w = 0.2 * (1.0 - 0.55 * clamp(along, 0.0, 1.0));
      float tail = d.x > 0.0 ? exp(-q.y * q.y / (w * w)) * (1.0 - smoothstep(0.2, 1.0, along)) * 0.32 : 0.0;
      float env = exp(-rr * rr / 0.03) * 0.25;
      float disc = exp(-pow(d.x / 0.035, 2.0) - pow(d.y / 0.11, 2.0));
      float star = exp(-rr * rr / 0.0012) * 2.5;
      vec3 col = vEmit * ((bow * 1.4 + tail + env) * (1.0 - disc * 0.85) + star * vec3(1.0, 0.92, 0.85));
      float a = disc * 0.8 * min(1.0, dot(vEmit, vec3(0.5)));
      gl_FragColor = vec4(col, a);
    }
  }`;
