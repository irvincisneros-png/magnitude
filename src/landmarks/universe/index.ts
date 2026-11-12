/**
 * STUB landmark "universe". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/universe/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "universe",
  name: "Cosmic web → observable universe",
  sizeMeters: 8.8e26,
  range: [21.6, 27.5],
  evidence: "modelled",
  nesting: "true",
  blurb:
    "Galaxies gather into filaments around enormous empty voids. The observable universe is about 93 billion light-years across, and we are at the centre of our own view of it.",
  howWeKnow: {
    instrument: "Galaxy redshift surveys and the cosmic microwave background",
    text: "Surveys measure the distances to millions of galaxies, and satellites such as Planck map the oldest light in the universe at the edge of what we can see.",
  },
  lightTime: "About 93 billion years to cross today (the universe is only 13.8 billion years old)",
  timescale: "Galaxy clusters form over billions of years",
  labels: [{ text: "Cosmic web → observable universe", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.74 });
export default factory;
