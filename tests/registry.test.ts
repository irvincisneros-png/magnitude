import { describe, expect, it } from 'vitest';
import { DESERTS, MANIFEST } from '../src/landmarks/manifest';
import { desertPresence, focusSpan, layerPresence, windowFor } from '../src/engine/registry';
import { S_MAX, S_MIN } from '../src/engine/scale';

const EPS = 1e-9;
const inDesert = (lo: number, hi: number) => DESERTS.some((d) => d.range[0] <= lo + EPS && d.range[1] >= hi - EPS);

describe('manifest', () => {
  it('has 20 landmarks with unique ids in ascending size order', () => {
    expect(MANIFEST).toHaveLength(20);
    expect(new Set(MANIFEST.map((r) => r.id)).size).toBe(20);
    for (let i = 1; i < MANIFEST.length; i++) {
      expect(MANIFEST[i].sizeMeters).toBeGreaterThan(MANIFEST[i - 1].sizeMeters);
      expect(MANIFEST[i].range[0]).toBeGreaterThan(MANIFEST[i - 1].range[0]);
    }
  });

  it('spans the whole scale range', () => {
    expect(MANIFEST[0].range[0]).toBe(S_MIN);
    expect(MANIFEST[MANIFEST.length - 1].range[1]).toBe(S_MAX);
  });

  it('neighbours overlap by at least 0.7 decades, except across a declared desert', () => {
    for (let i = 1; i < MANIFEST.length; i++) {
      const prevHi = MANIFEST[i - 1].range[1];
      const lo = MANIFEST[i].range[0];
      if (inDesert(prevHi, lo)) continue;
      expect(prevHi - lo, `${MANIFEST[i - 1].id} → ${MANIFEST[i].id}`).toBeGreaterThanOrEqual(0.7 - EPS);
    }
  });

  it('covers every s in [S_MIN, S_MAX] (0.1 steps) with a landmark or a desert', () => {
    for (let k = 0; k <= Math.round((S_MAX - S_MIN) * 10); k++) {
      const s = S_MIN + k / 10;
      const covered =
        MANIFEST.some((r) => s >= r.range[0] - EPS && s <= r.range[1] + EPS) ||
        DESERTS.some((d) => s >= d.range[0] - EPS && s <= d.range[1] + EPS);
      expect(covered, `s=${s.toFixed(1)}`).toBe(true);
    }
  });

  it('never fades to nothing: total presence (landmarks + desert) stays high everywhere', () => {
    for (let k = 0; k <= Math.round((S_MAX - S_MIN) * 20); k++) {
      const s = S_MIN + k / 20;
      const total = MANIFEST.reduce((a, _r, i) => a + layerPresence(i, s, MANIFEST), 0) + DESERTS.reduce((a, d) => a + desertPresence(s, d), 0);
      expect(total, `s=${s}`).toBeGreaterThan(0.49);
    }
  });
});

describe('registry window', () => {
  it('keeps active ±1 and retains active ±2', () => {
    const s = Math.log10(1.7); // human only
    const [a, b] = focusSpan(s, MANIFEST);
    expect(MANIFEST[a].id).toBe('human');
    expect(b).toBe(a);
    const { keep, retain } = windowFor(s, MANIFEST);
    expect(keep.map((i) => MANIFEST[i].id)).toEqual(['ant', 'human', 'earth']);
    expect(retain.map((i) => MANIFEST[i].id)).toEqual(['sand-grain', 'ant', 'human', 'earth', 'earth-moon']);
  });

  it('inside the desert, focuses the landmarks either side of the gap', () => {
    const [a, b] = focusSpan(-25, MANIFEST);
    expect([MANIFEST[a].id, MANIFEST[b].id]).toEqual(['planck', 'proton']);
  });

  it('clamps at the ends', () => {
    expect(windowFor(S_MIN, MANIFEST).keep.map((i) => MANIFEST[i].id)).toEqual(['planck', 'proton']);
    expect(windowFor(S_MAX, MANIFEST).keep.map((i) => MANIFEST[i].id)).toEqual(['milky-way', 'universe']);
  });

  it('outermost landmarks stay fully present at the ends of the scale', () => {
    expect(layerPresence(0, S_MIN, MANIFEST)).toBe(1);
    expect(layerPresence(MANIFEST.length - 1, S_MAX, MANIFEST)).toBe(1);
  });
});
