/** Small DOM helpers, inline icons and shared state used by the feature layer (compare, tours, missions…). */
import { lsGet, lsSet } from './feature-logic';

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Tiny hyperscript: el('button', { class: 'x', type: 'button' }, 'Label', child…). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...kids: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) e.append(kid);
  return e;
}

/** Inline stroke icon (18 px, currentColor) matching the toolbar's glass buttons. */
const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
export const ICONS = {
  compare: svg('<circle cx="8.5" cy="12" r="5.5"/><circle cx="16.5" cy="12" r="3" /><path d="M16.5 7.5v-2M16.5 18.5v-2" opacity=".5"/>'),
  tours: svg('<circle cx="12" cy="12" r="8.5"/><path d="m15.6 8.4-2.2 5-5 2.2 2.2-5z"/>'),
  missions: svg('<path d="M6 21V4"/><path d="M6 5h11l-2 3.5 2 3.5H6"/>'),
  timelight: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  soundOff: svg('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="m16 9.5 4 5M20 9.5l-4 5"/>'),
  soundOn: svg('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  teacher: svg('<path d="M4 6.5C6.5 5 9.5 5 12 6.5v12c-2.5-1.5-5.5-1.5-8 0z"/><path d="M20 6.5C17.5 5 14.5 5 12 6.5v12c2.5-1.5 5.5-1.5 8 0z"/>'),
  play: svg('<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5.5v13M16 5.5v13" stroke-width="2.4"/>'),
  prev: svg('<path d="M7 5.5v13M18 5.5 10 12l8 6.5z" fill="currentColor"/>'),
  next: svg('<path d="M17 5.5v13M6 5.5 14 12l-8 6.5z" fill="currentColor"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  stamp: svg('<circle cx="12" cy="10" r="5.5"/><path d="m9 15-1.5 5.5 4.5-2.5 4.5 2.5L15 15"/><path d="m9.7 10 1.8 1.8 3-3.2"/>'),
  swap: svg('<path d="M7 4 3.5 7.5 7 11M3.5 7.5H15M17 13l3.5 3.5L17 20M20.5 16.5H9"/>'),
  pin: svg('<path d="M12 21v-6"/><path d="M8 4h8l-1 6 3 3.5H6L9 10z"/>'),
};

const rootEl = () => document.getElementById('app') ?? document.body;
const hudEl = () => document.querySelector<HTMLElement>('.hud') ?? rootEl();
export const getRoot = rootEl;
export const getHud = hudEl;
export const getCanvas = () => document.querySelector<HTMLCanvasElement>('canvas.stage');

// ------------------------------------------------------------------ dock: bottom strip for the tour player and mission HUD

let dock: HTMLElement | null = null;
export function getDock(): HTMLElement {
  if (!dock || !dock.isConnected) {
    dock = el('div', { class: 'dock' });
    hudEl().appendChild(dock);
  }
  return dock;
}
/** Keeps `.dock-on` on the root in step with whether anything is docked (lets phones hide the info card). */
export function syncDock() {
  const d = getDock();
  const n = d.querySelectorAll('.dock-item:not([hidden])').length;
  rootEl().classList.toggle('dock-on', n > 0);
}

// ------------------------------------------------------------------ motion preference

const KEY_RM = 'magnitude.reduceMotion';
type RM = 'on' | 'off' | null;
const rmListeners: (() => void)[] = [];
const osReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function readRm(): RM {
  const v = lsGet(KEY_RM);
  return v === 'on' || v === 'off' ? v : null;
}
let rmPref: RM = readRm();

/** Effective reduced-motion for the feature layer: user override, else the OS preference. */
export const reducedMotion = () => (rmPref === 'on' ? true : rmPref === "off" ? false : osReduced());
export function setReducedMotion(on: boolean) {
  rmPref = on ? 'on' : 'off';
  lsSet(KEY_RM, rmPref);
  rootEl().classList.toggle('reduce-motion', reducedMotion());
  rmListeners.forEach((f) => f());
}
export function applyMotionClass() { rootEl().classList.toggle('reduce-motion', reducedMotion()); }
export function onMotionChange(f: () => void) { rmListeners.push(f); }

/** Keeps a range input's filled-track colour in step with its value (CSS var --fill). */
export function bindRange(r: HTMLInputElement) {
  const upd = () => r.style.setProperty('--fill', `${((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100}%`);
  r.addEventListener('input', upd);
  upd();
  return upd;
}
