/**
 * Contact cues painted onto the human scene's skin (layers share no depth): the grains' sun
 * shadows, soft contact occlusion and the caustic of sunlight focused through the quartz.
 * Premultiplied output: rgb is added light, alpha darkens what is underneath, so one pass gives
 * a correctly coloured (bluish, sky-lit) shadow and an additive caustic.
 */
import * as THREE from 'three';
import { LIGHT_GLSL } from './light';
import { ENV_GLSL } from './env';
import { MAP } from './shape';

const vert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
precision highp sampler3D;
${LIGHT_GLSL}
${ENV_GLSL}
uniform sampler3D tSdf; uniform float uB; uniform float uN; uniform vec3 uOffQ;
uniform vec4 uAo[3]; // x, z, yaw, unused
uniform vec2 uAoR[3];
varying vec3 vW;
float sdfQ(vec3 p) {
  p -= uOffQ;
  if (any(greaterThan(abs(p), vec3(uB)))) return 1.0;
  vec3 uvw = ((p + uB) / (2.0 * uB) * (uN - 1.0) + 0.5) / uN;
  return texture(tSdf, uvw).r;
}
void main() {
  vec2 xz = vW.xz;
  vec4 m = groundMap(xz);
  // contact occlusion: distance to the quartz just above the skin, and footprint ellipses of the others
  float s1 = sdfQ(vec3(xz.x, 0.012, xz.y));
  float s2 = sdfQ(vec3(xz.x, 0.06, xz.y));
  float ao = mix(0.3, 1.0, smoothstep(-0.004, 0.07, s1)) * mix(0.7, 1.0, smoothstep(0.0, 0.16, s2));
  for (int i = 0; i < 3; i++) {
    vec2 d = xz - uAo[i].xy;
    float c = cos(uAo[i].z), s = sin(uAo[i].z);
    vec2 l = vec2(d.x * c - d.y * s, d.x * s + d.y * c) / uAoR[i];
    float e = length(l);
    ao *= mix(0.35, 1.0, smoothstep(0.8, 1.45, e));
  }
  vec3 P = uSkinLd + uSkinLa;
  vec3 want = (uSkinLd * m.a + uSkinLa) * ao;
  vec3 ratio = want / P;
  float a = clamp(1.0 - min(min(ratio.r, ratio.g), ratio.b), 0.0, 1.0);
  vec3 c = max(want - P * (1.0 - a), 0.0) + uSkinLd * min(m.rgb, vec3(10.0)) * 0.75;
  // edge of the map: nothing to paint
  vec2 uv = (xz - uMapMin) / uMapSize;
  float edge = smoothstep(0.0, 0.03, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
  gl_FragColor = vec4(c, a) * edge;
}`;

export function decalMesh(uniforms: Record<string, THREE.IUniform>) {
  const g = new THREE.PlaneGeometry(MAP.w, MAP.h);
  g.rotateX(-Math.PI / 2);
  g.translate(MAP.x0 + MAP.w / 2, 0.0004, MAP.z0 + MAP.h / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}
