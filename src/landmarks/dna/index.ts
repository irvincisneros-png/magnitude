/**
 * STUB landmark "dna". A landmark agent replaces this file (and may add siblings in this
 * folder plus public/assets/dna/). Contract: src/engine/types.ts. Size/range: manifest.ts.
 */
import type { LandmarkFactory, LandmarkMeta } from '../../engine/types';
import { createStubLandmark } from '../_stub';

const meta: LandmarkMeta = {
  id: "dna",
  name: "DNA double helix",
  sizeMeters: 2e-9,
  range: [-9.6, -6.5],
  evidence: "measured",
  nesting: "true",
  blurb:
    "DNA is a twisted ladder of atoms about 2 nanometres wide. Its order of letters (A, T, C and G) carries the instructions for building you.",
  howWeKnow: {
    instrument: "X-ray crystallography",
    text: "Rosalind Franklin's X-ray images revealed the helix in 1952, and modern crystal structures such as PDB 1BNA locate every atom.",
  },
  lightTime: "About 7 × 10⁻¹⁸ seconds",
  timescale: "Molecular vibrations: about 10⁻¹² s",
  labels: [{ text: "DNA double helix", position: [0, 0.68, 0], zoomRange: [-0.6, 1.4] }],
};

const factory: LandmarkFactory = () => createStubLandmark(meta, { hue: 0.6 });
export default factory;
