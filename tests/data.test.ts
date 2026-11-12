import { describe, it, expect } from 'vitest';
import markers from '../src/data/markers.json';

interface Marker {
  id: string;
  name: string;
  sizeMeters: number;
  category: string;
  evidence: string;
  blurb: string;
  howWeKnow: {
    instrument: string;
    text: string;
  };
}

const CATEGORIES = new Set([
  'quantum',
  'atomic',
  'molecular',
  'biological',
  'human',
  'planetary',
  'stellar',
  'galactic',
  'cosmic',
]);

const EVIDENCE = new Set(['measured', 'modelled', 'speculative']);

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const data = markers as Marker[];

describe('markers.json', () => {
  it('is an array of at least 50 markers', () => {
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(50);
  });

  it('has unique ids that are kebab-case', () => {
    const ids = data.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `id "${id}" is not kebab-case`).toMatch(KEBAB_CASE);
    }
  });

  it('is sorted ascending by sizeMeters', () => {
    for (let i = 1; i < data.length; i++) {
      expect(
        data[i].sizeMeters,
        `"${data[i].id}" should not come before "${data[i - 1].id}"`,
      ).toBeGreaterThanOrEqual(data[i - 1].sizeMeters);
    }
  });

  it('has only positive, finite sizeMeters values', () => {
    for (const m of data) {
      expect(typeof m.sizeMeters, `${m.id} sizeMeters type`).toBe('number');
      expect(Number.isFinite(m.sizeMeters), `${m.id} sizeMeters finite`).toBe(true);
      expect(m.sizeMeters, `${m.id} sizeMeters positive`).toBeGreaterThan(0);
    }
  });

  it('uses only allowed category values', () => {
    for (const m of data) {
      expect(CATEGORIES.has(m.category), `${m.id} category "${m.category}"`).toBe(true);
    }
  });

  it('uses only allowed evidence values', () => {
    for (const m of data) {
      expect(EVIDENCE.has(m.evidence), `${m.id} evidence "${m.evidence}"`).toBe(true);
    }
  });

  it('has non-empty blurb, instrument and text strings', () => {
    for (const m of data) {
      expect(typeof m.blurb, `${m.id} blurb`).toBe('string');
      expect(m.blurb.trim().length, `${m.id} blurb empty`).toBeGreaterThan(0);
      expect(typeof m.howWeKnow.instrument, `${m.id} instrument`).toBe('string');
      expect(m.howWeKnow.instrument.trim().length, `${m.id} instrument empty`).toBeGreaterThan(0);
      expect(typeof m.howWeKnow.text, `${m.id} howWeKnow.text`).toBe('string');
      expect(m.howWeKnow.text.trim().length, `${m.id} howWeKnow.text empty`).toBeGreaterThan(0);
    }
  });

  it('keeps each blurb to 30 words or fewer', () => {
    for (const m of data) {
      const words = m.blurb.trim().split(/\s+/).length;
      expect(words, `${m.id} blurb has ${words} words`).toBeLessThanOrEqual(30);
    }
  });
});
