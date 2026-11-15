/**
 * Pure logic for the "SIZE COMPARISON" banner (DOM-free so it can be unit-tested in Node).
 * A landmark whose meta says nesting: 'comparison' shows its next-smaller neighbour as a size
 * comparison, not as something that is really inside it. While the view cross-fades between the
 * pair (the overlap of their s-ranges) the banner is shown, fading in and out with the transition.
 */
import { smoothstep } from '../engine/scale';

export interface ComparisonRow { id: string; range: [number, number] }
export interface ComparisonMeta { nesting: 'true' | 'comparison'; nestingNote?: string; comparisonBanner?: string }
export interface ComparisonState { id: string; alpha: number; text: string }

/** First sentence of a note (up to and including its first full stop followed by a space or the end). */
export const firstSentence = (note: string): string => {
  const m = note.match(/^.*?[.!?](?=\s|$)/s);
  return (m ? m[0] : note).trim();
};

/** The banner sentence for a meta: its comparisonBanner, else the first sentence of nestingNote, else a generic line. */
export const bannerText = (m: ComparisonMeta): string =>
  m.comparisonBanner?.trim() || (m.nestingNote ? firstSentence(m.nestingNote) : 'These objects are shown side by side only to compare sizes.');

/** The s-range where `big` cross-fades with `small` (the next-smaller landmark), or null if they do not overlap. */
export const overlapRange = (big: ComparisonRow, small: ComparisonRow): [number, number] | null => {
  const lo = Math.max(big.range[0], small.range[0]);
  const hi = Math.min(big.range[1], small.range[1]);
  return hi > lo ? [lo, hi] : null;
};

/** Edge fade length (s units) for an overlap of this width. */
const edge = (w: number) => Math.min(0.2, w * 0.25);

/**
 * Banner state at scale s: the pair with the highest visibility, or null when none is visible.
 * `rows` are ordered smallest → largest; `metaOf` returns undefined for a landmark whose meta is not loaded.
 */
export function comparisonAt(s: number, rows: readonly ComparisonRow[], metaOf: (id: string) => ComparisonMeta | undefined): ComparisonState | null {
  let best: ComparisonState | null = null;
  for (let i = 1; i < rows.length; i++) {
    const big = rows[i];
    if (s < big.range[0] || s > big.range[1]) continue;
    const ov = overlapRange(big, rows[i - 1]);
    if (!ov || s < ov[0] || s > ov[1]) continue;
    const meta = metaOf(big.id);
    if (!meta || meta.nesting !== 'comparison') continue;
    const e = edge(ov[1] - ov[0]);
    const alpha = smoothstep(ov[0], ov[0] + e, s) * (1 - smoothstep(ov[1] - e, ov[1], s));
    if (alpha > 0.005 && (!best || alpha > best.alpha)) best = { id: big.id, alpha, text: bannerText(meta) };
  }
  return best;
}
