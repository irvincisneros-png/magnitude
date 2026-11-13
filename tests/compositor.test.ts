import { describe, expect, it } from 'vitest';
import { layerOpacities, layerVisibility } from '../src/engine/compositor';

const full = (n: number, v = 255) => new Uint8Array(n).fill(v);

describe('layerVisibility (half-resolution / skip bound)', () => {
  it('without coverage information every layer may be fully visible (opacity is the bound)', () => {
    const ops = layerOpacities([1, 1, 0.5]);
    expect(layerVisibility(ops, [null, null, null], 4)).toEqual(ops);
  });

  it('an opaque layer on top hides the stack under it in proportion to its opacity', () => {
    const ops = [1, 1, 0.93]; // largest first; the top layer covers every block, the middle one nothing
    const vis = layerVisibility(ops, [null, full(4, 0), full(4)], 4);
    expect(vis[2]).toBeCloseTo(0.93);
    expect(vis[1]).toBeCloseTo(0.07);
    expect(vis[0]).toBeCloseTo(0.07);
  });

  it('a single uncovered block keeps the layer below fully visible', () => {
    const cov = full(4); cov[2] = 0;
    const vis = layerVisibility([1, 1], [null, cov], 4);
    expect(vis[0]).toBe(1);
  });

  it('a fully opaque, fully present top layer leaves nothing of the layers below', () => {
    const vis = layerVisibility([1, 1], [null, full(4)], 4);
    expect(vis[0]).toBe(0);
  });
});
