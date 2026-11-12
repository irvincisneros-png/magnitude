/**
 * STUB landmark "planck". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/planck/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "planck",
  name: "Planck scale",
  sizeMeters: 1.6e-35,
  range: [-35.5, -32.0],
  evidence: "speculative",
  nesting: "true",
  blurb:
    "The Planck length is where our best theories of gravity and quantum physics stop working together. Space itself may be a seething \"quantum foam\" here, but nobody knows.",
  howWeKnow: {
    instrument: "Theory (dimensional analysis)",
    text: "Combining the speed of light, the gravitational constant and Planck's constant gives a length of about 1.6 × 10⁻³⁵ m. No experiment can probe anything close to it.",
  },
  lightTime: "5.4 × 10⁻⁴⁴ seconds (one Planck time)",
  timescale: "Unknown: perhaps a Planck time, 10⁻⁴⁴ s",
  labels: [{ text: "Planck scale", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.78 });
export default factory;
