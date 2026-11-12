/**
 * STUB landmark "human". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/human/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "human",
  name: "Human",
  sizeMeters: 1.7,
  range: [-4.1, 3.7],
  evidence: "measured",
  nesting: "true",
  blurb:
    "You are about 1.7 metres tall. Every other scale in Magnitude is measured against you.",
  howWeKnow: {
    instrument: "A tape measure",
    text: "Some things are easy to measure directly. Everything smaller or larger is compared, step by step, back to sizes like this.",
  },
  lightTime: "About 6 nanoseconds",
  timescale: "A heartbeat: about 1 second",
  labels: [{ text: "Human", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.08 });
export default factory;
