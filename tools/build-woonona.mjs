#!/usr/bin/env node
/**
 * Builds the runtime assets for the "human" landmark (Woonona Beach, NSW) from open data.
 *
 *   node tools/build-woonona.mjs <rawDir> [outDir = public/assets/human]
 *
 * <rawDir> holds what was downloaded (see src/landmarks/human/CREDITS.md):
 *   osm.json     Overpass API export (out geom) of the area around Woonona Beach
 *   coast.json   Overpass API export of natural=coastline ways for a wider strip of coast
 *   tiles/       Terrain Tiles (terrarium PNG), files named <z>_<x>_<y>.png, zooms 15, 13 and 12
 *
 * Outputs (local frame: metres east → +x, metres north → −z, centred on ORIGIN_LAT/LON in site.ts):
 *   height_fine.png    512² RGB, 5 m cells over 2560 m; height = (R·256 + G) / 50 − 100 m
 *   height_coarse.png  512² RGB, 40 m cells over 20 480 m; same encoding; B = built-up weight
 *   cover.png          1024² RGBA, 2.5 m cells over 2560 m: R sand, G dune scrub/heath, B woodland, A rock
 *   cover2.png         1024² RGB: R roads and car parks, G paved paths, B railway ballast
 *   features.json      buildings, generated houses, trees, pools (local metres) + measured dimensions
 *
 * Heights: land from the elevation tiles; the beach face, seabed (not in the data) and lagoons are
 * modelled from the OSM coastline: a ~1:8 sand berm above the mapped high-water line, a ~1:14 beach
 * face, then a Dean equilibrium profile h = −0.11·x^(2/3) with a low surf bar (all marked as modelled).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const RAW = process.argv[2];
const OUT = process.argv[3] || 'public/assets/human';
if (!RAW) { console.error('usage: node tools/build-woonona.mjs <rawDir> [outDir]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ site
const siteSrc = fs.readFileSync('src/landmarks/human/site.ts', 'utf8');
const LAT0 = Number(/ORIGIN_LAT\s*=\s*(-?[\d.]+)/.exec(siteSrc)[1]);
const LON0 = Number(/ORIGIN_LON\s*=\s*(-?[\d.]+)/.exec(siteSrc)[1]);
const f0 = (LAT0 * Math.PI) / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * f0) + 1.175 * Math.cos(4 * f0);
const M_LON = 111412.84 * Math.cos(f0) - 93.5 * Math.cos(3 * f0);
const toXZ = (lat, lon) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
const toLL = (x, z) => [LAT0 - z / M_LAT, LON0 + x / M_LON];

// ------------------------------------------------------------------ deterministic random
let seed = 20517;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const hash2 = (x, y) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ PNG
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12]) throw new Error('unsupported PNG'); }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0;
  if (!bpp) throw new Error('unsupported PNG colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp), stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst + i - stride] : 0, c = y && i >= bpp ? out[dst + i - stride - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, bpp, data) {
  const stride = w * bpp, raw = Buffer.alloc(h * (stride + 1)), row = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    let best = null, bestSum = Infinity, bestF = 0;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = data[y * stride + i], a = i >= bpp ? data[y * stride + i - bpp] : 0, b = y ? data[(y - 1) * stride + i] : 0, c = y && i >= bpp ? data[(y - 1) * stride + i - bpp] : 0;
        let pr = 0;
        if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
        else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (x - pr) & 255; row[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; bestF = f; best = Buffer.from(row); }
    }
    raw[y * (stride + 1)] = bestF; best.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = bpp === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ elevation tiles
const tiles = new Map();
for (const f of fs.readdirSync(path.join(RAW, 'tiles'))) {
  const m = /^(\d+)_(\d+)_(\d+)\.png$/.exec(f); if (!m) continue;
  const png = decodePNG(fs.readFileSync(path.join(RAW, 'tiles', f)));
  const e = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) e[i] = png.data[i * png.bpp] * 256 + png.data[i * png.bpp + 1] + png.data[i * png.bpp + 2] / 256 - 32768;
  tiles.set(`${m[1]}/${m[2]}/${m[3]}`, e);
}
function demAt(zoom, lat, lon) {
  const n = 2 ** zoom * 256, r = (lat * Math.PI) / 180;
  const X = ((lon + 180) / 360) * n - 0.5, Y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n - 0.5;
  const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
  const px = (x, y) => { const t = tiles.get(`${zoom}/${x >> 8}/${y >> 8}`); return t ? t[(y & 255) * 256 + (x & 255)] : NaN; };
  const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}
/** Best available elevation (m) at local (x, z). */
function dem(x, z, coarse = false) {
  const [lat, lon] = toLL(x, z);
  for (const zm of coarse ? [13, 12] : [15, 13, 12]) { const v = demAt(zm, lat, lon); if (!Number.isNaN(v)) return v; }
  return 0;
}

// ------------------------------------------------------------------ OSM
const osm = JSON.parse(fs.readFileSync(path.join(RAW, fs.existsSync(path.join(RAW, 'osm2.json')) ? 'osm2.json' : 'osm.json'), 'utf8')).elements;
const coastWays = JSON.parse(fs.readFileSync(path.join(RAW, 'coast.json'), 'utf8')).elements.filter((e) => e.type === 'way');
const ring = (g) => g.map((p) => toXZ(p.lat, p.lon));
/** Polygons of an element as arrays of rings (outer and inner rings; even–odd fill handles holes). */
function polysOf(e) {
  if (e.type === 'way' && e.geometry) return [ring(e.geometry)];
  if (e.type === 'relation' && e.members) {
    // join member ways into closed rings
    const segs = e.members.filter((m) => m.type === 'way' && m.geometry).map((m) => ring(m.geometry));
    const rings = [];
    while (segs.length) {
      let cur = segs.shift();
      for (let guard = 0; guard < 500 && segs.length; guard++) {
        const end = cur[cur.length - 1];
        if (Math.hypot(end[0] - cur[0][0], end[1] - cur[0][1]) < 0.5) break;
        const k = segs.findIndex((s) => Math.hypot(s[0][0] - end[0], s[0][1] - end[1]) < 0.5 || Math.hypot(s[s.length - 1][0] - end[0], s[s.length - 1][1] - end[1]) < 0.5);
        if (k < 0) break;
        let s = segs.splice(k, 1)[0];
        if (Math.hypot(s[0][0] - end[0], s[0][1] - end[1]) >= 0.5) s = s.reverse();
        cur = cur.concat(s.slice(1));
      }
      rings.push(cur);
    }
    return rings;
  }
  return [];
}
const T = (e) => e.tags || {};
const isArea = (e) => e.type === 'relation' || (e.geometry && e.geometry.length > 3 && e.geometry[0].lat === e.geometry[e.geometry.length - 1].lat && e.geometry[0].lon === e.geometry[e.geometry.length - 1].lon);

// coastline chain (land on the left of the way direction)
const coastChain = (() => {
  const ways = coastWays.map((w) => ({ nodes: w.nodes, pts: ring(w.geometry) }));
  // start from the way containing the point nearest the origin, then extend both ways
  let best = 0, bd = Infinity;
  ways.forEach((w, i) => w.pts.forEach((p) => { const d = Math.hypot(p[0], p[1]); if (d < bd) { bd = d; best = i; } }));
  let chain = ways.splice(best, 1)[0];
  let nodes = chain.nodes.slice(), pts = chain.pts.slice();
  for (let grow = true; grow;) {
    grow = false;
    for (let i = 0; i < ways.length; i++) {
      const w = ways[i];
      if (w.nodes[0] === nodes[nodes.length - 1]) { nodes = nodes.concat(w.nodes.slice(1)); pts = pts.concat(w.pts.slice(1)); ways.splice(i, 1); grow = true; break; }
      if (w.nodes[w.nodes.length - 1] === nodes[0]) { nodes = w.nodes.slice(0, -1).concat(nodes); pts = w.pts.slice(0, -1).concat(pts); ways.splice(i, 1); grow = true; break; }
    }
  }
  return pts;
})();
console.log(`coastline chain: ${coastChain.length} points, z ${Math.round(coastChain[0][1])} → ${Math.round(coastChain[coastChain.length - 1][1])}`);
// the chain runs south → north here, land (west) on its left: close it far inland
const landPoly = [...coastChain, [-60000, coastChain[coastChain.length - 1][1]], [-60000, coastChain[0][1]]];

// ------------------------------------------------------------------ rasterising helpers
/** A square grid centred on the origin: N cells of `cell` metres. */
const grid = (N, cell) => ({ N, cell, half: (N * cell) / 2, cx: (i) => (i + 0.5) * cell - (N * cell) / 2 });
/** Even–odd scanline fill of rings into `out` (Float32 coverage, ss×ss supersampling), value v. */
function fillPolys(G, rings, out, v = 1, ss = 4, mode = 'max') {
  const { N, cell, half } = G, sub = cell / ss;
  let zmin = Infinity, zmax = -Infinity, xmin = Infinity, xmax = -Infinity;
  for (const r of rings) for (const p of r) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); }
  if (xmax < -half || xmin > half || zmax < -half || zmin > half) return;
  const j0 = Math.max(0, Math.floor((zmin + half) / sub)), j1 = Math.min(N * ss - 1, Math.ceil((zmax + half) / sub));
  const acc = new Float32Array(N);
  let accRow = -1;
  const flush = () => {
    if (accRow < 0) return;
    for (let i = 0; i < N; i++) if (acc[i] > 0) {
      const k = accRow * N + i, c = (acc[i] / (ss * ss)) * v;
      out[k] = mode === 'max' ? Math.max(out[k], c) : mode === 'set' ? (c > 0.5 ? v : out[k]) : out[k] + c;
      acc[i] = 0;
    }
  };
  for (let sj = j0; sj <= j1; sj++) {
    const row = Math.floor(sj / ss);
    if (row !== accRow) { flush(); accRow = row; }
    const z = (sj + 0.5) * sub - half;
    const xs = [];
    for (const r of rings) for (let k = 0; k < r.length - 1; k++) {
      const a = r[k], b = r[k + 1];
      if ((a[1] <= z) !== (b[1] <= z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const s0 = Math.max(0, Math.ceil((xs[k] + half) / sub - 0.5)), s1 = Math.min(N * ss - 1, Math.floor((xs[k + 1] + half) / sub - 0.5));
      for (let si = s0; si <= s1; si++) acc[Math.floor(si / ss)] += 1;
    }
  }
  flush();
}
/** Thick polyline with soft edges into `out` (max). */
function strokeLine(G, pts, width, out, v = 1) {
  const { N, cell, half } = G;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const r = width / 2 + cell;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r + half) / cell)), i1 = Math.min(N - 1, Math.floor((Math.max(ax, bx) + r + half) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r + half) / cell)), j1 = Math.min(N - 1, Math.floor((Math.max(az, bz) + r + half) / cell));
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * cell - half, z = (j + 0.5) * cell - half;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      const c = clamp((width / 2 - d) / cell + 0.5, 0, 1) * v;
      const q = j * N + i; if (c > out[q]) out[q] = c;
    }
  }
}
/** Point-in-rings (even–odd). */
function inside(rings, x, z) {
  let c = false;
  for (const r of rings) for (let k = 0, l = r.length - 1; k < r.length; l = k++) {
    const a = r[k], b = r[l];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// ------------------------------------------------------------------ coastline distance (signed, + on land)
const segIndex = new Map(), SEG_CELL = 200;
for (let k = 0; k < coastChain.length - 1; k++) {
  const [ax, az] = coastChain[k], [bx, bz] = coastChain[k + 1];
  for (let i = Math.floor(Math.min(ax, bx) / SEG_CELL); i <= Math.floor(Math.max(ax, bx) / SEG_CELL); i++)
    for (let j = Math.floor(Math.min(az, bz) / SEG_CELL); j <= Math.floor(Math.max(az, bz) / SEG_CELL); j++) {
      const key = i + ',' + j; if (!segIndex.has(key)) segIndex.set(key, []); segIndex.get(key).push(k);
    }
}
function coastDist(x, z) {
  const ci = Math.floor(x / SEG_CELL), cj = Math.floor(z / SEG_CELL);
  let best = Infinity;
  for (let r = 0; r < 60; r++) {
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j += (Math.abs(i - ci) === r ? 1 : 2 * r || 1)) {
      for (const k of segIndex.get(i + ',' + j) || []) {
        const [ax, az] = coastChain[k], [bx, bz] = coastChain[k + 1];
        const dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9), 0, 1);
        best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
      }
    }
    if (best < (r - 1) * SEG_CELL) break;
  }
  return best;
}
const landMask = (G) => { const m = new Float32Array(G.N * G.N); fillPolys(G, [landPoly], m, 1, 1, 'set'); return m; };

// ------------------------------------------------------------------ OSM layers
const sel = (pred) => osm.filter((e) => pred(T(e)) && (e.geometry || e.members));
const beaches = sel((t) => t.natural === 'beach');
const sands = sel((t) => t.natural === 'sand');
const scrubs = sel((t) => t.natural === 'scrub' || t.natural === 'heath');
const woods = sel((t) => t.natural === 'wood' || t.landuse === 'forest');
const rocks = sel((t) => ['bare_rock', 'rock', 'reef', 'shingle'].includes(t.natural));
const waters = sel((t) => t.natural === 'water');
const parks = sel((t) => ['park', 'recreation_ground', 'pitch', 'garden', 'golf_course', 'playground'].includes(t.leisure) || ['grass', 'recreation_ground', 'meadow', 'village_green', 'cemetery'].includes(t.landuse));
const residential = sel((t) => t.landuse === 'residential');
const blocked = sel((t) => ['commercial', 'retail', 'industrial', 'railway', 'construction', 'cemetery', 'grass', 'recreation_ground', 'quarry'].includes(t.landuse) || ['school', 'hospital', 'parking', 'kindergarten', 'college', 'university', 'fire_station', 'place_of_worship'].includes(t.amenity) || t.leisure);
const pools = sel((t) => t.leisure === 'swimming_pool');
const buildings = osm.filter((e) => T(e).building && e.type === 'way' && e.geometry);
const roads = osm.filter((e) => e.type === 'way' && T(e).highway && e.geometry);
const rails = osm.filter((e) => e.type === 'way' && T(e).railway === 'rail' && e.geometry);
const parking = sel((t) => t.amenity === 'parking');
const ROAD_W = { motorway: 16, trunk: 15, primary: 14, primary_link: 8, secondary: 11, secondary_link: 7, tertiary: 9, tertiary_link: 7, unclassified: 7, residential: 7.5, living_street: 6, service: 4.5 };
const PATH_W = { footway: 2.4, cycleway: 2.8, path: 2.0, pedestrian: 4, steps: 2 };
const nearCoast = (rings, lim) => rings.some((r) => r.some((p) => coastDist(p[0], p[1]) < lim));

// ------------------------------------------------------------------ fine & coarse heights
const FINE = grid(512, 5), COARSE = grid(512, 40), COVER = grid(1024, 2.5);

/** Land cover on grid G: sand, scrub, wood, rock (+ derived below), roads, paths, rail, and helper masks. */
function makeCover(G) {
  const n = G.N * G.N, mk = () => new Float32Array(n);
  const C = { sand: mk(), scrub: mk(), wood: mk(), rock: mk(), road: mk(), path: mk(), rail: mk(), park: mk(), water: mk(), resi: mk() };
  const minW = (w) => Math.max(w, G.cell * 0.9);
  for (const e of beaches) fillPolys(G, polysOf(e), C.sand);
  for (const e of sands) { const p = polysOf(e); if (nearCoast(p, 400)) fillPolys(G, p, C.sand); }
  for (const e of scrubs) fillPolys(G, polysOf(e), C.scrub);
  for (const e of woods) fillPolys(G, polysOf(e), C.wood);
  for (const e of rocks) fillPolys(G, polysOf(e), C.rock);
  for (const e of parks) fillPolys(G, polysOf(e), C.park);
  for (const e of residential) fillPolys(G, polysOf(e), C.resi);
  for (const e of waters) fillPolys(G, polysOf(e), C.water);
  for (const e of parking) fillPolys(G, polysOf(e), C.road, 0.85);
  for (const e of roads) {
    const t = T(e), pts = ring(e.geometry);
    if (t.highway === 'proposed' || t.highway === 'construction' || t.tunnel === 'yes') continue;
    if (ROAD_W[t.highway]) strokeLine(G, pts, minW(t.service === 'driveway' ? 3.2 : ROAD_W[t.highway]), C.road, G.cell > 5 ? 0.8 : 1);
    else if (PATH_W[t.highway] || t.highway === 'track') {
      const sandy = t.surface === 'sand' || t.surface === 'grass' || t.surface === 'dirt' || t.surface === 'ground' || t.highway === 'track';
      if (sandy) strokeLine(G, pts, 3.0, C.sand, t.surface === 'grass' ? 0.4 : 0.9);
      else strokeLine(G, pts, PATH_W[t.highway] || 2, C.path);
    }
  }
  for (const e of rails) strokeLine(G, ring(e.geometry), minW(5.5), C.rail);
  return C;
}
const COVER_MID = grid(640, 10);
const C = makeCover(COVER), CM = makeCover(COVER_MID);

const landF = landMask(FINE), landC = landMask(COARSE), landV = landMask(COVER);
/** Height model (m above mean sea level) at (x, z). `land` and signed distance are computed here. */
const waterF = new Float32Array(FINE.N * FINE.N);
for (const e of waters) fillPolys(FINE, polysOf(e), waterF);
function heightModel(x, z, coarse, landFlag, wet = 0) {
  const d = coastDist(x, z);
  const raw = dem(x, z, coarse);
  if (!landFlag) {
    // sea: beach face then a Dean profile with a low, rip-cut surf bar (modelled, not measured)
    let h;
    if (d < 22) h = 0.45 - d / 14;
    else h = 0.45 - 22 / 14 - 0.11 * Math.pow(d - 22, 2 / 3);
    const rip = vnoise(x / 140 + 3.1, z / 140);
    h += 0.75 * Math.exp(-(((d - 85) / 28) ** 2)) * smooth(0.25, 0.6, rip);
    if (d > 4000 && raw < h) h = h + (raw - h) * smooth(4000, 9000, d); // join the surveyed deep shelf
    return { h, d: -d };
  }
  // only mapped water is water: lidar voids and drains behind the dunes stay land
  let h = Math.max(raw, 0.35);
  // the beach: a sand berm above the mapped high-water line, the dune face behind it
  if (d < 70) h = Math.min(h, 0.45 + 0.13 * d + 0.6 * smooth(10, 30, d));
  if (wet > 0.5) h = Math.min(h, -0.45);
  return { h, d };
}
function heightGrid(G, land, coarse) {
  const H = new Float32Array(G.N * G.N), Dd = new Float32Array(G.N * G.N);
  for (let j = 0; j < G.N; j++) for (let i = 0; i < G.N; i++) {
    const { h, d } = heightModel(G.cx(i), G.cx(j), coarse, land[j * G.N + i] > 0.5, coarse ? 0 : waterF[j * G.N + i]);
    H[j * G.N + i] = h; Dd[j * G.N + i] = d;
  }
  return { H, Dd };
}
console.time('heights');
const fine = heightGrid(FINE, landF, false);
const coarse = heightGrid(COARSE, landC, true);
console.timeEnd('heights');
const sampleGrid = (G, A, x, z) => {
  const fx = clamp((x + G.half) / G.cell - 0.5, 0, G.N - 1.001), fz = clamp((z + G.half) / G.cell - 0.5, 0, G.N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, N = G.N;
  return A[j * N + i] * (1 - u) * (1 - v) + A[j * N + i + 1] * u * (1 - v) + A[(j + 1) * N + i] * (1 - u) * v + A[(j + 1) * N + i + 1] * u * v;
};
const heightAt = (x, z) => (Math.abs(x) < FINE.half - 10 && Math.abs(z) < FINE.half - 10 ? sampleGrid(FINE, fine.H, x, z) : sampleGrid(COARSE, coarse.H, x, z));

// rock platforms: unmapped low land at the coast that is neither sand, park, scrub, housing nor water
// (e.g. around the Woonona Rock Pool on Collins Point), then a fringe of reef just offshore
function deriveRock(G, C, land) {
  const N = G.N, rockLand = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; if (land[k] < 0.5) continue;
    const x = G.cx(i), z = G.cx(j);
    if (C.sand[k] > 0.3 || C.park[k] > 0.3 || C.resi[k] > 0.3 || C.scrub[k] > 0.3 || C.water[k] > 0.3 || C.road[k] > 0.3 || C.wood[k] > 0.3) continue;
    if (coastDist(x, z) > 90) continue;
    if (dem(x, z) > 3.2) continue;
    rockLand[k] = 1;
  }
  // remove specks (fine grid): keep only cells with ≥ 12 rock neighbours in a 5×5 window
  const sp = G.cell < 5 ? 2 : 0;
  for (let j = sp; j < N - sp; j++) for (let i = sp; i < N - sp; i++) {
    if (!rockLand[j * N + i]) continue;
    let c = 0; for (let b = -sp; b <= sp; b++) for (let a = -sp; a <= sp; a++) c += rockLand[(j + b) * N + i + a];
    if (c >= (sp ? 12 : 1)) C.rock[j * N + i] = Math.max(C.rock[j * N + i], 1);
  }
  // reef: sea cells within 40 m of a rock cell
  const reef = new Float32Array(N * N), R = Math.max(2, Math.round(40 / G.cell)), st = R > 8 ? 2 : 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (C.rock[j * N + i] < 0.5 || land[j * N + i] < 0.5) continue;
    for (let b = -R; b <= R; b += st) for (let a = -R; a <= R; a += st) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const k = jj * N + ii; if (land[k] > 0.5) continue;
      const w = 1 - Math.hypot(a, b) / R; if (w > reef[k]) reef[k] = w;
    }
  }
  for (let k = 0; k < N * N; k++) if (reef[k] > 0) C.rock[k] = Math.max(C.rock[k], smooth(0, 0.6, reef[k]) * (0.55 + 0.45 * vnoise(G.cx(k % N) / 17, G.cx(Math.floor(k / N)) / 17)));
}
const landM = landMask(COVER_MID);
deriveRock(COVER, C, landV);
deriveRock(COVER_MID, CM, landM);
{
  // platforms are low and roughly level; reefs are shallow
  for (let j = 0; j < FINE.N; j++) for (let i = 0; i < FINE.N; i++) {
    const x = FINE.cx(i), z = FINE.cx(j);
    const r = sampleGrid(COVER, C.rock, x, z); if (r < 0.05) continue;
    const k = j * FINE.N + i, hh = fine.H[k];
    const plat = 0.35 + 0.7 * vnoise(x / 9, z / 9) + 0.25 * vnoise(x / 2.5, z / 2.5);
    fine.H[k] = hh + (Math.max(Math.min(hh, 2.6), plat - (landF[k] > 0.5 ? 0 : 1.2 + 0.03 * -fine.Dd[k])) - hh) * smooth(0.05, 0.6, r);
  }
}
// ocean rock pools: a level floor inside the walls, and a low platform around them
for (const e of pools) {
  const t = T(e); const R = minRect(polysOf(e)[0]); if (!R) continue;
  if (!(/Rock Pool/i.test(t.name || '') || coastDist(R.cx, R.cz) < 120)) continue;
  const c = Math.cos(R.a), s2 = Math.sin(R.a);
  for (let j = 0; j < FINE.N; j++) for (let i = 0; i < FINE.N; i++) {
    const x = FINE.cx(i) - R.cx, z = FINE.cx(j) - R.cz;
    const u = Math.abs(x * c + z * s2) - R.w / 2, v = Math.abs(-x * s2 + z * c) - R.d / 2;
    const out = Math.max(u, v); const k = j * FINE.N + i;
    if (out < -2) fine.H[k] = Math.min(fine.H[k], -0.6);
    else if (out < 8) fine.H[k] = Math.min(fine.H[k], 0.85);
  }
}
// the shallows show through the coarse map too
for (let j = 0; j < COARSE.N; j++) for (let i = 0; i < COARSE.N; i++) {
  const x = COARSE.cx(i), z = COARSE.cx(j);
  if (Math.abs(x) < FINE.half - 20 && Math.abs(z) < FINE.half - 20) coarse.H[j * COARSE.N + i] = sampleGrid(FINE, fine.H, x, z);
}

// ------------------------------------------------------------------ encode heights
function encodeHeights(G, H, B) {
  const out = Buffer.alloc(G.N * G.N * 3);
  for (let k = 0; k < G.N * G.N; k++) {
    const q = clamp(Math.round((H[k] + 100) * 50), 0, 65535);
    out[k * 3] = q >> 8; out[k * 3 + 1] = q & 255; out[k * 3 + 2] = B ? clamp(Math.round(B[k] * 255), 0, 255) : 0;
  }
  return encodePNG(G.N, G.N, 3, out);
}
// built-up weight for the far suburbs (the plain between the sea and the escarpment)
const urban = new Float32Array(COARSE.N * COARSE.N);
for (let j = 1; j < COARSE.N - 1; j++) for (let i = 1; i < COARSE.N - 1; i++) {
  const k = j * COARSE.N + i; if (landC[k] < 0.5) continue;
  const h = coarse.H[k];
  const sl = Math.hypot(coarse.H[k + 1] - coarse.H[k - 1], coarse.H[k + COARSE.N] - coarse.H[k - COARSE.N]) / 80;
  urban[k] = smooth(90, 45, h) * smooth(0.22, 0.1, sl) * smooth(15, 60, coarse.Dd[k]);
}
fs.writeFileSync(path.join(OUT, 'height_fine.png'), encodeHeights(FINE, fine.H));
fs.writeFileSync(path.join(OUT, 'height_coarse.png'), encodeHeights(COARSE, coarse.H, urban));
for (const [G, CC, suffix] of [[COVER, C, ''], [COVER_MID, CM, '_mid']]) {
  const N = G.N, a = Buffer.alloc(N * N * 4), b = Buffer.alloc(N * N * 3);
  const q = (v) => clamp(Math.round(v * 255), 0, 255);
  for (let k = 0; k < N * N; k++) {
    a[k * 4] = q(CC.sand[k]); a[k * 4 + 1] = q(CC.scrub[k]); a[k * 4 + 2] = q(CC.wood[k]); a[k * 4 + 3] = q(CC.rock[k]);
    b[k * 3] = q(CC.road[k]); b[k * 3 + 1] = q(CC.path[k]); b[k * 3 + 2] = q(CC.rail[k]);
  }
  fs.writeFileSync(path.join(OUT, `cover${suffix}.png`), encodePNG(N, N, 4, a));
  fs.writeFileSync(path.join(OUT, `cover2${suffix}.png`), encodePNG(N, N, 3, b));
}

// ------------------------------------------------------------------ buildings
/** Minimum-area oriented rectangle of a ring: [cx, cz, w, d, angle]. */
function minRect(r) {
  let best = null;
  for (let k = 0; k < r.length - 1; k++) {
    const a = Math.atan2(r[k + 1][1] - r[k][1], r[k + 1][0] - r[k][0]);
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of r) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) { const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; best = { area, cx: uc * c - vc * s, cz: uc * s + vc * c, w: u1 - u0, d: v1 - v0, a }; }
  }
  return best;
}
const BLD = []; // x, z, w, d, angle, height, roof (0 flat, 1 hip, 2 gable), colour seed
const occ = new Map(), OCC = 4; // 4 m occupancy grid for placement
const occKey = (x, z) => Math.floor(x / OCC) + ',' + Math.floor(z / OCC);
const markRect = (cx, cz, w, d, a, pad = 0) => {
  const c = Math.cos(a), s = Math.sin(a);
  for (let u = -w / 2 - pad; u <= w / 2 + pad; u += OCC / 2) for (let v = -d / 2 - pad; v <= d / 2 + pad; v += OCC / 2) occ.set(occKey(cx + u * c - v * s, cz + u * s + v * c), 1);
};
const rectFree = (cx, cz, w, d, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  for (let u = -w / 2; u <= w / 2 + 0.01; u += OCC / 2) for (let v = -d / 2; v <= d / 2 + 0.01; v += OCC / 2) if (occ.has(occKey(cx + u * c - v * s, cz + u * s + v * c))) return false;
  return true;
};
const EXTENT = 3200;
for (const e of buildings) {
  const t = T(e), r = ring(e.geometry);
  const R = minRect(r); if (!R || R.w < 2 || R.d < 2) continue;
  if (Math.abs(R.cx) > EXTENT || Math.abs(R.cz) > EXTENT) continue;
  const area = R.w * R.d;
  let h = t['building:levels'] ? Number(t['building:levels']) * 3.1 + 0.6 : t.height ? Number(t.height) : 0;
  const kind = t.building;
  if (!h || Number.isNaN(h)) h = ['garage', 'shed', 'carport', 'roof', 'garages'].includes(kind) ? 2.6 : ['apartments', 'hospital'].includes(kind) ? 10 : area > 1500 ? 7.5 : area > 400 ? 6 : 3.4 + 2.8 * (hash2(e.id, 1) > 0.7 ? 1 : 0);
  if (t.name && /Surf Life Saving/i.test(t.name)) h = 7.2;
  const roof = area > 450 || ['commercial', 'retail', 'industrial', 'civic', 'school', 'warehouse', 'hospital', 'apartments'].includes(kind) ? 0 : (hash2(e.id, 2) > 0.35 ? 1 : 2);
  BLD.push([R.cx, R.cz, R.w, R.d, R.a, h, roof, hash2(e.id, 3)]);
  markRect(R.cx, R.cz, R.w, R.d, R.a, 1.5);
}
const osmBuildingCount = BLD.length;

// occupancy from roads and non-residential land, at 4 m (within EXTENT)
for (const e of roads) {
  const t = T(e), pts = ring(e.geometry);
  const w = ROAD_W[t.highway] || PATH_W[t.highway] || 0; if (!w || t.highway === 'proposed') continue;
  for (let k = 0; k < pts.length - 1; k++) {
    const L = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    for (let s = 0; s <= L; s += 1.5) {
      const x = pts[k][0] + ((pts[k + 1][0] - pts[k][0]) * s) / L, z = pts[k][1] + ((pts[k + 1][1] - pts[k][1]) * s) / L;
      for (let o = -w / 2 - 1.5; o <= w / 2 + 1.5; o += 1.5) {
        const nx = -(pts[k + 1][1] - pts[k][1]) / L, nz = (pts[k + 1][0] - pts[k][0]) / L;
        occ.set(occKey(x + nx * o, z + nz * o), 1);
      }
    }
  }
}
for (const e of rails) { const pts = ring(e.geometry); for (let k = 0; k < pts.length - 1; k++) { const L = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); for (let s = 0; s <= L; s += 2) for (let o = -8; o <= 8; o += 2) { const nx = -(pts[k + 1][1] - pts[k][1]) / L, nz = (pts[k + 1][0] - pts[k][0]) / L; occ.set(occKey(pts[k][0] + ((pts[k + 1][0] - pts[k][0]) * s) / L + nx * o, pts[k][1] + ((pts[k + 1][1] - pts[k][1]) * s) / L + nz * o), 1); } } }
const resiRings = residential.map(polysOf);
const blockedRings = blocked.concat(beaches, scrubs, woods, waters, rocks).map(polysOf);
const inResi = (x, z) => resiRings.some((r) => inside(r, x, z));
const inBlocked = (x, z) => blockedRings.some((r) => inside(r, x, z));
const bboxOf = (rings) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const r of rings) for (const p of r) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); } return [a, b, c, d]; };
const resiBB = resiRings.map(bboxOf), blockBB = blockedRings.map(bboxOf);
const inSet = (rings, bbs, x, z) => { for (let k = 0; k < rings.length; k++) { const b = bbs[k]; if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue; if (inside(rings[k], x, z)) return true; } return false; };

// generated houses along residential streets (OSM maps only some of the suburb's buildings)
const TREES = []; // x, z, height, radius, kind (0 garden/street tree, 1 shrub, 2 Norfolk Island pine, 3 eucalypt)
let genHouses = 0;
for (const e of roads) {
  const t = T(e);
  if (!['residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary'].includes(t.highway)) continue;
  const pts = ring(e.geometry), rw = ROAD_W[t.highway];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const L = Math.hypot(bx - ax, bz - az); if (L < 8) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, ang = Math.atan2(uz, ux);
    for (const side of [-1, 1]) {
      let s = 4 + rnd() * 6;
      while (s < L - 4) {
        const front = 14 + rnd() * 6; // lot frontage
        const w = 9.5 + rnd() * 5, d = 11 + rnd() * 7;
        const off = rw / 2 + 6.5 + rnd() * 3 + d / 2;
        const cx = ax + ux * s - uz * off * side, cz = az + uz * s + ux * off * side;
        s += front;
        if (Math.abs(cx) > EXTENT || Math.abs(cz) > EXTENT) continue;
        if (!inSet(resiRings, resiBB, cx, cz) || inSet(blockedRings, blockBB, cx, cz)) continue;
        if (!rectFree(cx, cz, w, d, ang)) continue;
        const hg = heightAt(cx, cz); if (hg < 1.5 || coastDist(cx, cz) < 25) continue;
        const two = rnd() < 0.22;
        BLD.push([cx, cz, w, d, ang, two ? 6.0 : 3.3, rnd() < 0.62 ? 1 : 2, rnd()]);
        markRect(cx, cz, w, d, ang, 1.2); genHouses++;
        // backyard / front-garden trees
        const nt = rnd() < 0.85 ? 1 + Math.floor(rnd() * 2.4) : 0;
        for (let q = 0; q < nt; q++) {
          const back = rnd() < 0.7;
          const tu = (rnd() - 0.5) * (front - 2), tv = back ? off + d / 2 + 4 + rnd() * 12 : rw / 2 + 2.5 + rnd() * 3;
          const tx = ax + ux * (s - front + tu) - uz * tv * side, tz = az + uz * (s - front + tu) + ux * tv * side;
          if (occ.has(occKey(tx, tz)) && !back) continue;
          if (!inSet(resiRings, resiBB, tx, tz)) continue;
          const big = rnd();
          TREES.push([tx, tz, 4 + big * big * 12, 2 + big * 4, rnd() < 0.3 ? 3 : 0]);
        }
      }
    }
  }
}
// pools: rock pools get concrete walls; backyard pools are just water
const POOLS = [];
for (const e of pools) {
  const R = minRect(polysOf(e)[0]); if (!R) continue;
  const rock = /Rock Pool/i.test(T(e).name || '') || coastDist(R.cx, R.cz) < 120;
  POOLS.push([R.cx, R.cz, R.w, R.d, R.a, rock ? 1 : 0]);
}
// park and reserve trees; Norfolk Island pines along foreshore parks near the beach
for (const e of parks) {
  const rings = polysOf(e), bb = bboxOf(rings);
  if (bb[1] < -EXTENT || bb[0] > EXTENT || bb[3] < -EXTENT || bb[2] > EXTENT) continue;
  const t = T(e);
  const pitch = t.leisure === 'pitch' || t.leisure === 'playground';
  const area = (bb[1] - bb[0]) * (bb[3] - bb[2]);
  const foreshore = nearCoast(rings, 260) && t.leisure === 'park';
  const nTry = Math.min(4000, area / (pitch ? 1e9 : 260));
  for (let q = 0; q < nTry; q++) {
    const x = bb[0] + rnd() * (bb[1] - bb[0]), z = bb[2] + rnd() * (bb[3] - bb[2]);
    if (!inside(rings, x, z) || occ.has(occKey(x, z))) continue;
    // keep the middle of parks open (mown grass); trees towards the edges
    let edge = Infinity; for (const r of rings) for (let k = 0; k < r.length - 1; k++) { const [ax, az] = r[k], [bx, bz] = r[k + 1]; const dx = bx - ax, dz = bz - az, tt = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); edge = Math.min(edge, Math.hypot(x - ax - tt * dx, z - az - tt * dz)); }
    if (edge > 14 && rnd() < 0.85) continue;
    const big = rnd();
    if (foreshore && coastDist(x, z) < 200 && rnd() < 0.45) TREES.push([x, z, 17 + rnd() * 13, 3.2 + rnd() * 1.6, 2]);
    else TREES.push([x, z, 5 + big * 11, 2.5 + big * 4, big > 0.6 ? 3 : 0]);
  }
}
// dune scrub and woodland
for (const [list, kind, dens] of [[scrubs, 1, 45], [woods, 3, 45]]) for (const e of list) {
  const rings = polysOf(e), bb = bboxOf(rings);
  if (bb[1] < -EXTENT || bb[0] > EXTENT || bb[3] < -EXTENT || bb[2] > EXTENT) continue;
  const n = Math.min(12000, ((bb[1] - bb[0]) * (bb[3] - bb[2])) / dens);
  for (let q = 0; q < n; q++) {
    const x = bb[0] + rnd() * (bb[1] - bb[0]), z = bb[2] + rnd() * (bb[3] - bb[2]);
    // dense right around the person, thinning with distance (the terrain shader carries the rest)
    const r = Math.hypot(x, z);
    if (rnd() > (kind === 1 ? 1.6 * Math.exp(-r / 350) + 0.04 : 1.4 * Math.exp(-r / 900) + 0.12)) continue;
    if (!inside(rings, x, z) || occ.has(occKey(x, z))) continue;
    if (r < 9 || (r < 28 && x > -4)) continue; // the open track-head where the person stands, and the view down to the sand
    if (sampleGrid(COVER, C.sand, x, z) > 0.4) continue;
    const big = rnd();
    // wind-pruned: low on the seaward face of the dune, taller in its lee
    const lee = 0.5 + 0.5 * smooth(12, 70, coastDist(x, z));
    // the thicket itself is the terrain's canopy; these are the taller banksias and wattles above it
    if (kind === 1) TREES.push([x, z, (2.0 + big * 2.2) * lee + (rnd() < 0.08 ? 3.5 : 0), (1.0 + big * 1.4) * (0.7 + 0.3 * lee), rnd() < 0.08 ? 3 : 1]);
    else TREES.push([x, z, 9 + big * 14, 3 + big * 4, 3]);
  }
}
// street trees on the grass verges of foreshore streets nearest the beach
console.log(`buildings: ${osmBuildingCount} from OSM + ${genHouses} generated; trees ${TREES.length}; pools ${POOLS.length}`);

// ------------------------------------------------------------------ measurements
const M = {};
{
  const wb = beaches.find((e) => /Woonona/i.test(T(e).name || ''));
  const r = polysOf(wb)[0];
  // split the ring at its northern- and southernmost vertices into the landward and seaward sides
  let iN = 0, iS = 0; r.forEach((p, i) => { if (p[1] < r[iN][1]) iN = i; if (p[1] > r[iS][1]) iS = i; });
  const walk = (a, b) => { const out = []; for (let i = a; ; i = (i + 1) % (r.length - 1)) { out.push(r[i]); if (i === b) break; } return out; };
  const sideA = walk(iN, iS), sideB = walk(iS, iN);
  const plen = (s) => s.reduce((L, p, i) => (i ? L + Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0), 0);
  // the seaward side is the one closer to the mapped coastline
  const meanCD = (s) => s.reduce((a, p) => a + coastDist(p[0], p[1]), 0) / s.length;
  const sea = meanCD(sideA) < meanCD(sideB) ? sideA : sideB, landS = sea === sideA ? sideB : sideA;
  M.beachLengthM = Math.round(plen(sea));
  M.beachLandwardEdgeM = Math.round(plen(landS));
  // dry-sand width (dune toe/vegetation line to the mapped high-water line), every 20 m along the sand
  const widths = [];
  const segDist = (s, x, z) => { let b = Infinity; for (let k = 0; k < s.length - 1; k++) { const [ax, az] = s[k], [bx, bz] = s[k + 1]; const dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); b = Math.min(b, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return b; };
  let acc = 0;
  for (let k = 0; k < landS.length - 1; k++) {
    const [ax, az] = landS[k], [bx, bz] = landS[k + 1], L = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < L; s += 20) { const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L; if (acc + s > 30 && acc + s < plen(landS) - 30) widths.push(segDist(sea, x, z)); }
    acc += L;
  }
  widths.sort((a, b) => a - b);
  M.drySandWidthM = { min: Math.round(widths[0]), median: Math.round(widths[widths.length >> 1]), max: Math.round(widths[widths.length - 1]), samples: widths.length };
  // shoreline orientation: principal axis of the seaward edge; and the seaward normal
  let mx = 0, mz = 0; for (const p of sea) { mx += p[0]; mz += p[1]; } mx /= sea.length; mz /= sea.length;
  let sxx = 0, szz = 0, sxz = 0; for (const p of sea) { sxx += (p[0] - mx) ** 2; szz += (p[1] - mz) ** 2; sxz += (p[0] - mx) * (p[1] - mz); }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz); // axis angle in (x, z)
  let az = (Math.atan2(Math.cos(th), -Math.sin(th)) * 180) / Math.PI; // bearing: east = x, north = −z
  az = ((az % 180) + 180) % 180;
  M.shoreAxisBearingDeg = Math.round(az);
  M.faceBearingDeg = Math.round((az + 90) % 360);
  // the two ends
  M.beachNorthEnd = toLL(...r[iN]).map((v) => +v.toFixed(5)); M.beachSouthEnd = toLL(...r[iS]).map((v) => +v.toFixed(5));
  M.beachMidXZ = sea[sea.length >> 1].map((v) => Math.round(v));
  // pool
  const wp = pools.find((e) => /Woonona/i.test(T(e).name || ''));
  const PR = minRect(polysOf(wp)[0]);
  M.poolM = [+PR.w.toFixed(0), +PR.d.toFixed(0)].sort((a, b) => b - a); M.poolXZ = [Math.round(PR.cx), Math.round(PR.cz)];
  M.poolDistM = Math.round(Math.hypot(PR.cx, PR.cz));
  // rock platform around the pool: rock cover on land within 250 m of the pool
  let cells = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let j = 0; j < COVER.N; j++) for (let i = 0; i < COVER.N; i++) {
    const k = j * COVER.N + i, x = COVER.cx(i), z = COVER.cx(j);
    if (C.rock[k] < 0.5 || landV[k] < 0.5 || Math.hypot(x - PR.cx, z - PR.cz) > 250) continue;
    cells++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  M.platformAreaM2 = Math.round(cells * COVER.cell * COVER.cell); M.platformExtentM = [Math.round(x1 - x0), Math.round(z1 - z0)];
  M.platformXZ = [Math.round((x0 + x1) / 2), Math.round((z0 + z1) / 2)];
  // surf club
  const sc = buildings.find((e) => /Woonona Surf/i.test(T(e).name || ''));
  if (sc) { const R = minRect(ring(sc.geometry)); M.surfClubXZ = [Math.round(R.cx), Math.round(R.cz)]; M.surfClubDistM = Math.round(Math.hypot(R.cx, R.cz)); }
  // foreshore and ground elevation
  M.groundElevM = +heightAt(0, 0).toFixed(2);
  M.demAtSpotM = +dem(0, 0).toFixed(2);
  let crest = 0; for (let s = 0; s < 200; s += 2) crest = Math.max(crest, dem(-s, 0));
  M.duneCrestWithin200mWestM = +crest.toFixed(1);
  // escarpment: profile due west of the spot and to the named summits
  const prof = []; for (let s = 0; s <= 9000; s += 40) prof.push([s, dem(-s, 0, true)]);
  const top = prof.reduce((a, p) => (p[1] > a[1] ? p : a));
  // the escarpment foot: where the steepest climb starts (first point above 60 m), crest: first point ≥ 90 % of the top
  const foot = prof.find((p) => p[1] > 60), brow = prof.find((p) => p[1] >= 0.9 * top[1]);
  M.escarpmentWest = { topM: Math.round(top[1]), topDistKm: +(top[0] / 1000).toFixed(2), footDistKm: +(foot[0] / 1000).toFixed(2), browDistKm: +(brow[0] / 1000).toFixed(2), browM: Math.round(brow[1]) };
  const named = [['Brokers Nose', -34.3669353, 150.8757312], ['Woonona Mountain', -34.3234669, 150.882864], ['Sublime Point', -34.296822, 150.9253434], ['Bellambi Point', -34.3682, 150.93068]];
  M.named = named.map(([n, la, lo]) => { const [x, z] = toXZ(la, lo); return { name: n, x: Math.round(x), z: Math.round(z), distKm: +(Math.hypot(x, z) / 1000).toFixed(2), bearing: Math.round(((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360), elevM: Math.round(dem(x, z, true)), elevFineM: Math.round(dem(x, z)) }; });
}
console.log(JSON.stringify(M, null, 1));

// buildings and trees as little-endian Int16 records (decimetres; angles in 1e-4 rad; seeds in 1e-4)
const dm = (v) => clamp(Math.round(v * 10), -32768, 32767);
const bin = new Int16Array(BLD.length * 8 + TREES.length * 5);
let o = 0;
for (const b of BLD) { bin.set([dm(b[0]), dm(b[1]), dm(b[2]), dm(b[3]), Math.round(b[4] * 1e4) % 31416, dm(b[5]), b[6], Math.round(b[7] * 1e4)], o); o += 8; }
for (const t of TREES) { bin.set([dm(t[0]), dm(t[1]), dm(t[2]), dm(t[3]), t[4]], o); o += 5; }
fs.writeFileSync(path.join(OUT, 'features.bin'), Buffer.from(bin.buffer));
const features = {
  note: 'Local metres: east → +x, north → −z, origin at ORIGIN_LAT/LON (src/landmarks/human/site.ts). Built by tools/build-woonona.mjs from OpenStreetMap (© OpenStreetMap contributors, ODbL) and Terrain Tiles. features.bin: Int16 LE, buildings [x, z, w, d, angle·1e4, h, roof, seed·1e4] (dm) then trees [x, z, h, r, kind] (dm).',
  origin: [LAT0, LON0],
  grids: { fine: { n: FINE.N, cell: FINE.cell }, coarse: { n: COARSE.N, cell: COARSE.cell }, cover: { n: COVER.N, cell: COVER.cell }, coverMid: { n: COVER_MID.N, cell: COVER_MID.cell } },
  counts: { bld: BLD.length, osmBld: osmBuildingCount, trees: TREES.length },
  pools: POOLS.map((p) => p.map((v, i) => (i === 4 ? +v.toFixed(3) : i === 5 ? v : +v.toFixed(1)))),
  measured: M,
};
fs.writeFileSync(path.join(OUT, 'features.json'), JSON.stringify(features));
let total = 0;
for (const f of fs.readdirSync(OUT)) { if (fs.statSync(path.join(OUT, f)).isDirectory()) continue; const s = fs.statSync(path.join(OUT, f)).size; if (/^(height_|cover|features)/.test(f) && !/\.json$/.test(f) || f === 'features.json') { total += s; console.log(f.padEnd(20), (s / 1024).toFixed(0), 'KB'); } }
console.log('total', (total / 1024).toFixed(0), 'KB');
