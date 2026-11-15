import { describe, expect, it } from 'vitest';
import { bannerText, comparisonAt, firstSentence, overlapRange, type ComparisonMeta, type ComparisonRow } from '../src/ui/comparison-logic';

const rows: ComparisonRow[] = [
  { id: 'e-coli', range: [-6.6, -4.4] },
  { id: 'cell', range: [-5.3, -3.3] },
  { id: 'sand-grain', range: [-4.5, -2.3] },
];
const metas: Record<string, ComparisonMeta> = {
  'e-coli': { nesting: 'true' },
  cell: { nesting: 'comparison', nestingNote: 'Not inside your cells. Second sentence.', comparisonBanner: 'Banner.' },
  'sand-grain': { nesting: 'true' },
};
const at = (s: number) => comparisonAt(s, rows, (id) => metas[id]);

describe('comparison banner logic', () => {
  it('finds the overlap of a pair', () => {
    expect(overlapRange(rows[1], rows[0])).toEqual([-5.3, -4.4]);
    expect(overlapRange({ id: 'a', range: [0, 1] }, { id: 'b', range: [2, 3] })).toBeNull();
  });
  it('shows only inside the cross-fade of a comparison landmark', () => {
    expect(at(-6)).toBeNull();
    expect(at(-3.9)).toBeNull();
    expect(at(-4.85)?.id).toBe('cell');
    expect(at(-4.85)?.alpha).toBeCloseTo(1, 5);
  });
  it('fades in and out at the edges', () => {
    expect(at(-5.29)!.alpha).toBeLessThan(0.1);
    expect(at(-4.41)!.alpha).toBeLessThan(0.1);
    expect(at(-5.2)!.alpha).toBeGreaterThan(at(-5.29)!.alpha);
  });
  it('ignores landmarks whose nesting is true or whose meta is not loaded', () => {
    expect(comparisonAt(-4.85, rows, () => ({ nesting: 'true' }))).toBeNull();
    expect(comparisonAt(-4.85, rows, () => undefined)).toBeNull();
  });
  it('picks comparisonBanner, else first sentence of the note', () => {
    expect(at(-4.85)?.text).toBe('Banner.');
    expect(bannerText({ nesting: 'comparison', nestingNote: 'First one. Second one.' })).toBe('First one.');
    expect(firstSentence('No full stop')).toBe('No full stop');
  });
});
