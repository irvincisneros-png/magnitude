/**
 * Log ruler: the whole S_MIN…S_MAX range with decade ticks, landmark ticks, marker dots and the
 * declared desert. Vertical on the right edge; horizontal along the bottom on narrow screens.
 * Click → eased flight; drag → scrub.
 */
import { DESERTS, type ManifestRow } from '../landmarks/manifest';
import { S_MAX, S_MIN, formatFriendly, superscript } from '../engine/scale';
import type { Marker } from './markers';

export interface RulerDeps {
  landmarks: readonly ManifestRow[];
  markers: readonly Marker[];
  homeFor: (sizeMeters: number) => number;
  flyTo: (s: number) => void;
  glideTo: (s: number) => void;
  narrowQuery: MediaQueryList;
}

const frac = (s: number) => (s - S_MIN) / (S_MAX - S_MIN);
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Ruler {
  readonly el: HTMLElement;
  private track: HTMLElement;
  private thumb: HTMLElement;
  private thumbLabel: HTMLElement;
  private tip: HTMLElement;
  private names: HTMLElement[] = [];
  private activeId = '';
  private lastS = NaN;

  constructor(parent: HTMLElement, private deps: RulerDeps) {
    const el = (this.el = document.createElement('nav'));
    el.className = 'ruler';
    el.setAttribute('aria-label', 'Scale ruler');

    const decades: string[] = [];
    for (let n = Math.ceil(S_MIN); n <= Math.floor(S_MAX); n++) {
      const major = n % 5 === 0;
      decades.push(`<i class="tick${major ? ' major' : ''}${n % 10 === 0 ? ' ten' : ''}" style="--p:${frac(n)}">${major ? `<b>10${superscript(n)}</b>` : ''}</i>`);
    }
    const deserts = DESERTS.map((d) => `<i class="desert-band" style="--p:${frac(d.range[0])};--q:${frac(d.range[1])}" title="${esc(d.name)}"></i>`).join('');
    const marks = deps.markers
      .map((m) => {
        const s = Math.log10(m.sizeMeters);
        if (s < S_MIN || s > S_MAX) return '';
        return `<button type="button" class="mark" style="--p:${frac(s)}" data-size="${m.sizeMeters}" data-name="${esc(m.name)}" aria-label="${esc(m.name)}" tabindex="-1"></button>`;
      })
      .join('');
    const lms = deps.landmarks
      .map((r) => {
        const s = Math.log10(r.sizeMeters);
        return `<button type="button" class="lm" style="--p:${frac(s)}" data-id="${r.id}" data-size="${r.sizeMeters}" aria-label="Fly to ${esc(r.name)}"><span class="lm-dot"></span><span class="lm-name">${esc(r.name)}</span></button>`;
      })
      .join('');

    el.innerHTML = `
      <div class="ruler-track" role="slider" tabindex="0" aria-label="Scale: power of ten of the view height in metres"
           aria-valuemin="${S_MIN}" aria-valuemax="${S_MAX}" aria-orientation="vertical">
        <i class="ruler-line"></i>${deserts}${decades.join('')}
        <div class="marks">${marks}</div>
        <div class="lms">${lms}</div>
        <div class="ruler-thumb"><span class="ruler-thumb-label"></span></div>
      </div>
      <div class="ruler-tip" role="tooltip"></div>`;
    parent.appendChild(el);
    this.track = el.querySelector('.ruler-track')!;
    this.thumb = el.querySelector('.ruler-thumb')!;
    this.thumbLabel = el.querySelector('.ruler-thumb-label')!;
    this.tip = el.querySelector('.ruler-tip')!;
    this.names = [...el.querySelectorAll<HTMLElement>('.lm')];

    this.bindPointer();
    this.bindTips();
    this.track.addEventListener('keydown', (e) => {
      const step = e.key === 'PageUp' ? 5 : e.key === 'PageDown' ? -5 : e.key === 'Home' ? -999 : e.key === 'End' ? 999 : 0;
      if (step) { e.preventDefault(); deps.flyTo(this.lastS + step); }
    });
    const relayout = () => this.layoutNames();
    window.addEventListener('resize', relayout);
    deps.narrowQuery.addEventListener('change', () => {
      this.track.setAttribute('aria-orientation', deps.narrowQuery.matches ? 'horizontal' : 'vertical');
      requestAnimationFrame(relayout);
    });
    this.track.setAttribute('aria-orientation', deps.narrowQuery.matches ? 'horizontal' : 'vertical');
    requestAnimationFrame(relayout);
  }

  private get horizontal() { return this.deps.narrowQuery.matches; }

  /** s under a pointer position. */
  private sAt(x: number, y: number) {
    const r = this.track.getBoundingClientRect();
    const f = this.horizontal ? (x - r.left) / r.width : 1 - (y - r.top) / r.height;
    return S_MIN + Math.min(1, Math.max(0, f)) * (S_MAX - S_MIN);
  }

  private bindPointer() {
    let start: { x: number; y: number; id: number } | null = null;
    let dragging = false;
    this.track.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.lm, .mark')) return; // buttons handle their own click
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragging = false;
      this.track.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.track.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
        dragging = true;
        this.el.classList.add('dragging');
      }
      if (dragging) this.deps.glideTo(this.sAt(e.clientX, e.clientY));
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (!dragging) this.deps.flyTo(this.sAt(e.clientX, e.clientY));
      start = null;
      dragging = false;
      this.el.classList.remove('dragging');
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.lm, .mark');
      if (b) this.deps.flyTo(this.deps.homeFor(Number(b.dataset.size)));
    });
  }

  private bindTips() {
    const show = (b: HTMLElement) => {
      const name = b.dataset.name ?? b.querySelector('.lm-name')?.textContent ?? '';
      this.tip.innerHTML = `<strong>${esc(name)}</strong><span>${formatFriendly(Number(b.dataset.size))}</span>`;
      const r = b.getBoundingClientRect();
      const host = this.el.getBoundingClientRect();
      this.tip.style.setProperty('--x', `${r.left + r.width / 2 - host.left}px`);
      this.tip.style.setProperty('--y', `${r.top + r.height / 2 - host.top}px`);
      this.tip.classList.add('on');
    };
    const hide = () => this.tip.classList.remove('on');
    this.el.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.mark, .lm');
      if (b && e.pointerType === 'mouse') show(b); else if (!b) hide();
    });
    this.el.addEventListener('pointerleave', hide);
    this.el.addEventListener('focusin', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.mark, .lm');
      if (b) show(b);
    });
    this.el.addEventListener('focusout', hide);
  }

  /** Greedy label culling so landmark names never overlap; the active one always wins. */
  private layoutNames() {
    const r = this.track.getBoundingClientRect();
    const len = this.horizontal ? r.width : r.height;
    const gap = this.horizontal ? 9999 : 17; // horizontal: only the active name is shown
    const items = this.names.map((el) => ({ el, px: frac(Math.log10(Number(el.dataset.size))) * len, active: el.dataset.id === this.activeId }));
    const placed: number[] = [];
    for (const it of [...items].sort((a, b) => Number(b.active) - Number(a.active))) {
      const ok = it.active || placed.every((p) => Math.abs(p - it.px) >= gap);
      it.el.classList.toggle('named', ok);
      if (ok) placed.push(it.px);
    }
  }

  setActive(id: string) {
    if (id === this.activeId) return;
    this.activeId = id;
    this.names.forEach((el) => el.classList.toggle('active', el.dataset.id === id));
    this.layoutNames();
  }

  update(s: number) {
    if (Math.abs(s - this.lastS) < 1e-4) return;
    this.lastS = s;
    this.thumb.style.setProperty('--p', String(frac(s)));
    const rounded = Math.round(s * 10) / 10;
    this.thumbLabel.innerHTML = `10<sup>${rounded.toFixed(1).replace('-', '−')}</sup>`;
    this.track.setAttribute('aria-valuenow', s.toFixed(2));
    this.track.setAttribute('aria-valuetext', `View height ${formatFriendly(10 ** s)}`);
  }
}
