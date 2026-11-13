"""Signed distance to the OpenStreetMap coastline around Woonona Beach (positive = land).
usage: python3 -I coast_sdf.py <coast.json> <out.png>
Grid: N x N cells over 2*HALF metres centred on the origin; row 0 = north, col 0 = west.
Encoding: grey = round(127.5 + d / STEP), d clamped to +-127*STEP metres."""
import json, math, sys
import numpy as np
from PIL import Image
from matplotlib.path import Path

LAT0, LON0 = -34.357798, 150.919131
N, HALF, STEP = 1024, 14000.0, 4.0
f0 = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * f0) + 1.175 * math.cos(4 * f0)
M_LON = 111412.84 * math.cos(f0) - 93.5 * math.cos(3 * f0)
xz = lambda p: ((p['lon'] - LON0) * M_LON, -(p['lat'] - LAT0) * M_LAT)

els = json.load(open(sys.argv[1]))['elements']
ways = [{'nodes': w['nodes'], 'pts': [xz(p) for p in w['geometry']]} for w in els if w['type'] == 'way']
closed = [w for w in ways if w['nodes'][0] == w['nodes'][-1]]
openw = [w for w in ways if w['nodes'][0] != w['nodes'][-1]]
# join open ways into one chain (land on the left)
best = min(range(len(openw)), key=lambda i: min(math.hypot(*p) for p in openw[i]['pts']))
c = openw.pop(best); nodes, pts = c['nodes'][:], c['pts'][:]
grow = True
while grow:
    grow = False
    for i, w in enumerate(openw):
        if w['nodes'][0] == nodes[-1]: nodes += w['nodes'][1:]; pts += w['pts'][1:]; openw.pop(i); grow = True; break
        if w['nodes'][-1] == nodes[0]: nodes = w['nodes'][:-1] + nodes; pts = w['pts'][:-1] + pts; openw.pop(i); grow = True; break
print('chain', len(pts), 'pts; start z', round(pts[0][1]), 'end z', round(pts[-1][1]), '; leftover open ways', len(openw), '; islets', len(closed))
land = pts + [(-60000, pts[-1][1]), (-60000, pts[0][1])]

cell = 2 * HALF / N
cx = (np.arange(N) + 0.5) * cell - HALF
X, Z = np.meshgrid(cx, cx)  # row = z (north first since z = -north... row 0 -> z = -HALF = north)
P = np.stack([X.ravel(), Z.ravel()], 1)
inside = Path(np.array(land)).contains_points(P)
for w in closed: inside ^= Path(np.array(w['pts'])).contains_points(P)
inside = inside.reshape(N, N)

DMAX = 127 * STEP
dist = np.full((N, N), DMAX)
segs = []
for line in [pts] + [w['pts'] for w in closed]:
    segs += [(line[i], line[i + 1]) for i in range(len(line) - 1)]
m = int(math.ceil(DMAX / cell)) + 1
for (ax, az), (bx, bz) in segs:
    i0 = max(0, int((min(az, bz) + HALF) / cell) - m); i1 = min(N, int((max(az, bz) + HALF) / cell) + m + 1)
    j0 = max(0, int((min(ax, bx) + HALF) / cell) - m); j1 = min(N, int((max(ax, bx) + HALF) / cell) + m + 1)
    if i0 >= i1 or j0 >= j1: continue
    px, pz = X[i0:i1, j0:j1], Z[i0:i1, j0:j1]
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz or 1e-9
    t = np.clip(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1)
    d = np.hypot(px - ax - t * dx, pz - az - t * dz)
    np.minimum(dist[i0:i1, j0:j1], d, out=dist[i0:i1, j0:j1])
sd = np.where(inside, dist, -dist)
g = np.clip(np.round(127.5 + sd / STEP), 0, 255).astype(np.uint8)
Image.fromarray(g, 'L').save(sys.argv[2], optimize=True)
# report: signed distance at origin and the nearest shoreline due east
o = N // 2
print('sd at origin (m): %.1f' % sd[o - 1:o + 1, o - 1:o + 1].mean())
row = sd[o]
k = next(j for j in range(o, N) if row[j] < 0)
print('first water east of origin at x ~ %.0f m' % cx[k])
