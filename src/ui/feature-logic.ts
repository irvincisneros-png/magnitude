/**
 * Pure (DOM-free, shell-free) logic for the feature layer so it can be unit-tested in Node:
 * duration formatting, ratio sentences, mission checkers, tour timing, audio parameter maps and a
 * storage-safe stamp store. The UI modules (compare, timelight, tours, missions, audio…) import from here.
 */
import { HUMAN_LOG, superscript } from '../engine/scale';

// ------------------------------------------------------------------ constants

export const C_LIGHT = 299_792_458; // m/s
export const YEAR_S = 31_557_600; // Julian year in seconds
export const UNIVERSE_AGE_YEARS = 13.8e9;
/** Above this view height (metres) the "you are seeing the past" line appears. */
export const PAST_LIGHT_FROM = 1e13;

const sig = (x: number, n: number) => (x === 0 ? 0 : Number(x.toPrecision(n)));
const group = (x: number) => {
  const [int, frac] = String(x).split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${g}.${frac}` : g;
};
/** 5.4e-44 → "5.4 × 10⁻⁴⁴" */
const sciNumber = (x: number, digits = 2) => {
  let exp = Math.floor(Math.log10(x));
  let mant = sig(x / 10 ** exp, digits);
  if (mant >= 10) { mant = sig(mant / 10, digits); exp += 1; }
  return mant === 1 ? `10${superscript(exp)}` : `${mant} × 10${superscript(exp)}`;
};

// ------------------------------------------------------------------ time & light

/** Seconds light needs to cross `meters`. */
export const lightCrossingSeconds = (meters: number) => meters / C_LIGHT;

const SMALL_UNITS: [number, string][] = [[1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns'], [1e-12, 'ps'], [1e-15, 'fs'], [1e-18, 'as']];

/**
 * Human-readable duration from 10⁻⁴⁴ s up to billions of years.
 * 5.4e-44 → "5.4 × 10⁻⁴⁴ s" · 0.0042 → "4.2 ms" · 500 → "8.3 min" · 3e17 → "9.5 billion years".
 */
export function formatDuration(seconds: number): string {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return '0 s';
  if (seconds < 1e-18) return `${sciNumber(seconds)} s`;
  if (seconds < 1) {
    const [u, name] = SMALL_UNITS.find(([v]) => seconds >= v) ?? SMALL_UNITS[SMALL_UNITS.length - 1];
    return `${sig(seconds / u, 2)} ${name}`;
  }
  const plural = (v: number, one: string, many: string) => `${group(v)} ${v === 1 ? one : many}`;
  if (seconds < 60) return `${sig(seconds, 2)} s`;
  if (seconds < 3600) return `${sig(seconds / 60, 2)} min`;
  if (seconds < 86400) return plural(sig(seconds / 3600, 2), 'hour', 'hours');
  if (seconds < YEAR_S) return plural(sig(seconds / 86400, seconds < 86400 * 100 ? 2 : 3), 'day', 'days');
  const y = seconds / YEAR_S;
  if (y < 1e4) return plural(sig(y, y < 100 ? 2 : 3), 'year', 'years');
  if (y < 1e6) return `${sig(y / 1e3, y < 1e5 ? 2 : 3)} thousand years`;
  if (y < 1e9) return `${sig(y / 1e6, y < 1e8 ? 2 : 3)} million years`;
  if (y < 1e12) return `${sig(y / 1e9, y < 1e11 ? 2 : 3)} billion years`;
  return `${sciNumber(y)} years`;
}

/** The "you are seeing the past" sentence for a view whose far edge is `meters` away; '' below ~10¹³ m. */
export function pastLightLine(meters: number): string {
  if (meters < PAST_LIGHT_FROM) return '';
  const t = lightCrossingSeconds(meters);
  if (t / YEAR_S > UNIVERSE_AGE_YEARS) {
    return 'The universe is only about 13.8 billion years old, so light from beyond this point has not had time to reach us. This is the edge of the visible past.';
  }
  return `Light from this far away left ${formatDuration(t)} ago, so you are seeing the past.`;
}

// ------------------------------------------------------------------ compare

export interface Sized { id?: string; name: string; sizeMeters: number }
export interface RatioParts { big: Sized; small: Sized; ratio: number; powers: number }

export function ratioParts(a: Sized, b: Sized): RatioParts {
  const [big, small] = a.sizeMeters >= b.sizeMeters ? [a, b] : [b, a];
  const ratio = big.sizeMeters / small.sizeMeters;
  return { big, small, ratio, powers: Math.log10(ratio) };
}

/** Objects that are proper nouns (keep their capitals) and whether they take "the". */
const PROPER = new Set([
  'earth', 'sun', 'moon', 'mars', 'jupiter', 'pluto', 'uluru', 'mount-everest', 'betelgeuse', 'sirius-a', 'sirius-b',
  'proxima-centauri', 'orion-nebula', 'omega-centauri', 'large-magellanic-cloud', 'triangulum-galaxy-m33', 'andromeda-galaxy',
  'local-group', 'virgo-supercluster', 'bootes-void', 'laniakea', 'sloan-great-wall', 'hubble-sphere', 'kuiper-belt', 'oort-cloud',
  'milky-way', 'solar-system', 'great-pyramid-of-giza', 'burj-khalifa', 'sydney-harbour-bridge', 'australia-width', 'planck',
]);
const THE = new Set([
  'sun', 'moon', 'milky-way', 'solar-system', 'great-pyramid-of-giza', 'burj-khalifa', 'sydney-harbour-bridge', 'orion-nebula',
  'large-magellanic-cloud', 'triangulum-galaxy-m33', 'andromeda-galaxy', 'local-group', 'virgo-supercluster', 'bootes-void',
  'sloan-great-wall', 'hubble-sphere', 'kuiper-belt', 'oort-cloud', 'australia-width',
]);
/** Proper nouns that pluralise sensibly ("109 Earths"). */
const PROPER_PLURAL = new Set(['earth', 'sun', 'moon', 'jupiter']);
const OVERRIDE: Record<string, { one: string; many: string }> = {
  planck: { one: 'the Planck length', many: 'Planck lengths' },
  human: { one: 'a person', many: 'people' },
  'electron-compton-wavelength': { one: 'the electron Compton wavelength', many: 'electron Compton wavelengths' },
  'astronomical-unit': { one: 'one astronomical unit', many: 'astronomical units' },
  'light-year': { one: 'one light-year', many: 'light-years' },
  'earth-moon-distance': { one: 'the Earth–Moon distance', many: 'Earth–Moon distances' },
  'alpha-centauri-distance': { one: 'the distance to Alpha Centauri', many: 'distances to Alpha Centauri' },
  'australia-width': { one: 'the width of Australia', many: 'Australias' },
  'human-hair-width': { one: 'the width of a human hair', many: 'human hair widths' },
  haemoglobin: { one: 'a haemoglobin molecule', many: 'haemoglobin molecules' },
  'green-light': { one: 'the wavelength of green light', many: 'wavelengths of green light' },
  'hiv-virus': { one: 'an HIV virus particle', many: 'HIV virus particles' },
  'e-coli': { one: 'an E. coli bacterium', many: 'E. coli bacteria' },
  'neutron-star': { one: 'a neutron star', many: 'neutron stars' },
  nucleus: { one: 'the carbon-12 nucleus', many: 'carbon-12 nuclei' },
  'uranium-nucleus': { one: 'a uranium-238 nucleus', many: 'uranium-238 nuclei' },
};

const IRREGULAR: Record<string, string> = { nucleus: 'nuclei', bacterium: 'bacteria', person: 'people' };
function pluraliseWord(w: string): string {
  const lower = w.toLowerCase();
  if (IRREGULAR[lower]) return IRREGULAR[lower];
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}
/** "Red blood cell" → "red blood cells"; "Grain of sand" → "grains of sand". */
export function pluralise(phrase: string): string {
  const m = phrase.match(/^(.*?)( of | to )(.*)$/);
  if (m) return `${pluraliseWord(m[1])}${m[2]}${m[3]}`;
  const i = phrase.lastIndexOf(' ');
  return i < 0 ? pluraliseWord(phrase) : `${phrase.slice(0, i + 1)}${pluraliseWord(phrase.slice(i + 1))}`;
}

const stripParens = (n: string) => n.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
const lowerFirst = (n: string) => (/^[A-Z]{2,}|^[A-Z]\. /.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1));

/** Singular phrase with article ("the Sun", "a red blood cell") and a safe plural, or null when no safe plural exists. */
export function describeObject(o: Sized): { one: string; many: string | null } {
  const id = o.id ?? '';
  if (OVERRIDE[id]) return OVERRIDE[id];
  const name = stripParens(o.name);
  if (/^\d/.test(name)) return { one: name, many: null };
  if (PROPER.has(id)) {
    return { one: `${THE.has(id) ? 'the ' : ''}${name}`, many: PROPER_PLURAL.has(id) ? pluralise(name) : null };
  }
  const base = lowerFirst(name);
  return { one: `the ${base}`, many: pluralise(base) };
}

/** 109.45 → "109", 3.41 → "3.4", 1.2e7 → "12 million", 5e61 → "5 × 10⁶¹". */
export function formatCount(n: number): string {
  if (n >= 1e15) return sciNumber(n, 2);
  if (n >= 1e12) return `${sig(n / 1e12, 2)} trillion`;
  if (n >= 1e9) return `${sig(n / 1e9, 2)} billion`;
  if (n >= 1e6) return `${sig(n / 1e6, 2)} million`;
  return group(sig(n, n < 100 ? 2 : 3));
}

/** "About 109 Earths fit across the Sun." (order of arguments does not matter). */
export function ratioSentence(a: Sized, b: Sized): string {
  const { big, small, ratio } = ratioParts(a, b);
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const B = describeObject(big);
  const S = describeObject(small);
  if (ratio < 1.1) return `${cap(B.one)} and ${S.one} are almost exactly the same size.`;
  if (ratio < 10 || !S.many) {
    return `${cap(B.one)} is about ${formatCount(ratio)} times as big as ${S.one}.`;
  }
  return `About ${formatCount(ratio)} ${S.many} fit across ${B.one}.`;
}

/** "That is a gap of 2.0 powers of ten (about ×10²)." */
export function powersSentence(a: Sized, b: Sized): string {
  const { powers } = ratioParts(a, b);
  if (powers < 0.05) return 'No powers of ten between them.';
  const n = Math.round(powers);
  const tail = n >= 1 ? ` (about ×10${superscript(n)})` : '';
  return `That is a gap of ${powers.toFixed(1)} ${Math.abs(powers - 1) < 0.05 ? 'power' : 'powers'} of ten${tail}.`;
}

/** The object whose size is closest (in powers of ten) to what the view frames at scale `s`. */
export function nearestObject<T extends Sized>(s: number, items: readonly T[]): T | undefined {
  let best: T | undefined;
  let bd = Infinity;
  for (const it of items) {
    const d = Math.abs(Math.log10(it.sizeMeters) + 0.25 - s);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

export interface CompareLayout {
  bigR: number; smallR: number; bigCx: number; smallCx: number; cy: number; dot: boolean;
}
export const CMP_W = 320;
export const CMP_H = 190;
/**
 * Geometry for the compare stage. `t` 0 → the bigger object fits the stage; t 1 → the smaller one is 110 px across
 * (the bigger one is then far off the edge and is drawn as a huge curved edge). Pure so it can be unit-tested.
 */
export function compareLayout(ratio: number, t: number): CompareLayout {
  const gap = 14;
  ratio = Math.max(1, ratio);
  // pixels per big-object-width k: log k interpolates between "big = 150 px" and "small = 110 px"
  const kFit = 150;
  const kSmall = 110 * ratio;
  const lk = Math.log10(kFit) + (Math.log10(kSmall) - Math.log10(kFit)) * Math.min(1, Math.max(0, t));
  const k = 10 ** lk;
  const bigD = k; // big size = 1 unit
  const smallD = k / ratio;
  const cx = (CMP_W + bigD + gap) / 2; // centred composite → small centre
  const smallCx = Math.min(cx, CMP_W - 12 - Math.min(smallD, 120) / 2);
  const smallR = smallD / 2;
  const edge = smallCx - smallR - gap;
  const bigR = Math.min(bigD / 2, 3000);
  return { bigR, smallR, bigCx: edge - bigR, smallCx, cy: CMP_H / 2 - 4, dot: smallD < 3 };
}

// ------------------------------------------------------------------ missions

export interface FindTarget { s: number; tolerance: number }
export interface CompareSpec { a: string; b: string; answer: number; tolerancePct: number }
export interface Mission {
  id: string; title: string; prompt: string; type: 'find' | 'compare' | 'estimate';
  target?: FindTarget; compare?: CompareSpec; hint: string; reward: string;
}

export const HOLD_SECONDS = 1.5;

/** Is the view within tolerance of the mission's target scale? */
export const checkFind = (s: number, t: FindTarget) => Number.isFinite(s) && Math.abs(s - t.s) <= t.tolerance;

/** Is a typed numeric answer within ±tolerancePct of the true answer? */
export const checkAnswer = (value: number, answer: number, tolerancePct: number) =>
  Number.isFinite(value) && value > 0 && Math.abs(value - answer) <= Math.abs(answer) * (tolerancePct / 100);

/** Parses "109", "1,200", "1.2 million", "1e3", "3 x 10^4", "5k". Returns null if no number found. */
export function parseAnswer(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '').replace(/×/g, 'x');
  if (!t) return null;
  const sci = t.match(/^(-?\d*\.?\d+)\s*(?:x|\*)\s*10\s*(?:\^|\*\*)?\s*(-?\d+)/);
  if (sci) return Number(sci[1]) * 10 ** Number(sci[2]);
  const m = t.match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*(k|thousand|million|m|billion|b|trillion)?\b/);
  if (!m) return null;
  let v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, million: 1e6, m: 1e6, billion: 1e9, b: 1e9, trillion: 1e12 };
  if (m[2]) v *= mult[m[2]];
  return v;
}

/** Accumulates "time spent inside tolerance"; leaving resets it. */
export class HoldTracker {
  held = 0;
  constructor(readonly needed = HOLD_SECONDS) {}
  /** Returns progress 0..1; `done` once held for `needed` seconds. */
  update(inside: boolean, dt: number): { progress: number; done: boolean } {
    this.held = inside ? Math.min(this.needed, this.held + Math.max(0, dt)) : 0;
    return { progress: this.held / this.needed, done: this.held >= this.needed };
  }
  reset() { this.held = 0; }
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Stamp collection persisted in storage that may be missing, blocked or full; falls back to memory. */
export class StampStore {
  private ids = new Set<string>();
  constructor(private getStorage: () => StorageLike | null, private key = 'magnitude.stamps.v1') {
    this.ids = new Set(this.read());
  }
  private read(): string[] {
    try {
      const raw = this.getStorage()?.getItem(this.key);
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
  }
  private write() {
    try { this.getStorage()?.setItem(this.key, JSON.stringify([...this.ids])); } catch { /* blocked: stays in memory */ }
  }
  has(id: string) { return this.ids.has(id); }
  add(id: string) { if (!this.ids.has(id)) { this.ids.add(id); this.write(); } }
  reset() {
    this.ids.clear();
    try { this.getStorage()?.removeItem(this.key); } catch { /* blocked */ }
  }
  get count() { return this.ids.size; }
  list() { return [...this.ids]; }
}

/** localStorage accessor that never throws. */
export function safeLocalStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Guarded reads/writes: every access in try/catch so a blocked or full store never breaks the UI. */
export function lsGet(key: string): string | null {
  try { return safeLocalStorage()?.getItem(key) ?? null; } catch { return null; }
}
export function lsSet(key: string, value: string) {
  try { safeLocalStorage()?.setItem(key, value); } catch { /* blocked */ }
}

// ------------------------------------------------------------------ tours

export interface TourStep { s: number; yaw?: number; pitch?: number; seconds: number; caption: string }
export interface Tour { id: string; title: string; summary: string; steps: TourStep[] }

export const tourSeconds = (t: Tour) => t.steps.reduce((a, s) => a + s.seconds, 0);
/** Seconds into the tour at which step `i` starts. */
export const stepStart = (t: Tour, i: number) => t.steps.slice(0, i).reduce((a, s) => a + s.seconds, 0);
/** Index of the step playing at `elapsed` seconds (clamped). */
export function stepAt(t: Tour, elapsed: number): number {
  let acc = 0;
  for (let i = 0; i < t.steps.length; i++) {
    acc += t.steps[i].seconds;
    if (elapsed < acc) return i;
  }
  return t.steps.length - 1;
}
/**
 * Seconds a step spends flying (the rest is time to read the caption). Scales with the distance in decades, never more
 * than half the step, and is near-instant under reduced motion.
 */
export const flightSeconds = (step: TourStep, decades: number, reduced: boolean) =>
  reduced ? 0.3 : Math.max(0.6, Math.min(step.seconds * 0.5, 0.6 + 0.55 * Math.sqrt(Math.abs(decades))));
/** The caption of the destination appears once this fraction of the flight is done. */
export const CAPTION_AT = 0.65;

/** Tour id from a hash like "#s=-9.5&tour=inside-you". */
export function tourFromHash(hash: string): string | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get('tour');
  return v && /^[a-z0-9-]+$/i.test(v) ? v : null;
}

// ------------------------------------------------------------------ audio parameter map

export interface AudioParams {
  /** Root pitch of the pad in Hz. */
  rootHz: number;
  /** Low-pass cut-off of the pad (brightness). */
  cutoffHz: number;
  /** Band-pass centre of the noise bed and its level (texture). */
  noiseHz: number;
  noiseGain: number;
  /** Echo feedback (size of the space) and wet level. */
  feedback: number;
  wet: number;
}

/** Interpolates tiny → human → cosmic across d = s − log10(1.7 m); `logMode` interpolates in the log domain. */
function lerp3(d: number, tiny: number, mid: number, big: number, logMode: boolean): number {
  const f = logMode ? Math.log : (x: number) => x;
  const g = logMode ? Math.exp : (x: number) => x;
  const dTiny = -35.7;
  const dBig = 27.3;
  if (d <= 0) {
    const u = Math.min(1, d / dTiny);
    return g(f(mid) + (f(tiny) - f(mid)) * u);
  }
  const u = Math.min(1, d / dBig);
  return g(f(mid) + (f(big) - f(mid)) * u);
}

/**
 * How the soundscape follows `s`: tiny scales airy, high and glassy; human scale warm; cosmic scales deep and vast.
 * Continuous in s (no jumps), so smoothing the parameters over time sounds like one flowing piece.
 */
export function audioParamsFor(s: number): AudioParams {
  const d = Math.max(-36, Math.min(28, s)) - HUMAN_LOG;
  return {
    rootHz: lerp3(d, 1100, 110, 34, true),
    cutoffHz: lerp3(d, 5200, 1300, 360, true),
    noiseHz: lerp3(d, 6500, 900, 110, true),
    noiseGain: lerp3(d, 0.05, 0.012, 0.055, false),
    feedback: lerp3(d, 0.42, 0.5, 0.68, false),
    wet: lerp3(d, 0.34, 0.3, 0.6, false),
  };
}
