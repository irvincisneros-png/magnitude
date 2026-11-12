/**
 * STUB landmark "solar-system". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/solar-system/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "solar-system",
  name: "Solar System",
  sizeMeters: 9e12,
  range: [10.8, 17.5],
  evidence: "measured",
  nesting: "true",
  blurb:
    "The planets orbit the Sun in a nearly flat disc. Neptune's orbit is about 9 billion km across, yet the planets themselves are tiny specks.",
  howWeKnow: {
    instrument: "Radar ranging and spacecraft tracking",
    text: "Bouncing radar off planets and timing signals from spacecraft measures distances across the Solar System very precisely.",
  },
  lightTime: "About 8.3 hours across Neptune's orbit",
  timescale: "Neptune's year: 165 Earth years",
  labels: [{ text: "Solar System", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.12 });
export default factory;
