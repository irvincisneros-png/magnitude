/**
 * Scale maths. One number drives everything: `s` = log10(height of the view in metres).
 * Pure functions only (no Three.js) so they are unit-testable.
 */
export const S_MIN = -35.5;
export const S_MAX = 27.5;
export const FOV_DEG = 45;
export const HUMAN_LOG = Math.log10(1.7);

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clampS = (s: number) => Math.min(S_MAX, Math.max(S_MIN, s));
/** Height of the view in the landmark's local units (characteristic size = 1). */
export const viewHeightLocal = (s: number, sizeMeters: number) => 10 ** (s - Math.log10(sizeMeters));
export const cameraDistance = (s: number, sizeMeters: number, fovDeg = FOV_DEG) =>
  viewHeightLocal(s, sizeMeters) / (2 * Math.tan((fovDeg * Math.PI) / 360));
/** 0..1 presence of a landmark with range [lo, hi]; fades over `fade` decades at each end. */
export const presence = (s: number, [lo, hi]: [number, number], fade = 0.6) =>
  smoothstep(lo, lo + fade, s) * (1 - smoothstep(hi - fade, hi, s));

// ---------------------------------------------------------------- formatting

const SUP: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};
/** Integer → Unicode superscript, e.g. -10 → "⁻¹⁰". */
export const superscript = (n: number) => String(Math.round(n)).split('').map((c) => SUP[c] ?? c).join('');

/** Round to `sig` significant figures and drop trailing zeros (as a number). */
const sigRound = (x: number, sig: number) => (x === 0 ? 0 : Number(x.toPrecision(sig)));

/** Thousands separators without relying on the host locale. */
const group = (x: number) => {
  const [int, frac] = String(x).split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${g}.${frac}` : g;
};

/** 1.5e-10 → "1.5 × 10⁻¹⁰ m" (up to 3 significant figures). */
export const formatSci = (m: number) => {
  if (!(m > 0) || !Number.isFinite(m)) return '0 m';
  let exp = Math.floor(Math.log10(m));
  let mant = sigRound(m / 10 ** exp, 3);
  if (mant >= 10) { mant = sigRound(mant / 10, 3); exp += 1; }
  return mant === 1 ? `10${superscript(exp)} m` : `${mant} × 10${superscript(exp)} m`;
};

const UNITS: [number, string][] = [
  [9.461e15, 'light-years'],
  [1.496e11, 'AU'],
  [1e3, 'km'],
  [1, 'm'],
  [1e-2, 'cm'],
  [1e-3, 'mm'],
  [1e-6, 'µm'],
  [1e-9, 'nm'],
  [1e-12, 'pm'],
  [1e-15, 'fm'],
];
const WORDS: [number, string][] = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

/**
 * Friendly size: 1.5e-10 → "150 pm", 1.27e7 → "12,700 km", 8.8e26 → "93 billion light-years".
 * Below 1 fm there is no everyday unit, so it falls back to scientific notation.
 */
export const formatFriendly = (m: number): string => {
  if (!(m > 0) || !Number.isFinite(m)) return '0 m';
  if (m < 1e-15) return formatSci(m);
  const [unit, name] = UNITS.find(([u]) => m >= u) ?? UNITS[UNITS.length - 1];
  const v = m / unit;
  if (name === 'light-years' && v >= 1e3) {
    const [w, word] = WORDS.find(([u]) => v >= u)!;
    return `${group(sigRound(v / w, v / w >= 100 ? 3 : 2))} ${word} light-years`;
  }
  const r = sigRound(v, v >= 100 ? 3 : 2);
  const label = name === 'light-years' && r === 1 ? 'light-year' : name;
  return `${group(r)} ${label}`;
};

export interface HumanRatio { exponent: number; direction: 'bigger' | 'smaller' | 'same' }
/** How many powers of ten the current view is from a 1.7 m human. */
export const humanRatio = (s: number): HumanRatio => {
  const n = Math.round(s - HUMAN_LOG);
  if (n === 0) return { exponent: 0, direction: 'same' };
  return { exponent: Math.abs(n), direction: n > 0 ? 'bigger' : 'smaller' };
};
