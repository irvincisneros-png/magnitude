/**
 * Time & light layer (toggle): how long light takes to cross the current view, what typically happens at this size,
 * and, far out in space, the fact that you are seeing the past.
 */
import { formatFriendly } from '../engine/scale';
import type { LandmarkMeta } from '../engine/types';
import { ICONS, el, getHud } from './feature-kit';
import { formatDuration, lightCrossingSeconds, pastLightLine, lsGet, lsSet } from './feature-logic';
import { addToolbarButton, api, on } from './shell';

export { formatDuration } from './feature-logic';

const KEY = 'magnitude.timelight';

export function mountTimeLight() {
  const crossing = el('div', { class: 'tl-value' });
  const timescaleVal = el('div', { class: 'tl-text' });
  const timescaleRow = el('div', { class: 'tl-row' }, el('span', { class: 'tl-label' }, 'Typical event at this size'), timescaleVal);
  const past = el('p', { class: 'tl-past' });
  const panel = el('aside', { class: 'timelight glass', 'aria-label': 'Time and light', hidden: true },
    el('div', { class: 'tl-row' }, el('span', { class: 'tl-label' }, 'Light crosses this view in'), crossing),
    timescaleRow, past,
  );
  getHud().appendChild(panel);

  let meta: LandmarkMeta | null = null;
  let landmarkName = '';
  let on_ = false;
  let lastKey = '';

  const btn = addToolbarButton({
    id: 'timelight', label: 'Time and light layer', icon: ICONS.timelight,
    onClick: () => set(!on_),
  });
  btn.setAttribute('aria-pressed', 'false');

  function set(v: boolean, save = true) {
    on_ = v;
    panel.hidden = !v;
    btn.classList.toggle('active', v);
    btn.setAttribute('aria-pressed', String(v));
    if (save) lsSet(KEY, v ? '1' : '0');
    lastKey = '';
    update(api().getS());
  }

  function update(s: number) {
    if (!on_) return;
    const metres = 10 ** s;
    const text = formatDuration(lightCrossingSeconds(metres));
    const ts = meta?.timescale ?? '';
    const pastText = pastLightLine(metres);
    const key = `${text}|${ts}|${pastText}|${landmarkName}`;
    if (key === lastKey) return;
    lastKey = key;
    crossing.textContent = text;
    timescaleVal.textContent = ts;
    timescaleRow.hidden = !ts;
    timescaleRow.querySelector('.tl-label')!.textContent = landmarkName ? `At the ${landmarkName.toLowerCase()} scale` : 'Typical event at this size';
    past.textContent = pastText;
    past.hidden = !pastText;
    panel.setAttribute('aria-label', `Time and light. Light crosses ${formatFriendly(metres)} in ${text}.`);
  }

  on('scale', update);
  on('landmark', ({ meta: m }) => {
    meta = m;
    landmarkName = m?.name ?? '';
    lastKey = '';
    update(api().getS());
  });

  if (lsGet(KEY) === '1') set(true, false);
}
