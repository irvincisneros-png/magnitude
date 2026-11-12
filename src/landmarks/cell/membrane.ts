/**
 * Translucent membrane shells (plasma membrane, nuclear envelope): fresnel sheen with a faint
 * thin-film shimmer, lipid/protein micro-texture as a bump map, slow surface undulation, and a
 * near-camera dissolve so the camera can pass through them.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COMMON, FRAG } from './glsl';
import type { Shared } from './layout';

const vert = /* glsl */ `
${COMMON}
uniform float uUnd; uniform float uUndF;
varying vec3 vW; varying vec3 vN; varying vec3 vObj;
void main() {
  vec3 p = position;
  float w = vnoise(p * uUndF + vec3(0.0, uTime * 0.05, 0.0)) - 0.5;
  w += 0.5 * (vnoise(p * uUndF * 2.3 - vec3(uTime * 0.04)) - 0.5);
  p += normal * w * uUnd;
  vObj = p;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
${COMMON}
${FRAG}
uniform vec3 uTint; uniform vec3 uRim;
uniform float uAlpha; uniform float uRimA; uniform float uBumpF; uniform float uBumpS;
uniform float uFade; uniform float uNear;
varying vec3 vW; varying vec3 vN; varying vec3 vObj;
void main() {
  vec3 toC = cameraPosition - vW;
  float dist = length(toC);
  vec3 v = toC / dist;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float h = fbm3(vObj * uBumpF + vec3(0.0, 0.0, uTime * 0.03));
  // fine protein speckle in the bilayer
  float sp = smoothstep(0.72, 0.9, vnoise(vObj * uBumpF * 4.1));
  n = bumpN(n, vW, (h + sp * 0.4) * uBumpS);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 2.6);
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (ndv * 1.3 + h * 0.6 + vec3(0.0, 0.33, 0.67)));
  vec3 base = uTint * (0.8 + 0.4 * h);
  vec3 col = sssLight(base, n, v, 0.7, 0.8, 0.9) * 0.55;
  col += uRim * mix(vec3(1.0), film * 1.5, 0.4) * fr * uRimA;
  col += uRim * sp * 0.08;
  float a = uAlpha * (0.7 + 0.6 * h) + fr * uRimA * 0.65 + sp * 0.05;
  a *= gl_FrontFacing ? 1.0 : 0.55;
  a *= smoothstep(uD * uNear * 0.25, uD * uNear, dist);
  float f = fogF(dist);
  col = mix(col, uFogCol, f);
  a *= (1.0 - 0.7 * f) * uFade;
  gl_FragColor = vec4(col * a, a);
}`;

export interface ShellOpts {
  tint: THREE.Color; rim: THREE.Color; alpha: number; rimA: number;
  bumpF: number; bumpS: number; und: number; undF: number; near: number;
}

export function shellMaterial(shared: Shared, o: ShellOpts, side: THREE.Side) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      ...shared,
      uTint: { value: o.tint }, uRim: { value: o.rim },
      uAlpha: { value: o.alpha }, uRimA: { value: o.rimA },
      uBumpF: { value: o.bumpF }, uBumpS: { value: o.bumpS },
      uUnd: { value: o.und }, uUndF: { value: o.undF },
      uFade: { value: 1 }, uNear: { value: o.near },
    },
    transparent: true,
    depthWrite: false,
    side,
    // premultiplied output
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

/**
 * Closed smooth shell: an icosphere whose unit directions are mapped through
 * centre + radii ⊙ dir · shape(dir).
 */
export function shellGeometry(detail: number, centre: THREE.Vector3, radii: THREE.Vector3,
  shape: (x: number, y: number, z: number) => number, scale = 1) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g);
  g.dispose();
  g = m;
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = shape(v.x, v.y, v.z) * scale;
    p.setXYZ(i, centre.x + radii.x * v.x * r, centre.y + radii.y * v.y * r, centre.z + radii.z * v.z * r);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
