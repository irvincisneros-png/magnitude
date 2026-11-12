import { describe, expect, it } from 'vitest';
import markers from '../src/data/markers.json';
import missions from '../src/data/missions.json';
import outcomes from '../src/data/outcomes.json';
import tours from '../src/data/tours.json';
import { MANIFEST } from '../src/landmarks/manifest';
import { S_MAX, S_MIN } from '../src/engine/scale';
import {
  C_LIGHT, HoldTracker, StampStore, audioParamsFor, checkAnswer, checkFind, compareLayout, flightSeconds, formatCount, formatDuration,
  lightCrossingSeconds, parseAnswer, pastLightLine, powersSentence, pluralise, ratioSentence, stepAt, stepStart, tourFromHash, tourSeconds,
  type Mission, type StorageLike, type Tour,
} from '../src/ui/feature-logic';

const sizeOf = (id: string) => {
  const l = MANIFEST.find((m) => m.id === id);
  if (l) return { id, name: l.name, sizeMeters: l.sizeMeters };
  const m = (markers as { id: string; name: string; sizeMeters: number }[]).find((x) => x.id === id);
  if (!m) throw new Error(`unknown object ${id}`);
  return { id, name: m.name, sizeMeters: m.sizeMeters };
};

describe('formatDuration', () => {
  it('uses scientific notation below an attosecond', () => {
    expect(formatDuration(5.39e-44)).toBe('5.4 × 10⁻⁴⁴ s');
    expect(formatDuration(1e-43)).toBe('10⁻⁴³ s');
  });
  it('picks sub-second units', () => {
    expect(formatDuration(0.0042)).toBe('4.2 ms');
    expect(formatDuration(5.7e-9)).toBe('5.7 ns');
    expect(formatDuration(3e-15)).toBe('3 fs');
  });
  it('handles seconds up to days', () => {
    expect(formatDuration(1)).toBe('1 s');
    expect(formatDuration(90)).toBe('1.5 min');
    expect(formatDuration(3600)).toBe('1 hour');
    expect(formatDuration(30000)).toBe('8.3 hours');
    expect(formatDuration(86400 * 3)).toBe('3 days');
  });
  it('handles years up to billions', () => {
    expect(formatDuration(31_557_600)).toBe('1 year');
    expect(formatDuration(31_557_600 * 4.2)).toBe('4.2 years');
    expect(formatDuration(31_557_600 * 26000)).toBe('26 thousand years');
    expect(formatDuration(31_557_600 * 2.5e6)).toBe('2.5 million years');
    expect(formatDuration(lightCrossingSeconds(8.8e26))).toBe('93 billion years');
  });
  it('is monotonic in unit order and survives bad input', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(NaN)).toBe('0 s');
    expect(formatDuration(Infinity)).toBe('0 s');
  });
  it('covers the whole scale range with a non-empty string', () => {
    for (let s = S_MIN; s <= S_MAX; s += 0.5) expect(formatDuration(lightCrossingSeconds(10 ** s)).length).toBeGreaterThan(2);
  });
});

describe('light-crossing and the past', () => {
  it('light crosses the Sun in about 4.6 s', () => {
    expect(lightCrossingSeconds(1.39e9)).toBeCloseTo(1.39e9 / C_LIGHT, 6);
    expect(formatDuration(lightCrossingSeconds(1.39e9))).toBe('4.6 s');
  });
  it('shows the past line only above ~10^13 m', () => {
    expect(pastLightLine(1e12)).toBe('');
    expect(pastLightLine(1e13)).toMatch(/^Light from this far away left 9\.3 hours ago/);
    expect(pastLightLine(9.4608e15)).toMatch(/left 1 year ago/);
    expect(pastLightLine(9.46e15)).toMatch(/365 days ago/);
  });
  it('caps at the age of the universe', () => {
    expect(pastLightLine(8.8e26)).toMatch(/13\.8 billion years old/);
  });
});

describe('ratioSentence', () => {
  const earth = sizeOf('earth');
  const sun = sizeOf('sun');
  it('says 109 Earths fit across the Sun, in either argument order', () => {
    expect(ratioSentence(earth, sun)).toBe('About 109 Earths fit across the Sun.');
    expect(ratioSentence(sun, earth)).toBe('About 109 Earths fit across the Sun.');
  });
  it('handles common nouns', () => {
    const rbc = sizeOf('red-blood-cell');
    const hair = sizeOf('human-hair-width');
    expect(ratioSentence(rbc, hair)).toBe('About 10 red blood cells fit across the width of a human hair.');
  });
  it('uses "times as big" for small ratios and for nouns without a safe plural', () => {
    expect(ratioSentence(sizeOf('mars'), sizeOf('earth'))).toBe('Earth is about 1.9 times as big as Mars.');
    expect(ratioSentence(sizeOf('mars'), sizeOf('jupiter'))).toBe('Jupiter is about 21 times as big as Mars.');
  });
  it('reports equal sizes', () => {
    expect(ratioSentence(earth, { name: 'Twin', sizeMeters: earth.sizeMeters })).toMatch(/almost exactly the same size/);
  });
  it('copes with absurd ratios', () => {
    const s = ratioSentence(sizeOf('planck'), sizeOf('universe'));
    expect(s).toMatch(/Planck lengths fit across the observable universe/);
    expect(s).toMatch(/× 10⁶¹/);
  });
  it('states the powers of ten gap', () => {
    expect(powersSentence(earth, sun)).toBe('That is a gap of 2.0 powers of ten (about ×10²).');
    expect(powersSentence(earth, earth)).toBe('No powers of ten between them.');
  });
  it('pluralises and counts', () => {
    expect(pluralise('red blood cell')).toBe('red blood cells');
    expect(pluralise('grain of sand')).toBe('grains of sand');
    expect(pluralise('carbon-12 nucleus')).toBe('carbon-12 nuclei');
    expect(pluralise('mite')).toBe('mites');
    expect(formatCount(109.45)).toBe('109');
    expect(formatCount(3.41)).toBe('3.4');
    expect(formatCount(12_700)).toBe('12,700');
    expect(formatCount(3.1e7)).toBe('31 million');
  });
});

describe('compareLayout', () => {
  it('fits the bigger object at zoom 0 and the smaller at zoom 1', () => {
    const a = compareLayout(1000, 0);
    expect(a.bigR * 2).toBeCloseTo(150, 3);
    expect(a.smallR * 2).toBeCloseTo(0.15, 3);
    expect(a.dot).toBe(true);
    const b = compareLayout(1000, 1);
    expect(b.smallR * 2).toBeCloseTo(110, 3);
    expect(b.dot).toBe(false);
    expect(b.bigR).toBeLessThanOrEqual(3000);
  });
  it('keeps the small object on stage and never overlaps the big one', () => {
    for (const ratio of [1.5, 10, 1e3, 1e9, 1e60]) {
      for (let t = 0; t <= 1; t += 0.1) {
        const L = compareLayout(ratio, t);
        expect(L.smallCx + L.smallR).toBeLessThanOrEqual(320);
        expect(L.bigCx + L.bigR).toBeLessThanOrEqual(L.smallCx - L.smallR + 1e-6);
        expect(Number.isFinite(L.bigCx)).toBe(true);
      }
    }
  });
});

describe('mission checkers', () => {
  it('checkFind is inclusive of the tolerance', () => {
    expect(checkFind(-4.4, { s: -4.4, tolerance: 0.1 })).toBe(true);
    expect(checkFind(-4.31, { s: -4.4, tolerance: 0.1 })).toBe(true);
    expect(checkFind(-4.2, { s: -4.4, tolerance: 0.1 })).toBe(false);
    expect(checkFind(NaN, { s: 0, tolerance: 1 })).toBe(false);
  });
  it('checkAnswer applies a percentage tolerance', () => {
    expect(checkAnswer(109, 109, 5)).toBe(true);
    expect(checkAnswer(104, 109, 5)).toBe(true);
    expect(checkAnswer(103, 109, 5)).toBe(false);
    expect(checkAnswer(116, 109, 5)).toBe(false);
    expect(checkAnswer(0, 109, 5)).toBe(false);
    expect(checkAnswer(NaN, 109, 5)).toBe(false);
  });
  it('parseAnswer understands friendly input', () => {
    expect(parseAnswer('109')).toBe(109);
    expect(parseAnswer(' 1,200 ')).toBe(1200);
    expect(parseAnswer('1.5 million')).toBe(1.5e6);
    expect(parseAnswer('2k')).toBe(2000);
    expect(parseAnswer('1e3')).toBe(1000);
    expect(parseAnswer('3 x 10^4')).toBe(30000);
    expect(parseAnswer('3 × 10^4')).toBe(30000);
    expect(parseAnswer('about a hundred')).toBeNull();
    expect(parseAnswer('')).toBeNull();
  });
  it('HoldTracker needs 1.5 s of continuous time inside and resets when leaving', () => {
    const h = new HoldTracker();
    expect(h.update(true, 1).done).toBe(false);
    expect(h.update(false, 0.1).progress).toBe(0);
    expect(h.update(true, 1).progress).toBeCloseTo(1 / 1.5, 6);
    expect(h.update(true, 0.4).done).toBe(false);
    expect(h.update(true, 0.1).done).toBe(true);
  });
});

describe('StampStore', () => {
  const memory = (): StorageLike & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return {
      data,
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = v; },
      removeItem: (k) => { delete data[k]; },
    };
  };
  it('persists and reloads stamps', () => {
    const m = memory();
    const a = new StampStore(() => m);
    a.add('x'); a.add('y'); a.add('x');
    expect(a.count).toBe(2);
    expect(new StampStore(() => m).list()).toEqual(['x', 'y']);
  });
  it('resets', () => {
    const m = memory();
    const a = new StampStore(() => m);
    a.add('x');
    a.reset();
    expect(a.count).toBe(0);
    expect(new StampStore(() => m).count).toBe(0);
  });
  it('works when storage throws on every access', () => {
    const blocked: StorageLike = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    const a = new StampStore(() => blocked);
    expect(() => a.add('x')).not.toThrow();
    expect(a.has('x')).toBe(true);
    expect(() => a.reset()).not.toThrow();
    expect(a.count).toBe(0);
  });
  it('works when there is no storage at all and survives corrupt data', () => {
    const a = new StampStore(() => null);
    a.add('x');
    expect(a.has('x')).toBe(true);
    const m = memory();
    m.data['magnitude.stamps.v1'] = '{not json';
    expect(new StampStore(() => m).count).toBe(0);
    m.data['magnitude.stamps.v1'] = '[1,"a",null]';
    expect(new StampStore(() => m).list()).toEqual(['a']);
  });
});

describe('missions.json', () => {
  const list = missions as Mission[];
  it('has 8 missions with a mix of types and unique ids', () => {
    expect(list).toHaveLength(8);
    expect(new Set(list.map((m) => m.id)).size).toBe(8);
    expect(new Set(list.map((m) => m.type))).toEqual(new Set(['find', 'compare', 'estimate']));
  });
  it('validates the schema', () => {
    for (const m of list) {
      for (const k of ['id', 'title', 'prompt', 'hint', 'reward'] as const) expect(m[k].trim().length, `${m.id}.${k}`).toBeGreaterThan(0);
      if (m.type === 'find') {
        expect(m.target, m.id).toBeDefined();
        expect(m.target!.s).toBeGreaterThanOrEqual(S_MIN);
        expect(m.target!.s).toBeLessThanOrEqual(S_MAX);
        expect(m.target!.tolerance).toBeGreaterThan(0);
        expect(m.target!.tolerance).toBeLessThanOrEqual(0.6);
      } else {
        expect(m.compare, m.id).toBeDefined();
        expect(m.compare!.tolerancePct).toBeGreaterThan(0);
      }
    }
  });
  it('compare/estimate answers match the real size ratio of the objects', () => {
    for (const m of list.filter((x) => x.compare)) {
      const a = sizeOf(m.compare!.a);
      const b = sizeOf(m.compare!.b);
      const ratio = Math.max(a.sizeMeters, b.sizeMeters) / Math.min(a.sizeMeters, b.sizeMeters);
      expect(checkAnswer(ratio, m.compare!.answer, m.compare!.tolerancePct), `${m.id}: ratio ${ratio}`).toBe(true);
      expect(checkAnswer(m.compare!.answer, ratio, m.compare!.tolerancePct), `${m.id} reverse`).toBe(true);
    }
  });
  it('find targets sit inside a landmark range or the desert', () => {
    const cover = (s: number) => MANIFEST.some((l) => s >= l.range[0] && s <= l.range[1]) || (s >= -32 && s <= -18.5);
    for (const m of list.filter((x) => x.target)) expect(cover(m.target!.s), m.id).toBe(true);
  });
});

describe('tours.json', () => {
  const list = tours as Tour[];
  it('has the three tours', () => {
    expect(list.map((t) => t.id)).toEqual(['whole-journey', 'inside-you', 'our-place']);
  });
  it('has valid steps', () => {
    for (const t of list) {
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(6);
      for (const st of t.steps) {
        expect(st.s).toBeGreaterThanOrEqual(S_MIN);
        expect(st.s).toBeLessThanOrEqual(S_MAX);
        expect(st.seconds).toBeGreaterThanOrEqual(5);
        expect(st.caption.split(/\s+/).length, `${t.id} caption length`).toBeLessThanOrEqual(40);
        expect(st.caption).not.toMatch(/color|metre-s|\bcentre\b.*\bcenter\b/i);
        if (st.pitch !== undefined) expect(Math.abs(st.pitch)).toBeLessThanOrEqual(1.4);
      }
    }
  });
  it('whole journey runs Planck to universe in about 90 s', () => {
    const t = list[0];
    expect(t.steps[0].s).toBeLessThan(-34);
    expect(t.steps[t.steps.length - 1].s).toBeGreaterThan(26);
    expect(tourSeconds(t)).toBeGreaterThanOrEqual(80);
    expect(tourSeconds(t)).toBeLessThanOrEqual(100);
  });
  it('inside-you goes human to quark and our-place goes human to universe', () => {
    const inside = list[1];
    expect(inside.steps[0].s).toBeGreaterThan(0);
    expect(inside.steps[inside.steps.length - 1].s).toBeLessThan(-16);
    const place = list[2];
    expect(place.steps[0].s).toBeGreaterThan(0);
    expect(place.steps[place.steps.length - 1].s).toBeGreaterThan(26);
  });
  it('timing helpers agree', () => {
    const t = list[0];
    expect(stepStart(t, 0)).toBe(0);
    expect(stepStart(t, 2)).toBe(t.steps[0].seconds + t.steps[1].seconds);
    expect(stepAt(t, 0)).toBe(0);
    expect(stepAt(t, t.steps[0].seconds)).toBe(1);
    expect(stepAt(t, 1e6)).toBe(t.steps.length - 1);
    expect(flightSeconds(t.steps[1], 10, true)).toBe(0.3);
    expect(flightSeconds(t.steps[1], 10, false)).toBeLessThanOrEqual(t.steps[1].seconds / 2);
    expect(flightSeconds(t.steps[1], 0, false)).toBeGreaterThanOrEqual(0.6);
    expect(flightSeconds(t.steps[1], 4, false)).toBeLessThan(flightSeconds(t.steps[1], 16, false) + 1e-9);
  });
  it('parses the tour deep link', () => {
    expect(tourFromHash('#s=-9.5&tour=inside-you')).toBe('inside-you');
    expect(tourFromHash('#s=-9.5')).toBeNull();
    expect(tourFromHash('#tour=../x')).toBeNull();
  });
});

describe('audioParamsFor', () => {
  it('is warm at human scale, high and bright when tiny, deep and dark when vast', () => {
    const tiny = audioParamsFor(-35);
    const human = audioParamsFor(Math.log10(1.7));
    const cosmic = audioParamsFor(27);
    expect(human.rootHz).toBeCloseTo(110, 0);
    expect(tiny.rootHz).toBeGreaterThan(human.rootHz * 4);
    expect(cosmic.rootHz).toBeLessThan(human.rootHz / 2);
    expect(tiny.cutoffHz).toBeGreaterThan(human.cutoffHz);
    expect(cosmic.cutoffHz).toBeLessThan(human.cutoffHz);
    expect(cosmic.wet).toBeGreaterThan(human.wet);
    expect(cosmic.feedback).toBeGreaterThan(human.feedback);
    expect(cosmic.feedback).toBeLessThan(0.9);
  });
  it('root pitch falls steadily as s increases and never jumps', () => {
    let prev = audioParamsFor(S_MIN);
    for (let s = S_MIN + 0.05; s <= S_MAX; s += 0.05) {
      const p = audioParamsFor(s);
      expect(p.rootHz).toBeLessThanOrEqual(prev.rootHz + 1e-9);
      expect(Math.abs(Math.log2(p.rootHz / prev.rootHz))).toBeLessThan(0.02);
      expect(Math.abs(p.cutoffHz / prev.cutoffHz - 1)).toBeLessThan(0.05);
      prev = p;
    }
  });
  it('stays in audible, safe ranges everywhere', () => {
    for (let s = S_MIN - 1; s <= S_MAX + 1; s += 0.5) {
      const p = audioParamsFor(s);
      expect(p.rootHz).toBeGreaterThanOrEqual(30);
      expect(p.rootHz).toBeLessThanOrEqual(1200);
      expect(p.noiseGain).toBeLessThan(0.1);
      expect(p.feedback).toBeLessThan(0.9);
    }
  });
});

describe('outcomes.json', () => {
  const o = outcomes as unknown as {
    outcomes: Record<string, { year: number; code: string; text: string; source: string; nesaOutcome: string | null; officialSource: string | null }>;
    landmarks: Record<string, { classroomUse: string; outcomes: { code: string; fit: string }[] }>;
    wholeTool: { outcomes: { code: string }[] };
    needsTeacherCheck: { id: string; reason: string }[];
  };
  it('has an entry for every landmark', () => {
    expect(Object.keys(o.landmarks).sort()).toEqual(MANIFEST.map((m) => m.id).sort());
    for (const v of Object.values(o.landmarks)) expect(v.classroomUse.length).toBeGreaterThan(20);
  });
  it('every referenced outcome exists with wording and a recorded source file', () => {
    const refs = [...Object.values(o.landmarks).flatMap((l) => l.outcomes), ...o.wholeTool.outcomes];
    for (const r of refs) {
      const d = o.outcomes[r.code];
      expect(d, r.code).toBeDefined();
      expect(d.text.trim().length).toBeGreaterThan(10);
      expect(d.source).toMatch(/\.json$/);
      expect(r.code).toBe(`Y${d.year} ${d.code}`);
      if (d.nesaOutcome) {
        expect(d.nesaOutcome).toMatch(/^SC[45]-[A-Z]{3}-\d\d$/);
        expect(d.officialSource).toBeTruthy();
      }
    }
  });
  it('lists every unmapped landmark under needsTeacherCheck, and only those', () => {
    const unmapped = Object.entries(o.landmarks).filter(([, v]) => v.outcomes.length === 0).map(([id]) => id).sort();
    expect(o.needsTeacherCheck.map((n) => n.id).sort()).toEqual(unmapped);
    for (const n of o.needsTeacherCheck) expect(n.reason.length).toBeGreaterThan(20);
  });
});
