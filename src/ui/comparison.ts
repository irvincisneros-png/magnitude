/**
 * "SIZE COMPARISON" banner: shown whenever the view is inside the cross-fade between a landmark
 * marked nesting: 'comparison' and its next-smaller neighbour (e.g. skin cell → E. coli), so nobody
 * reads the smaller object as being really inside the bigger one. Fades with the transition.
 */
import { MANIFEST } from '../landmarks/manifest';
import { comparisonAt } from './comparison-logic';
import { api, on } from './shell';

export class ComparisonBanner {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private shownText = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'comparison';
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = '<span class="comparison-tag">Size comparison</span><span class="comparison-text"></span>';
    this.text = this.el.querySelector('.comparison-text')!;
    parent.appendChild(this.el);
    on('scale', (s) => this.update(s));
    on('landmark', () => this.update(api().getS()));
  }

  update(s: number) {
    const st = comparisonAt(s, MANIFEST, (id) => api().getMeta(id));
    if (!st) {
      if (!this.el.hidden) { this.el.hidden = true; this.el.style.opacity = '0'; this.text.textContent = ''; this.shownText = ''; }
      return;
    }
    if (st.text !== this.shownText) { this.shownText = st.text; this.text.textContent = st.text; }
    this.el.hidden = false;
    this.el.style.opacity = st.alpha.toFixed(3);
  }
}
