/**
 * STUB landmark "sun". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/sun/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "sun",
  name: "Sun",
  sizeMeters: 1.39e9,
  range: [8.6, 11.5],
  evidence: "measured",
  nesting: "comparison",
  nestingNote: "Earth is shown beside the Sun for size, not at its true distance of 150 million km.",
  blurb:
    "The Sun is about 109 times wider than Earth: a ball of hot plasma powered by nuclear fusion in its core.",
  howWeKnow: {
    instrument: "Solar telescopes and planetary radar",
    text: "Knowing the Earth–Sun distance from radar, the Sun's angular size in the sky gives its diameter of about 1.39 million km.",
  },
  lightTime: "About 4.6 seconds",
  timescale: "Sunspot cycle: about 11 years",
  labels: [{ text: "Sun", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.09 });
export default factory;
