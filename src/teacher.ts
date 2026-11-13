/**
 * Teacher view: landmarks with deep links, classroom ideas, tours, missions and NSW Science 7–10 outcome mapping.
 * Outcome codes and wording come from src/data/outcomes.json, which copies them from the owner's existing sites
 * (never invented); landmarks without a verified match are listed under "Needs teacher check".
 */
import './teacher.css';
import missionsJson from './data/missions.json';
import outcomesJson from './data/outcomes.json';
import toursJson from './data/tours.json';
import { clampS, formatFriendly, formatSci } from './engine/scale';
import { MANIFEST } from './landmarks/manifest';
import { tourSeconds, type Mission, type Tour } from './ui/feature-logic';

interface OutcomeDef { year: number; code: string; unit: string | null; text: string; nesaOutcome: string | null; nesaFocusArea: string | null; source: string; officialSource: string | null }
interface Data {
  note: string;
  sources: { file: string; description: string }[];
  fitKey: Record<string, string>;
  outcomes: Record<string, OutcomeDef>;
  landmarks: Record<string, { classroomUse: string; outcomes: { code: string; fit: 'direct' | 'loose' }[] }>;
  wholeTool: { outcomes: { code: string; fit: 'direct' | 'loose' }[] };
  needsTeacherCheck: { id: string; reason: string; candidates?: string[] }[];
}
const data = outcomesJson as unknown as Data;
const tours = toursJson as Tour[];
const missions = missionsJson as Mission[];

/** Same framing rule as main.ts so deep links land where the app would put you. */
function home(sizeMeters: number, range: [number, number]) {
  const s = Math.log10(sizeMeters) + 0.25;
  const [lo, hi] = range;
  return clampS(Math.min(hi - 0.6, Math.max(lo + 0.6, s)));
}
const link = (s: number, extra = '') => `index.html#s=${s.toFixed(2)}${extra}`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function outcomeList(refs: { code: string; fit: string }[]) {
  const ul = h('ul', { class: 'oc' });
  for (const r of refs) {
    const d = data.outcomes[r.code];
    if (!d) continue;
    const li = h('li', {}, h('span', { class: 'code' }, r.code), d.text);
    if (d.nesaOutcome) li.append(h('span', { class: 'nesa', title: d.nesaFocusArea ?? '' }, `NESA ${d.nesaOutcome}`));
    li.append(h('span', { class: `fit ${r.fit}`, title: data.fitKey[r.fit] ?? '' }, r.fit === 'direct' ? 'direct' : 'loose fit'));
    ul.append(li);
  }
  return ul;
}

const root = document.getElementById('teacher')!;
const main = h('main');
root.append(main);

main.append(
  h('header', { class: 'top' },
    h('div', {}, h('div', { class: 'kicker' }, 'Magnitude'), h('h1', {}, 'Teacher view')),
    h('div', { class: 'actions' }, h('a', { class: 'btn', href: 'index.html' }, 'Open Magnitude'), (() => {
      const b = h('button', { class: 'btn', type: 'button' }, 'Print this page');
      b.addEventListener('click', () => window.print());
      return b;
    })()),
  ),
  h('p', { class: 'lead' }, 'Magnitude is a continuous zoom through every scale of the universe, from the Planck length (10⁻³⁵ m) to the observable universe (10²⁷ m). Use the links below to open the simulation at a landmark, and the outcome lists to plan Year 7 to 10 lessons. Every landmark page in the simulation carries an evidence badge (measured, modelled or speculative) and a "How do we know?" panel.'),
);

// ---- landmarks
main.append(h('h2', {}, 'Landmarks, classroom uses and outcomes'));
for (const row of MANIFEST) {
  const d = data.landmarks[row.id];
  const card = h('section', { class: 'lm', id: row.id });
  card.append(h('div', { class: 'lm-head' },
    h('h3', {}, row.name),
    h('span', { class: 'size' }, formatFriendly(row.sizeMeters) === formatSci(row.sizeMeters) ? formatSci(row.sizeMeters) : `${formatFriendly(row.sizeMeters)} · ${formatSci(row.sizeMeters)}`),
    h('a', { class: 'link', href: link(row.home ?? home(row.sizeMeters, row.range)) }, 'Open in Magnitude')));
  if (d) {
    card.append(h('p', { class: 'use' }, d.classroomUse));
    card.append(d.outcomes.length ? outcomeList(d.outcomes) : h('p', { class: 'none' }, 'No verified outcome yet. See "Needs teacher check" below.'));
  }
  main.append(card);
}

// ---- tours
main.append(h('h2', {}, 'Guided tours'), h('p', { class: 'lead' }, 'Captioned flights for whole-class viewing. Students can take over at any time by scrolling or touching.'));
for (const t of tours) {
  const first = t.steps[0];
  main.append(h('section', { class: 'item' },
    h('div', { class: 'lm-head' }, h('h3', {}, t.title), h('span', { class: 'size' }, `${t.steps.length} stops · about ${Math.round(tourSeconds(t) / 5) * 5} seconds`),
      h('a', { class: 'link', href: link(first.s, `&tour=${t.id}`) }, 'Start this tour')),
    h('p', { class: 'use' }, t.summary)));
}

// ---- missions
main.append(h('h2', {}, 'Missions'), h('p', { class: 'lead' }, 'Short challenges with stamps stored in the student\'s own browser. Answers for the compare and estimate missions are shown for marking.'));
const rows = missions.map((m) => h('tr', {},
  h('td', {}, m.type),
  h('td', {}, h('strong', {}, m.title), h('br'), m.prompt),
  h('td', {}, m.type === 'find' && m.target ? `Hold the view near s = ${m.target.s} (±${m.target.tolerance})` : m.compare ? `About ${m.compare.answer.toLocaleString('en-AU')} (±${m.compare.tolerancePct}%)` : ''),
));
main.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Mission'), h('th', {}, 'Success'))), h('tbody', {}, ...rows)),
  h('p', { class: 'small' }, '"s" is the base-10 logarithm of the height of the view in metres, shown in the page address after the # sign.'));

// ---- whole tool
main.append(h('h2', {}, 'Outcomes for the whole tool'), h('p', { class: 'lead' }, 'Using Magnitude to talk about scientific models, scale and how knowledge grows.'), outcomeList(data.wholeTool.outcomes));

// ---- needs check
const check = h('section', { class: 'item check' }, h('h3', {}, 'Needs teacher check'),
  h('p', { class: 'use' }, 'These landmarks have no verified outcome in the sources below, so nothing has been guessed. Please decide whether any dot point fits.'));
const ul = h('ul');
for (const n of data.needsTeacherCheck) {
  const name = MANIFEST.find((m) => m.id === n.id)?.name ?? n.id;
  const li = h('li', {}, h('strong', {}, name), `: ${n.reason}`);
  if (n.candidates?.length) {
    for (const c of n.candidates) { const def = data.outcomes[c]; if (def) li.append(h('br'), h('span', { class: 'small' }, `Nearest verified dot point: ${c} ${def.text}`)); }
  }
  ul.append(li);
}
check.append(ul);
main.append(h('h2', {}, 'Syllabus mapping notes'), check);

// ---- sources
main.append(
  h('section', { class: 'item' }, h('h3', {}, 'Where the outcome wording comes from'),
    h('p', { class: 'use' }, 'Codes like "Y8 6.2.2" are the school programme dot-point codes (year, unit, lesson). A green "NESA" tag is the official Science 7–10 (2023) outcome code, shown only where the owner\'s CellScape syllabus map links that dot point to one. Wording is copied word for word.'),
    h('ul', {}, ...data.sources.map((s) => h('li', {}, h('code', {}, s.file), ` ${s.description}`))),
    h('p', { class: 'small' }, '"Direct" means the landmark is a main example of the dot point. "Loose fit" means it supports the dot point but is not the focus, so use your judgement.')),
);
document.title = 'Magnitude: teacher view';
