/**
 * The neighbours: a milky feldspar grain (cleavage steps, satin lustre, light glowing through it),
 * a black heavy-mineral grain (ilmenite: sub-metallic, glinting) and a worn shell fragment with
 * concentric growth ridges and a layered broken edge. One shader, three kinds.
 */
import * as THREE from 'three';
import { LIGHT_GLSL } from './light';
import { ENV_GLSL } from './env';
import { SHELL, rng } from './shape';

const vert = /* glsl */ `
attribute float aPart;
varying vec3 vObj; varying vec3 vW; varying vec3 vN; varying float vPart;
void main() {
  vObj = position; vPart = aPart;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
${LIGHT_GLSL}
${ENV_GLSL}
varying vec3 vObj; varying vec3 vW; varying vec3 vN; varying float vPart;

float glint(vec3 p, vec3 N, vec3 V, float cs, float dens, float spread) {
  vec3 q = p / cs;
  vec3 c = floor(q);
  vec3 hh = hash33(c);
  if (hh.x > dens) return 0.0;
  vec3 ctr = c + 0.2 + 0.6 * hash33(c + 17.0);
  float spot = smoothstep(0.45, 0.05, length(q - ctr));
  vec3 fn = normalize(N + (hash33(c + 5.0) - 0.5) * spread + 0.01 * sin(uTime * vec3(2.3, 1.9, 3.1) + hh * 30.0));
  return spot * pow(max(dot(reflect(-V, fn), uSun), 0.0), 600.0);
}

void main() {
  vec3 V = normalize(cameraPosition - vW);
  float fp = length(cameraPosition - vW) * uPx;
  vec3 N0 = normalize(vN);
  if (!gl_FrontFacing) N0 = -N0;
  vec3 p = vObj;
  vec3 alb; float rough; float F0; float trans; float h = 0.0; float gd = 0.0; float gs = 0.8;
#if KIND == 0
  // feldspar: milky, faintly pink, with stepped cleavage and a satin sheen
  float cl = fract(dot(p, vec3(0.97, 0.05, 0.2)) * 26.0 + vnoise3(p * 4.0) * 0.6);
  h += 0.0035 * smoothstep(0.0, 0.85, cl) * lod(26.0, fp);
  h += 0.0012 * (vnoise3(p * 120.0) - 0.5) * lod(120.0, fp);
  float cloud = vnoise3(p * 5.0) * 0.6 + vnoise3(p * 17.0) * 0.4;
  alb = mix(vec3(0.62, 0.5, 0.43), vec3(0.8, 0.72, 0.66), cloud);
  alb = mix(alb, vec3(0.62, 0.36, 0.2), smoothstep(0.62, 0.8, vnoise3(p * 6.0 + 5.0)) * 0.5);
  rough = 0.3; F0 = 0.045; trans = 0.55; gd = 0.18; gs = 0.35;
#elif KIND == 1
  // heavy mineral (ilmenite/magnetite): black, sub-metallic, conchoidal and pitted
  h += 0.002 * (vnoise3(p * 60.0) - 0.5) * lod(60.0, fp);
  h += 0.0008 * (vnoise3(p * 200.0) - 0.5) * lod(200.0, fp);
  alb = vec3(0.02, 0.019, 0.018);
  alb = mix(alb, vec3(0.16, 0.08, 0.04), smoothstep(0.6, 0.8, vnoise3(p * 9.0)) * 0.6);
  rough = 0.32; F0 = 0.07; trans = 0.0; gd = 0.5; gs = 0.7;
#else
  // shell: growth ridges are in the mesh; colour bands, chalky worn outer face, glossy inner face
  vec2 um = p.xz - vec2(-0.95, -0.25);
  float gr = length(um);
  float band = vnoise2(vec2(gr * 9.0, 0.5)) * 0.7 + vnoise2(vec2(gr * 30.0, 2.0)) * 0.3;
  alb = mix(vec3(0.62, 0.52, 0.4), vec3(0.78, 0.7, 0.58), band);
  alb = mix(alb, vec3(0.5, 0.36, 0.48), smoothstep(0.58, 0.75, vnoise2(vec2(gr * 5.0, 7.0))) * 0.6);
  alb = mix(alb, vec3(0.7, 0.42, 0.22), smoothstep(0.6, 0.8, vnoise3(p * 5.0 + 2.0)) * 0.35);
  h += 0.0015 * (vnoise3(p * 90.0) - 0.5) * lod(90.0, fp);
  rough = 0.42; F0 = 0.04; trans = 0.35; gd = 0.06; gs = 0.4;
  if (vPart > 0.5 && vPart < 1.5) { alb = mix(alb, vec3(0.84, 0.8, 0.78), 0.5); rough = 0.12; }
  if (vPart > 1.5) {
    // broken edge: stacked crossed-lamellar layers
    float lay = fract(p.y * 70.0 + vnoise3(p * 20.0) * 0.8);
    alb *= 0.85 + 0.25 * smoothstep(0.2, 0.5, lay) * (1.0 - smoothstep(0.6, 0.9, lay));
    h += 0.0012 * lay * lod(70.0, fp);
    rough = 0.55;
  }
#endif
  vec3 N = bumpN(N0, vW, h);
  float nv = max(dot(N, V), 1e-3);
  float ndl = dot(N, uSun);
  float ao = mix(0.5, 1.0, smoothstep(0.0, 0.09, vW.y));
  // shadowed by other grains? (only the quartz casts onto the neighbours' bases; cheap map lookup)
  float vis = mix(groundMap(vW.xz).a, 1.0, smoothstep(0.0, 0.25, vW.y));
  vec3 wrap = vec3(trans * 0.5);
  vec3 diff = clamp((vec3(ndl) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 col = alb * uSunCol * diff * vis + alb * skyIrr(N) * 1.3 * ao;
  // bounce from the skin
  col += alb * uSkinLd * max(-N.y, 0.0) * 0.35 * ao;
  // light through thin translucent edges
  col += alb * uSunCol * trans * pow(max(dot(-V, uSun), 0.0), 3.0) * 0.35 * vis;
  float F = F0 + (1.0 - F0) * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, N);
  col += F * mix(envSharp(vW, R), envDiff(vW, R), smoothstep(0.1, 0.4, rough)) * ao;
  vec3 hv = normalize(uSun + V);
  float Fh = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, hv), 0.0), 5.0);
  col += uSunCol * Fh * ggx(max(dot(N, hv), 0.0), rough) * max(ndl, 0.0) * vis / (4.0 * nv + 0.4);
  float cs = max(0.004, fp * 2.2);
  col += uSunCol * glint(p, N0, V, cs, gd, gs) * 14.0 * vis;
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

export function solidMaterial(uniforms: Record<string, THREE.IUniform>, kind: 0 | 1 | 2) {
  return new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, defines: { KIND: kind }, side: kind === 2 ? THREE.DoubleSide : THREE.FrontSide });
}

/**
 * Shell fragment: a piece of a bivalve shell, convex side up, with a broken outline. Top face has
 * concentric growth ridges around an umbo off the fragment; bottom face is the smooth inner side;
 * a rim strip joins them along the break. Local frame: the fragment lies roughly in xz around 0.
 */
export function shellGeometry(): THREE.BufferGeometry {
  const RINGS = 44, SEG = 160;
  const R = rng(5);
  // broken outline: a jagged polygon smoothed slightly
  const K = 8;
  const corners = Array.from({ length: K }, () => 0.72 + R() * 0.38);
  const outline = (a: number) => {
    const f = (a / (Math.PI * 2)) * K;
    const i = Math.floor(f), t = f - i;
    const r0 = corners[i % K], r1 = corners[(i + 1) % K];
    const small = 0.04 * Math.sin(a * 23 + 1.3) + 0.025 * Math.sin(a * 41);
    return SHELL.R * (r0 + (r1 - r0) * t + small);
  };
  const umbo = [-0.95, -0.25];
  const topY = (x: number, z: number) => {
    const g = Math.hypot(x - umbo[0], z - umbo[1]);
    const ridge = 0.009 * Math.pow(Math.abs(Math.sin(g * Math.PI * 11)), 0.6) + 0.006 * Math.sin(g * Math.PI * 37);
    const ang = Math.atan2(z - umbo[1], x - umbo[0]);
    const rib = 0.008 * Math.cos(ang * 46);
    return SHELL.th * 0.5 + SHELL.tilt * x - (x * x + z * z) / (2 * SHELL.curve) + ridge + rib;
  };
  const botY = (x: number, z: number) => topY(x, z) - SHELL.th - 0.015 * Math.sin(x * 9 + z * 5) - 0.025 * Math.sin(Math.hypot(x - umbo[0], z - umbo[1]) * Math.PI * 11) * 0;
  const pos: number[] = [], part: number[] = [], idx: number[] = [];
  const grid = (top: boolean) => {
    const base = pos.length / 3;
    pos.push(0, top ? topY(0, 0) : botY(0, 0), 0); part.push(top ? 0 : 1);
    for (let i = 1; i <= RINGS; i++) for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const r = (i / RINGS) * outline(a);
      const x = r * Math.cos(a), z = r * Math.sin(a);
      pos.push(x, top ? topY(x, z) : botY(x, z), z); part.push(top ? 0 : 1);
    }
    const flip = (a: number, b: number, c: number) => (top ? idx.push(a, c, b) : idx.push(a, b, c));
    for (let j = 0; j < SEG; j++) flip(base, base + 1 + j, base + 1 + ((j + 1) % SEG));
    for (let i = 1; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
      const a = base + 1 + (i - 1) * SEG + j, b = base + 1 + (i - 1) * SEG + ((j + 1) % SEG);
      flip(a, a + SEG, b); flip(b, a + SEG, b + SEG);
    }
  };
  grid(true);
  grid(false);
  // rim
  const rimBase = pos.length / 3;
  const LAY = 6;
  for (let j = 0; j < SEG; j++) {
    const a = (j / SEG) * Math.PI * 2;
    const r = outline(a);
    const x = r * Math.cos(a), z = r * Math.sin(a);
    const y0 = topY(x, z), y1 = botY(x, z);
    for (let k = 0; k <= LAY; k++) {
      const t = k / LAY;
      // the break is a little ragged: layers step in and out
      const inset = 0.012 * Math.sin(k * 2.1 + a * 17) * (k > 0 && k < LAY ? 1 : 0);
      pos.push(x * (1 - inset), y0 + (y1 - y0) * t, z * (1 - inset)); part.push(2);
    }
  }
  for (let j = 0; j < SEG; j++) for (let k = 0; k < LAY; k++) {
    const a = rimBase + j * (LAY + 1) + k, b = rimBase + ((j + 1) % SEG) * (LAY + 1) + k;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
