/** Settings panel: graphics quality, reduced motion, sound on/off and volume. */
import type { QualityMode } from '../engine/quality';
import { ambient, type SoundControl } from './audio';
import { ICONS, bindRange, el, reducedMotion, setReducedMotion } from './feature-kit';
import { addToolbarButton, api, mountPanel } from './shell';

const MODES: { mode: QualityMode; label: string; note: string }[] = [
  { mode: 'auto', label: 'Auto', note: 'Picks the best tier for your device and backs off if it struggles.' },
  { mode: 'low', label: 'Low', note: 'Fastest. No glow effects, fewer particles. Good for school laptops and phones.' },
  { mode: 'medium', label: 'Medium', note: 'Adds bloom and sharper rendering.' },
  { mode: 'high', label: 'High', note: 'Everything on. Needs a good graphics card.' },
];

export function mountSettings(sound: SoundControl) {
  // ---- quality
  const qNote = el('p', { class: 'set-note' });
  const qNow = el('span', { class: 'set-now' });
  const qBtns = MODES.map((m) => {
    const b = el('button', { type: 'button', class: 'seg', role: 'radio', 'data-mode': m.mode }, m.label);
    b.addEventListener('click', () => { api().setQuality(m.mode); refreshQuality(); setTimeout(refreshQuality, 400); });
    return b;
  });
  const qGroup = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Graphics quality' }, ...qBtns);

  function refreshQuality() {
    const q = api().getQuality();
    for (const b of qBtns) {
      const on_ = b.dataset.mode === q.mode;
      b.setAttribute('aria-checked', String(on_));
      b.classList.toggle('on', on_);
    }
    qNote.textContent = MODES.find((m) => m.mode === q.mode)?.note ?? '';
    qNow.textContent = q.mode === 'auto' ? `Now using: ${q.tier}` : '';
  }

  // ---- toggles
  const toggle = (label: string, desc: string, on_: boolean, onChange: (v: boolean) => void) => {
    const sw = el('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on_), 'aria-label': label }, el('i'));
    sw.addEventListener('click', () => onChange(sw.getAttribute('aria-checked') !== 'true'));
    const set = (v: boolean) => sw.setAttribute('aria-checked', String(v));
    return { sw, set, row: el('div', { class: 'set-row' }, el('div', { class: 'set-text' }, el('span', { class: 'set-label' }, label), el('span', { class: 'set-desc' }, desc)), sw) };
  };
  const rm = toggle('Reduce motion', 'Shorter flights and no animated effects in the panels.', reducedMotion(), (v) => { setReducedMotion(v); rm.set(v); });
  const snd = toggle('Sound', 'A gentle generative soundscape that follows your scale.', false, (v) => { void sound.set(v); });
  sound.onChange((v) => snd.set(v));
  if (!ambient.supported) { snd.sw.setAttribute('disabled', ''); }

  const vol = el('input', { type: 'range', min: 0, max: 100, value: Math.round(ambient.getVolume() * 100), class: 'range', 'aria-label': 'Volume' });
  bindRange(vol);
  vol.addEventListener('input', () => ambient.setVolume(Number(vol.value) / 100));

  const body = el('div', { class: 'settings' },
    el('div', { class: 'set-block' }, el('div', { class: 'field-label' }, 'Graphics quality ', qNow), qGroup, qNote),
    el('div', { class: 'set-block' }, rm.row),
    el('div', { class: 'set-block' }, snd.row, el('div', { class: 'set-vol' }, el('span', { class: 'set-desc' }, 'Volume'), vol)),
  );
  const panel = mountPanel('settings', 'Settings', body);
  addToolbarButton({ id: 'settings', label: 'Settings', icon: ICONS.settings, onClick: () => { refreshQuality(); panel.toggle(); } });
  refreshQuality();
}
