/** GLSL for the carbon-12 nucleus: nucleon raymarch, pion-exchange arcs, far-field pin-prick. */

export const NUCLEON_R = 0.15;      // fog scale of one nucleon (local units)
export const BOUND_R = 0.25;         // per-nucleon bounding radius used for ray culling

export const fieldVert = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
  }`;

export const fieldFrag = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform vec3 uCam;
  uniform float uTime;
  uniform vec3 uC[12];
  uniform float uR[12];
  uniform float uT[12];      // 1 = proton, 0 = neutron
  uniform vec3 uQ[36];
  uniform vec3 uCN;          // nucleus centre
  uniform float uGain;       // overall emission (fades as the nucleus becomes a point)
  uniform float uHalo;
  uniform float uQuark;
  uniform float uOrigin;     // strength of the proxy at the origin (the real proton shows through)
  uniform float uView;
  uniform float uIn;         // 0 outside, 1 deep inside the origin proton
  varying vec3 vPos;

  const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

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

    // ---- which nucleons does this ray touch?  (march only inside their union)
    int hit[12];
    int nh = 0;
    float tmin = 1e9, tmax = -1e9;
    for (int i = 0; i < 12; i++) {
      vec3 oc = ro - uC[i];
      float b = dot(oc, rd);
      float c = dot(oc, oc) - ${(BOUND_R * BOUND_R).toFixed(5)} * uR[i] * uR[i];
      float d = b * b - c;
      if (d > 0.0) {
        float s = sqrt(d);
        if (-b + s > 0.0) {
          hit[nh] = i; nh++;
          tmin = min(tmin, max(-b - s, 0.0));
          tmax = max(tmax, -b + s);
        }
      }
    }

    vec3 col = vec3(0.0);
    float T = 1.0;
    float jit = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 97.0);

    if (nh > 0 && uGain > 0.001) {
      float span = tmax - tmin;
      float dt = span / float(STEPS);
      vec3 flowA = vec3(0.0, uTime * 0.09, uTime * 0.04);
      vec3 flowB = vec3(uTime * 0.13, -uTime * 0.1, 0.0);
      for (int s = 0; s < STEPS; s++) {
        float tt = tmin + dt * (float(s) + jit);
        vec3 p = ro + rd * tt;

        float G = 0.0, Gp = 0.0;
        for (int j = 0; j < 12; j++) {
          if (j >= nh) break;
          int i = hit[j];
          vec3 d = p - uC[i];
          float rr = ${NUCLEON_R.toFixed(4)} * uR[i];
          float g = exp(-dot(d, d) / (rr * rr) * 3.2);
          if (i == 0) g *= uOrigin;
          G += g; Gp += g * uT[i];
        }
        if (G < 0.004) continue;

        vec4 w = texture(uNoise, p * 1.5 + flowA);
        vec3 pw = p + (w.xyz - 0.5) * 0.14;
        float n1 = texture(uNoise, pw * 2.6 + flowB).r;
        float n2 = texture(uNoise, ROT * pw * 6.2 - flowA * 1.7).g;
        float n = n1 * 0.6 + n2 * 0.4;
        #if OCT > 2
          float n3 = texture(uNoise, ROT * ROT * pw * 13.0 + flowB * 2.3).b;
          n = n * 0.8 + n3 * 0.2;
        #endif
        n = (n - 0.5) * 1.8 + 0.5;

        float body = G * (0.45 + 1.15 * n);
        float fog = smoothstep(0.10, 0.70, body);
        float hot = smoothstep(0.25, 1.35, G * (0.55 + n));
        float ridge = 1.0 - abs(2.0 * n2 - 1.0);
        float fil = pow(ridge, 9.0) * smoothstep(0.1, 0.6, G) * (0.55 + 0.45 * sin(uTime * 5.0 + n1 * 21.0));

        // proton: violet → magenta → gold (as in the proton scene).  neutron: indigo → cyan → ice
        vec3 cp = mix(vec3(0.30, 0.05, 0.70), vec3(1.0, 0.12, 0.50), smoothstep(0.0, 0.5, hot));
        cp = mix(cp, vec3(1.35, 0.72, 0.36), smoothstep(0.55, 1.0, hot));
        vec3 cn = mix(vec3(0.06, 0.12, 0.55), vec3(0.12, 0.55, 0.95), smoothstep(0.0, 0.5, hot));
        cn = mix(cn, vec3(0.80, 1.05, 1.20), smoothstep(0.55, 1.0, hot));
        vec3 c = mix(cn, cp, Gp / (G + 1e-4));

        vec3 em = c * fog * (0.25 + fog) * 6.0 + vec3(1.0, 0.75, 0.9) * fil * 5.0 * fog;
        float dens = fog * 9.0 * mix(1.0, 0.5, uIn);
        col += T * em * uGain * dt;
        T *= exp(-dens * dt);
        if (T < 0.02) break;
      }

      // ---- three bright points inside each nucleon (valence quarks)
      if (uQuark > 0.001) {
        float eps = 0.0045 * min(uView, 0.6);
        float sig = 0.007;
        for (int j = 0; j < 12; j++) {
          if (j >= nh) break;
          int i = hit[j];
          float wgt = (i == 0 ? uOrigin : 1.0);
          for (int k = 0; k < 3; k++) {
            vec2 g = pointGlow(ro, rd, uQ[i * 3 + k], tmin, tmax, eps, sig);
            vec3 qc = k == 0 ? vec3(1.0, 0.35, 0.28) : (k == 1 ? vec3(0.35, 1.0, 0.5) : vec3(0.4, 0.55, 1.0));
            qc = mix(qc, vec3(1.0), 0.45);
            col += (qc * g.x * 1.5 + qc * g.y * 0.12) * uQuark * wgt * (0.5 + 0.5 * T) * uGain;
          }
        }
      }
    }

    // ---- soft overall halo (closed-form line integral of a gaussian about the centre)
    if (uHalo > 0.001) {
      vec3 oc = uCN - ro;
      float tc = dot(oc, rd);
      float h2 = dot(oc, oc) - tc * tc;
      float sg = 0.40;
      float h = exp(-h2 / (sg * sg)) * smoothstep(-sg, sg, tc);
      float core = exp(-h2 / 0.09) * smoothstep(-0.3, 0.3, tc);
      col += (vec3(0.85, 0.32, 0.6) * h * 0.04 + vec3(0.9, 0.5, 0.5) * core * 0.04) * uHalo * (1.0 - uIn);
    }

    float a = clamp(1.0 - T, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
  }`;

// ------------------------------------------------------------------ pion-exchange arcs
export const arcVert = /* glsl */ `
  attribute vec4 aPair;          // i, j, phase, rate
  uniform vec3 uC[12];
  uniform vec3 uCam;
  uniform float uTime, uWidth;
  varying float vU; varying float vSide; varying float vFlash; varying float vHead;
  void main() {
    int i = int(aPair.x + 0.5), j = int(aPair.y + 0.5);
    vec3 a = uC[i], b = uC[j];
    vec3 ax = b - a;
    float L = max(length(ax), 1e-4);
    vec3 dir = ax / L;
    float u = position.x;
    vec3 up = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 n1 = normalize(cross(dir, up));
    vec3 n2 = cross(dir, n1);
    float env = sin(3.14159265 * u);
    float ph = aPair.z * 6.2831853;
    float t = uTime * aPair.w;
    vec3 p = a + ax * u;
    p += env * 0.025 * (sin(u * 11.0 + t * 6.0 + ph) * n1 + cos(u * 8.0 - t * 5.0 + ph * 1.7) * n2);
    // each arc lives for part of its cycle, flashing as a pion is passed
    float life = fract(t * 0.35 + aPair.z);
    float alive = smoothstep(0.0, 0.08, life) * smoothstep(0.62, 0.5, life);
    vFlash = alive * (0.6 + 0.4 * sin(uTime * 31.0 + ph * 3.0));
    vHead = clamp(life / 0.55, 0.0, 1.0);
    vec3 vd = normalize(p - uCam);
    vec3 side = normalize(cross(dir, vd));
    p += side * position.y * uWidth * (0.35 + 0.65 * env);
    vU = u; vSide = position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

export const arcFrag = /* glsl */ `
  uniform float uFade;
  varying float vU; varying float vSide; varying float vFlash; varying float vHead;
  void main() {
    float prof = exp(-vSide * vSide * 3.5);
    float bead = exp(-pow((vU - vHead) * 7.0, 2.0));
    float thread = 0.10 * sin(3.14159265 * vU);
    float I = (thread + 0.9 * bead) * prof * vFlash * uFade;
    vec3 c = mix(vec3(1.0, 0.45, 0.85), vec3(1.0, 0.95, 0.9), bead);
    gl_FragColor = vec4(c * I, I * 0.05);
  }`;

// ------------------------------------------------------------------ far-field pin-prick (matches the atom's)
export const pinVert = /* glsl */ `
  uniform float uRn;
  uniform vec2 uViewport;
  uniform float uDpr;
  varying vec2 vPx; varying float vRc; varying float vH;
  void main() {
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float z = max(-mv.z, 1e-9);
    vec4 clip = projectionMatrix * mv;
    float pxPerUnit = 0.5 * uViewport.y * projectionMatrix[1][1] / z;
    float rc = uRn * pxPerUnit;
    float hR = max(rc * 1.6, 3.0 * uDpr);
    float quad = max(rc * 1.2, 1.0) + hR * 9.0;
    vec2 off = position.xy * quad;
    clip.xy += off / (0.5 * uViewport) * clip.w;
    gl_Position = clip;
    vPx = off; vRc = rc; vH = hR;
  }`;

export const pinFrag = /* glsl */ `
  uniform float uI; uniform vec3 uCore; uniform vec3 uHalo; uniform float uTime;
  varying vec2 vPx; varying float vRc; varying float vH;
  void main() {
    float r = length(vPx);
    float rc = max(vRc, 0.6);
    float core = 1.0 - smoothstep(rc - 0.8, rc + 0.8, r);
    float sub = min(1.0, vRc * vRc / 0.36);
    float shimmer = 0.92 + 0.08 * sin(uTime * 3.1) * sin(uTime * 1.7 + 1.0);
    float halo = exp(-r / vH) * 0.55 + 0.18 / (1.0 + (r / vH) * (r / vH));
    vec3 col = uCore * core * mix(0.35, 1.0, sub) * 14.0 + uHalo * halo;
    col *= uI * shimmer;
    gl_FragColor = vec4(col, clamp(core, 0.0, 1.0) * uI);
  }`;
