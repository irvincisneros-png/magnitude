/**
 * HTML label overlay for `meta.labels`: projects each label's local position with its layer's
 * camera, fades it by layer opacity and the label's zoomRange, then declutters in screen space
 * (priority = array order; overlaps with other labels, UI elements or the viewport edge fade out).
 */
import * as THREE from 'three';
import type { ActiveInfo } from '../engine/engine';
import { smoothstep } from '../engine/scale';
import { declutter, type DeclutterItem, type Rect } from './declutter';

const LABEL_H = 16;   // text box height (px)
const LABEL_LIFT = 12; // label text sits this far above its anchor point (matches CSS)
const KEEP_OUT = '.card, .toolbar, .anchor, .ruler, .panel.open, .dock-item';
const NARROW_MAX = 3;

interface Entry extends DeclutterItem {
  key: string;
  el: HTMLElement;
  text: string;
  alpha: number;
  rank: number;
  vis: number; // smoothed visibility 0..1
  seen: boolean;
}

export class Labels {
  private host: HTMLElement;
  private pool = new Map<string, Entry>();
  private widths = new Map<string, number>();
  private list: Entry[] = [];
  private keepOut: Rect[] = [];
  private keepFrame = 0;
  private lastT = performance.now();
  private v = new THREE.Vector3();

  constructor(overlay: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'labels';
    overlay.appendChild(this.host);
  }

  private measure(el: HTMLElement, text: string): number {
    let w = this.widths.get(text);
    if (w === undefined) {
      w = (el.firstElementChild as HTMLElement).offsetWidth || text.length * 8;
      this.widths.set(text, w);
    }
    return w;
  }

  private refreshKeepOut() {
    const rects = this.keepOut;
    let n = 0;
    const els = document.querySelectorAll<HTMLElement>(KEEP_OUT);
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (els[i].hidden) continue;
      const o = rects[n] ?? (rects[n] = { x0: 0, y0: 0, x1: 0, y1: 0 });
      o.x0 = r.left; o.y0 = r.top; o.x1 = r.right; o.y1 = r.bottom;
      n++;
    }
    rects.length = n;
  }

  update(active: ActiveInfo[], w: number, h: number) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.keepFrame++ % 6 === 0) this.refreshKeepOut();
    const hostRect = this.host.getBoundingClientRect();
    const ox = hostRect.left, oy = hostRect.top;

    const list = this.list;
    list.length = 0;
    for (const e of this.pool.values()) e.seen = false;

    // Higher-presence layers get priority; within a layer, array order.
    for (let li = 0; li < active.length; li++) {
      const a = active[li];
      const labels = a.meta?.labels;
      if (!labels || !a.camera) continue;
      const layerA = smoothstep(0.35, 0.85, a.opacity * a.presence);
      if (layerA <= 0.01) continue;
      for (let i = 0; i < labels.length; i++) {
        const lb = labels[i];
        let alpha = layerA;
        if (lb.zoomRange) {
          const [lo, hi] = lb.zoomRange;
          alpha *= smoothstep(lo - 0.25, lo + 0.05, a.zoom) * (1 - smoothstep(hi - 0.05, hi + 0.25, a.zoom));
        }
        if (alpha <= 0.01) continue;
        this.v.set(lb.position[0], lb.position[1], lb.position[2]).project(a.camera);
        if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) continue;
        const key = `${a.id}:${i}`;
        let e = this.pool.get(key);
        if (!e) {
          const el = document.createElement('div');
          el.className = 'label';
          el.innerHTML = '<span></span>';
          el.style.opacity = '0';
          this.host.appendChild(el);
          e = { key, el, text: '', alpha: 0, rank: 0, vis: 0, seen: true, wasShown: false, show: false, box: { x0: 0, y0: 0, x1: 0, y1: 0 } };
          this.pool.set(key, e);
        }
        if (e.text !== lb.text) { e.text = lb.text; e.el.firstElementChild!.textContent = lb.text; }
        const x = (this.v.x * 0.5 + 0.5) * w;
        const y = (-this.v.y * 0.5 + 0.5) * h;
        const tw = this.measure(e.el, lb.text);
        e.seen = true;
        e.alpha = alpha;
        e.rank = -a.presence * 1000 + li * 0.001 + i * 1e-6; // lower = higher priority
        // box in viewport coordinates (keep-out rects are viewport coordinates)
        e.box.x0 = ox + x - tw / 2; e.box.x1 = ox + x + tw / 2;
        e.box.y1 = oy + y - LABEL_LIFT + 2; e.box.y0 = e.box.y1 - LABEL_H - 2;
        e.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        list.push(e);
      }
    }

    // Keep ordering stable: sort by rank (layer presence, then array order).
    list.sort((p, q) => p.rank - q.rank);
    const narrow = w < 760;
    declutter(list, this.keepOut, ox + w, oy + h, { maxVisible: narrow ? NARROW_MAX : Infinity });

    const step = Math.min(1, dt * 7);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      e.wasShown = e.show;
      e.vis += ((e.show ? 1 : 0) - e.vis) * step;
      if (e.show && e.vis > 0.98) e.vis = 1;
      if (!e.show && e.vis < 0.02) e.vis = 0;
      e.el.style.opacity = (e.alpha * e.vis).toFixed(3);
    }
    for (const [key, e] of this.pool) {
      if (!e.seen) { e.el.remove(); this.pool.delete(key); }
    }
  }
}
