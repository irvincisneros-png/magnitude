import { describe, expect, it } from 'vitest';
import { cardKey, metaToCard } from '../src/ui/infocard';
import type { LandmarkMeta } from '../src/engine/types';

const meta: LandmarkMeta = {
  id: 'cell', name: 'Cell', sizeMeters: 1e-5, range: [-7, -3], evidence: 'measured', nesting: 'true',
  blurb: 'A cell.', howWeKnow: { instrument: 'Microscope', text: 'We look.' }, lightTime: '', timescale: '',
};

describe('cardKey', () => {
  it('differs between the Loading placeholder and the real meta of the same landmark', () => {
    const placeholder = { id: 'cell', name: 'Cell', sizeMeters: 1e-5, blurb: 'Loading…' };
    expect(cardKey(metaToCard(meta))).not.toBe(cardKey(placeholder));
  });
  it('is stable for identical content', () => {
    expect(cardKey(metaToCard(meta, '01 / 02'))).toBe(cardKey(metaToCard(meta, '01 / 02')));
  });
});
