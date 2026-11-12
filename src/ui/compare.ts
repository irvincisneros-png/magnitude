/**
 * Compare tray: pick any two objects (the 12 landmarks + every ruler marker), see them at true relative scale
 * and read the ratio in words. When the ratio is huge, a zoom control grows the small one out of a dot.
 */
import { formatFriendly, superscript } from '../engine/scale';
import { api, addToolbarButton, mountPanel } from './shell';
import { ICONS, bindRange, el, onMotionChange, reducedMotion } from './feature-kit';
import { CMP_H, CMP_W, compareLayout, nearestObject, powersSentence, ratioParts, ratioSentence, type Sized } from './feature-logic';

export { ratioSentence, powersSentence } from './feature-logic';

interface Obj extends Sized { id: string; kind: 'landmark' | 'marker' }

const SVG_NS = 'http://www.w3.org/2000/svg';
const sv = (tag: string, attrs: Record<string, string | number> = {}) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

export function mountCompare() {
  const a = api();
  const objects: Obj[] = [
    ...a.landmarks.map((l) => ({ id: l.id, name: l.name, sizeMeters: l.sizeMeters, kind: 'landmark' as const })),
    ...a.markers.map((m) => ({ id: m.id, name: m.name, sizeMeters: m.sizeMeters, kind: 'marker' as const })),
  ].sort((x, y) => x.sizeMeters - y.sizeMeters);
  const byName = new Map(objects.map((o) => [o.name.toLowerCase(), o]));
  const byId = new Map(objects.map((o) => [o.id, o]));

  let slotA: Obj | undefined = byId.get('earth');
  let slotB: Obj | undefined = byId.get('sun');
  let t = 0; // zoom 0..1
  let anim = 0;

  // ---- DOM
  const dl = el('datalist', { id: 'cmp-objects' });
  for (const o of objects) dl.append(el('option', { value: o.name, label: `${formatFriendly(o.sizeMeters)}${o.kind === 'landmark' ? ' · landmark' : ''}` }));

  const makeSlot = (label: string, which: 'A' | 'B') => {
    const input = el('input', {
      type: 'text', class: 'cmp-input', list: 'cmp-objects', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Search, e.g. blue whale', 'aria-label': `Object ${which}`,
    });
    const pin = el('button', { type: 'button', class: 'mini', title: `Set object ${which} to what you are looking at now` }, 'Pin current');
    const go = el('button', { type: 'button', class: 'mini ghost', title: `Fly to object ${which}` }, 'Go to');
    const wrap = el('div', { class: 'cmp-slot' }, el('label', { class: 'field-label' }, label), input, el('div', { class: 'cmp-slot-actions' }, pin, go));
    return { wrap, input, pin, go };
  };
  const sa = makeSlot('Object A', 'A');
  const sb = makeSlot('Object B', 'B');
  const swap = el('button', { type: 'button', class: 'mini ghost cmp-swap', 'aria-label': 'Swap A and B', title: 'Swap A and B' });
  swap.innerHTML = `${ICONS.swap}<span>Swap</span>`;

  const stage = sv('svg', { viewBox: `0 0 ${CMP_W} ${CMP_H}`, class: 'cmp-svg', role: 'img', 'aria-label': 'The two objects drawn at true relative scale' });
  stage.innerHTML = `
    <defs>
      <radialGradient id="cmpBig" cx="34%" cy="30%" r="80%">
        <stop offset="0" stop-color="#e3eeff"/><stop offset=".38" stop-color="#7ea7e0"/><stop offset=".78" stop-color="#2a4676"/><stop offset="1" stop-color="#0d1830"/>
      </radialGradient>
      <radialGradient id="cmpSmall" cx="34%" cy="30%" r="80%">
        <stop offset="0" stop-color="#fff6dc"/><stop offset=".4" stop-color="#e7c685"/><stop offset=".8" stop-color="#8a6429"/><stop offset="1" stop-color="#2c1d0a"/>
      </radialGradient>
      <radialGradient id="cmpGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ecd7a8" stop-opacity=".55"/><stop offset="1" stop-color="#ecd7a8" stop-opacity="0"/></radialGradient>
    </defs>
    <g class="cmp-big-g"><circle class="cmp-big" fill="url(#cmpBig)" stroke="rgba(255,255,255,.22)" stroke-width="1"/></g>
    <g class="cmp-small-g"><circle class="cmp-glow" fill="url(#cmpGlow)"/><circle class="cmp-ring" fill="none" stroke="#ecd7a8" stroke-width="1"/><circle class="cmp-small" fill="url(#cmpSmall)" stroke="rgba(255,255,255,.3)" stroke-width=".8"/></g>
    <text class="cmp-dot-label" text-anchor="middle"></text>`;
  const bigC = stage.querySelector<SVGCircleElement>('.cmp-big')!;
  const smallC = stage.querySelector<SVGCircleElement>('.cmp-small')!;
  const ring = stage.querySelector<SVGCircleElement>('.cmp-ring')!;
  const glow = stage.querySelector<SVGCircleElement>('.cmp-glow')!;
  const dotLabel = stage.querySelector<SVGTextElement>('.cmp-dot-label')!;

  const legend = el('div', { class: 'cmp-legend' });
  const slider = el('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'range', 'aria-label': 'Zoom: grow the smaller object' });
  const updFill = bindRange(slider);
  const play = el('button', { type: 'button', class: 'mini' }, 'Play zoom');
  const zoomReadout = el('span', { class: 'cmp-zoom-readout' });
  const zoomRow = el('div', { class: 'cmp-zoom' }, el('label', { class: 'field-label' }, 'Zoom into the smaller one'), el('div', { class: 'cmp-zoom-ctl' }, slider, play), zoomReadout);
  const sentence = el('p', { class: 'cmp-sentence', 'aria-live': 'polite' });
  const powers = el('p', { class: 'cmp-powers' });
  const empty = el('p', { class: 'cmp-empty' }, 'Choose two objects to compare.');

  const body = el('div', { class: 'cmp' },
    dl,
    el('div', { class: 'cmp-slots' }, sa.wrap, sb.wrap),
    swap,
    el('div', { class: 'cmp-stage' }, stage as unknown as Node),
    legend, zoomRow, sentence, powers, empty,
  );

  const panel = mountPanel('compare', 'Compare', body);
  addToolbarButton({ id: 'compare', label: 'Compare tray', icon: ICONS.compare, onClick: () => panel.toggle() });

  // ---- behaviour
  function resolveInput(input: HTMLInputElement): Obj | undefined {
    return byName.get(input.value.trim().toLowerCase());
  }
  function sync() {
    sa.input.value = slotA?.name ?? '';
    sb.input.value = slotB?.name ?? '';
    render();
  }
  for (const [slot, which] of [[sa, 'A'], [sb, 'B']] as const) {
    slot.input.addEventListener('input', () => {
      const o = resolveInput(slot.input);
      if (!o) return;
      if (which === 'A') slotA = o; else slotB = o;
      t = 0; slider.value = '0'; updFill();
      render();
    });
    slot.input.addEventListener('focus', () => slot.input.select());
    slot.input.addEventListener('blur', () => { if (!resolveInput(slot.input)) slot.input.value = (which === 'A' ? slotA : slotB)?.name ?? ''; });
    slot.pin.addEventListener('click', () => {
      const o = nearestObject(a.getS(), objects);
      if (!o) return;
      if (which === 'A') slotA = o; else slotB = o;
      t = 0; slider.value = '0'; updFill();
      sync();
    });
    slot.go.addEventListener('click', () => {
      const o = which === 'A' ? slotA : slotB;
      if (o) void a.flyTo(a.homeFor(o.sizeMeters));
    });
  }
  swap.addEventListener('click', () => { [slotA, slotB] = [slotB, slotA]; sync(); });

  slider.addEventListener('input', () => { cancelAnimationFrame(anim); t = Number(slider.value) / 1000; render(); });
  play.addEventListener('click', () => {
    cancelAnimationFrame(anim);
    if (reducedMotion()) { t = t < 0.5 ? 1 : 0; slider.value = String(t * 1000); updFill(); render(); return; }
    const from = t >= 0.999 ? 0 : t;
    const t0 = performance.now();
    const dur = 5200 * (1 - from * 0.6);
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / dur);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      t = from + (1 - from) * e;
      slider.value = String(Math.round(t * 1000));
      updFill();
      render();
      if (u < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  });
  onMotionChange(() => cancelAnimationFrame(anim));

  function render() {
    const ready = !!slotA && !!slotB;
    empty.hidden = ready;
    sentence.hidden = powers.hidden = !ready;
    stage.parentElement!.hidden = !ready;
    legend.hidden = !ready;
    zoomRow.hidden = true;
    if (!slotA || !slotB) return;
    const { big, small, ratio } = ratioParts(slotA, slotB);
    sentence.textContent = ratioSentence(slotA, slotB);
    powers.textContent = powersSentence(slotA, slotB);

    const showZoom = ratio > 12;
    zoomRow.hidden = !showZoom;
    const tt = showZoom ? t : 0;
    const L = compareLayout(ratio, tt);
    bigC.setAttribute('r', String(L.bigR));
    bigC.setAttribute('cx', String(L.bigCx));
    bigC.setAttribute('cy', String(L.cy));
    const sr = Math.max(L.smallR, 1.4);
    smallC.setAttribute('r', String(sr));
    smallC.setAttribute('cx', String(L.smallCx));
    smallC.setAttribute('cy', String(L.cy));
    glow.setAttribute('r', String(Math.max(sr * 2.2, 9)));
    glow.setAttribute('cx', String(L.smallCx)); glow.setAttribute('cy', String(L.cy));
    ring.setAttribute('cx', String(L.smallCx)); ring.setAttribute('cy', String(L.cy));
    ring.setAttribute('r', String(sr + 5));
    ring.style.opacity = L.dot ? '0.85' : '0';
    ring.classList.toggle('pulse', L.dot);
    dotLabel.textContent = L.dot ? `${small.name.replace(/\s*\([^)]*\)/, '')} is this dot` : '';
    dotLabel.setAttribute('x', String(Math.min(CMP_W - 70, Math.max(70, L.smallCx))));
    dotLabel.setAttribute('y', String(L.cy + 24));

    const mag = 10 ** (Math.log10(ratio) * tt);
    zoomReadout.textContent = tt > 0.001
      ? `Zoomed in ×${mag >= 1e4 ? `10${superscript(Math.round(Math.log10(mag)))}` : Math.round(mag).toLocaleString('en-AU')}`
      : 'Zoomed out: the bigger object fits the frame';

    legend.replaceChildren(
      el('span', { class: 'cmp-key big' }, el('i'), `${big.name} · ${formatFriendly(big.sizeMeters)}`),
      el('span', { class: 'cmp-key small' }, el('i'), `${small.name} · ${formatFriendly(small.sizeMeters)}`),
    );
    stage.setAttribute('aria-label', `${big.name} (${formatFriendly(big.sizeMeters)}) and ${small.name} (${formatFriendly(small.sizeMeters)}) at true relative scale`);
  }

  sync();
}
