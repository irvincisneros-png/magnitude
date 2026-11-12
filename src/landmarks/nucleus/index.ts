/**
 * STUB landmark "nucleus". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/nucleus/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "nucleus",
  name: "Carbon-12 nucleus",
  sizeMeters: 5.4e-15,
  range: [-14.9, -12.5],
  evidence: "measured",
  nesting: "true",
  blurb:
    "Six protons and six neutrons pressed tightly together by the strong force. The nucleus holds almost all of an atom's mass in a tiny space.",
  howWeKnow: {
    instrument: "Electron scattering and nuclear physics experiments",
    text: "Scattering experiments measure the charge radius of carbon-12 at about 2.5 fm, so the whole nucleus is roughly 5 fm across.",
  },
  lightTime: "About 2 × 10⁻²³ seconds",
  timescale: "Nuclear vibrations: about 10⁻²² s",
  labels: [{ text: "Carbon-12 nucleus", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.06 });
export default factory;
