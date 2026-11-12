# Magnitude — design spec

Date: 2026-11-13. Status: approved by owner. Working title "Magnitude".

## 1. What it is

An interactive, seamless 3D zoom through every scale of the universe, from the Planck length (10^-35 m) to the observable universe (10^27 m). Portfolio-grade showpiece that also works in a classroom (NSW Science 7–10 teacher layer). Visual bar: polished, real-looking 3D (molecular-animation / planetarium quality), never plain primitives or flat colours. No AI-generated image art.

## 2. Decisions from the owner interview

- Audience: showpiece + classroom.
- Navigation: one continuous zoom with hand-built landmark scenes; a log-scale ruler to jump anywhere.
- Devices: must run smoothly on school laptops and phones (low tier); scales up to full post-processing on good GPUs.
- Extras: compare tray, "How do we know?", guided tours + missions, time & light layer.
- Release: vertical slice of 12 hero landmarks first, later passes to ~40.
- Assets: authored/procedural 3D driven by real open data where it exists.
- Audio: generative ambient score + UI sounds, muted by default; tours are captions (no voice).
- Publishing: new public repo `irvincisneros-png/magnitude` on GitHub Pages — only after owner confirms.

## 3. Stack

Vite + TypeScript + Three.js (WebGL2). Vanilla DOM for UI (no framework). Vitest for unit tests. Static build with `base: './'` so it works on GitHub Pages at a subpath. Dev server on port 8520 (`npm run dev -- --port 8520 --strictPort`).

## 4. Core model

One number drives everything: **`s` = log10 of the height of the view in metres**. Range −35.5 … 27.5.

Each **landmark** is a self-contained Three.js scene authored in **local units where its characteristic size = 1 unit**, with **the local origin as its anchor**: the point where the next-smaller landmark sits, and the point the camera orbits. The child's frame is identity at the origin with +Y up (e.g. the Earth scene puts Wollongong, NSW at the origin with local "up" = +Y and the Earth's centre 0.5 units below).

The engine keeps one shared orbit orientation (yaw/pitch) and, for each active layer, a camera at distance

```
viewHeightLocal = 10^(s − logSize)
distance        = viewHeightLocal / (2·tan(fov/2))
near/far        = scaled to distance (per layer)
```

Active layers are drawn largest first, depth cleared between layers, so the smaller scene appears as a shrinking object at the centre of the bigger one. This avoids all floating-point problems: no scene ever holds numbers far from 1.

Each landmark has a presence range in `s`; the engine computes `presence` 0…1 (smoothstep fades ~0.5 decade wide) and composites layers with it. Landmarks do not need to implement opacity themselves. A parent may draw its own proxy of the child at the origin (e.g. the solar-system scene draws a glowing Sun) so the hand-over is seamless.

Where no landmark is present (e.g. the ~20 orders between the proton and the Planck length), the engine shows a **desert** layer: a subtle drifting void with a counter ("nothing known for the next N powers of ten"). The emptiness is content.

`nesting: 'true' | 'comparison'` records honesty: the Sun scene shows Earth beside it for size, not at true distance, and the info card says so.

## 5. Landmark contract

```ts
type Quality = 'low' | 'medium' | 'high';
type Evidence = 'measured' | 'modelled' | 'speculative';

interface LandmarkMeta {
  id: string;
  name: string;
  sizeMeters: number;            // characteristic size (1 local unit)
  range: [number, number];       // s-range in which the scene is present
  evidence: Evidence;
  nesting: 'true' | 'comparison';// how the next-smaller landmark sits inside this one
  nestingNote?: string;          // shown when 'comparison'
  blurb: string;                 // 1–2 sentences, Year 7–10 reading level
  howWeKnow: { instrument: string; text: string };
  lightTime: string;             // light-crossing time, human readable
  timescale: string;             // typical event timescale at this size
  post?: { bloom?: number; exposure?: number };
  labels?: { text: string; position: [number, number, number]; zoomRange?: [number, number] }[];
}

interface FrameState {
  s: number; zoom: number;       // zoom = s − log10(sizeMeters)
  presence: number; time: number; dt: number;
  camera: THREE.PerspectiveCamera; quality: Quality;
}

interface Landmark {
  meta: LandmarkMeta;
  scene: THREE.Scene;
  init(ctx: { renderer: THREE.WebGLRenderer; quality: Quality; assetUrl(path: string): string }): Promise<void>;
  update(frame: FrameState): void;
  setQuality(q: Quality): void;
  dispose(): void;
}
```

One folder per landmark: `src/landmarks/<id>/index.ts` default-exporting a factory `() => Landmark`. Lazy-loaded; the engine keeps the active landmarks ±1 neighbour in memory and disposes the rest. Landmark assets live in `public/assets/<id>/`.

## 6. The 12 hero landmarks

| id | Name | Size (m) | Evidence | Scene notes |
|---|---|---|---|---|
| planck | Planck scale | 1.6e-35 | speculative | Quantum-foam impression; clearly flagged as artistic/speculative |
| proton | Proton (quarks & gluons) | 1.7e-15 | modelled | Three valence quarks in a seething gluon field; quarks < 1e-18 m |
| nucleus | Carbon-12 nucleus | 5.4e-15 | measured | 6 protons + 6 neutrons, jostling; proton nests truly |
| atom | Carbon atom | 1.5e-10 | modelled | Probability-cloud orbitals (not Bohr orbits); vast emptiness down to nucleus |
| dna | DNA double helix | 2e-9 (width) | measured | Real B-DNA atom coordinates (PDB 1BNA) with a crowded nucleoplasm feel |
| cell | Human skin cell | 3e-5 | measured | CellScape-quality interior: organelles, crowding, translucency |
| human | Human | 1.7 | measured | Stylised but refined figure standing on a headland; skin detail hands over to the cell |
| earth | Earth | 1.27e7 | measured | NASA Blue Marble day/night/clouds, atmosphere scattering; Wollongong at the origin |
| sun | Sun | 1.39e9 | measured | Animated granulation, corona, prominences; Earth beside it (comparison) |
| solar-system | Solar System | 9e12 (Neptune's orbit) | measured | True orbits, planets as visible markers, Kuiper belt; Sun at origin |
| milky-way | Milky Way | 1e21 | modelled | Particle-based barred spiral with dust lanes; Sun's position at origin, 26,000 ly from the centre |
| universe | Cosmic web → observable universe | 8.8e26 | measured/modelled | Filaments and voids of galaxies, ending at the CMB shell; we are at the centre of *our observable* universe |

Objects without a scene (virus, red blood cell, Moon, Jupiter, nebula, Andromeda, …) are **ruler markers** from `src/data/markers.json` until later passes.

## 7. UI

- **Log ruler** (right edge / bottom on phones): the full −35…27 range, landmark and marker ticks, drag or click to travel (animated, eased in `s`).
- **Info card**: name, size in metres and friendly units, blurb, evidence badge (Measured / Modelled / Speculative), "How do we know?" (instrument + text), nesting note when applicable.
- **Human anchor**: always-visible "×10^n bigger/smaller than you".
- **Time & light layer** (toggle): light-crossing time and typical timescales for the current size; beyond the solar system, "you are seeing this as it was N years ago".
- **Compare tray**: pin any two landmarks/markers; shows them at true relative scale (with a zoom control when the ratio is huge) and a live ratio ("109 Earths fit across the Sun").
- **Tours**: captioned auto-flights defined in `src/data/tours.json` (keyframes of `s`, orbit, caption).
- **Missions**: scavenger-hunt challenges from `src/data/missions.json` (find/compare/estimate), stamps stored in localStorage (guarded).
- **Teacher view** (`teacher.html`): landmark ↔ NSW Science 7–10 outcome mapping, lesson ideas, deep links. Outcome codes/wording must be taken from the owner's existing Year 7–10 site repos, never invented; unverifiable items flagged.
- **Deep links**: `#s=-9.5` (plus optional `&tour=`).
- **Settings**: quality tier (auto/low/medium/high), reduced motion, sound.
- **Audio**: WebAudio generative ambient pad whose pitch/texture follows `s`; muted by default.

Input: wheel, pinch, drag-to-orbit, keys (↑/↓ zoom, ←/→ previous/next landmark), all with inertia. Works at 375 px wide. Respects `prefers-reduced-motion`.

## 8. Quality tiers

Auto-picked from a quick GPU probe + frame-time watchdog, user-overridable.

- low: no post-processing except tone mapping; reduced particle counts and texture sizes; DPR ≤ 1.
- medium: bloom, DPR ≤ 1.5.
- high: bloom, depth of field where it helps, volumetric/extra passes, DPR ≤ 2.

Budget: ≥ 30 fps on integrated graphics at low; ≥ 55 fps on a discrete/Apple-silicon GPU at high.

## 9. Data and credits

Allowed external data, all public-domain or permissively licensed, recorded in `CREDITS.md` with source URL and licence: NASA Blue Marble / Visible Earth textures, NASA/SDO-informed Sun reference (procedural shader), HYG star database (CC BY-SA) for the sky, RCSB PDB 1BNA (public domain). The cosmic web may be procedural if survey data is too heavy, and must then carry the "Modelled" badge. Numbers in `markers.json` and landmark metadata are fact-checked by the orchestrator.

## 10. Structure

```
src/engine/      scale.ts (maths), controller.ts (input+inertia), registry.ts, compositor.ts, quality.ts, desert.ts, post.ts
src/landmarks/   <id>/index.ts  (one per landmark)
src/ui/          ruler.ts, infocard.ts, anchor.ts, timelight.ts, compare.ts, tours.ts, missions.ts, settings.ts, audio.ts
src/data/        markers.json, tours.json, missions.json, outcomes.json
public/assets/   <id>/…
tests/           scale, registry/presence, data validation
teacher.html, index.html, CREDITS.md
```

## 11. Testing and review

Unit tests: scale maths (distance, presence curves, formatters such as metres → friendly units), registry ordering and range coverage (every `s` is covered by a landmark or a declared desert), data-file schema validation. Every landmark is reviewed by screenshot in the browser at low and high tier and at 375 px before being accepted. `npm run build` and `npm test` must pass before any commit that claims completion.

## 12. Out of scope for the first slice

Voiced narration, the remaining ~28 landmark scenes, free-fly mode, accounts or any server.
