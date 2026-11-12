/**
 * Missions: scavenger-hunt challenges from src/data/missions.json. 'find' missions complete automatically when you
 * hold the view within tolerance for 1.5 s; 'compare' and 'estimate' missions take a typed number. Stamps are kept
 * in localStorage (guarded; works with storage blocked, then lasts for the visit).
 */
import missionsJson from '../data/missions.json';
import { formatFriendly } from '../engine/scale';
import { ICONS, el, getDock, syncDock } from './feature-kit';
import {
  HoldTracker, StampStore, checkAnswer, checkFind, parseAnswer, safeLocalStorage, type Mission,
} from './feature-logic';
import { addToolbarButton, api, mountPanel } from './shell';

export const MISSIONS = missionsJson as Mission[];
export const stamps = new StampStore(safeLocalStorage);

const TYPE_LABEL = { find: 'Find', compare: 'Compare', estimate: 'Estimate' } as const;

export function mountMissions() {
  const list = el('ul', { class: 'mission-list' });
  const tally = el('p', { class: 'panel-intro' });
  const resetBtn = el('button', { type: 'button', class: 'mini ghost danger' }, 'Reset stamps');
  const panel = mountPanel('missions', 'Missions', el('div', { class: 'missions' }, tally, list, el('div', { class: 'panel-foot' }, resetBtn)));
  const toolBtn = addToolbarButton({ id: 'missions', label: 'Missions', icon: ICONS.missions, onClick: () => panel.toggle() });
  const badge = el('span', { class: 'tool-badge', hidden: true });
  toolBtn.append(badge);

  // ---- HUD (in the dock)
  const hTitle = el('span', { class: 'mh-title' });
  const hPrompt = el('p', { class: 'mh-prompt' });
  const hHint = el('p', { class: 'mh-hint', hidden: true });
  const hFill = el('i');
  const hMeter = el('div', { class: 'mh-meter', role: 'progressbar', 'aria-label': 'Hold steady', 'aria-valuemin': 0, 'aria-valuemax': 100 }, hFill);
  const hInput = el('input', { type: 'text', inputmode: 'decimal', class: 'cmp-input mh-input', placeholder: 'Your answer', 'aria-label': 'Your answer', autocomplete: 'off' });
  const hCheck = el('button', { type: 'button', class: 'mini accent' }, 'Check');
  const hForm = el('form', { class: 'mh-form' }, hInput, hCheck);
  const hMsg = el('p', { class: 'mh-msg', 'aria-live': 'polite' });
  const hHintBtn = el('button', { type: 'button', class: 'mini ghost' }, 'Hint');
  const hQuit = el('button', { type: 'button', class: 'mini ghost' }, 'Give up');
  const hud = el('section', { class: 'mission-hud dock-item glass', 'aria-label': 'Active mission', hidden: true },
    el('div', { class: 'mh-head' }, el('span', { class: 'mh-kicker' }, 'Mission'), hTitle, el('div', { class: 'mh-actions' }, hHintBtn, hQuit)),
    hPrompt, hHint, hMeter, hForm, hMsg);
  getDock().appendChild(hud);

  let active: Mission | null = null;
  const hold = new HoldTracker();
  let raf = 0;
  let last = 0;
  let resetArmed = 0;

  function renderList() {
    list.replaceChildren();
    for (const m of MISSIONS) {
      const done = stamps.has(m.id);
      const startBtn = el('button', { type: 'button', class: 'mini' }, done ? 'Replay' : active?.id === m.id ? 'Active' : 'Start');
      if (active?.id === m.id) startBtn.setAttribute('disabled', '');
      startBtn.addEventListener('click', () => start(m.id));
      list.append(el('li', { class: `mission${done ? ' done' : ''}${active?.id === m.id ? ' is-active' : ''}`, 'data-mission': m.id },
        el('span', { class: 'stamp', 'aria-hidden': 'true' }),
        el('div', { class: 'mi-text' },
          el('span', { class: 'mi-top' }, el('span', { class: 'mi-type' }, TYPE_LABEL[m.type]), done ? el('span', { class: 'mi-reward' }, `Stamp: ${m.reward}`) : null),
          el('span', { class: 'mi-title' }, m.title),
          el('span', { class: 'mi-prompt' }, m.prompt)),
        startBtn));
    }
    (list.querySelectorAll('.stamp') as NodeListOf<HTMLElement>).forEach((s) => { s.innerHTML = ICONS.stamp; });
    tally.textContent = `${stamps.count} of ${MISSIONS.length} stamps collected.`;
    badge.hidden = stamps.count === 0;
    badge.textContent = String(stamps.count);
  }

  function objectsById(id: string) {
    const lm = api().landmarks.find((l) => l.id === id);
    if (lm) return { name: lm.name, sizeMeters: lm.sizeMeters };
    const mk = api().markers.find((m) => m.id === id);
    return mk ? { name: mk.name, sizeMeters: mk.sizeMeters } : null;
  }

  function start(id: string) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m) return;
    active = m;
    hold.reset();
    hTitle.textContent = m.title;
    hPrompt.textContent = m.prompt;
    hHint.textContent = m.hint;
    hHint.hidden = true;
    hMsg.textContent = '';
    hMsg.className = 'mh-msg';
    hInput.value = '';
    hMeter.hidden = m.type !== 'find';
    hForm.hidden = m.type === 'find';
    hFill.style.width = '0%';
    hud.classList.remove('won');
    hud.hidden = false;
    syncDock();
    panel.close();
    renderList();
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(loop);
    if (m.type !== 'find') setTimeout(() => hInput.focus({ preventScroll: true }), 50);
  }

  function end() {
    active = null;
    cancelAnimationFrame(raf);
    hud.hidden = true;
    syncDock();
    renderList();
  }

  function win(m: Mission) {
    stamps.add(m.id);
    hud.classList.add('won');
    hMsg.className = 'mh-msg ok';
    hMsg.textContent = `Stamp earned: ${m.reward}!`;
    hMeter.hidden = true;
    hForm.hidden = true;
    cancelAnimationFrame(raf);
    renderList();
    setTimeout(() => { if (active?.id === m.id) end(); }, 3200);
  }

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const m = active;
    if (!m || m.type !== 'find' || !m.target) return;
    const inside = checkFind(api().getS(), m.target);
    const r = hold.update(inside, dt);
    hFill.style.width = `${r.progress * 100}%`;
    hMeter.setAttribute('aria-valuenow', String(Math.round(r.progress * 100)));
    hMeter.classList.toggle('near', inside);
    if (r.done) win(m);
  }

  hForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = active;
    if (!m || !m.compare) return;
    const v = parseAnswer(hInput.value);
    if (v === null) { hMsg.className = 'mh-msg bad'; hMsg.textContent = 'Type a number, like 250 or 1.5 million.'; return; }
    if (checkAnswer(v, m.compare.answer, m.compare.tolerancePct)) { win(m); return; }
    const ratio = v / m.compare.answer;
    hMsg.className = 'mh-msg bad';
    const a = objectsById(m.compare.a);
    const b = objectsById(m.compare.b);
    hMsg.textContent = ratio > 1 ? 'Too high. Try a smaller number.' : 'Too low. Try a bigger number.';
    if (a && b) hMsg.textContent += ` (${a.name} is ${formatFriendly(a.sizeMeters)}, ${b.name} is ${formatFriendly(b.sizeMeters)}.)`;
  });
  hHintBtn.addEventListener('click', () => { hHint.hidden = !hHint.hidden; });
  hQuit.addEventListener('click', end);

  resetBtn.addEventListener('click', () => {
    if (!resetArmed) {
      resetBtn.textContent = 'Click again to confirm';
      resetArmed = window.setTimeout(() => { resetArmed = 0; resetBtn.textContent = 'Reset stamps'; }, 3000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = 0;
    resetBtn.textContent = 'Reset stamps';
    stamps.reset();
    renderList();
  });

  renderList();
  return { start, end, active: () => active?.id ?? null };
}
