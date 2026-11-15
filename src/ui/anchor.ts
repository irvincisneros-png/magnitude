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

  constructor(private parent: HTMLElement) {
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
    window.addEventListener('resize', () => this.fit());
  }

  /**
   * On phones the toolbar sits to the right of the readout; shrink a long value ("188 thousand light-years")
   * so it never runs underneath the buttons. Wide screens have the room and keep the full size.
   */
  private fit() {
    const f = this.friendly;
    f.style.fontSize = '';
    if (!this.parent.closest('.narrow')) return;
    const bar = this.parent.querySelector<HTMLElement>('.toolbar');
    if (!bar || bar.hidden) return;
    const room = bar.getBoundingClientRect().left - f.getBoundingClientRect().left - 16;
    const need = f.scrollWidth;
    if (room <= 0 || need <= room) return;
    f.style.fontSize = `${Math.max(13, Math.floor(parseFloat(getComputedStyle(f).fontSize) * (room / need)))}px`;
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
    this.fit();
    this.sci.textContent = sci === f ? '' : sci;
    this.ratio.dataset.dir = r.direction;
    this.ratio.innerHTML =
      r.direction === 'same'
        ? `<span class="ratio-icon" aria-hidden="true"></span>About your size`
        : `<span class="ratio-icon" aria-hidden="true"></span><b>10${superscript(r.exponent)}</b>&thinsp;times ${r.direction} than you`;
  }
}
