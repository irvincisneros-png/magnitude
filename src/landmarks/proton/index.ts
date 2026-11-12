/**
 * STUB landmark "proton". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/proton/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "proton",
  name: "Proton (quarks & gluons)",
  sizeMeters: 1.7e-15,
  range: [-18.5, -14.2],
  evidence: "modelled",
  nesting: "true",
  blurb:
    "A proton is not a solid ball. It is three quarks held together by a storm of gluons, and most of its mass comes from that energy.",
  howWeKnow: {
    instrument: "Particle accelerators (electron scattering)",
    text: "Firing high-energy electrons at protons and measuring how they bounce off reveals the size of the proton and the point-like quarks inside it.",
  },
  lightTime: "About 6 × 10⁻²⁴ seconds",
  timescale: "Quark interactions: about 10⁻²⁴ s",
  labels: [{ text: "Proton (quarks & gluons)", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.02 });
export default factory;
