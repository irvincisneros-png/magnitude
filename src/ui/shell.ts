/**
 * UI shell: DOM skeleton, event bus and the extension points later features use.
 *
 *   import { on, api, mountPanel, addToolbarButton } from './shell';
 *   on('scale', (s) => …);                 // every frame s changes
 *   on('landmark', ({ id, meta }) => …);   // when the dominant landmark (or 'desert') changes
 *   api().flyTo(-9.5);                     // engine controls, see MagnitudeApi
 *   const panel = mountPanel('compare', 'Compare', el); panel.open();
 *   addToolbarButton({ id: 'compare', label: 'Compare', icon: '<svg…>', onClick: () => panel.toggle() });
 */
import type { ManifestRow } from '../landmarks/manifest';
import type { LandmarkMeta, Quality } from '../engine/types';
import type { QualityMode } from '../engine/quality';
import type { Marker } from './markers';

// ------------------------------------------------------------------ event bus

export interface ShellEvents {
  scale: number;
  landmark: { id: string; meta: LandmarkMeta | null };
}
type Handler<K extends keyof ShellEvents> = (payload: ShellEvents[K]) => void;
const handlers: { [K in keyof ShellEvents]: Set<Handler<K>> } = { scale: new Set(), landmark: new Set() };

/** Subscribe; returns an unsubscribe function. */
export function on<K extends keyof ShellEvents>(event: K, cb: Handler<K>): () => void {
  handlers[event].add(cb);
  return () => { handlers[event].delete(cb); };
}
export function emit<K extends keyof ShellEvents>(event: K, payload: ShellEvents[K]) {
  for (const cb of handlers[event]) {
    try { cb(payload); } catch (err) { console.error(`[magnitude] ${event} handler threw`, err); }
  }
}

// ------------------------------------------------------------------ engine API for features

export interface MagnitudeApi {
  getS(): number;
  setS(s: number): void;
  /** Eased flight; resolves on arrival (or when interrupted). Orbit angles in radians. */
  flyTo(s: number, seconds?: number, orbit?: { yaw?: number; pitch?: number }): Promise<void>;
  getOrbit(): { yaw: number; pitch: number };
  getQuality(): { mode: QualityMode; tier: Quality };
  setQuality(mode: QualityMode): void;
  /** Ordered landmark rows (id, name, sizeMeters, range). */
  landmarks: readonly ManifestRow[];
  /** Loaded metadata of a landmark if it is currently in memory. */
  getMeta(id: string): LandmarkMeta | undefined;
  /** Validated markers from src/data/markers.json (empty if the file is missing). */
  markers: readonly Marker[];
  /** A nice s to frame a landmark or marker of this size. */
  homeFor(sizeMeters: number): number;
  reducedMotion: boolean;
}

let _api: MagnitudeApi | null = null;
export function registerApi(a: MagnitudeApi) { _api = a; }
export function api(): MagnitudeApi {
  if (!_api) throw new Error('[magnitude] shell api() used before the engine started');
  return _api;
}

// ------------------------------------------------------------------ DOM skeleton

export interface ShellDom {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement; // full-screen, pointer-events: none (labels, desert counter)
  hud: HTMLElement;     // corner UI
  toolbar: HTMLElement;
  panels: HTMLElement;
}
let dom: ShellDom | null = null;

export function buildShell(root: HTMLElement): ShellDom {
  root.innerHTML = `
    <canvas class="stage" aria-label="Magnitude 3D view. Scroll, pinch or use arrow keys to zoom; drag to orbit."></canvas>
    <div class="overlay" aria-hidden="false"></div>
    <div class="hud">
      <div class="toolbar" role="toolbar" aria-label="Tools"></div>
      <div class="panels"></div>
    </div>`;
  dom = {
    root,
    canvas: root.querySelector('canvas')!,
    overlay: root.querySelector('.overlay')!,
    hud: root.querySelector('.hud')!,
    toolbar: root.querySelector('.toolbar')!,
    panels: root.querySelector('.panels')!,
  };
  return dom;
}
const need = () => { if (!dom) throw new Error('[magnitude] shell not built yet'); return dom; };

// ------------------------------------------------------------------ toolbar

export interface ToolbarButton { id: string; label: string; icon: string; onClick: (btn: HTMLButtonElement) => void }

/** Adds a round glass icon button (top-right). `icon` is inline SVG markup or a short text glyph. */
export function addToolbarButton({ id, label, icon, onClick }: ToolbarButton): HTMLButtonElement {
  const d = need();
  d.toolbar.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool';
  b.dataset.id = id;
  b.title = label;
  b.setAttribute('aria-label', label);
  if (icon.trim().startsWith('<')) b.innerHTML = icon; else b.textContent = icon;
  b.addEventListener('click', () => onClick(b));
  d.toolbar.appendChild(b);
  return b;
}

// ------------------------------------------------------------------ panels

export interface PanelHandle {
  el: HTMLElement;
  body: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}
const panels = new Map<string, PanelHandle>();

/**
 * Mounts a glass side panel (bottom sheet on phones). One panel is open at a time.
 * Returns a handle; the panel starts closed. Esc closes it.
 */
export function mountPanel(id: string, title: string, element: HTMLElement): PanelHandle {
  const d = need();
  panels.get(id)?.el.remove();
  const el = document.createElement('section');
  el.className = 'panel glass';
  el.dataset.id = id;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  el.hidden = true;
  el.innerHTML = `<header class="panel-head"><h2 class="panel-title"></h2><button type="button" class="panel-close" aria-label="Close">×</button></header><div class="panel-body"></div>`;
  el.querySelector('.panel-title')!.textContent = title;
  const body = el.querySelector<HTMLElement>('.panel-body')!;
  body.appendChild(element);
  d.panels.appendChild(el);
  const h: PanelHandle = {
    el,
    body,
    open() {
      panels.forEach((p) => { if (p !== h) p.close(); });
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('open'));
      d.toolbar.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add('active');
    },
    close() {
      if (el.hidden) return;
      el.classList.remove('open');
      d.toolbar.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.remove('active');
      setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 260);
    },
    toggle() { if (el.classList.contains('open')) h.close(); else h.open(); },
    isOpen: () => el.classList.contains('open'),
  };
  el.querySelector('.panel-close')!.addEventListener('click', () => h.close());
  panels.set(id, h);
  return h;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') panels.forEach((p) => p.close());
});
