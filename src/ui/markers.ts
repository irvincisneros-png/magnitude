/**
 * Ruler markers from src/data/markers.json (owned by the data task). Loaded through
 * import.meta.glob so a missing file simply yields no markers; entries are validated
 * so one bad row never breaks the UI.
 */
import type { Evidence } from '../engine/types';

export interface Marker {
  id: string;
  name: string;
  sizeMeters: number;
  category: string;
  evidence: Evidence;
  blurb: string;
  howWeKnow: { instrument: string; text: string };
}

const files = import.meta.glob<unknown>('../data/markers.json', { eager: true, import: 'default' });

const isMarker = (m: unknown): m is Marker => {
  const r = m as Record<string, unknown> | null;
  return !!r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.sizeMeters === 'number' && r.sizeMeters > 0;
};

export const MARKERS: readonly Marker[] = (() => {
  const raw = Object.values(files)[0];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isMarker).map((m) => ({
    ...m,
    category: m.category ?? 'other',
    evidence: (['measured', 'modelled', 'speculative'] as const).includes(m.evidence) ? m.evidence : 'measured',
    blurb: m.blurb ?? '',
    howWeKnow: m.howWeKnow ?? { instrument: '', text: '' },
  }));
})();
