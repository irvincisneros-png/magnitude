/**
 * Guided tours: captioned auto-flights from src/data/tours.json. Player with play/pause/skip, caption bar and
 * progress; any user input pauses the tour. Deep link: #s=…&tour=<id>.
 */
import toursJson from '../data/tours.json';
import { ICONS, applyMotionClass, el, getCanvas, getDock, getRoot, reducedMotion, syncDock } from './feature-kit';
import { CAPTION_AT, flightSeconds, stepStart, tourFromHash, tourSeconds, type Tour } from './feature-logic';
import { addToolbarButton, api, mountPanel } from './shell';

export const TOURS = toursJson as Tour[];

export interface TourControl { start(id: string): void; stop(): void; active(): string | null }

export function mountTours(): TourControl {
  const list = el('div', { class: 'tour-list' });
  const panel = mountPanel('tours', 'Guided tours', el('div', { class: 'tours' },
    el('p', { class: 'panel-intro' }, 'Sit back and let Magnitude fly. Touch, scroll or press a key at any time to take over.'), list));
  addToolbarButton({ id: 'tours', label: 'Guided tours', icon: ICONS.tours, onClick: () => panel.toggle() });

  // ---- player
  const caption = el('p', { class: 'tp-caption', 'aria-live': 'polite' });
  const title = el('span', { class: 'tp-title' });
  const count = el('span', { class: 'tp-count' });
  const fill = el('i');
  const bar = el('div', { class: 'tp-progress', role: 'progressbar', 'aria-label': 'Tour progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  const mk = (cls: string, label: string, icon: string) => {
    const b = el('button', { type: 'button', class: `tp-btn ${cls}`, 'aria-label': label, title: label });
    b.innerHTML = icon;
    return b;
  };
  const bPrev = mk('prev', 'Previous step', ICONS.prev);
  const bPlay = mk('play', 'Pause tour', ICONS.pause);
  const bNext = mk('next', 'Next step', ICONS.next);
  const bClose = mk('close', 'End tour', ICONS.close);
  const replay = el('button', { type: 'button', class: 'mini tp-replay', hidden: true }, 'Play again');
  const player = el('section', { class: 'tour-player dock-item glass', 'aria-label': 'Guided tour', hidden: true },
    el('div', { class: 'tp-head' }, title, count, el('div', { class: 'tp-ctl' }, bPrev, bPlay, bNext, bClose)),
    caption, bar, replay);
  getDock().appendChild(player);

  let tour: Tour | null = null;
  let index = 0;
  let playing = false;
  let stepElapsed = 0;
  let flightLen = 0;
  let token = 0; // invalidates in-flight promises
  let raf = 0;
  let last = 0;
  let flying = false;
  let total = 0;

  function setHash(id: string | null) {
    const p = new URLSearchParams(location.hash.slice(1));
    if (id) p.set('tour', id); else p.delete('tour');
    try { history.replaceState(null, '', `#${p.toString()}`); } catch { /* sandboxed */ }
  }

  function updateProgress() {
    if (!tour) return;
    const done = stepStart(tour, index) + Math.min(stepElapsed, tour.steps[index].seconds);
    const pct = Math.min(100, (done / total) * 100);
    fill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  let captionShown = false;
  function showCaption() {
    if (!tour || captionShown) return;
    captionShown = true;
    caption.textContent = tour.steps[index].caption;
    caption.classList.remove('swap');
    void caption.offsetWidth; // restart the fade
    caption.classList.add('swap');
  }

  function showStep() {
    if (!tour) return;
    count.textContent = `${index + 1} / ${tour.steps.length}`;
    title.textContent = tour.title;
    bPrev.disabled = index === 0;
    replay.hidden = true;
    updateProgress();
  }

  function fly(from: number) {
    if (!tour) return;
    const st = tour.steps[index];
    const my = ++token;
    const len = Math.max(0.3, flightLen - from);
    flying = true;
    void api().flyTo(st.s, len, { yaw: st.yaw, pitch: st.pitch }).then(() => {
      if (my === token) { flying = false; showCaption(); }
    });
  }

  function beginStep(i: number) {
    if (!tour) return;
    index = Math.max(0, Math.min(tour.steps.length - 1, i));
    const st = tour.steps[index];
    stepElapsed = 0;
    captionShown = false;
    flightLen = flightSeconds(st, st.s - api().getS(), reducedMotion());
    showStep();
    if (playing) fly(0); else showCaption();
  }

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!playing || !tour) return;
    stepElapsed += dt;
    // a slow frame rate must not eat the reading time: while still flying, the clock waits at the end of the flight
    if (flying) stepElapsed = Math.min(stepElapsed, flightLen);
    if (!captionShown && stepElapsed >= flightLen * CAPTION_AT) showCaption();
    updateProgress();
    if (stepElapsed >= tour.steps[index].seconds) {
      if (index >= tour.steps.length - 1) finish();
      else beginStep(index + 1);
    }
  }

  function setPlaying(p: boolean) {
    playing = p;
    bPlay.innerHTML = p ? ICONS.pause : ICONS.play;
    bPlay.setAttribute('aria-label', p ? 'Pause tour' : 'Play tour');
    bPlay.title = p ? 'Pause tour' : 'Play tour';
    player.classList.toggle('paused', !p);
  }

  function pause() {
    if (!tour || !playing) return;
    setPlaying(false);
    token++;
    flying = false;
    api().setS(api().getS()); // cancels the controller flight where it is
  }
  function resume() {
    if (!tour) return;
    setPlaying(true);
    if (stepElapsed >= tour.steps[index].seconds) { beginStep(index + 1 < tour.steps.length ? index + 1 : index); return; }
    // re-fly to this step's target; remaining flight time
    const near = Math.abs(api().getS() - tour.steps[index].s) < 0.02;
    if (!near) fly(Math.min(stepElapsed, flightLen - 0.3)); else showCaption();
  }

  function finish() {
    if (!tour) return;
    setPlaying(false);
    token++;
    flying = false;
    caption.textContent = 'That is the end of the tour. Keep exploring, or play it again.';
    replay.hidden = false;
    fill.style.width = '100%';
    bar.setAttribute('aria-valuenow', '100');
  }

  function start(id: string) {
    const t = TOURS.find((x) => x.id === id);
    if (!t) return;
    tour = t;
    total = tourSeconds(t);
    player.hidden = false;
    syncDock();
    getRoot().classList.add('touring');
    document.querySelector('.hint')?.classList.add('gone');
    panel.close();
    setPlaying(true);
    setHash(id);
    beginStep(0);
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (!tour) return;
    token++;
    flying = false;
    if (playing) api().setS(api().getS());
    tour = null;
    setPlaying(false);
    cancelAnimationFrame(raf);
    player.hidden = true;
    syncDock();
    getRoot().classList.remove('touring');
    setHash(null);
  }

  bPlay.addEventListener('click', () => (playing ? pause() : resume()));
  bNext.addEventListener('click', () => { if (tour) { if (index >= tour.steps.length - 1) finish(); else { setPlaying(true); beginStep(index + 1); } } });
  bPrev.addEventListener('click', () => { if (tour) { setPlaying(true); beginStep(index - 1); } });
  bClose.addEventListener('click', stop);
  replay.addEventListener('click', () => tour && start(tour.id));

  // user input pauses the tour (the controller already cancels its own flight on wheel/keys/pinch)
  const interrupt = (e: Event) => {
    if (!tour || !playing) return;
    const t = e.target as Node | null;
    if (t && player.contains(t)) return;
    pause();
  };
  getCanvas()?.addEventListener('wheel', interrupt, { passive: true });
  getCanvas()?.addEventListener('pointerdown', interrupt);
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '=', '_'].includes(e.key)) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return;
      interrupt(e);
    }
  });
  // the ruler also moves the camera; treat touching it as taking over
  document.querySelector('.ruler')?.addEventListener('pointerdown', interrupt);

  // ---- list
  for (const t of TOURS) {
    const secs = tourSeconds(t);
    const btn = el('button', { type: 'button', class: 'tour-item', 'data-tour': t.id },
      el('span', { class: 'ti-play' }),
      el('span', { class: 'ti-text' },
        el('span', { class: 'ti-title' }, t.title),
        el('span', { class: 'ti-sum' }, t.summary),
        el('span', { class: 'ti-meta' }, `${t.steps.length} stops · about ${Math.round(secs / 5) * 5} seconds`)));
    btn.addEventListener('click', () => start(t.id));
    list.appendChild(btn);
  }

  // ---- deep link
  window.addEventListener('hashchange', () => {
    const id = tourFromHash(location.hash);
    if (id && id !== tour?.id) start(id);
  });
  const initial = tourFromHash(location.hash);
  if (initial) {
    const go = () => start(initial);
    // wait for the engine's first frame so the opening flight is smooth
    const ready = (window as unknown as { __magnitude?: { ready: Promise<void> } }).__magnitude?.ready;
    if (ready) void ready.then(() => setTimeout(go, 400)); else setTimeout(go, 1200);
  }
  applyMotionClass();

  return { start, stop, active: () => tour?.id ?? null };
}
