/**
 * STUB landmark "milky-way". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/milky-way/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "milky-way",
  name: "Milky Way",
  sizeMeters: 1e21,
  range: [16.8, 22.3],
  evidence: "modelled",
  nesting: "true",
  blurb:
    "Our galaxy is a barred spiral of a few hundred billion stars about 100,000 light-years across. The Sun sits about 26,000 light-years from the centre.",
  howWeKnow: {
    instrument: "Radio telescopes and the Gaia satellite",
    text: "Gaia measures the positions and motions of over a billion stars, and radio maps of hydrogen gas trace the spiral arms we cannot see through the dust.",
  },
  lightTime: "About 100,000 years",
  timescale: "One galactic orbit of the Sun: about 230 million years",
  labels: [{ text: "Milky Way", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.68 });
export default factory;
