/**
 * Full-screen volume pass drawn first: integrates a soft density through the cell and the
 * nucleus analytically along each view ray, giving the translucent glowing body, the
 * cytosol/nucleoplasm haze when the camera is inside, and the dark tissue backdrop outside
 * (which fades away at the zoom-out end so the human layer shows through).
 */
import * as THREE from 'three';
import { COMMON } from './glsl';
import { CELL_C, CELL_R, NUC_C, NUC_R, PAL, type Shared } from './layout';
import { Bin } from './util';

const vert = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const frag = /* glsl */ `
${COMMON}
uniform mat4 uInvProj; uniform mat4 uCamWorld;
uniform vec3 uCellC; uniform vec3 uCellR; uniform vec3 uNucC; uniform vec3 uNucR;
uniform vec3 uCyto; uniform vec3 uNuc; uniform vec3 uOut;
uniform float uOutA; uniform float uCellGain; uniform float uNucGain;
varying vec2 vNdc;

// Integral of (1 - r^2) along the ray through an ellipsoid (r = normalised radius), t >= 0.
// Written around the closest-approach point so it stays precise when the camera is far away.
vec2 ellInt(vec3 ro, vec3 rd, vec3 c, vec3 r) {
  vec3 o = (ro - c) / r; vec3 d = rd / r;
  float a = dot(d, d); float b = dot(o, d);
  float tm = -b / a;
  float k = dot(o, o) - b * b / a;          // squared normalised radius at closest approach
  if (k >= 1.0) return vec2(0.0, 1e9);
  float h = sqrt((1.0 - k) / a);
  float u0 = max(-h, -tm), u1 = h;          // clip to in front of the camera
  if (u1 <= u0) return vec2(0.0, 1e9);
  float F1 = (1.0 - k) * u1 - a * u1 * u1 * u1 / 3.0;
  float F0 = (1.0 - k) * u0 - a * u0 * u0 * u0 / 3.0;
  return vec2(F1 - F0, tm + u0);
}

void main() {
  vec4 hv = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (hv.xyz / hv.w));
  vec3 ro = cameraPosition;

  vec2 ci = ellInt(ro, rd, uCellC, uCellR);
  vec2 ni = ellInt(ro, rd, uNucC, uNucR);
  float Ic = ci.x / 0.62;   // ≈ 1 through the middle of the cell
  float In = ni.x / 0.20;   // ≈ 1 through the middle of the nucleus

  // Mottling sampled at the densest part of the ray (cheap, 2 octaves).
  vec3 pc = ro + rd * (ci.y + 0.25);
  float mc = fbm2o(pc * 9.0 + vec3(0.0, uTime * 0.02, 0.0));
  vec3 pn = ro + rd * (ni.y + 0.05);
  float mn = fbm2o(pn * 30.0 - vec3(uTime * 0.015));

  // Outside: deep tissue backdrop with a soft gradient (light from above).
  vec3 col = uOut * (0.7 + 0.6 * clamp(rd.y * 0.5 + 0.5, 0.0, 1.0)) * uOutA;
  float alpha = uOutA;

  float ac = 1.0 - exp(-Ic * 1.6);
  vec3 cyto = uCyto * uCellGain * (0.65 + 0.7 * mc) * (0.7 + 0.6 * ac);
  col = col * (1.0 - ac * 0.75) + cyto * ac;
  alpha = 1.0 - (1.0 - alpha) * (1.0 - ac);

  float an = 1.0 - exp(-In * 1.8);
  vec3 nuc = uNuc * uNucGain * (0.55 + 0.9 * mn);
  col = col * (1.0 - an * 0.6) + nuc * an;
  alpha = 1.0 - (1.0 - alpha) * (1.0 - an);

  gl_FragColor = vec4(col, alpha);
}`;

export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private bin = new Bin();

  constructor(shared: Shared) {
    const geo = this.bin.add(new THREE.PlaneGeometry(2, 2));
    this.mat = this.bin.add(new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        ...shared,
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCellC: { value: CELL_C.clone() },
        uCellR: { value: CELL_R.clone().multiplyScalar(1.0) },
        uNucC: { value: NUC_C.clone() },
        uNucR: { value: NUC_R.clone() },
        uCyto: { value: PAL.cytosol.clone() },
        uNuc: { value: PAL.nucleoplasm.clone() },
        uOut: { value: PAL.outside.clone() },
        uOutA: { value: 1 },
        uCellGain: { value: 1 },
        uNucGain: { value: 1 },
      },
      // Opaque pass with NoBlending: drawn first (renderOrder), writes colour + coverage alpha.
      depthTest: false,
      depthWrite: false,
      transparent: false,
    }));
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  update(cam: THREE.PerspectiveCamera, outA: number) {
    const u = this.mat.uniforms;
    u.uInvProj.value = cam.projectionMatrixInverse;
    u.uCamWorld.value = cam.matrixWorld;
    u.uOutA.value = outA;
  }

  dispose() { this.bin.dispose(); }
}
