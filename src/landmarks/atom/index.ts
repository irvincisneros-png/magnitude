/**
 * STUB landmark "atom". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/atom/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "atom",
  name: "Carbon atom",
  sizeMeters: 1.5e-10,
  range: [-13.3, -8.8],
  evidence: "modelled",
  nesting: "true",
  blurb:
    "Electrons do not orbit like planets. They form fuzzy clouds of probability around a nucleus 30,000 times smaller than the atom, so an atom is almost entirely empty space.",
  howWeKnow: {
    instrument: "X-ray crystallography and quantum mechanics",
    text: "X-rays bouncing off crystals measure the spacing between atoms, and quantum mechanics predicts the shapes of electron clouds that match spectroscopy.",
  },
  lightTime: "About 5 × 10⁻¹⁹ seconds",
  timescale: "Electron motion: about 10⁻¹⁷ s (attoseconds)",
  labels: [{ text: "Carbon atom", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.55 });
export default factory;
