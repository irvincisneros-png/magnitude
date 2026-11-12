# Landmark builder brief (shared by every landmark agent)

You are replacing ONE stub scene in "Magnitude", a seamless 3D zoom from the Planck length to the observable universe. Read, in this order:

1. `src/engine/types.ts` — the binding contract (units, frame, rendering rules, lifecycle).
2. `docs/specs/2026-11-13-magnitude-design.md` §4–6, §8.
3. `src/landmarks/manifest.ts` — your size and range, and your neighbours'.
4. `src/landmarks/_stub.ts` and your current `src/landmarks/<id>/index.ts` — what you replace.

## What you own

Only `src/landmarks/<id>/**` and `public/assets/<id>/**`. Do not edit anything else (engine, UI, other landmarks, package.json). If you believe the engine needs a change, say so in your report instead. Three.js core and `three/examples/jsm/*` are available; add no dependencies.

Keep the meta `id`, `sizeMeters` and `range` identical to the manifest. Rewrite every other meta field with accurate text a Year 7–10 student can read (Australian spelling), including `howWeKnow`, `lightTime`, `timescale`, `labels` and `post` hints.

## How the zoom works (critical)

- Your scene is authored with your characteristic size = 1 unit. The origin is the anchor: the next-smaller landmark sits there, and the camera always orbits the origin (shared yaw/pitch, user can orbit freely, pitch ±80°).
- `frame.zoom = s − log10(sizeMeters)`. zoom 0 → your object fills the view height. Negative → the camera is deep inside/close to the origin. Positive → you are a shrinking object inside your parent.
- You must look right over your WHOLE range:
  - **Zoom-in end:** the camera is very close to the origin. There must be real, interesting detail there, at that scale, leading the eye to where the child landmark appears. No giant blurry polygons, no empty frame (unless emptiness is the point, and then it must read as deliberate).
  - **Middle:** the hero shot. This is the screenshot people share.
  - **Zoom-out end:** you are a small object at the centre of your parent's scene. Fade your own backdrop/environment elements out with zoom (use `frame.zoom`) so the parent shows around you. Do not fade the hero object itself; the engine handles presence.
- Leave `scene.background` null. Never call `renderer.render`.
- Depth: near = distance/200, far = distance·2000 + 50. Far-away geometry z-fights when the camera is very close to the origin; fade or hide distant detail at strongly negative zoom, or render large backdrops with `depthTest: false` / `depthWrite: false` and renderOrder.
- Level of detail is driven by `frame.zoom`; counts and resolution by quality tier.

## Visual bar

Polished, real-looking 3D of the standard of professional molecular animation and planetarium shows. Custom `ShaderMaterial`s, layered noise (fbm, curl, worley), fresnel/rim light, soft translucency, depth cues, particles with soft falloff, constant subtle motion. Physically motivated colour. NOT acceptable: bare spheres/boxes, flat `MeshBasicMaterial` colours, a toy/cartoon look, AI-generated images, clip-art. If something cannot be made to look real (e.g. quantum objects), make it look *beautiful and deliberate* and set the evidence badge honestly.

Bright values > 1 (linear) bloom on medium/high; design so the scene still reads on `low` with no bloom.

## Performance

Target ≥ 30 fps on integrated graphics at `low`, ≥ 55 fps on Apple silicon at `high`. Rough budgets: low ≤ 40k particles, ≤ 1k textures, cheap fragment shaders (≤ 3 noise octaves on full-screen surfaces); high ≤ 400k particles, ≤ 4k textures. Build geometry once in `init`; no per-frame allocation. `setQuality` must work live. `dispose()` frees everything.

## External data

Only if your section of the brief allows it, only from the named official source, saved into `public/assets/<id>/`, total ≤ 12 MB for your landmark. Record each file with source URL and licence in `src/landmarks/<id>/CREDITS.md`.

## Working and verifying

- A dev server is ALREADY RUNNING at http://localhost:8520 and is shared with other agents. Do not start, stop or restart it, and do not run `npm install`.
- Use the built-in browser tools (`mcp__Claude_Browser__*`): create YOUR OWN tab with `tabs_create`, and pass that `tabId` to every call. Never act on another tab. Open `http://localhost:8520/?debug&q=high#s=<value>`.
- `__magnitude.setS(x)`, `await __magnitude.flyTo(x, 2)`, `__magnitude.setQuality('low'|'high')`, `?q=low`. Other agents' edits can trigger reloads; just re-navigate. The pane may be hidden, so frames may only advance when you screenshot: take screenshots to look, and judge fps from `?debug` cautiously.
- Screenshot and critically inspect at least: range start + 0.7, zoom −1, zoom 0, zoom +0.7, range end − 0.7; at `high` and `low`; and once at mobile width (`resize_window` preset mobile, then reset to desktop). Look at your own screenshots as a harsh art director would and iterate until it is genuinely impressive. Also check the hand-over into both neighbours (they may still be stubs).
- Check the console for errors/warnings from your files.
- Type-check only your own work: `npx tsc --noEmit 2>&1 | grep "landmarks/<id>"` must print nothing (other agents may have work in progress elsewhere; ignore their errors).
- Do NOT use git. The orchestrator commits.

## Report back

What you built; the screenshots' verdict in your own honest words (what still looks weak); fps seen per tier; anything unverified; any engine change you want.
