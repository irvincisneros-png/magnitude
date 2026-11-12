/**
 * Engine-owned "desert" layer for declared gaps with no landmark (proton → Planck).
 * A near-black void with faint drifting motes that stream past as you zoom, plus a DOM
 * counter: "N powers of ten of nothing we know of". The emptiness is the content.
 */
import * as THREE from 'three';
import type { DesertRow } from '../landmarks/manifest';
import type { Quality } from './types';

const vert = /* glsl */ `
  attribute vec4 seed;            // xyz in [-1,1], w = random
  uniform float uPhase; uniform float uTime; uniform float uPx;
  varying float vA;
  void main() {
    float d = fract(seed.z * 0.5 + 0.5 + uPhase + uTime * 0.004);
    vec3 p = vec3(seed.xy * (2.0 + d * 26.0), -0.6 - d * 30.0);
    p.xy += 0.15 * vec2(sin(uTime * 0.13 + seed.w * 40.0), cos(uTime * 0.11 + seed.w * 31.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (0.6 + seed.w * 1.4) / -mv.z;
    vA = smoothstep(0.0, 0.12, d) * smoothstep(1.0, 0.55, d) * (0.35 + 0.65 * seed.w);
  }`;
const frag = /* glsl */ `
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float r = dot(c, c);
    float a = exp(-r * 18.0) * vA;
    gl_FragColor = vec4(vec3(0.62, 0.68, 0.85) * a * 0.9, a);
  }`;

const skyFrag = /* glsl */ `
  varying vec3 vDir; uniform float uPhase;
  float h(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 4375.85); }
  float n(vec3 p) { vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
  void main() {
    vec3 d = normalize(vDir);
    float v = n(d * 2.5 + uPhase * 0.15) * 0.6 + n(d * 6.0 - uPhase * 0.1) * 0.4;
    vec3 col = mix(vec3(0.004, 0.005, 0.012), vec3(0.03, 0.025, 0.06), smoothstep(0.35, 0.9, v));
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Desert {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private points: THREE.Points | null = null;
  private mat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private el: HTMLElement;
  private numEl: HTMLElement;
  private subEl: HTMLElement;
  private lastS = 0;
  private dir = -1; // -1 zooming in, +1 zooming out
  private shown = '';

  constructor(private row: DesertRow, overlay: HTMLElement) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { uPhase: { value: 0 }, uTime: { value: 0 }, uPx: { value: 30 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: skyFrag, uniforms: { uPhase: this.mat.uniforms.uPhase }, side: THREE.BackSide, depthWrite: false,
      }),
    );
    this.scene.add(this.sky);
    this.setQuality('medium');

    this.el = document.createElement('div');
    this.el.className = 'desert-counter';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="desert-num"></div><div class="desert-sub"></div>`; // the info card carries the blurb
    this.numEl = this.el.querySelector('.desert-num')!;
    this.subEl = this.el.querySelector('.desert-sub')!;
    overlay.appendChild(this.el);
  }

  setQuality(q: Quality) {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    const n = q === 'low' ? 700 : q === 'medium' ? 1600 : 3000;
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) seed.set([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.points = new THREE.Points(g, this.mat);
    this.scene.add(this.points);
  }

  /** `pxScale` = drawing-buffer height, so motes keep their size across DPRs. */
  update(s: number, presence: number, time: number, aspect: number, pxScale: number, yaw: number, pitch: number) {
    const ds = s - this.lastS;
    if (Math.abs(ds) > 1e-4) this.dir = ds < 0 ? -1 : 1;
    this.lastS = s;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.set(-pitch * 0.15, -yaw * 0.15, 0, 'YXZ');
    this.mat.uniforms.uPhase.value = s * 0.9;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uPx.value = pxScale * 0.02;

    const [lo, hi] = this.row.range;
    const visible = presence > 0.02;
    this.el.style.opacity = String(Math.min(1, presence * 1.4));
    this.el.classList.toggle('on', visible);
    if (!visible) return;
    const n = this.dir < 0 ? Math.max(0, Math.round(s - lo)) : Math.max(0, Math.round(hi - s));
    const target = this.dir < 0 ? 'until the Planck scale' : 'until the proton';
    const key = `${n}|${target}`;
    if (key !== this.shown) {
      this.shown = key;
      this.numEl.textContent = String(n);
      this.subEl.textContent = n === 1 ? `power of ten of nothing we know of, ${target}` : `powers of ten of nothing we know of, ${target}`;
    }
  }

  dispose() {
    this.points?.geometry.dispose();
    this.mat.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.el.remove();
  }
}
