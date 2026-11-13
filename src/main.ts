/**
 * Magnitude entry: builds the shell, starts the engine and wires UI ↔ engine.
 * URL options: #s=<number> deep link · ?q=low|medium|high forces a tier for this visit ·
 * ?debug shows an fps / layers readout.
 */
import './styles.css';
import { Controller } from './engine/controller';
import { Engine, type ActiveInfo } from './engine/engine';
import type { QualityMode } from './engine/quality';
import { clampS } from './engine/scale';
import type { Quality } from './engine/types';
import { mountFeatures } from './features';
import { DESERTS, MANIFEST } from './landmarks/manifest';
import { Anchor } from './ui/anchor';
import { InfoCard, metaToCard } from './ui/infocard';
import { Labels } from './ui/labels';
import { MARKERS } from './ui/markers';
import { Ruler } from './ui/ruler';
import { buildShell, emit, registerApi } from './ui/shell';

declare global {
  interface Window {
    __magnitude?: {
      getS(): number;
      setS(s: number): void;
      setOrbit(yaw: number, pitch: number): void;
      flyTo(s: number, seconds?: number): Promise<void>;
      setQuality(mode: QualityMode): void;
      getActive(): { id: string; presence: number; opacity: number; ready: boolean; zoom: number }[];
      getQuality(): { mode: QualityMode; tier: Quality };
      ready: Promise<void>;
    };
  }
}

const root = document.getElementById('app')!;
const dom = buildShell(root);
const narrowQuery = matchMedia('(max-width: 760px)');
const setNarrow = () => root.classList.toggle('narrow', narrowQuery.matches);
narrowQuery.addEventListener('change', setNarrow);
setNarrow();

if (!hasWebGL2()) {
  root.insertAdjacentHTML('beforeend', `<div class="fatal glass"><h1>Magnitude needs WebGL2</h1><p>Try a recent version of Chrome, Edge, Firefox or Safari, or turn on hardware acceleration.</p></div>`);
  throw new Error('[magnitude] WebGL2 unavailable');
}

const veil = document.createElement('div');
veil.className = 'veil';
veil.innerHTML = `<div class="veil-brand"><span class="brand-mark"></span>Magnitude</div><div class="veil-sub">10⁻³⁵ m → 10²⁷ m</div>`;
root.appendChild(veil);

const engine = new Engine(dom.canvas, dom.overlay);
const forced = new URLSearchParams(location.search).get('q');
if (forced === 'low' || forced === 'medium' || forced === 'high') engine.quality.set(forced, false); // this visit only

/** A good s to frame something of this size; landmarks are kept inside their own range. */
const homeFor = (sizeMeters: number) => {
  const s = Math.log10(sizeMeters) + 0.25;
  const row = MANIFEST.find((r) => r.sizeMeters === sizeMeters);
  if (!row) return clampS(s);
  if (row.home !== undefined) return clampS(row.home);
  const [lo, hi] = row.range;
  return clampS(Math.min(hi - 0.6, Math.max(lo + 0.6, s)));
};
const homes = MANIFEST.map((r) => homeFor(r.sizeMeters));
const humanHome = homes[MANIFEST.findIndex((r) => r.id === 'human')];
const controller = new Controller(dom.canvas, { homes, initialS: humanHome });

const anchor = new Anchor(dom.hud);
const card = new InfoCard(dom.hud);
const ruler = new Ruler(dom.hud, {
  landmarks: MANIFEST,
  markers: MARKERS,
  homeFor,
  flyTo: (s) => void controller.flyTo(s),
  glideTo: (s) => controller.glideTo(s),
  narrowQuery,
});
const labels = new Labels(dom.overlay);

const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent = matchMedia('(pointer: coarse)').matches
  ? 'Pinch to zoom · drag to look around'
  : 'Scroll to zoom · drag to orbit · ← → jump between landmarks';
dom.hud.appendChild(hint);
let hintTimer = window.setTimeout(() => hint.classList.add('gone'), 9000);
controller.onUserInput = () => {
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hint.classList.add('gone'), 1200);
  controller.onUserInput = () => {};
};

let active: ActiveInfo[] = [];
registerApi({
  getS: () => controller.s,
  setS: (s) => controller.setS(s),
  flyTo: (s, seconds, orbit) => controller.flyTo(s, seconds, orbit),
  getOrbit: () => ({ yaw: controller.yaw, pitch: controller.pitch }),
  getQuality: () => ({ mode: engine.quality.mode, tier: engine.tier }),
  setQuality: (m) => engine.setQuality(m),
  landmarks: MANIFEST,
  getMeta: (id) => active.find((a) => a.id === id)?.meta ?? metaCache.get(id),
  markers: MARKERS,
  homeFor,
  reducedMotion: controller.reducedMotion,
});

// ------------------------------------------------------------------ resize

const resize = () => engine.resize(root.clientWidth, root.clientHeight);
new ResizeObserver(resize).observe(root);
resize();

// ------------------------------------------------------------------ dominant landmark → card

const metaCache = new Map<string, NonNullable<ActiveInfo['meta']>>();
let dominant = '';
function pickDominant(list: ActiveInfo[]): ActiveInfo | undefined {
  const cur = list.find((a) => a.id === dominant);
  let best: ActiveInfo | undefined;
  // Several landmarks can be fully present at once: prefer the one the view is framed on (zoom ≈ +0.25).
  const score = (a: ActiveInfo) => a.presence - (MANIFEST.some((r) => r.id === a.id) ? 0.25 * Math.min(3, Math.abs(a.zoom - 0.25)) : 0);
  for (const a of list) if (!best || score(a) > score(best) + 1e-6 || (Math.abs(score(a) - score(best)) < 1e-6 && a.ready)) best = a;
  if (cur && best && best !== cur && score(best) < score(cur) + 0.1 && cur.presence > 0.3) return cur; // hysteresis
  return best;
}
function showDominant(a: ActiveInfo) {
  const i = MANIFEST.findIndex((r) => r.id === a.id);
  if (a.meta) metaCache.set(a.id, a.meta);
  const meta = a.meta ?? metaCache.get(a.id);
  const key = `${a.id}:${meta ? 'meta' : 'none'}`;
  if (key === shownKey) return;
  shownKey = key;
  dominant = a.id;
  ruler.setActive(a.id);
  if (i >= 0) {
    const index = `${String(i + 1).padStart(2, '0')} / ${MANIFEST.length}`;
    if (meta) card.show(metaToCard(meta, index));
    else card.show({ id: a.id, index, name: MANIFEST[i].name, sizeMeters: MANIFEST[i].sizeMeters, blurb: 'Loading…' });
  } else {
    const d = DESERTS.find((x) => x.id === a.id);
    if (d) card.show({ id: d.id, index: 'No landmark', name: d.name, blurb: d.blurb });
  }
  emit('landmark', { id: a.id, meta: meta ?? null });
}
let shownKey = '';

// ------------------------------------------------------------------ debug readout

const debugEl = new URLSearchParams(location.search).has('debug') ? document.createElement('pre') : null;
if (debugEl) { debugEl.className = 'debug'; root.appendChild(debugEl); }
let fpsAcc = 0, fpsN = 0, fps = 0;

// ------------------------------------------------------------------ loop

window.__magnitude = {
  getS: () => controller.s,
  setS: (s) => controller.setS(s),
  setOrbit: (yaw, pitch) => { controller.yaw = yaw; controller.pitch = pitch; },
  flyTo: (s, seconds) => controller.flyTo(s, seconds),
  setQuality: (m) => engine.setQuality(m),
  getActive: () => active.map(({ id, presence, opacity, ready, zoom }) => ({ id, presence, opacity, ready, zoom })),
  getQuality: () => ({ mode: engine.quality.mode, tier: engine.tier }),
  ready: Promise.resolve(),
};

const t0 = performance.now();
let last = t0;
let lastS = NaN;
function tick(now: number) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  controller.update(dt);
  const s = controller.s;
  active = engine.frame(s, controller.yaw, controller.pitch, (now - t0) / 1000, dt);
  labels.update(active, root.clientWidth, root.clientHeight);
  if (s !== lastS) {
    lastS = s;
    anchor.update(s);
    ruler.update(s);
    emit('scale', s);
  }
  const d = pickDominant(active);
  if (d) showDominant(d);
  if (debugEl) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    const info = engine.renderer.info.render;
    debugEl.textContent = `${fps.toFixed(0)} fps · ${engine.tier} (${engine.quality.mode}) · s ${s.toFixed(2)} · ${info.calls} calls · ${info.triangles} tris\n` +
      active.map((a) => `${a.id.padEnd(13)} p ${a.presence.toFixed(2)} op ${a.opacity.toFixed(2)} z ${a.zoom.toFixed(2)}${a.ready ? '' : ' (loading)'}`).join('\n');
  }
}

window.__magnitude.ready = (async () => {
  await engine.warm(controller.s);
  anchor.update(controller.s);
  ruler.update(controller.s);
  requestAnimationFrame((t) => { last = t; tick(t); });
  requestAnimationFrame(() => veil.classList.add('gone'));
  setTimeout(() => veil.remove(), 1600);
})();

mountFeatures(); // compare, tours, missions, time & light, sound, settings (src/features.ts)

dom.canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  root.insertAdjacentHTML('beforeend', `<div class="fatal glass"><h1>Graphics paused</h1><p>The GPU reset. Reload the page to continue.</p></div>`);
});

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}
