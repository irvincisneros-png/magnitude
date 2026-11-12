/**
 * Ordered landmark manifest (plan "Fixed tables"). Smallest first.
 * The engine uses these sizes/ranges before a landmark is loaded, so they are authoritative;
 * each landmark's meta must repeat the same numbers.
 */
import type { LandmarkFactory } from '../engine/types';

export interface ManifestRow {
  id: string;
  name: string;
  sizeMeters: number;
  range: [number, number];
  load: () => Promise<{ default: LandmarkFactory }>;
}

export interface DesertRow {
  id: string;
  name: string;
  range: [number, number];
  blurb: string;
}

export const MANIFEST: readonly ManifestRow[] = [
  { id: 'planck', name: 'Planck scale', sizeMeters: 1.6e-35, range: [-35.5, -32.0], load: () => import('./planck/index') },
  { id: 'proton', name: 'Proton', sizeMeters: 1.7e-15, range: [-18.5, -14.2], load: () => import('./proton/index') },
  { id: 'nucleus', name: 'Carbon-12 nucleus', sizeMeters: 5.4e-15, range: [-14.9, -12.5], load: () => import('./nucleus/index') },
  { id: 'atom', name: 'Carbon atom', sizeMeters: 1.5e-10, range: [-13.3, -8.8], load: () => import('./atom/index') },
  { id: 'dna', name: 'DNA double helix', sizeMeters: 2e-9, range: [-9.6, -6.5], load: () => import('./dna/index') },
  { id: 'cell', name: 'Human skin cell', sizeMeters: 3e-5, range: [-7.3, -3.3], load: () => import('./cell/index') },
  { id: 'human', name: 'Human', sizeMeters: 1.7, range: [-4.1, 3.7], load: () => import('./human/index') },
  { id: 'earth', name: 'Earth', sizeMeters: 1.27e7, range: [2.9, 9.4], load: () => import('./earth/index') },
  { id: 'sun', name: 'Sun', sizeMeters: 1.39e9, range: [8.6, 11.5], load: () => import('./sun/index') },
  { id: 'solar-system', name: 'Solar System', sizeMeters: 9e12, range: [10.8, 17.5], load: () => import('./solar-system/index') },
  { id: 'milky-way', name: 'Milky Way', sizeMeters: 1e21, range: [16.8, 22.3], load: () => import('./milky-way/index') },
  { id: 'universe', name: 'Observable universe', sizeMeters: 8.8e26, range: [21.6, 27.5], load: () => import('./universe/index') },
];

/** Declared gaps with no landmark; the engine shows the desert layer here. */
export const DESERTS: readonly DesertRow[] = [
  {
    id: 'desert',
    name: 'The great desert',
    range: [-32.0, -18.5],
    blurb:
      'Between the proton and the Planck length lie about fourteen powers of ten where no experiment has ever found any structure. The emptiness is real: this is the edge of what we know.',
  },
];
