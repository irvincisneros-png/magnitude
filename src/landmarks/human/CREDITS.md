# Human landmark — data credits

The place in this scene is the real Woonona Beach, Woonona NSW 2517 (northern Wollongong), built at
true scale from open data by `tools/build-woonona.mjs`. Everything is authored procedurally from the
data: no photographs, satellite imagery or AI-generated images are used.

## Map data — OpenStreetMap

© OpenStreetMap contributors. Available under the Open Database Licence (ODbL 1.0),
https://www.openstreetmap.org/copyright

- Source: Overpass API, https://overpass-api.de/api/interpreter
- Downloaded: 13 November 2026 (OSM base timestamps 2026-11-13T02:31Z and 02:49Z)
- Queries:
  - bbox (S, W, N, E) −34.390, 150.880, −34.324, 150.950: natural (beach, sand, rock, bare_rock,
    reef, shingle, scrub, heath, wood, wetland, water, cliff), leisure (parks, pools, pitches…),
    landuse, highway, railway, waterway, building and selected amenity areas (out geom).
  - bbox −34.375, 150.885, −34.325, 150.945 (first extract, used for exploration).
  - natural=coastline, bbox −34.47, 150.80, −34.22, 151.05.
  - Named places for measurements (Brokers Nose, Woonona Mountain, Sublime Point Lookout).
- Used for: the coastline (mean high-water line), the Woonona Beach polygon and other sand, dune
  scrub, woodland, rock, lagoons and creeks, parks, roads, paths, the South Coast railway line, the
  Woonona Rock Pool and other pools, and building footprints (simplified to rectangles).
- Derived database: `public/assets/human/cover*.png`, `features.json`, `features.bin` are derived from
  OpenStreetMap data and are available under the same ODbL terms.

## Elevation — Terrain Tiles (AWS Open Data)

- Source: Terrain Tiles on AWS, terrarium PNG encoding,
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
  (height = R·256 + G + B/256 − 32768 m); zoom 15 (beach and suburb), 13 and 12 (escarpment,
  plateau and sea). Registry: https://registry.opendata.aws/terrain-tiles/
- Downloaded: 13 November 2026.
- Required attribution (from https://github.com/tilezen/joerd/blob/master/docs/attribution.md):
  - Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
  - Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration;
  - United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the
    U.S. Geological Survey.
  - (The full required list also names ArcticDEM, Austria, Canada, Europe EU-DEM, Mexico INEGI,
    New Zealand LINZ, Norway Kartverket and UK Environment Agency data; none of those areas is used.)

## Modelled, not measured

- Nearshore seabed (not in the elevation data): a ~1:14 beach face below the mapped high-water line,
  then a Dean equilibrium profile (depth ≈ 0.11·x^(2/3) m) with a low, rip-cut surf bar ~85 m out,
  joined to the surveyed shelf (ETOPO1) beyond ~4 km.
- The sand berm above the high-water line (~1:8), the rock platform around the Woonona Rock Pool
  (unmapped low coastal land that is not sand, park, scrub or housing) and its reef fringe.
- About 4,900 suburban houses where OpenStreetMap does not map the buildings: placed along mapped
  residential streets inside mapped residential land, with typical lot sizes. All tree and shrub
  positions, and the Norfolk Island pines in the foreshore parks, are placed by rule within mapped
  land cover, not from a tree survey.

## The person

The figure (`figure2/`, assets in `public/assets/human/figure/`) is derived from the MakeHuman base
mesh, skeleton and skinning weights, released under CC0 1.0 by the MakeHuman project; see
`figure2/CREDITS.md` for the exact files and commit. Pose, clothing, hat and shading are original work.
The close-up hairs on the back of the hand are generated in `hairs.ts` on an ellipsoid fitted to the
figure's skin curvature at the hand (pose.ts).
