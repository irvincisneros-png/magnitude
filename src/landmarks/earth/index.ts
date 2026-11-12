/**
 * STUB landmark "earth". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/earth/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "earth",
  name: "Earth",
  sizeMeters: 1.27e7,
  range: [2.9, 9.4],
  evidence: "measured",
  nesting: "true",
  blurb:
    "Earth is about 12,700 km across. The thin blue layer of air that keeps us alive is only about 1% of its radius.",
  howWeKnow: {
    instrument: "Satellite geodesy",
    text: "Satellites tracked by lasers and radio measure Earth's shape to within centimetres. Eratosthenes first estimated it around 240 BCE using shadows.",
  },
  lightTime: "About 42 milliseconds",
  timescale: "One rotation: 24 hours",
  labels: [{ text: "Earth", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.58 });
export default factory;
