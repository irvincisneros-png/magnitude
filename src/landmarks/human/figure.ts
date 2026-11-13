/**
 * The person: four meshes (body, head, right hand + forearm, left hand + forearm) generated from
 * the SDF in a worker, shaded with physically motivated skin, cloth and hair, lit by the low
 * morning Sun with soft capsule shadows, baked ambient occlusion and translucency. Subtle breathing
 * and cloth/hair flutter in the sea breeze.
 */
import * as THREE from 'three';
import { BUMP, COMMON, type Shared } from './glsl';
import { SKIN } from './skinGlsl';
import { acquireSkinTextures, releaseSkinTextures } from './skinTex';
import { buildFigure, HAND_H, type FigureOut, type MeshOut } from './figureSdf';

const vert = /* glsl */ `
${COMMON}
attribute vec4 aAttr; attribute float aMat;
uniform float uBreath;
varying vec3 vP; varying vec3 vN; varying vec4 vAttr; varying float vMat;
LOGZ_VARY
void main() {
  vec3 p = position;
  vec3 n = normal;
  // breathing (~14 breaths a minute) and cloth / hair moving in the onshore breeze
  p += n * aAttr.z * 0.0035 * uBreath;
  float fl = aAttr.w;
  if (fl > 0.0) {
    float t = uTime;
    float g = vnoise3(p * 6.0 + vec3(t * 1.3, 0.0, t * 0.4)) - 0.5;
    float r = vnoise3(p * 23.0 + vec3(t * 3.1, t * 0.7, 0.0)) - 0.5;
    p += (n * 0.65 + vec3(-0.35, 0.0, 0.1)) * fl * (g * 0.006 + r * 0.0018) * (0.6 + 0.4 * uWind);
  }
  vP = p; vN = n; vAttr = aAttr; vMat = aMat;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const frag = /* glsl */ `
${COMMON}
${BUMP}
${SKIN}
uniform float uPatchR;
uniform mat3 uHeadInv; uniform vec3 uPivot; uniform vec3 uH;
varying vec3 vP; varying vec3 vN; varying vec4 vAttr; varying float vMat;
LOGZ_VARY

float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

vec3 clothShade(vec3 alb, vec3 n, vec3 v, float sh, float ao, float sheen, float rough) {
  vec3 L = uSun;
  float ndl = dot(n, L);
  float diff = clamp((ndl + 0.15) / 1.15, 0.0, 1.0);
  vec3 col = alb * uSunCol * diff * sh + alb * skyIrr(n) * ao * 1.3;
  vec3 h = normalize(L + v);
  float nv = max(dot(n, v), 0.02);
  // Charlie-style sheen: soft glow at grazing angles, typical of cloth fibres
  float sinH = sqrt(max(1.0 - pow(max(dot(n, h), 1e-6), 2.0), 0.0));
  float sh2 = (2.0 + 1.0 / sheen) * pow(max(sinH, 1e-6), 1.0 / sheen) / (2.0 * PI);
  col += uSunCol * alb * 0.35 * sh2 * max(ndl, 0.0) * sh / (4.0 * nv + 0.6) * 2.5;
  col += uSunCol * 0.04 * ggx(n, h, rough) * max(ndl, 0.0) * sh;
  col += skyCol(reflect(-v, n)) * pow(max(1.0 - nv, 1e-6), 3.0) * 0.08 * ao;
  return col;
}

/** Cloth albedo (rgb) and bump height (a) for material m. */
vec4 clothAlb(int m, vec3 p, vec3 nw, float fp) {
  vec3 q = uFigInv * p + uH;
  vec3 n = uFigInv * nw;
  float wv = 1.0 - smoothstep(1.2e-4, 5e-4, fp);
  if (m == 3) {
    // linen-cotton shirt, soft chambray blue, slubby weave, soft drape folds, a placket down the front
    vec2 uvw = abs(n.y) > 0.7 ? q.xz : abs(n.x) > abs(n.z) ? q.zy : q.xy;
    float drape = fbmAA(vec2((q.x + q.z) * 26.0, q.y * 6.0), fp * 26.0, 3);
    float crease = fbmAA(vec2((q.x - q.z) * 60.0 + q.y * 20.0, q.y * 14.0), fp * 60.0, 2);
    float weave = (sin(uvw.x * 7000.0) * sin(uvw.y * 7000.0)) * 0.5 + 0.5;
    float slub = vnoise(vec2(uvw.x * 900.0, uvw.y * 60.0));
    float wr = fbmAA(uvw * 40.0, fp * 40.0, 3);
    vec3 alb = vec3(0.105, 0.15, 0.2) * (0.9 + 0.2 * wr) * (0.92 + 0.16 * slub * wv);
    float pk = (q.z + 0.012 - 0.02 * (q.y - 1.2)) / 0.005;
    float plk = exp(-pk * pk) * smoothstep(0.05, 0.1, q.x) * step(q.y, 1.42) * step(0.86, q.y);
    alb *= (1.0 - plk * 0.15) * (0.9 + 0.2 * drape);
    return vec4(alb, (weave * 1.2e-4 + slub * 1.5e-4) * wv + drape * 2.2e-3 + crease * 6e-4);
  }
  if (m == 4) {
    float tw = sin((q.x + q.y + q.z) * 9000.0) * 0.5 + 0.5;
    // chinos: vertical drape, bunching above the shoes and behind the knees
    float drape = fbmAA(vec2((q.x + q.z) * 30.0, q.y * 4.0), fp * 30.0, 3);
    float bunch = (sin(q.y * 75.0 + vnoise(q.xz * 40.0) * 5.0) * 0.5 + 0.5) * (smoothstep(0.32, 0.14, q.y) + 0.6 * exp(-pow(abs(q.y - 0.5) / 0.05, 2.0)));
    vec3 alb = vec3(0.034, 0.04, 0.062) * (0.9 + 0.2 * fbmAA(q.xy * 30.0 + q.z * 20.0, fp * 30.0, 3)) * (0.9 + 0.2 * drape);
    return vec4(alb, tw * 1e-4 * wv + drape * 2e-3 + bunch * 1.2e-3);
  }
  if (m == 5) {
    vec3 alb = vec3(0.13, 0.075, 0.042) * (0.85 + 0.3 * fbmAA(q.xz * 120.0 + q.y * 70.0, fp * 120.0, 3));
    return vec4(alb, 0.0);
  }
  return vec4(0.56, 0.53, 0.47, 0.0);
}

/** Woven straw sun hat with a dark cotton band. */
vec3 hatShade(vec3 p, vec3 n, vec3 v, float sh, float ao, float fp) {
  vec3 b = uFigInv * p + uH;
  vec3 q = uHeadInv * (b - uPivot) + uPivot;
  vec2 c = vec2(q.x + 0.014, q.z);
  float rr = length(c), ang = atan(c.y, c.x);
  float wv = 1.0 - smoothstep(1.5e-4, 7e-4, fp);
  // plaited straw: concentric rows on the brim and crown, criss-cross fibres
  float row = rr < 0.11 ? (q.y * 900.0 + rr * 300.0) : rr * 520.0;
  float weave = sin(row * 3.0) * sin(ang * 260.0 + row) * 0.5 + 0.5;
  float fib = vnoise(vec2(ang * 900.0, row * 4.0));
  vec3 alb = vec3(0.40, 0.31, 0.18) * (0.82 + 0.25 * mix(0.5, weave, wv) + 0.12 * (fib - 0.5) * wv);
  alb *= 0.9 + 0.2 * fbmAA(vec2(ang * 3.0, rr * 30.0), fp * 30.0, 2);
  float band = smoothstep(1.629, 1.632, q.y) * (1.0 - smoothstep(1.646, 1.649, q.y)) * (1.0 - smoothstep(0.105, 0.115, rr));
  alb = mix(alb, vec3(0.045, 0.04, 0.036), band);
  vec3 nb = bumpN(n, p, (weave * 3e-4 + fib * 1e-4) * wv * (1.0 - band));
  return clothShade(alb, nb, v, sh, ao, 0.35, 0.55);
}

vec3 hairShade(vec3 p, vec3 n, vec3 v, float sh, float ao, float fp) {
    // hair: strands combed back and down from the crown; Kajiya-Kay highlights
    vec3 q = uFigInv * p + uH;
    vec3 crown = uPivot + vec3(-0.03, 0.26, 0.0);
    vec3 flow = normalize(q - crown + vec3(0.0, -0.05, 0.0));
    vec3 T = normalize(flow - n * dot(flow, n));
    vec3 B = cross(n, T);
    float across = dot(q, B);
    float strand = vnoise(vec2(across * 2600.0, dot(q, T) * 90.0)) * 0.7 + vnoise(vec2(across * 400.0, dot(q, T) * 20.0)) * 0.3;
    float sw = 1.0 - smoothstep(1e-4, 5e-4, fp);
    vec3 alb = vec3(0.032, 0.02, 0.013) * mix(1.0, 0.55 + 0.9 * strand, sw);
    vec3 L = uSun;
    float ndl = dot(n, L);
    vec3 h = normalize(L + v);
    vec3 T2 = normalize(T + n * 0.12);
    float th = dot(T, h), th2 = dot(T2, h);
    float s1 = pow(sqrt(max(1.0 - th * th, 1e-12)), 90.0);
    float s2 = pow(sqrt(max(1.0 - th2 * th2, 1e-12)), 22.0);
    vec3 col = alb * uSunCol * clamp(ndl * 0.7 + 0.3, 0.0, 1.0) * sh + alb * skyIrr(n) * ao * 1.2;
    col += uSunCol * (s1 * 0.06 + s2 * vec3(0.35, 0.2, 0.1) * 0.12) * smoothstep(-0.1, 0.3, ndl) * sh * (0.6 + 0.4 * strand);
    col += uSunCol * vec3(0.5, 0.25, 0.1) * pow(max(dot(v, -L), 1e-6), 4.0) * 0.12; // rim through the hair
    return col;
}

void main() {
  vec3 p = vP;
  int m = int(vMat + 0.5);
  #ifdef HEAD
  // head mesh ids: 0 skin, 1 hair, 2 hat
  float wHat = smoothstep(1.3, 1.7, vMat);
  float wHair = smoothstep(0.3, 0.7, vMat) * (1.0 - wHat);
  m = 0;
  #endif
  #ifdef HAND_R
  if (uPatchR > 0.0) {
    float r = length(p) / uPatchR;
    if (r < 0.68) discard;
  }
  #endif
  vec3 v = normalize(uCamM - p);
  vec3 n = normalize(vN);
  float ao = vAttr.x;
  float fp = max(length(dFdx(p)), length(dFdy(p)));
  float sh = figureShadow(p + n * 0.004);
  vec3 col;
  if (!gl_FrontFacing) {
    // the camera is inside the hand: daylight glowing red through flesh
    float g = vnoise3(p * 900.0) * 0.5 + vnoise3(p * 210.0) * 0.5;
    col = vec3(0.30, 0.025, 0.012) * uSunCol * (0.14 + 0.1 * g);
    gl_FragColor = vec4(col, 1.0);
    LOGZ_FRAG
    return;
  }
  if (m == 0) {
    #ifdef HAND_R
    vec3 hp = uFigInv * p; // hand frame (x along the fingers)
    SkinS s = skin(hp.xz, fp);
    float top = smoothstep(0.15, 0.6, n.y);
    n = normalize(n - uFigRot * vec3(s.g.x, 0.0, s.g.y) * top);
    vec3 alb = skinAlbedo(hp.xz, s, fp * (2.0 - top));
    // knuckle and joint creases
    float crease = 0.0;
    float kx = hp.x - 0.044;
    crease = (1.0 - smoothstep(0.0, 0.0011, abs(sin(kx * 1400.0 + vnoise(hp.xz * 900.0) * 2.0)))) * smoothstep(0.0, 0.01, kx) * (1.0 - smoothstep(0.012, 0.03, kx)) * top;
    alb *= 1.0 - crease * 0.25 * (1.0 - smoothstep(1e-4, 4e-4, fp));
    col = skinShade(alb, n, v, sh, ao, vAttr.y, s.cav * top, 1.0);
    #else
    float mel = fbmAA(p.xz * 160.0 + p.y * 90.0, fp * 160.0, 3);
    vec3 alb = vec3(0.36, 0.235, 0.175) * mix(0.9, 1.06, mel);
    float hb = (vnoise3(p * 1800.0) - 0.5) * 2e-5 * (1.0 - smoothstep(1e-4, 5e-4, fp));
    n = bumpN(n, p, hb);
    #ifdef HEAD
    col = wHat + wHair < 0.99 ? skinShade(alb, n, v, sh, ao, vAttr.y * 0.4, 0.0, 0.6) : vec3(0.0);
    if (wHair > 0.01) col = mix(col, hairShade(p, normalize(vN), v, sh, ao, fp), wHair);
    if (wHat > 0.01) col = mix(col, hatShade(p, normalize(vN), v, sh, ao, fp), wHat);
    #else
    col = skinShade(alb, n, v, sh, ao, vAttr.y, 0.0, 0.7);
    #endif
    #endif
  } else if (m == 1) {
    vec3 alb = vec3(0.44, 0.27, 0.21);
    col = skinShade(alb, n, v, sh, ao, 0.3, 0.0, 1.3);
  } else {
    // cloth: blend neighbouring materials smoothly (ids 3 shirt, 4 trousers, 5 shoe, 6 sole)
    float mf = clamp(vMat, 3.0, 6.0);
    int m0 = int(floor(mf));
    float w = smoothstep(0.2, 0.8, mf - float(m0));
    vec4 a = clothAlb(m0, p, n, fp);
    if (w > 0.001) a = mix(a, clothAlb(min(m0 + 1, 6), p, n, fp), w);
    n = bumpN(n, p, a.w);
    col = clothShade(a.rgb, n, v, sh, ao, 0.45, 0.6);
  }
  col = aerial(col, p);
  gl_FragColor = vec4(col, 1.0);
  LOGZ_FRAG
}`;

/** Cached result: the SDF is deterministic, so it is built once per page load. */
let cache: Promise<FigureOut> | null = null;
function generate(): Promise<FigureOut> {
  if (cache) return cache;
  cache = new Promise<FigureOut>((resolve) => {
    let worker: Worker | null = null;
    const fallback = () => { worker?.terminate(); resolve(buildFigure()); };
    try {
      worker = new Worker(new URL('./figure.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<FigureOut>) => { worker?.terminate(); resolve(e.data); };
      worker.onerror = (e) => { console.warn('[human] figure worker failed, building on the main thread', e.message); fallback(); };
      worker.postMessage(0);
    } catch { fallback(); }
  });
  return cache;
}

export class Figure {
  readonly group = new THREE.Group();
  data: FigureOut | null = null;
  private mats: THREE.ShaderMaterial[] = [];
  private geos: THREE.BufferGeometry[] = [];
  readonly handMat: THREE.ShaderMaterial;
  private uBreath = { value: 0 };
  private tex = acquireSkinTextures();

  constructor(private shared: Shared) {
    const headInv = new THREE.Matrix3();
    // inverse head rotation (yaw 0.2 about Y, pitch −0.035 about Z), matching figureSdf
    const yaw = 0.2, pitch = 0.1;
    const rot = new THREE.Matrix4().makeRotationY(-yaw).multiply(new THREE.Matrix4().makeRotationZ(-pitch));
    headInv.setFromMatrix4(rot).invert();
    const mk = (defines: Record<string, string>, side: THREE.Side) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, defines, side,
        uniforms: {
          ...shared, uBreath: this.uBreath, uPatchR: { value: 0 },
          uHeadInv: { value: headInv }, uPivot: { value: new THREE.Vector3(-0.012, 1.47, 0) },
          uH: { value: new THREE.Vector3(...HAND_H) },
          tCells: { value: this.tex.cells }, tPlat: { value: this.tex.plat },
        },
      });
      this.mats.push(m);
      return m;
    };
    this.handMat = mk({ HAND_R: '' }, THREE.DoubleSide);
    this.bodyMat = mk({}, THREE.FrontSide);
    this.headMat = mk({ HEAD: '' }, THREE.FrontSide);
  }
  private bodyMat: THREE.ShaderMaterial;
  private headMat: THREE.ShaderMaterial;

  async build(): Promise<FigureOut> {
    const d = await generate();
    this.data = d;
    const add = (m: MeshOut, mat: THREE.ShaderMaterial, order: number) => {
      const g = new THREE.BufferGeometry();
      // copies: the cached arrays are shared between landmark instances
      g.setAttribute('position', new THREE.BufferAttribute(m.pos.slice(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.nrm.slice(), 3));
      g.setAttribute('aAttr', new THREE.BufferAttribute(m.attr.slice(), 4));
      g.setAttribute('aMat', new THREE.BufferAttribute(m.mat.slice(), 1));
      g.setIndex(new THREE.BufferAttribute(m.index.slice(), 1));
      g.computeBoundingSphere();
      this.geos.push(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    };
    add(d.meshes.handR, this.handMat, 3);
    add(d.meshes.handL, this.bodyMat, 3);
    add(d.meshes.head, this.headMat, 3);
    add(d.meshes.body, this.bodyMat, 3);
    const caps = this.shared.uCaps.value;
    for (let i = 0; i < 16; i++) {
      const c = d.capsules;
      caps[i * 2].set(c[i * 8], c[i * 8 + 1], c[i * 8 + 2], c[i * 8 + 3]);
      caps[i * 2 + 1].set(c[i * 8 + 4], c[i * 8 + 5], c[i * 8 + 6], c[i * 8 + 7]);
    }
    return d;
  }

  setTier(_q: string) { /* skin relief is texture-based on every tier */ }

  setLogDepth(on: boolean) {
    for (const m of this.mats) {
      if (on === !('NO_LOGZ' in m.defines)) continue;
      if (on) delete m.defines.NO_LOGZ; else m.defines.NO_LOGZ = '';
      m.needsUpdate = true;
    }
  }

  update(time: number, patchR: number) {
    this.uBreath.value = Math.sin((time * 2 * Math.PI) / 4.4) * 0.5 + 0.5;
    this.handMat.uniforms.uPatchR.value = patchR;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    releaseSkinTextures();
  }
}
