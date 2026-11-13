/**
 * Sky (a full-screen pass behind everything: morning sky, the Sun's disc and glow, a high layer of
 * thin cloud), cloud wisps over the coast that show when looking down from a few kilometres up,
 * and the hand-over fader that dissolves this whole layer (from the edges in) so the Earth scene,
 * which looks at the same coast, takes over.
 */
import * as THREE from 'three';
import { COMMON, SITE, type Shared } from './glsl';
import { FEET_H } from './pose';
import type { SiteTextures } from './siteTex';

const quadVert = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const skyFrag = /* glsl */ `
${COMMON}
${SITE}
uniform mat4 uInvProj; uniform mat4 uCamRot; uniform float uBackdrop; uniform vec3 uFeetW;
varying vec2 vNdc;
void main() {
  vec4 vp = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamRot * vec4(normalize(vp.xyz / vp.w), 0.0)).xyz);
  vec3 col = skyCol(dir);
  float mu = dot(dir, uSun);
  // the Sun: limb-darkened disc (0.27° radius) and a bright aureole
  float ang = acos(clamp(mu, -1.0, 1.0));
  float disc = 1.0 - smoothstep(0.0042, 0.0049, ang);
  float la = ang / 0.0047;
  float limb = sqrt(max(1.0 - la * la, 0.0));
  col += vec3(1.0, 0.85, 0.65) * disc * (30.0 + 25.0 * limb);
  col += vec3(1.0, 0.8, 0.55) * exp(-ang * 60.0) * 0.6;
  // high, thin cloud (cirrus) at ~6 km, only while we are well below it
  float camAlt = uCamM.y - SEA_Y;
  float layer = 6000.0;
  if (dir.y > 0.0 && camAlt < layer) {
    float t = (layer - camAlt) / dir.y;
    vec2 q = (uCamM.xz + dir.xz * t) / 2600.0 + vec2(uTime * 0.0012, 0.0);
    vec2 wq = q + vec2(fbm2(q * 1.7, 3), fbm2(q * 1.7 + 4.0, 3)) * 0.6;
    float c = fbm2(vec2(wq.x * 1.0, wq.y * 3.5), 5);
    c = smoothstep(0.5, 0.8, c) * 0.55;
    c *= smoothstep(0.02, 0.18, dir.y) * (1.0 - smoothstep(0.4, 0.9, camAlt / layer));
    vec3 cc = vec3(1.0, 0.93, 0.85) * (uSunCol * 0.32 * (0.6 + 0.8 * pow(max(mu, 1e-6), 6.0))) + skyCol(vec3(0, 1, 0)) * 0.6;
    col = mix(col, cc, c);
  }
  // close-up backdrop: the dune, the beach and the surf, as a defocused macro background (the real
  // terrain, grass and sea are switched off at skin scale, where they would be out of focus anyway)
  if (uBackdrop > 0.0 && dir.y < 0.0) {
    // find where the view ray meets the ground, using the real height map (three refinements)
    vec3 hit = uCamM + dir * ((GROUND_Y - uCamM.y) / dir.y);
    vec2 hd = vec2(0.0);
    for (int i = 0; i < 3; i++) {
      hd = siteHD(hit.xz - MAP_O);
      float yy = SEA_Y + max(hd.x, 0.0);
      hit = uCamM + dir * ((yy - uCamM.y) / dir.y);
    }
    float hgt = hd.x;
    vec2 q = hit.xz - MAP_O;
    vec4 cA; vec3 cB; siteCover(q, cA, cB);
    float nz = fbm2(q * 0.06, 3);
    vec3 grassC = mix(vec3(0.06, 0.085, 0.03), vec3(0.15, 0.13, 0.06), smoothstep(0.5, 0.75, nz) * 0.6);
    grassC = mix(grassC, vec3(0.035, 0.05, 0.022), cA.g);
    vec3 sandC = mix(vec3(0.47, 0.39, 0.26), vec3(0.24, 0.2, 0.15), smoothstep(0.9, 0.3, hgt));
    vec3 lit = uSunCol * uSun.y + skyIrr(vec3(0, 1, 0)) * 1.2;
    float sand = max(cA.r, smoothstep(1.7, 0.9, hgt));
    vec3 land = mix(grassC, sandC, sand);
    land = mix(land, vec3(0.08, 0.07, 0.06), cA.a);
    land = mix(land, vec3(0.06), cB.r);
    land *= lit;
    float F = 0.02 + 0.98 * pow(max(1.0 + dir.y, 1e-6), 5.0);
    vec3 w = mix(vec3(0.02, 0.1, 0.1), vec3(0.008, 0.045, 0.06), smoothstep(0.0, 8.0, -hgt)) * (uSunCol * uSun.y * 0.6 + skyIrr(vec3(0, 1, 0))) * (1.0 - F) + skyCol(reflect(dir, vec3(0, 1, 0))) * F;
    float foam = smoothstep(-2.6, -0.4, hgt) * (1.0 - smoothstep(-0.1, 0.1, hgt)) * (0.5 + 0.5 * sin(hd.y * 0.1 + uTime * 0.6));
    w = mix(w, vec3(0.8) * lit * 0.8, foam * 0.6);
    vec3 ground = mix(w, land, smoothstep(-0.05, 0.1, hgt));
    col = mix(col, aerial(ground, hit), uBackdrop * smoothstep(0.0, -0.01, dir.y));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const faderFrag = /* glsl */ `
uniform float uKeep; uniform float uAspect;
varying vec2 vNdc;
void main() {
  float r = length(vNdc * vec2(uAspect, 1.0)) * 0.6;
  float k = smoothstep(0.0, 1.0, uKeep * 1.7 - r * 0.7);
  gl_FragColor = vec4(0.0, 0.0, 0.0, k);
}`;

const wispVert = /* glsl */ `
${COMMON}
attribute vec4 aW; // centre x, z, altitude, size
attribute float aSeed;
varying vec2 vUv; varying vec3 vP; varying float vSeed;
LOGZ_VARY
void main() {
  vUv = position.xy;
  vec3 p = vec3(aW.x + position.x * aW.w * 1.6, SEA_Y + aW.z, aW.y + position.y * aW.w);
  vP = p; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  LOGZ_VERT(mv)
}`;

const wispFrag = /* glsl */ `
${COMMON}
uniform float uOpacity;
varying vec2 vUv; varying vec3 vP; varying float vSeed;
LOGZ_VARY
void main() {
  vec2 q = vUv * 2.2 + vSeed * 17.0 + vec2(uTime * 0.004, 0.0);
  vec2 w = vec2(fbm2(q * 1.3, 3), fbm2(q * 1.3 + 7.0, 3));
  float d = fbm2(q + w * 1.2, 5);
  float edge = 1.0 - smoothstep(0.35, 1.0, length(vUv));
  float a = smoothstep(0.42, 0.75, d) * edge * uOpacity;
  if (a < 0.004) discard;
  vec3 c = vec3(1.0, 0.95, 0.88) * (uSunCol * 0.42 * (0.7 + 0.5 * d)) + skyIrr(vec3(0, 1, 0)) * 1.1;
  c = aerial(c, vP);
  gl_FragColor = vec4(c, a * 0.85);
  LOGZ_FRAG
}`;

export class Sky {
  readonly group = new THREE.Group();
  private quad = new THREE.BufferGeometry();
  private skyMat: THREE.ShaderMaterial;
  private faderMat: THREE.ShaderMaterial;
  private wispMat: THREE.ShaderMaterial;
  private wispGeo: THREE.InstancedBufferGeometry;
  private wisps: THREE.Mesh;
  private fader: THREE.Mesh;

  constructor(shared: Shared) {
    this.quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.skyMat = new THREE.ShaderMaterial({
      // drawn after the opaque scene with a depth test at the far plane, so it only shades
      // pixels nothing else covers
      vertexShader: quadVert, fragmentShader: skyFrag, depthTest: true, depthWrite: false,
      uniforms: { ...shared, uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() }, uBackdrop: { value: 0 }, tFine: { value: null }, tCoarse: { value: null }, tCov: { value: null }, tCov2: { value: null }, tCovM: { value: null }, tCov2M: { value: null }, uFeetW: { value: new THREE.Vector3(FEET_H[0], FEET_H[1], FEET_H[2]) } },
    });
    const sky = new THREE.Mesh(this.quad, this.skyMat);
    sky.frustumCulled = false; sky.renderOrder = 50;
    this.faderMat = new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: faderFrag, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.SrcAlphaFactor,
      uniforms: { uKeep: { value: 1 }, uAspect: { value: 1 } },
    });
    this.fader = new THREE.Mesh(this.quad, this.faderMat);
    this.fader.frustumCulled = false; this.fader.renderOrder = 1000;

    // cloud wisps: fair-weather cumulus drifting along the escarpment and over the sea
    this.wispMat = new THREE.ShaderMaterial({
      vertexShader: wispVert, fragmentShader: wispFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, uOpacity: { value: 0 } },
    });
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const N = 14;
    const Wd = new Float32Array(N * 4), S = new Float32Array(N);
    let seed = 77;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < N; i++) {
      const x = FEET_H[0] + (rnd() - 0.45) * 9000, z = FEET_H[2] + (rnd() - 0.5) * 9000;
      // keep the headland itself clear for a moment longer
      const far = Math.hypot(x, z) < 900 ? 900 : 0;
      Wd.set([x + far, z, 1100 + rnd() * 900, 500 + rnd() * 900], i * 4);
      S[i] = rnd();
    }
    g.setAttribute('aW', new THREE.InstancedBufferAttribute(Wd, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(S, 1));
    g.instanceCount = N;
    this.wispGeo = g;
    this.wisps = new THREE.Mesh(g, this.wispMat);
    this.wisps.frustumCulled = false; this.wisps.renderOrder = 8;
    this.group.add(sky, this.wisps, this.fader);
  }

  /** Hand the site textures to the close-up backdrop. */
  setSite(t: SiteTextures) { for (const [k, u] of Object.entries(t.uniforms)) if (this.skyMat.uniforms[k]) this.skyMat.uniforms[k].value = u.value; }

  update(cam: THREE.PerspectiveCamera, zoom: number, backdrop: number) {
    this.skyMat.uniforms.uBackdrop.value = backdrop;
    this.skyMat.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    this.skyMat.uniforms.uCamRot.value.extractRotation(cam.matrixWorld);
    const op = THREE.MathUtils.smoothstep(zoom, 1.9, 2.5) * (1 - THREE.MathUtils.smoothstep(zoom, 3.05, 3.35));
    this.wispMat.uniforms.uOpacity.value = op;
    this.wisps.visible = op > 0.002;
    // dissolve this layer from the edges in so the Earth scene (same coast) shows through
    const keep = 1 - THREE.MathUtils.smoothstep(zoom, 3.0, 3.42);
    this.faderMat.uniforms.uKeep.value = keep;
    this.faderMat.uniforms.uAspect.value = cam.aspect;
    this.fader.visible = keep < 0.999;
  }

  dispose() {
    this.quad.dispose(); this.wispGeo.dispose();
    this.skyMat.dispose(); this.faderMat.dispose(); this.wispMat.dispose();
  }
}
