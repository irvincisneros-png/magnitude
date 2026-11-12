/**
 * HTML label overlay for `meta.labels`: projects each label's local position with its layer's
 * camera and fades it by layer opacity and the label's zoomRange.
 */
import * as THREE from 'three';
import type { ActiveInfo } from '../engine/engine';
import { smoothstep } from '../engine/scale';

export class Labels {
  private host: HTMLElement;
  private pool = new Map<string, HTMLElement>();
  private v = new THREE.Vector3();

  constructor(overlay: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'labels';
    overlay.appendChild(this.host);
  }

  update(active: ActiveInfo[], w: number, h: number) {
    const seen = new Set<string>();
    for (const a of active) {
      const labels = a.meta?.labels;
      if (!labels || !a.camera) continue;
      const layerA = smoothstep(0.35, 0.85, a.opacity * a.presence);
      if (layerA <= 0.01) continue;
      labels.forEach((lb, i) => {
        let alpha = layerA;
        if (lb.zoomRange) {
          const [lo, hi] = lb.zoomRange;
          alpha *= smoothstep(lo - 0.25, lo + 0.05, a.zoom) * (1 - smoothstep(hi - 0.05, hi + 0.25, a.zoom));
        }
        if (alpha <= 0.01) return;
        this.v.set(...lb.position).project(a.camera!);
        if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) return;
        const key = `${a.id}:${i}`;
        seen.add(key);
        let el = this.pool.get(key);
        if (!el) {
          el = document.createElement('div');
          el.className = 'label';
          el.innerHTML = '<span></span>';
          this.host.appendChild(el);
          this.pool.set(key, el);
        }
        if (el.dataset.text !== lb.text) { el.dataset.text = lb.text; el.firstElementChild!.textContent = lb.text; }
        const x = (this.v.x * 0.5 + 0.5) * w;
        const y = (-this.v.y * 0.5 + 0.5) * h;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        el.style.opacity = alpha.toFixed(3);
      });
    }
    for (const [key, el] of this.pool) {
      if (!seen.has(key)) { el.remove(); this.pool.delete(key); }
    }
  }
}
