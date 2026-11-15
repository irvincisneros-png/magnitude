# Human landmark — data credits

The place in this scene is the real Woonona Beach, Woonona NSW 2517 (northern Wollongong), built at
true scale from open data by `tools/build-woonona.mjs`. The ground's colour, from a few metres up, is a
real aerial photograph of the place (NSW Spatial Services, below), draped over the terrain by
`tools/build-woonona-imagery.py` and `aerial.ts`; close to the person, where the photo is too coarse,
procedural sand, dune and grass materials take over, tinted to the photo's colour. The sea is procedural
(animated swell and surf); the photo only adds a gentle, mean-neutral brightness modulation (sandbars,
rip channels) within ~250 m of the shore, with its breaking waves removed when baked. No AI-generated images are used.
The other photographic textures are those of the person (a scanned-and-textured avatar, see "The person").

**Attribution shown in the app:** Aerial photography and elevation © State of New South Wales (Spatial
Services, a business unit of the Department of Customer Service NSW), CC BY 4.0, extracted 15 November
2026; map data © OpenStreetMap contributors (ODbL).

## Aerial photography — NSW Spatial Services (NSW Imagery)

© State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW).
For current information go to spatial.nsw.gov.au. ©Department of Customer Service 2026-11-15 (date of
extraction). Licence: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/

Licence evidence (checked 15 November 2026):
- Spatial Web Services terms and conditions, clause 3.1: data accessed from the web services is
  "subject to the Creative Commons Attribution By Licence", with the additional term that Spatial
  Services is attributed as "©Department of Customer Service [date of extraction]".
  https://www.spatial.nsw.gov.au/products_and_services/web_services/terms_and_conditions (read from the
  Internet Archive copy of 14 January 2025; the live page now redirects to nsw.gov.au).
- Spatial Services copyright page: material is "licensed under the Creative Commons Attribution 4.0
  licence", and requests attribution as "© State of New South Wales (Spatial Services, a business unit
  of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au."
  https://www.spatial.nsw.gov.au/copyright (Internet Archive copy of 14 December 2025).
- Data.NSW catalogue entry "NSW Imagery": licence "Creative Commons Attribution" (cc-by).
  https://data.nsw.gov.au/data/dataset/nsw-imagery
- Caveats, recorded honestly: the copyright page excludes "images, photographs or illustrations" on its
  *website* (the imagery here comes from the web services, which clause 3.1 licenses); older Spatial
  Services information sheets (2018) reportedly linked the no-derivatives CC BY-ND 4.0 deed; the newer
  basemap's catalogue item names third-party satellite imagery (SPOT, © Airbus DS) for its small-scale
  layer, which is why the coarse levels here come from the older service instead (see below); and clause
  2.1.6 of the terms asks users not to retrieve the service with robots — the bake made about 440 ordinary
  tile requests once (289 used; the rest an abandoned trial of coarser zooms), sequentially with a pause,
  plus a handful of export requests, and caches them.

What was used:

| Level | Extent (local metres, centre / square) | Resolution | Source | Imagery |
|---|---|---|---|---|
| fine | centre (256, −512), 2048 m | 0.5 m/px (4096², and a 2048² copy) | NSW Imagery Basemap cached tiles, zoom 18 (289 tiles): https://portal.spatial.nsw.gov.au/aid/tile/rest/services/NSWWebImagery/MapServer | Wollongong, captured 4 March 2021, 7 cm (NSW_Imagery_Dates "BestImageryDates" layer at the standing spot: WOLLONGONG, SydneyCon, 2021-03-04, 7 cm) |
| mid | centre (0, −512), 8192 m | 4 m/px (2048², and 1024²) | NSW_Imagery map service, one `export` in EPSG:4326: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer | Spatial Services' ADS40 survey of 30 March 2008 (WOLLONGONG_ADS40_SC_20080330) — the only imagery that service draws at pixel sizes over 2 m (its Footprint layer) |
| coarse | centre (0, 0), 25.6 km | 12.5 m/px (2048²) | as mid | ADS40 2008 (Wollongong and Port Hacking blocks); on the plateau's far west and at sea, the service's Landsat 8 2014 fill (l8olps_nsw_2014; Landsat is public domain, courtesy of the U.S. Geological Survey) |

Processing (`tools/build-woonona-imagery.py`, no painting, no AI): bilinear resampling onto the scene's
local metre grid (the same tangent-plane projection as the map data, so roads, coastline and buildings
line up); over the open sea, breaking-wave whitewash replaced by the surrounding water colour so the
runtime's animated surf is the only surf; the Landsat fill colour-matched to the aerial survey with a
smooth gain field; the coarser levels colour-matched to the finer ones where they overlap; WebP
(quality 88 fine, 85 others). Files: `public/assets/human/aerial_fine_4096.webp`, `aerial_fine_2048.webp`,
`aerial_mid_2048.webp`, `aerial_mid_1024.webp`, `aerial_coarse_2048.webp`, `aerial.json` (extents and
colour statistics) and `aerial_keep.bin` (which generated houses and placed plants agree with the photo:
a generated house on photo lawn or bush, or a plant on photo sand, road or roof, is hidden).

## Elevation — NSW 5 m elevation model (NSW Spatial Services)

Same licence and attribution as the aerial photography (Spatial Web Services terms, clause 3.1;
copyright text in the service: "DFSI 2019").

- Source: NSW_5M_Elevation image service, "5 metre post spacing elevation derived from stereo imagery",
  https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer (two
  `exportImage` requests in EPSG:4326, float32: the fine grid's 2.6 km square at 2.5 m and the coarse
  grid's 20.9 km square at 20 m), fetched by `tools/fetch-nsw-dem.py` on 15 November 2026.
- Used by `tools/build-woonona.mjs` for all land inside the height grids (it resolves the foredune, the
  railway embankment, creeks and road cuttings that the terrain tiles blur away). The terrain tiles
  below still supply the deep sea floor.

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

## Elevation — Terrain Tiles (AWS Open Data) — sea floor and fallback

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

The man is the **Microsoft Rocketbox** avatar `Male_Adult_01` (rigged mesh and photo textures),
released under the **MIT License**, Copyright (c) 2020 Microsoft.

- Source: https://github.com/microsoft/Microsoft-Rocketbox — `Assets/Avatars/Adults/Male_Adult_01/`
  (`Export/Male_Adult_01.fbx`; `Textures/m002_body_color.tga`, `m002_body_normal.tga`,
  `m002_body_specular.tga`, `m002_head_color.tga`, `m002_head_normal.tga`, `m002_head_specular.tga`,
  `m002_opacity_color.tga`), downloaded 15 November 2026.
- Licence: MIT (the repository's `LICENSE.md`). The full licence text is in `figure2/CREDITS.md`.
- What we changed: posed (standing on his left leg, right forearm held out level, palm down, head
  bowed looking at the back of his right hand), baked into static geometry, rescaled to 1.70 m,
  ambient occlusion baked, textures resized and re-encoded: `tools/build-figure.py` (Blender) and
  `tools/build-figure-tex.py`. Assets: `public/assets/human/figure/`; shading: `figure2/`.

The close-up hairs on the back of the hand are generated in `hairs.ts` on an ellipsoid fitted to the
figure's skin curvature at the hand (pose.ts, figureData.ts).

## Licence status (checked 2026-11-16)

- data.nsw.gov.au lists "NSW Imagery" and the 5 m elevation model as "Creative Commons Attribution" without naming a version; the Spatial Services copyright and web-service terms pages redirected and could not be re-read live on this date (the quotes above are from archive copies).
- The NSW_Imagery map service's own description credits "external imagery sourced from © AAM 2011,2012; © Jacobs Group Ausimage 2002,2006,2009,2014; © LANDSAT 2014". The levels used here are Spatial Services' own 2021 and 2008 surveys plus a Landsat 2014 fill (Landsat is US Government public-domain data), but this has not been confirmed with Spatial Services.
- Both services set `exportTilesAllowed: false`. The imagery here was fetched once through ordinary map requests and is shipped downsampled.
- Not yet confirmed in writing with Spatial Services. If they object, delete `public/assets/human/aerial_*` and the scene falls back to the generated ground (the terrain shader treats missing imagery as "no photo").
