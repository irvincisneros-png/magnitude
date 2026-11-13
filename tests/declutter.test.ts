import { describe, expect, it } from 'vitest';
import { declutter, type DeclutterItem } from '../src/ui/declutter';

const item = (x0: number, y0: number, x1: number, y1: number, wasShown = false): DeclutterItem =>
  ({ box: { x0, y0, x1, y1 }, wasShown, show: false });

describe('declutter', () => {
  it('earlier label wins an overlap', () => {
    const a = item(100, 100, 200, 116), b = item(150, 105, 250, 121), c = item(400, 100, 500, 116);
    declutter([a, b, c], [], 1000, 800);
    expect([a.show, b.show, c.show]).toEqual([true, false, true]);
  });
  it('hides labels inside keep-out rects and outside the viewport', () => {
    const a = item(100, 100, 200, 116), b = item(-20, 300, 60, 316);
    declutter([a, b], [{ x0: 90, y0: 90, x1: 300, y1: 200 }], 1000, 800);
    expect([a.show, b.show]).toEqual([false, false]);
  });
  it('hysteresis: a shown label survives a near-miss that would block a new one', () => {
    const mk = (was: boolean) => [item(100, 100, 200, 116, true), item(100, 120, 200, 136, was)];
    const shown = mk(true), fresh = mk(false);
    declutter(shown, [], 1000, 800);
    declutter(fresh, [], 1000, 800);
    expect(shown[1].show).toBe(true);
    expect(fresh[1].show).toBe(false);
  });
  it('caps visible count', () => {
    const items = [0, 1, 2, 3, 4].map((i) => item(i * 150, 100, i * 150 + 100, 116));
    declutter(items, [], 1000, 800, { maxVisible: 3 });
    expect(items.filter((i) => i.show).length).toBe(3);
  });
});
