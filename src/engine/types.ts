/**
 * MAGNITUDE — LANDMARK CONTRACT (final for slice 1; spec §5).
 *
 * A landmark is one self-contained Three.js scene living in
 *   src/landmarks/<id>/index.ts   — default-exports a `LandmarkFactory`
 *   src/landmarks/<id>/*          — optional sibling modules / shaders
 *   public/assets/<id>/*          — optional assets, fetched via ctx.assetUrl('file.jpg')
 * Swapping a stub for a real scene means replacing ONLY those files. Nothing else in the
 * engine needs to change.
 *
 * Units & frame
 * - Author in LOCAL units where the landmark's characteristic size (meta.sizeMeters) = 1 unit.
 * - The local origin is the ANCHOR: where the next-smaller landmark sits, and the point the
 *   camera orbits. +Y is up. Keep all geometry within sensible float ranges (~1e-6 … 1e4 units).
 * - The engine owns the camera (one per layer). It orbits the origin with a shared yaw/pitch
 *   at distance = cameraDistance(s, sizeMeters); near = distance/200, far = distance·2000 + 50.
 *   Do not move the camera; read it from FrameState if you need view-dependent effects.
 *
 * Rendering
 * - The engine renders `scene` into its own linear HDR render target (transparent clear,
 *   alpha = coverage) and composites layers largest-first, fading them by presence.
 *   Do NOT implement whole-scene fading yourself, call renderer.render, change render targets,
 *   or set tone mapping. Leave `scene.background` null unless your scene is meant to be fully
 *   opaque (it will then hide bigger layers behind it while present).
 * - Output linear colour; tone mapping (ACES), exposure, bloom, vignette and grain are applied
 *   by the engine (see `post` hints). Bright values > 1 will bloom on medium/high.
 * - A parent may draw its own proxy of the child at the origin (e.g. a glowing Sun) so the
 *   hand-over is seamless.
 *
 * Lifecycle
 *   factory() → init(ctx) once (await assets here) → update(frame) every frame while present
 *   → setQuality(q) whenever the tier changes → dispose() when it scrolls ±2 neighbours away.
 *   dispose() must free every geometry, material, texture and render target you created.
 */
import type * as THREE from 'three';

/** Rendering tier. low: DPR ≤ 1, no bloom, reduced counts. medium: bloom, DPR ≤ 1.5. high: everything, DPR ≤ 2. */
export type Quality = 'low' | 'medium' | 'high';
/** Honesty badge shown on the info card. */
export type Evidence = 'measured' | 'modelled' | 'speculative';

export interface LandmarkLabel {
  text: string;
  /** Position in the landmark's LOCAL units. */
  position: [number, number, number];
  /**
   * Optional visibility window in ZOOM units (FrameState.zoom = s − log10(sizeMeters)):
   * the label shows only while zoom is inside [lo, hi]. zoom 0 = the landmark fills the view height.
   * Omitted → visible whenever the landmark is substantially present.
   */
  zoomRange?: [number, number];
}

export interface LandmarkMeta {
  id: string;                    // must equal the folder name and the manifest id
  name: string;
  sizeMeters: number;            // characteristic size (1 local unit). MUST equal the manifest table.
  range: [number, number];       // s-range in which the scene is present. MUST equal the manifest table.
  evidence: Evidence;
  nesting: 'true' | 'comparison';// how the next-smaller landmark sits inside this one
  nestingNote?: string;          // shown when 'comparison'
  blurb: string;                 // 1–2 sentences, Year 7–10 reading level
  howWeKnow: { instrument: string; text: string };
  lightTime: string;             // light-crossing time, human readable
  timescale: string;             // typical event timescale at this size
  /** Post-processing hints, interpolated by presence across layers. bloom: strength (default 0.4; bright pixels above ~0.9 luminance bloom), exposure: multiplier (default 1). */
  post?: { bloom?: number; exposure?: number };
  labels?: LandmarkLabel[];
}

export interface FrameState {
  s: number; zoom: number;       // zoom = s − log10(sizeMeters)
  presence: number; time: number; dt: number; // presence 0..1 (engine fades for you); time & dt in seconds
  camera: THREE.PerspectiveCamera; quality: Quality;
}

export interface InitContext {
  renderer: THREE.WebGLRenderer; // for PMREM, texture uploads, compile — never for rendering
  quality: Quality;
  /** Resolves a file in public/assets/<id>/ to a URL that works on GitHub Pages. */
  assetUrl(path: string): string;
}

export interface Landmark {
  meta: LandmarkMeta;
  scene: THREE.Scene;
  init(ctx: InitContext): Promise<void>;
  update(frame: FrameState): void;
  setQuality(q: Quality): void;
  dispose(): void;
}

/** What every src/landmarks/<id>/index.ts default-exports. Called once per load (after a dispose, a fresh instance is made). */
export type LandmarkFactory = () => Landmark;
