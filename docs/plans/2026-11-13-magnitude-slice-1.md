# Magnitude — Slice 1 Implementation Plan

> **For agentic workers:** executed subagent-driven by the orchestrator. One agent per task; tasks marked ∥ run in parallel and must only touch their own files. Spec: `docs/specs/2026-11-13-magnitude-design.md` (read it first; its Landmark contract is binding).

**Goal:** A seamless 3D zoom from 10^-35 m to 10^27 m with 12 polished hero landmarks, ruler, info card, compare tray, tours, missions, time & light layer, teacher view and ambient audio.

**Architecture:** One scalar `s = log10(view height in metres)` drives a stack of independent Three.js scenes, each authored at unit size around its own origin and rendered with its own camera distance, composited largest-first. UI is vanilla DOM over the canvas.

**Tech Stack:** Vite, TypeScript (strict), Three.js, Vitest. Dev port 8520.

---

## Fixed tables (binding for every task)

### Landmark order, size and presence range

| id | sizeMeters | range (s) |
|---|---|---|
| planck | 1.6e-35 | [-35.5, -32.0] |
| *(desert)* | — | -32.0 … -18.5 |
| proton | 1.7e-15 | [-18.5, -14.2] |
| nucleus | 5.4e-15 | [-14.9, -12.5] |
| atom | 1.5e-10 | [-13.3, -8.8] |
| dna | 2e-9 | [-9.6, -6.5] |
| cell | 3e-5 | [-7.3, -3.3] |
| human | 1.7 | [-4.1, 3.7] |
| earth | 1.27e7 | [2.9, 9.4] |
| sun | 1.39e9 | [8.6, 11.5] |
| solar-system | 9e12 | [10.8, 17.5] |
| milky-way | 1e21 | [16.8, 22.3] |
| universe | 8.8e26 | [21.6, 27.5] |

Neighbours overlap by ≥ 0.7 decades; the compositor cross-fades inside the overlap. A landmark must look right across its *whole* range, including far zoomed-in (camera very close to the origin) and zoomed-out (scene is a small object).

### Scale maths (Task 1 implements exactly this)

```ts
// src/engine/scale.ts
export const S_MIN = -35.5;
export const S_MAX = 27.5;
export const FOV_DEG = 45;
export const HUMAN_LOG = Math.log10(1.7);

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clampS = (s: number) => Math.min(S_MAX, Math.max(S_MIN, s));
/** Height of the view in the landmark's local units (characteristic size = 1). */
export const viewHeightLocal = (s: number, sizeMeters: number) => 10 ** (s - Math.log10(sizeMeters));
export const cameraDistance = (s: number, sizeMeters: number, fovDeg = FOV_DEG) =>
  viewHeightLocal(s, sizeMeters) / (2 * Math.tan((fovDeg * Math.PI) / 360));
/** 0..1 presence of a landmark with range [lo, hi]; fades over `fade` decades at each end. */
export const presence = (s: number, [lo, hi]: [number, number], fade = 0.6) =>
  smoothstep(lo, lo + fade, s) * (1 - smoothstep(hi - fade, hi, s));
```

Also in `scale.ts`: `formatSci(m)` → `"1.5 × 10⁻¹⁰ m"`; `formatFriendly(m)` → picks from ℓP-free list `fm, pm, nm, µm, mm, cm, m, km, AU (1.496e11), light-years (9.461e15)` with 2–3 significant figures and thousands words above 1e3 ly ("26 thousand light-years", "93 billion light-years"); `humanRatio(s)` → `{ exponent: number, direction: 'bigger' | 'smaller' | 'same' }` from `round(s − HUMAN_LOG)`.

### Data schemas

```ts
// src/data/markers.json — array
{ id: string; name: string; sizeMeters: number;
  category: 'quantum'|'atomic'|'molecular'|'biological'|'human'|'planetary'|'stellar'|'galactic'|'cosmic';
  evidence: 'measured'|'modelled'|'speculative'; blurb: string;
  howWeKnow: { instrument: string; text: string } }
// src/data/tours.json — array
{ id: string; title: string; summary: string;
  steps: { s: number; yaw?: number; pitch?: number; seconds: number; caption: string }[] }
// src/data/missions.json — array
{ id: string; title: string; prompt: string;
  type: 'find'|'compare'|'estimate';
  target?: { s: number; tolerance: number };            // find
  compare?: { a: string; b: string; answer: number; tolerancePct: number }; // compare/estimate (ids of landmarks/markers)
  hint: string; reward: string }
```

---

## Task 1 — Scaffold + scale maths (TDD)

**Files:** `package.json`, `vite.config.ts` (`base: './'`, port 8520), `tsconfig.json` (strict), `index.html`, `src/main.ts`, `src/engine/scale.ts`, `tests/scale.test.ts`, `.gitignore`.

- [ ] `npm create`-free manual scaffold; `npm i three` and `npm i -D vite typescript vitest @types/three`. Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`).
- [ ] Write `tests/scale.test.ts` first, run, see it fail:

```ts
import { describe, expect, it } from 'vitest';
import { cameraDistance, formatFriendly, formatSci, humanRatio, presence, viewHeightLocal } from '../src/engine/scale';

describe('scale', () => {
  it('view height is 1 local unit when s equals the landmark size', () => {
    expect(viewHeightLocal(Math.log10(1.27e7), 1.27e7)).toBeCloseTo(1, 10);
    expect(viewHeightLocal(-10, 1e-12)).toBeCloseTo(100, 8);
  });
  it('camera distance frames the view height at 45° fov', () => {
    expect(cameraDistance(0, 1)).toBeCloseTo(1 / (2 * Math.tan(Math.PI / 8)), 10);
  });
  it('presence fades in and out inside the range', () => {
    const r: [number, number] = [2, 6];
    expect(presence(1.9, r)).toBe(0);
    expect(presence(2.3, r)).toBeCloseTo(0.5, 5);
    expect(presence(4, r)).toBe(1);
    expect(presence(6.1, r)).toBe(0);
  });
  it('formats sizes', () => {
    expect(formatSci(1.5e-10)).toBe('1.5 × 10⁻¹⁰ m');
    expect(formatFriendly(1.5e-10)).toBe('150 pm');
    expect(formatFriendly(1.27e7)).toBe('12,700 km');
    expect(formatFriendly(8.8e26)).toBe('93 billion light-years');
  });
  it('human ratio', () => {
    expect(humanRatio(Math.log10(1.7))).toEqual({ exponent: 0, direction: 'same' });
    expect(humanRatio(7.1)).toEqual({ exponent: 7, direction: 'bigger' });
    expect(humanRatio(-9.8)).toEqual({ exponent: 10, direction: 'smaller' });
  });
});
```

- [ ] Implement `scale.ts`; `npm test` passes; commit.

## Task 2 — Engine + UI shell with stub landmarks

**Files:** `src/engine/{types,registry,compositor,controller,quality,desert,post}.ts`, `src/landmarks/_stub.ts`, `src/landmarks/<id>/index.ts` ×12 (stubs), `src/landmarks/manifest.ts`, `src/ui/{ruler,infocard,anchor,shell}.ts`, `src/styles.css`, `tests/registry.test.ts`.

- [ ] `types.ts`: the spec's contract verbatim (`Quality`, `Evidence`, `LandmarkMeta`, `FrameState`, `Landmark`, plus `LandmarkFactory = () => Landmark`).
- [ ] `manifest.ts`: ordered list `{ id, sizeMeters, range, name, load: () => import('./<id>/index') }` using the fixed table; `tests/registry.test.ts` asserts ascending order, ≥ 0.7 overlap between neighbours except the declared desert, and that every `s` in [S_MIN, S_MAX] at 0.1 steps is covered by a landmark or the desert.
- [ ] `registry.ts`: lazy-load active landmarks ±1 neighbour, `init` once, dispose beyond ±2.
- [ ] `compositor.ts`: per active layer set camera (shared yaw/pitch, `cameraDistance`, near = distance/200, far = distance·2000 + 50), draw largest first with depth cleared between layers, blend each by `presence` (render-target composite; lower layer stays fully opaque until the upper one reaches full presence so there is never a dip to black). Applies `meta.post` hints interpolated by presence.
- [ ] `post.ts`: tone mapping always; bloom on medium/high; vignette + faint grain on high.
- [ ] `quality.ts`: auto tier from renderer info + rolling frame-time watchdog (drop a tier after 2 s under 28 fps), user override persisted (guarded localStorage).
- [ ] `controller.ts`: wheel / pinch / keys change `s` with inertia; drag orbits (pitch clamped ±80°); `flyTo(s, seconds)` eased; hash deep link `#s=` read on load and written (throttled) on change; respects reduced motion (no inertia, instant-ish flights).
- [ ] `desert.ts`: engine-owned void layer for uncovered `s` with drifting motes and a DOM counter "N powers of ten of nothing we know of".
- [ ] `_stub.ts`: helper producing a decent placeholder landmark (lit icosphere + label) from a manifest row, so the whole zoom works before real scenes land. Each `src/landmarks/<id>/index.ts` default-exports a factory using the stub — these 12 files are the *only* files landmark agents later replace.
- [ ] UI shell: log ruler (drag/click, landmark ticks), info card (name, sizes, evidence badge, blurb, how-we-know, nesting note), human anchor readout, HTML label overlay for `meta.labels`. Extension point `src/ui/shell.ts` exports `mountPanel(id, title, element)` and a toolbar `addToolbarButton(...)` for Task 16 features, and an event bus `on('scale', cb)` / `on('landmark', cb)`.
- [ ] `window.__magnitude = { getS, setS, flyTo, setQuality, getActive }` for automated review.
- [ ] Verify: `npm test`, `npm run build`, run dev server and screenshot three scales. Commit.

## Task 3 ∥ — Scale data (cheap model, orchestrator fact-checks)

**Files:** `src/data/markers.json` (~60 objects across all nine categories, none duplicating the 12 landmarks), `tests/data.test.ts` (schema + sorted + unique ids).

## Tasks 4–15 ∥ — Hero landmarks (one agent each)

Each replaces only `src/landmarks/<id>/index.ts` (+ optional sibling files in that folder and `public/assets/<id>/`, + its line in `CREDITS.md`). Shared rules:

- Obey the contract; characteristic size = 1 local unit; anchor at origin, +Y up; correct at every `s` in range; honour `quality`; dispose everything.
- Visual bar: organic, layered, real-looking; custom shaders, noise, fresnel/rim light, soft depth cues, subtle constant motion. No bare primitives, no flat colours, no AI images.
- Fill every `meta` field with accurate, Year 7–10 readable text.
- Verify in the browser with screenshots at range start, middle and end, at low and high tier, and report them.

Per-landmark art direction is in each agent's brief (spec §6).

## Task 16 ∥ — Features

**Files:** `src/ui/{compare,tours,missions,timelight,settings,audio}.ts`, `src/data/{tours,missions,outcomes}.json`, `teacher.html`, `src/teacher.ts`. Uses only the shell's extension points. Outcomes taken from the owner's existing Year 7–10 site repos, never invented.

## Task 17 — Orchestrator review

Full zoom pass in the browser at low and high tier and 375 px; fix list back to builders; `npm test` + `npm run build`; then ask owner before creating the public repo.
