# Slice 2 addendum to the landmark builder brief

Read `docs/LANDMARK_BRIEF.md` first. Everything there holds except the section "Working and verifying", which this replaces. Eight agents are building eight landmarks at the same time.

## The chain (smallest first; new ones marked *)

planck, proton, nucleus, atom, dna, **phage***, **e-coli***, cell, **sand-grain***, **ant***, human, earth, **earth-moon***, sun, **betelgeuse***, solar-system, **orion-nebula***, **omega-centauri***, milky-way, universe. Sizes and ranges: `src/landmarks/manifest.ts`.

Layers are composited largest first with NO shared depth buffer: every smaller landmark is painted on top of every bigger one, whatever the 3D positions. All layers share the same orientation (identity at the origin, +Y up) and the same orbit, so a direction in your frame is the same direction in your neighbours' frames.

Several landmarks may be present at once (not only your direct neighbours). Check `__magnitude.getActive()` or the manifest to see who is on screen with you at each `s`.

## Verifying (replaces the browser-pane instructions)

- Do NOT use the built-in browser pane (`mcp__Claude_Browser__*`) or Chrome extension. Do NOT run `tools/fps.mjs` or any other benchmark: the orchestrator measures frame rates alone on a quiet machine afterwards. Design to the budgets in the brief and keep fragment shaders cheap on `low`.
- A dev server is already running at http://localhost:8521 (shared; do not start, stop or restart it; no `npm install`).
- Take real-time headless screenshots with
  `node tools/shot.mjs "<baseUrl>" <outDir> <s1,s2,...> [waitMs] [prefix] [yaw:pitch] [WxH]`
  e.g. `node tools/shot.mjs "http://localhost:8521/?q=high" "$OUT" 7.8,8.3,8.85 4000 hi` then again with `?q=low`, with another orbit such as `2.2:0.7` or `-1.0:-0.3` (radians; default 0.35:0.18), and once at `375x812`. It prints console errors and warnings: fix any that come from your files. Use your OWN output directory (a folder named after your landmark inside your scratchpad or `$TMPDIR`), never the repo. Read the JPGs with the Read tool; `python3 tools/sheet.py <out.jpg> <cols> <files…>` makes a contact sheet.
- Each run launches its own headless Chrome; run one at a time, and expect it to take 30 to 90 s. Other agents' edits can break the page for a moment (a syntax error in someone else's file); if a shot is black or errors mention another landmark, wait a minute and retry.
- Minimum set to inspect, at high and low: range start + 0.3, range start + 0.7, zoom −1 (if in range), zoom −0.5, zoom 0, zoom +0.25 (the "home" view the ruler jumps to), zoom +0.7, range end − 0.7, range end − 0.3; at least three orbits including a steep one (pitch ±1.2); one phone shot at home. Judge them as a harsh art director and iterate until the scene is genuinely impressive.
- Your neighbours may still be stubs (a noise-banded sphere with a wire halo) while you work. Hand-overs into stubs cannot be judged finally; say so in your report.
- Type-check only your own files: `npx tsc --noEmit 2>&1 | grep "landmarks/<id>"` must print nothing.
- Do NOT use git. Do not edit anything outside `src/landmarks/<id>/` and `public/assets/<id>/`.

## Performance target for this slice

About 60 fps at the `low` tier on an Apple-silicon laptop in headless Chrome at 1280×800, with your neighbours also on screen. On `low`: no full-screen raymarching with more than ~24 cheap steps, at most 3 noise octaves on full-screen surfaces, ≤ 40k particles, overdraw kept modest (large additive sprites are the usual killer). Scale richer on `medium` and `high`.
