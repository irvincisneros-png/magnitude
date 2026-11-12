/**
 * Quality tiers: auto-picked from the GPU string, then a frame-time watchdog drops a tier
 * after 2 s under 28 fps. A user override (auto/low/medium/high) persists in localStorage.
 */
import type * as THREE from 'three';
import type { Quality } from './types';

export type QualityMode = 'auto' | Quality;
const KEY = 'magnitude.quality';
const ORDER: Quality[] = ['low', 'medium', 'high'];

export const MAX_DPR: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };

function readMode(): QualityMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'auto' || v === 'low' || v === 'medium' || v === 'high') return v;
  } catch { /* storage blocked */ }
  return 'auto';
}
function writeMode(m: QualityMode) {
  try { localStorage.setItem(KEY, m); } catch { /* storage blocked */ }
}

/** Best guess at a starting tier from the WebGL renderer string and device hints. */
export function probeTier(renderer: THREE.WebGLRenderer): Quality {
  const gl = renderer.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch { /* ignore */ }
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'low';
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
  if (mobile || /mali|adreno|powervr|intel\(r\) (hd|uhd)|intel hd|intel uhd/.test(g)) return 'low';
  if (/apple m\d|apple gpu|nvidia|geforce|rtx|radeon rx|radeon pro/.test(g)) return 'high';
  return 'medium';
}

export class QualityManager {
  mode: QualityMode;
  tier: Quality;
  private listeners = new Set<(q: Quality) => void>();
  private autoTier: Quality;
  private samples: number[] = [];
  private sampleTime = 0;
  private cooldown = 3; // seconds before the watchdog may act (startup, after any change)

  constructor(renderer: THREE.WebGLRenderer) {
    this.autoTier = probeTier(renderer);
    this.mode = readMode();
    this.tier = this.mode === 'auto' ? this.autoTier : this.mode;
  }

  onChange(cb: (q: Quality) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** 'auto' re-enables the watchdog; a tier pins it. */
  set(mode: QualityMode, persist = true) {
    this.mode = mode;
    if (persist) writeMode(mode);
    this.apply(mode === 'auto' ? this.autoTier : mode);
  }

  /** Feed every frame's dt (seconds). */
  sample(dt: number) {
    if (dt > 0.25) return; // tab switch / hitch: ignore
    this.cooldown -= dt;
    this.samples.push(dt);
    this.sampleTime += dt;
    while (this.sampleTime > 2 && this.samples.length > 1) this.sampleTime -= this.samples.shift()!;
    if (this.mode !== 'auto' || this.cooldown > 0 || this.sampleTime < 1.9) return;
    const fps = this.samples.length / this.sampleTime;
    const i = ORDER.indexOf(this.tier);
    if (fps < 28 && i > 0) {
      this.autoTier = ORDER[i - 1];
      console.info(`[magnitude] ${fps.toFixed(0)} fps — dropping quality to ${this.autoTier}`);
      this.apply(this.autoTier);
    }
  }

  private apply(q: Quality) {
    this.samples = [];
    this.sampleTime = 0;
    this.cooldown = 3;
    if (q === this.tier) return;
    this.tier = q;
    this.listeners.forEach((cb) => cb(q));
  }
}
