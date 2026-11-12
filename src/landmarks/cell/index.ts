/**
 * STUB landmark "cell". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/cell/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "cell",
  name: "Human skin cell",
  sizeMeters: 3e-5,
  range: [-7.3, -3.3],
  evidence: "measured",
  nesting: "true",
  blurb:
    "A single skin cell is about 30 micrometres across and packed with organelles, proteins and the nucleus that stores your DNA.",
  howWeKnow: {
    instrument: "Light and electron microscopes",
    text: "Light microscopes show cells and their nuclei; electron microscopes reveal organelles and membranes down to a few nanometres.",
  },
  lightTime: "About 10⁻¹³ seconds (100 femtoseconds)",
  timescale: "Cell division: about 24 hours",
  labels: [{ text: "Human skin cell", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.92 });
export default factory;
