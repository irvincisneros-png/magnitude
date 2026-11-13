/**
 * Info card for the dominant landmark: name, scientific + friendly size, evidence badge, blurb,
 * "How do we know?" and the nesting note. Collapses to a compact bar on phones (tap to expand).
 */
import { formatFriendly, formatSci } from '../engine/scale';
import type { Evidence, LandmarkMeta } from '../engine/types';

export interface CardContent {
  id: string;
  index?: string; // e.g. "07 / 12"
  name: string;
  sizeMeters?: number;
  evidence?: Evidence;
  blurb: string;
  howWeKnow?: { instrument: string; text: string };
  nestingNote?: string;
}

const EVIDENCE_LABEL: Record<Evidence, string> = { measured: 'Measured', modelled: 'Modelled', speculative: 'Speculative' };
const EVIDENCE_HINT: Record<Evidence, string> = {
  measured: 'Sizes and structure here come from direct measurement.',
  modelled: 'Built from measurements plus a scientific model; details are an informed picture.',
  speculative: 'No experiment reaches this scale. This is an artistic impression of ideas.',
};

export const metaToCard = (m: LandmarkMeta, index?: string): CardContent => ({
  id: m.id, index, name: m.name, sizeMeters: m.sizeMeters, evidence: m.evidence, blurb: m.blurb, howWeKnow: m.howWeKnow,
  nestingNote: m.nesting === 'comparison' ? m.nestingNote ?? 'Objects here are shown side by side for size, not at their true distances.' : undefined,
});

/**
 * Identity of what a card shows. Must change when a placeholder (id + name only, "Loading…")
 * is replaced by the real meta, otherwise show() would skip the re-render and the card stays stuck.
 */
export const cardKey = (c: CardContent): string =>
  `${c.id}|${c.name}|${c.evidence ?? ''}|${c.howWeKnow?.text ? 1 : 0}|${c.nestingNote ?? ''}|${c.blurb}`;

export class InfoCard {
  readonly el: HTMLElement;
  private inner: HTMLElement;
  private current = '';
  private swapTimer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('article');
    this.el.className = 'card glass';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="card-inner"></div>`;
    this.inner = this.el.querySelector('.card-inner')!;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.card-toggle')) this.el.classList.toggle('expanded');
    });
  }

  show(c: CardContent) {
    const key = cardKey(c);
    if (key === this.current) return;
    const first = this.current === '';
    this.current = key;
    clearTimeout(this.swapTimer);
    if (first) { this.render(c); return; }
    this.el.classList.add('swapping');
    this.swapTimer = window.setTimeout(() => {
      this.render(c);
      this.el.classList.remove('swapping');
    }, 180);
  }

  private render(c: CardContent) {
    const ev = c.evidence;
    const size = c.sizeMeters
      ? `<p class="card-size"><span class="friendly">${formatFriendly(c.sizeMeters)}</span><span class="sci">${formatSci(c.sizeMeters)}</span></p>`
      : '';
    this.inner.innerHTML = `
      <header class="card-head">
        <span class="card-index">${c.index ?? ''}</span>
        ${ev ? `<span class="badge ev-${ev}" title="${EVIDENCE_HINT[ev]}"><i></i>${EVIDENCE_LABEL[ev]}</span>` : ''}
        <button type="button" class="card-toggle" aria-label="Show details"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </header>
      <h2 class="card-name"></h2>
      ${size}
      <div class="card-more">
        <p class="card-blurb"></p>
        ${c.howWeKnow?.text ? `<details class="card-how"><summary>How do we know?</summary><p class="how-inst"></p><p class="how-text"></p></details>` : ''}
        ${c.nestingNote ? `<p class="card-note"><svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"/><path d="M8 7v4M8 4.6v.1" stroke="currentColor" stroke-linecap="round" stroke-width="1.4"/></svg><span></span></p>` : ''}
      </div>`;
    this.inner.querySelector('.card-name')!.textContent = c.name;
    this.inner.querySelector('.card-blurb')!.textContent = c.blurb;
    const inst = this.inner.querySelector('.how-inst');
    if (inst && c.howWeKnow) {
      inst.textContent = c.howWeKnow.instrument;
      this.inner.querySelector('.how-text')!.textContent = c.howWeKnow.text;
    }
    const note = this.inner.querySelector('.card-note span');
    if (note && c.nestingNote) note.textContent = c.nestingNote;
  }
}
