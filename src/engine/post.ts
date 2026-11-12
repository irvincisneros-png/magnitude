/**
 * Post-processing on the composited HDR image.
 * low: tone mapping only · medium: + bloom · high: + bloom, vignette and faint film grain.
 */
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Quality } from './types';

export interface PostHints { bloom: number; exposure: number }

const finalFrag = /* glsl */ `
  uniform sampler2D tInput; uniform float uExposure; uniform float uVignette; uniform float uGrain;
  uniform float uTime; uniform vec2 uRes;
  varying vec2 vUv;
  vec3 aces(vec3 x) { // Narkowicz fit
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 c = texture2D(tInput, vUv).rgb * uExposure;
    c = aces(c);
    vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
    c *= mix(1.0, smoothstep(1.15, 0.25, length(q)), uVignette);
    c = toSRGB(c);
    float n = rnd(vUv * uRes + fract(uTime) * 91.7);
    c += (n - 0.5) * (uGrain + 1.0 / 255.0); // grain on high, dithering always
    gl_FragColor = vec4(c, 1.0);
  }`;

const quadVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Post {
  private bloom: UnrealBloomPass;
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  private tier: Quality = 'medium';

  constructor(private renderer: THREE.WebGLRenderer) {
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.9);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: finalFrag,
      uniforms: {
        tInput: { value: null }, uExposure: { value: 1 }, uVignette: { value: 0 }, uGrain: { value: 0 },
        uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  setTier(q: Quality) {
    this.tier = q;
    this.mat.uniforms.uVignette.value = q === 'high' ? 0.55 : q === 'medium' ? 0.3 : 0;
    this.mat.uniforms.uGrain.value = q === 'high' ? 0.035 : 0;
  }

  /** Width/height in device pixels. */
  setSize(w: number, h: number) {
    this.bloom.setSize(Math.max(2, w), Math.max(2, h)); // the pass works at half resolution internally
    this.mat.uniforms.uRes.value.set(w, h);
  }

  /** Bloom into `input` (in place), then tone-map + grade to the screen. */
  render(input: THREE.WebGLRenderTarget, hints: PostHints, time: number) {
    if (this.tier !== 'low' && hints.bloom > 0.001) {
      this.bloom.strength = hints.bloom;
      this.bloom.render(this.renderer, input, input, 0, false);
    }
    this.mat.uniforms.tInput.value = input.texture;
    this.mat.uniforms.uExposure.value = hints.exposure;
    this.mat.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(null);
    this.quad.render(this.renderer);
  }

  dispose() { this.bloom.dispose(); this.mat.dispose(); this.quad.dispose(); }
}
