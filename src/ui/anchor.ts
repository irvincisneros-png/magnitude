/**
 * Always-visible human anchor (top-left): current view height in friendly + scientific units,
 * and "10ⁿ times bigger/smaller than you".
 */
import { formatFriendly, formatSci, humanRatio, superscript } from '../engine/scale';

export class Anchor {
  readonly el: HTMLElement;
  private friendly: HTMLElement;
  private sci: HTMLElement;
  private ratio: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('header');
    this.el.className = 'anchor';
    this.el.innerHTML = `
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span>Magnitude</div>
      <div class="anchor-read" aria-live="off">
        <span class="anchor-label">View height</span>
        <span class="anchor-friendly"></span>
        <span class="anchor-sci"></span>
      </div>
      <div class="anchor-ratio" aria-live="polite"></div>`;
    this.friendly = this.el.querySelector('.anchor-friendly')!;
    this.sci = this.el.querySelector('.anchor-sci')!;
    this.ratio = this.el.querySelector('.anchor-ratio')!;
    parent.appendChild(this.el);
  }

  update(s: number) {
    const m = 10 ** s;
    const f = formatFriendly(m);
    const sci = formatSci(m);
    const r = humanRatio(s);
    const key = `${f}|${sci}|${r.exponent}|${r.direction}`;
    if (key === this.last) return;
    this.last = key;
    this.friendly.textContent = f;
    this.sci.textContent = sci === f ? '' : sci;
    this.ratio.dataset.dir = r.direction;
    this.ratio.innerHTML =
      r.direction === 'same'
        ? `<span class="ratio-icon" aria-hidden="true"></span>About your size`
        : `<span class="ratio-icon" aria-hidden="true"></span><b>10${superscript(r.exponent)}</b>&thinsp;times ${r.direction} than you`;
  }
}
