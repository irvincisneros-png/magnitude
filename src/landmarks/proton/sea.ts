/**
 * Sea quark–antiquark pairs and the last shimmer of the field.
 * Each pair is ONE point sprite whose fragment shader draws the quark (a colour charge) and
 * its antiquark (the matching anticolour) as two sparks joined by a faint gluon thread: they
 * pop into existence, drift apart, rejoin and vanish. Pairs are spread evenly in log(radius)
 * down to ~10⁻³·⁴ units, with sizes proportional to their radius, so at every zoom some sit at
 * the view's own scale (self-similar detail). Below r ≈ 10⁻² they thin out deliberately —
 * fewer and fewer, then nothing — handing the dive over to the empty "desert".
 */
import * as THREE from 'three';
import type { Quality } from '../../engine/types';

const vert = /* glsl */ `
  attribute vec3 aCentre;
  attribute vec3 aAxis;
  attribute vec4 aP;     // phase, rate, scale, rank
  attribute vec2 aK;     // kind (1 = pair, 0 = shimmer mote), colour index
  uniform float uTime, uPx, uMaxPx, uFade, uMote;
  uniform vec3 uCol[3];
  varying vec3 vC; varying vec3 vAC;
  varying float vA; varying float vPair; varying vec2 vHalf; varying float vSize; varying float vDot;
  void main() {
    float life = fract(uTime * aP.y + aP.x);
    float r = length(aCentre);
    float lr = log(r) * 0.4342945;
    float sc = aP.z;
    float isPair = aK.x;
    // deliberate thinning: the fraction of emitters that survive falls with radius
    float keep = mix(smoothstep(-3.55, -1.9, lr), smoothstep(-2.9, -1.1, lr), isPair);
    float vis = smoothstep(aP.w - 0.04, aP.w, keep);

    float env; float sep = 0.0;
    vec3 c = aCentre;
    if (isPair < 0.5) {
      env = pow(max(sin(6.2831853 * life), 0.0), 16.0) * (0.6 + 0.4 * sin(uTime * 23.0 + aP.x * 50.0));
      c += aAxis * sc * 0.6 * sin(uTime * 0.7 + aP.x * 30.0);
    } else {
      // alive for the first 20 % of each cycle: pop in, drift apart, rejoin, annihilate
      float u = clamp(life / 0.2, 0.0, 1.0);
      sep = sin(3.14159265 * u);
      env = step(life, 0.2) * smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.85, u);
      c += cross(aAxis, normalize(aCentre + 1e-6)) * sc * 0.4 * sin(uTime * 1.3 + aP.x * 11.0);
    }
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    float dist = max(-mv.z, 1e-7);
    float dotPx = uPx * sc * mix(0.12, 0.18, isPair) / dist;    // radius of one spark, px
    // screen-space half separation of the pair
    vec3 axV = normalize((modelViewMatrix * vec4(aAxis, 0.0)).xyz);
    vec2 half_ = axV.xy * (uPx * sc * (0.15 + 1.4 * sep) / dist) * isPair;
    float size = 2.0 * (length(half_) + dotPx * 2.5) + 2.0;

    float a = env * vis * uFade * mix(uMote, 1.0, isPair);
    a *= smoothstep(uMaxPx * 1.3, uMaxPx * 0.7, size);     // too close to the lens: drop it
    a *= clamp(dotPx / 0.6, 0.0, 1.0);                      // sub-pixel: dim instead of shrinking
    gl_PointSize = min(size, uMaxPx);
    gl_Position = projectionMatrix * mv;

    int ci = int(aK.y + 0.5);
    vec3 cc = ci == 0 ? uCol[0] : (ci == 1 ? uCol[1] : uCol[2]);
    vec3 mc = ci == 0 ? vec3(1.0, 0.35, 0.8) : (ci == 1 ? vec3(0.65, 0.45, 1.0) : vec3(1.0, 0.7, 0.5));
    vC = mix(mc, cc, isPair);
    vAC = mix(vec3(0.85, 0.82, 1.0), vec3(1.0) - cc * 0.8, isPair);   // anticolour: anti-red = cyan …
    vA = a; vPair = isPair; vHalf = half_; vSize = min(size, uMaxPx); vDot = max(dotPx, 0.6);
  }`;

const frag = /* glsl */ `
  varying vec3 vC; varying vec3 vAC;
  varying float vA; varying float vPair; varying vec2 vHalf; varying float vSize; varying float vDot;
  float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0); return length(pa - ba * h); }
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * vSize; p.y = -p.y;
    float d1 = length(p - vHalf) / vDot;
    float d2 = length(p + vHalf) / vDot;
    float s1 = exp(-d1 * d1 * 1.6) * 1.6 + exp(-d1 * d1 * 0.3) * 0.12 * vPair;
    float s2 = exp(-d2 * d2 * 1.6) * 1.6 + exp(-d2 * d2 * 0.3) * 0.12;
    float link = exp(-pow(seg(p, vHalf, -vHalf) / vDot, 2.0) * 3.0) * 0.1 * vPair;
    vec3 col = vC * s1 + vAC * s2 * vPair + vec3(1.0, 0.85, 0.95) * link;
    col += vec3(1.0) * (exp(-d1 * d1 * 6.0) + exp(-d2 * d2 * 6.0) * vPair) * 0.5;
    float g = vA * 0.2;
    gl_FragColor = vec4(col * g, (s1 + s2 * vPair) * g * 0.15);
  }`;

export function createSea(q: Quality, maxPointPx: number) {
  const uniforms = {
    uTime: { value: 0 },
    uPx: { value: 800 },
    uMaxPx: { value: Math.min(maxPointPx, 128) },
    uFade: { value: 1 },
    uMote: { value: 1 },
    uCol: { value: [new THREE.Vector3(1, 0.16, 0.1), new THREE.Vector3(0.18, 1, 0.3), new THREE.Vector3(0.2, 0.4, 1)] },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  let points: THREE.Points | null = null;
  const group = new THREE.Group();

  const build = (qq: Quality) => {
    if (points) { group.remove(points); points.geometry.dispose(); }
    const nPairs = qq === 'low' ? 1200 : qq === 'medium' ? 1800 : 2400;
    const nMotes = qq === 'low' ? 1500 : qq === 'medium' ? 3000 : 5000;
    const n = nPairs + nMotes;
    const centre = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const prm = new Float32Array(n * 4);
    const kk = new Float32Array(n * 2);
    const c = new THREE.Vector3(); const a = new THREE.Vector3();
    const dir = (out: THREE.Vector3) => {
      const u = Math.random() * 2 - 1; const t = Math.random() * Math.PI * 2; const k = Math.sqrt(1 - u * u);
      return out.set(k * Math.cos(t), u, k * Math.sin(t));
    };
    let o = 0;
    const put = (phase: number, rate: number, scale: number, rank: number, kind: number, ci: number) => {
      centre[o * 3] = c.x; centre[o * 3 + 1] = c.y; centre[o * 3 + 2] = c.z;
      axis[o * 3] = a.x; axis[o * 3 + 1] = a.y; axis[o * 3 + 2] = a.z;
      prm[o * 4] = phase; prm[o * 4 + 1] = rate; prm[o * 4 + 2] = scale; prm[o * 4 + 3] = rank;
      kk[o * 2] = kind; kk[o * 2 + 1] = ci;
      o++;
    };
    for (let i = 0; i < nPairs; i++) {
      // 80 %: log-uniform in radius (self-similar detail), 20 %: filling the proton's bulk
      const r = Math.random() < 0.8
        ? 10 ** (-3.4 + Math.random() * 3.0)
        : 0.42 * Math.cbrt(Math.random()) * (0.6 + 0.4 * Math.random());
      dir(c).multiplyScalar(r);
      dir(a);
      const scale = Math.max(r, 3e-4) * (0.05 + Math.random() * 0.05);
      const rate = (0.25 + Math.random() * 0.6) * (r < 0.05 ? 1.6 : 1);
      put(Math.random(), rate, scale, Math.random(), 1, Math.floor(Math.random() * 3));
    }
    for (let i = 0; i < nMotes; i++) {
      const r = Math.random() < 0.85 ? 10 ** (-3.7 + Math.random() * 3.3) : 0.45 * Math.cbrt(Math.random());
      dir(c).multiplyScalar(r);
      dir(a);
      put(Math.random(), 0.4 + Math.random() * 1.2, Math.max(r, 2e-4) * (0.03 + Math.random() * 0.03), Math.random(), 0, Math.floor(Math.random() * 3));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aCentre', new THREE.BufferAttribute(centre, 3));
    g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3));
    g.setAttribute('aP', new THREE.BufferAttribute(prm, 4));
    g.setAttribute('aK', new THREE.BufferAttribute(kk, 2));
    points = new THREE.Points(g, mat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    group.add(points);
  };
  build(q);

  return {
    group, uniforms,
    setQuality: build,
    dispose() { if (points) points.geometry.dispose(); mat.dispose(); },
  };
}
