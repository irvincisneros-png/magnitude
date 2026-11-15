#!/usr/bin/env python3
"""
Aerial imagery for the "human" landmark (Woonona Beach, NSW), draped over the terrain as its albedo.

    python3 -I tools/build-woonona-imagery.py <cacheDir> [outDir = public/assets/human]

Source: NSW Spatial Services "NSW Imagery Basemap" (NSWWebImagery) cached tile service, CC BY
(see src/landmarks/human/CREDITS.md for the licence text). Tiles are Web Mercator (EPSG:3857), 256 px;
they are fetched once into <cacheDir>/nswimg/ (sequentially, with a pause, generic User-Agent) and
reused on later runs.

Each level of detail is resampled onto the scene's local metre grid: the same equirectangular
tangent frame as tools/build-woonona.mjs (east -> +x, north -> -z, centred on ORIGIN_LAT/LON in
site.ts), so image row 0 is the northern edge and texture uv = (q - centre) / (2 * half) + 0.5.

Processing (no AI, no painting): bilinear resampling; over the open sea (from the baked height maps)
breaking-wave whitewash is replaced by the surrounding water colour (the runtime animates its own surf);
the coarser levels are colour-matched to the finer ones where they overlap so the clipmap has no seams.

Also writes aerial_veg.png (photo vegetation on the 2.5 m land-cover grid), aerial.json (extents, colour
statistics) and aerial_keep.bin: one byte per building and
tree in features.bin (1 = consistent with the photo: a generated house that is not on lawn or bush,
a tree that stands on photo vegetation).
"""
import json, math, os, re, sys, time, struct, io, urllib.request
import numpy as np
from PIL import Image

CACHE = sys.argv[1] if len(sys.argv) > 1 else None
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/assets/human'
if not CACHE:
    print(__doc__); sys.exit(1)
TILE_URL = 'https://portal.spatial.nsw.gov.au/aid/tile/rest/services/NSWWebImagery/MapServer/tile/{z}/{y}/{x}'
# the older NSW_Imagery map service: at pixel sizes over 2 m it draws only Spatial Services' own 2008 ADS40
# survey (and Landsat 2014 offshore), per its Footprint layer; the newer basemap's coarse zooms may be
# third-party satellite imagery (its item lists SPOT / Airbus DS), so the mid and coarse levels come from here
EXPORT_URL = ('https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export'
              '?bbox={w},{s},{e},{n}&bboxSR=4326&imageSR=4326&size={W},{H}&format=png24&transparent=false&f={f}')
UA = 'Mozilla/5.0 (compatible; open-data-fetch)'

site = open('src/landmarks/human/site.ts', encoding='utf8').read()
LAT0 = float(re.search(r'ORIGIN_LAT\s*=\s*(-?[\d.]+)', site).group(1))
LON0 = float(re.search(r'ORIGIN_LON\s*=\s*(-?[\d.]+)', site).group(1))
f0 = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * f0) + 1.175 * math.cos(4 * f0)
M_LON = 111412.84 * math.cos(f0) - 93.5 * math.cos(3 * f0)

# name, centre (x, z) in map metres, half-width (m), sizes to write (px), source (tile zoom, or 'export')
LODS = [
    ('fine', (256.0, -512.0), 1024.0, [4096, 2048], 18),        # 0.5 m/px: the beach, Collins Point, the rock pool, the surf club
    ('mid', (0.0, -512.0), 4096.0, [2048, 1024], 'export'),     # 4 m/px: Woonona, Bellambi, Bulli, the foot of the escarpment
    ('coarse', (0.0, 0.0), 12800.0, [2048], 'export'),          # 12.5 m/px: the coast and the escarpment, Sandon Point to Wollongong
]

# ------------------------------------------------------------------ tiles
os.makedirs(os.path.join(CACHE, 'nswimg'), exist_ok=True)
fetched = 0
def tile(z, x, y):
    global fetched
    p = os.path.join(CACHE, 'nswimg', f'{z}_{x}_{y}.jpg')
    if not os.path.exists(p):
        req = urllib.request.Request(TILE_URL.format(z=z, x=x, y=y), headers={'User-Agent': UA})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                break
            except Exception as e:
                if attempt == 2: raise
                time.sleep(2 + attempt * 3)
        with open(p, 'wb') as f: f.write(data)
        fetched += 1
        time.sleep(0.12)
    im = Image.open(p).convert('RGB')
    if im.size != (256, 256): im = im.resize((256, 256))
    return np.asarray(im)

def merc(lat, lon, z):
    n = 2 ** z * 256
    r = np.radians(lat)
    return (lon + 180) / 360 * n, (1 - np.log(np.tan(r) + 1 / np.cos(r)) / math.pi) / 2 * n

def grid(centre, half, N):
    c = (np.arange(N) + 0.5) / N * 2 * half - half
    x = centre[0] + c[None, :].repeat(N, 0)
    z = centre[1] + c[:, None].repeat(N, 1)
    return x, z

def export(centre, half, N):
    """One export request in EPSG:4326, which is linear in the local metre frame: only the aspect differs."""
    lon0, lon1 = LON0 + (centre[0] - half) / M_LON, LON0 + (centre[0] + half) / M_LON
    lat1, lat0 = LAT0 - (centre[1] - half) / M_LAT, LAT0 - (centre[1] + half) / M_LAT  # north, south
    W = int(round(N * (lon1 - lon0) / (lat1 - lat0)))
    args = dict(w=f'{lon0:.7f}', s=f'{lat0:.7f}', e=f'{lon1:.7f}', n=f'{lat1:.7f}', W=W, H=N)
    p = os.path.join(CACHE, 'nswimg', f'export_{centre[0]:.0f}_{centre[1]:.0f}_{half:.0f}_{N}.png')
    if not os.path.exists(p):
        req = urllib.request.Request(EXPORT_URL.format(f='json', **args), headers={'User-Agent': UA})
        info = json.load(urllib.request.urlopen(req, timeout=120))
        json.dump(info, open(p + '.json', 'w'))
        time.sleep(1)
        req = urllib.request.Request(EXPORT_URL.format(f='image', **args), headers={'User-Agent': UA})
        data = urllib.request.urlopen(req, timeout=300).read()
        open(p, 'wb').write(data)
        global fetched; fetched += 2
    info = json.load(open(p + '.json'))
    ext = info['extent']
    # the server keeps its pixels square in degrees, nudging the extent by a fraction of a pixel: resample
    # from the extent it reports so the image lands exactly on the local grid
    print(f'  export extent {ext["xmin"]:.7f},{ext["ymin"]:.7f},{ext["xmax"]:.7f},{ext["ymax"]:.7f} ({info["width"]}x{info["height"]})', flush=True)
    M = np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
    assert M.shape[1] == info['width'] and M.shape[0] == info['height'], M.shape
    x, zz = grid(centre, half, N)
    lat = LAT0 - zz / M_LAT; lon = LON0 + x / M_LON
    px = (lon - ext['xmin']) / (ext['xmax'] - ext['xmin']) * M.shape[1] - 0.5
    py = (ext['ymax'] - lat) / (ext['ymax'] - ext['ymin']) * M.shape[0] - 0.5
    i0 = np.clip(np.floor(px).astype(int), 0, M.shape[1] - 2); j0 = np.clip(np.floor(py).astype(int), 0, M.shape[0] - 2)
    u = np.clip(px - i0, 0, 1)[..., None]; v = np.clip(py - j0, 0, 1)[..., None]
    return M[j0, i0] * (1 - u) * (1 - v) + M[j0, i0 + 1] * u * (1 - v) + M[j0 + 1, i0] * (1 - u) * v + M[j0 + 1, i0 + 1] * u * v

def aerial_mask(img, x, z):
    """1 where the export draws the 2008 ADS40 aerial survey, 0 where it falls back to Landsat 2014 (the
    service's footprints are whole-block extents, so the fill is found from its colour instead: Landsat's
    land is blue-green and dim where the aerial survey's is warm). The sea does not matter here."""
    land = height(x, z) > 1.0
    r, b = img[..., 0], img[..., 2]
    k = 3
    rb = blur(b, k) - blur(r, k)
    ls = (rb > 2.0) & land
    # a majority filter (~250 m) cleans speckle; the fill comes in blocks kilometres across
    m = blur(ls.astype(np.float32), 10) > 0.5
    return np.where(land, ~m, True).astype(np.float32)

def harmonise(img, mask, mpp):
    """Bring the Landsat fill to the aerial survey's colour: a smooth per-channel gain field estimated
    from the land on either side of the boundary (radius ~1.5 km), applied where the mask is 0."""
    if mask.min() > 0.5: return img
    r = max(2, int(round(1500 / mpp / 3)))
    lum = img.mean(-1)
    land = (lum > 25).astype(np.float32)  # skip the dark sea
    a = mask * land; l = (1 - mask) * land
    mA = blur(img * a[..., None], r) / np.maximum(blur(a, r), 1e-3)[..., None]
    mL = blur(img * l[..., None], r) / np.maximum(blur(l, r), 1e-3)[..., None]
    ok = (blur(a, r) > 0.05) & (blur(l, r) > 0.05)
    gl = np.array([np.median((mA / np.maximum(mL, 1))[..., c][ok]) for c in range(3)]) if ok.any() else np.ones(3)
    gain = np.where(ok[..., None], mA / np.maximum(mL, 1), gl)
    # smooth the gain field again and keep it sane
    gain = np.clip(blur(gain, r), 0.5, 2.0)
    soft = blur(mask, max(1, int(round(60 / mpp))))  # feather the block edges over ~100 m
    return img * (soft[..., None] + (1 - soft[..., None]) * gain)

def render(centre, half, N, z):
    if z == 'export':
        img = export(centre, half, N)
        x, zz = grid(centre, half, N)
        m = aerial_mask(img, x, zz)
        print(f'  ADS40 aerial survey covers {m.mean() * 100:.0f}% of the level (the rest is Landsat)', flush=True)
        Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(CACHE, f'mask_{half:.0f}.png'))
        return harmonise(img, m, 2 * half / N)
    x, zz = grid(centre, half, N)
    lat = LAT0 - zz / M_LAT
    lon = LON0 + x / M_LON
    X, Y = merc(lat, lon, z)
    X -= 0.5; Y -= 0.5  # pixel centres
    tx0, tx1 = int(np.floor(X.min() / 256)), int(np.floor((X.max() + 1) / 256))
    ty0, ty1 = int(np.floor(Y.min() / 256)), int(np.floor((Y.max() + 1) / 256))
    print(f'  zoom {z}: tiles {tx1 - tx0 + 1} x {ty1 - ty0 + 1}', flush=True)
    M = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            M[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = tile(z, tx, ty)
    M = M.astype(np.float32)
    px = X - tx0 * 256; py = Y - ty0 * 256
    i0 = np.clip(np.floor(px).astype(int), 0, M.shape[1] - 2); j0 = np.clip(np.floor(py).astype(int), 0, M.shape[0] - 2)
    u = np.clip(px - i0, 0, 1)[..., None]; v = np.clip(py - j0, 0, 1)[..., None]
    return (M[j0, i0] * (1 - u) * (1 - v) + M[j0, i0 + 1] * u * (1 - v) + M[j0 + 1, i0] * (1 - u) * v + M[j0 + 1, i0 + 1] * u * v)

# ------------------------------------------------------------------ baked site data (heights, cover, features)
SITE_DIR = 'public/assets/human'  # the baked site data (inputs) always come from here
def png_rgb(p): return np.asarray(Image.open(os.path.join(SITE_DIR, p)).convert('RGBA')).astype(np.float32)
feat = json.load(open(os.path.join(SITE_DIR, 'features.json')))
G = feat['grids']
hf = png_rgb('height_fine.png'); hc = png_rgb('height_coarse.png')
Hf = (hf[..., 0] * 256 + hf[..., 1]) / 50 - 100
Hc = (hc[..., 0] * 256 + hc[..., 1]) / 50 - 100
cov = png_rgb('cover.png'); covm = png_rgb('cover_mid.png')

def sample(A, n, cell, x, z):
    half = n * cell / 2
    fx = np.clip((x + half) / cell - 0.5, 0, n - 1.001); fz = np.clip((z + half) / cell - 0.5, 0, n - 1.001)
    i = np.floor(fx).astype(int); j = np.floor(fz).astype(int); u = fx - i; v = fz - j
    if A.ndim == 3: u = u[..., None]; v = v[..., None]
    return A[j, i] * (1 - u) * (1 - v) + A[j, i + 1] * u * (1 - v) + A[j + 1, i] * (1 - u) * v + A[j + 1, i + 1] * u * v

def height(x, z):
    fh = G['fine']['n'] * G['fine']['cell'] / 2
    e = np.maximum(np.abs(x), np.abs(z))
    h = sample(Hc, G['coarse']['n'], G['coarse']['cell'], x, z)
    inner = e < fh - 15
    if inner.any():
        f = sample(Hf, G['fine']['n'], G['fine']['cell'], x, z)
        b = np.clip((e - (fh - 160)) / 145, 0, 1); b = b * b * (3 - 2 * b)
        h = np.where(inner, f + (h - f) * b, h)
    return h

def cover(x, z):
    """(sand, scrub, wood, rock) 0..1, fine cover blended into mid."""
    a = sample(cov, G['cover']['n'], G['cover']['cell'], x, z) / 255
    m = sample(covm, G['coverMid']['n'], G['coverMid']['cell'], x, z) / 255
    fh = G['cover']['n'] * G['cover']['cell'] / 2; mh = G['coverMid']['n'] * G['coverMid']['cell'] / 2
    e = np.maximum(np.abs(x), np.abs(z))[..., None]
    b = np.clip((e - (fh - 90)) / 80, 0, 1)
    out = a * (1 - b) + m * b
    return np.where(e > mh, 0, out)

def blur(a, r):
    """Separable box blur (3 passes ~ gaussian), edge-clamped. a: HxW or HxWxC."""
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if k == ax else (0, 0) for k in range(a.ndim)], mode='edge'), axis=ax)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[ax]), axis=ax); lo = np.take(c, np.arange(0, c.shape[ax] - 2 * r - 1), axis=ax)
            a = (hi - lo) / (2 * r + 1)
    return a

def clean_sea(img, x, z, mpp):
    """Over the sea, replace whitewash and bright wave faces with the surrounding water colour."""
    h = height(x, z)
    sea = h < -0.15
    if not sea.any(): return img, 0.0
    lum = img.mean(-1)
    sat = img.max(-1) - img.min(-1)
    # foam: bright and grey; local water: what remains, filled by normalised convolution
    r = max(2, int(round(12 / mpp)))
    base = blur(np.where(sea, lum, np.nan_to_num(lum)), r)
    foam = sea & (((lum > base + 18) & (sat < 60)) | (lum > 150))
    # grow the mask a little so the soft fringes of the whitewash go too
    foam = blur(foam.astype(np.float32), max(1, int(round(1.5 / mpp)))) > 0.08
    foam &= sea
    w = (sea & ~foam).astype(np.float32)
    out = img.copy()
    acc = np.zeros_like(img); wsum = np.zeros(img.shape[:2], np.float32)
    rr = r
    filled = np.zeros(img.shape[:2], bool)
    for _ in range(6):
        num = blur(img * w[..., None], rr); den = blur(w, rr)
        ok = foam & ~filled & (den > 0.05)
        out[ok] = num[ok] / den[ok][..., None]
        filled |= ok
        if (foam & ~filled).sum() == 0: break
        rr *= 2
    # soften the seam between replaced and kept water
    m = blur(foam.astype(np.float32), max(1, int(round(2 / mpp))))[..., None]
    soft = blur(out, max(1, int(round(3 / mpp))))
    out = np.where(sea[..., None], out * (1 - m) + (soft * m), out)
    return out, float(foam.sum() / max(sea.sum(), 1))

def match(src, ref, mask):
    """Per-channel mean/std transfer of src towards ref over mask (both float 0..255)."""
    out = src.copy()
    for c in range(3):
        s = src[..., c][mask]; r = ref[..., c][mask]
        if s.size < 100: return out
        g = np.clip(r.std() / max(s.std(), 1e-3), 0.7, 1.4)
        out[..., c] = (src[..., c] - s.mean()) * g + r.mean()
    return out

# ------------------------------------------------------------------ build each level
meta = {'source': 'NSW Spatial Services, NSW Imagery Basemap (NSWWebImagery), CC BY',
        'tiles': TILE_URL, 'origin': [LAT0, LON0], 'levels': {}}
rendered = {}
for name, centre, half, sizes, z in LODS:
    N = sizes[0]
    print(f'{name}: {2 * half:.0f} m square at {2 * half / N:.2f} m/px ({"zoom " + str(z) + " tiles" if z != "export" else "map export"})', flush=True)
    img = render(centre, half, N, z)
    x, zz = grid(centre, half, N)
    img, frac = clean_sea(img, x, zz, 2 * half / N)
    print(f'  whitewash replaced on {frac * 100:.1f}% of the sea', flush=True)
    rendered[name] = (img, centre, half)
    meta['levels'][name] = {'centre': list(centre), 'half': half, 'sizes': sizes, 'mPerPx': 2 * half / N, 'tileZoom': z}

# colour-match coarse -> mid -> fine over their overlaps (finer levels are the reference)
def resample_into(dst_name, src_name):
    """The src level's pixels over the dst level's grid (nearest is fine after a blur)."""
    simg, sc, sh = rendered[src_name]; dimg, dc, dh = rendered[dst_name]
    Nd = dimg.shape[0]; Ns = simg.shape[0]
    x, zz = grid(dc, dh, Nd)
    i = np.clip(((x - sc[0] + sh) / (2 * sh) * Ns).astype(int), 0, Ns - 1)
    j = np.clip(((zz - sc[1] + sh) / (2 * sh) * Ns).astype(int), 0, Ns - 1)
    inside = (np.abs(x - sc[0]) < sh) & (np.abs(zz - sc[1]) < sh)
    return simg[j, i], inside
def downsample(img, k):
    H = img.shape[0] // k
    return img[:H * k, :H * k].reshape(H, k, H, k, 3).mean((1, 3))
for coarse_name, fine_name in (('mid', 'fine'), ('coarse', 'mid')):
    cimg, cc, ch = rendered[coarse_name]
    k = 1
    fdown = blur(rendered[fine_name][0], 2)
    ref, inside = resample_into(coarse_name, fine_name)
    mask = inside.copy()
    mask[:] &= True
    # land only (the sea is replaced at runtime anyway)
    x, zz = grid(cc, ch, cimg.shape[0])
    mask &= height(x, zz) > 0.5
    cblur = blur(cimg, 1)
    matched = match(cimg, ref, mask)
    rendered[coarse_name] = (matched, cc, ch)
    d = np.abs(blur(matched, 1) - ref)[mask].mean() if mask.any() else 0
    print(f'{coarse_name} matched to {fine_name} over {mask.sum()} px (mean |diff| after: {d:.1f}/255)', flush=True)

# ------------------------------------------------------------------ statistics for the runtime
# photo colour of the beach sand and the lawns/bush (linear, for the shader's calibration)
def lin(c): c = c / 255.0; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
img, c, h = rendered['fine']
x, zz = grid(c, h, img.shape[0])
cv = cover(x, zz); hh = height(x, zz)
sandM = (cv[..., 0] > 0.8) & (hh > 1.6) & (hh < 6)
meta['sandLinear'] = [round(float(v), 4) for v in lin(img[sandM]).mean(0)]
vegM = ((cv[..., 1] > 0.8) | (cv[..., 2] > 0.8)) & (hh > 2)
meta['vegLinear'] = [round(float(v), 4) for v in lin(img[vegM]).mean(0)] if vegM.any() else None
print('photo sand (linear):', meta['sandLinear'], ' scrub/wood:', meta['vegLinear'])

# ------------------------------------------------------------------ write
os.makedirs(OUT, exist_ok=True)
total = 0
for name, (img, c, h) in rendered.items():
    sizes = meta['levels'][name]['sizes']
    im = Image.fromarray(np.clip(img + 0.5, 0, 255).astype(np.uint8))
    meta['levels'][name]['files'] = {}
    for n in sizes:
        f = f'aerial_{name}_{n}.webp'
        (im if n == im.size[0] else im.resize((n, n), Image.LANCZOS)).save(os.path.join(OUT, f), 'WEBP', quality=88 if name == 'fine' else 85, method=6)
        sz = os.path.getsize(os.path.join(OUT, f)); total += sz
        meta['levels'][name]['files'][str(n)] = f
        print(f'  {f}: {sz / 1e6:.2f} MB')

# ------------------------------------------------------------------ which buildings / trees agree with the photo
fb = np.fromfile(os.path.join(SITE_DIR, 'features.bin'), dtype='<i2')
nb, nt, nosm = feat['counts']['bld'], feat['counts']['trees'], feat['counts']['osmBld']
bld = fb[:nb * 8].reshape(nb, 8).astype(np.float32)
trees = fb[nb * 8:nb * 8 + nt * 5].reshape(nt, 5).astype(np.float32)
def photo_at(px, pz):
    """Photo colour (0..255) at points, from the finest level that covers them (blurred ~2 m)."""
    out = np.full((px.size, 3), np.nan, np.float32)
    for name in ('coarse', 'mid', 'fine'):
        img, c, h = rendered[name]
        N = img.shape[0]
        k = max(1, int(round(1.0 / (2 * h / N))))
        b = blur(img, k) if name == 'fine' else img
        inside = (np.abs(px - c[0]) < h * 0.995) & (np.abs(pz - c[1]) < h * 0.995)
        i = np.clip(((px - c[0] + h) / (2 * h) * N).astype(int), 0, N - 1)
        j = np.clip(((pz - c[1] + h) / (2 * h) * N).astype(int), 0, N - 1)
        out[inside] = b[j[inside], i[inside]]
    return out
def greenness(c):
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    return (2 * g - r - b) / np.maximum(r + g + b, 1)
keep_b = np.ones(nb, np.uint8)
gen = np.arange(nb) >= nosm
pc = photo_at(bld[:, 0] / 10, bld[:, 1] / 10)
gr = greenness(pc)
dark = pc.mean(1) < 55
# a generated house standing on lawn, bush or tree canopy contradicts the photo
keep_b[gen & ~np.isnan(gr) & ((gr > 0.06) | (dark & (gr > 0.0)))] = 0
pt = photo_at(trees[:, 0] / 10, trees[:, 1] / 10)
gt = greenness(pt)
keep_t = np.ones(nt, np.uint8)
# a tree must stand on photo vegetation (greenish, or the dark olive of eucalypt and banksia canopy)
lumt = pt.mean(1)
veg = (gt > 0.03) | ((lumt < 85) & (gt > 0.0))
keep_t[~np.isnan(gt) & ~veg] = 0
open(os.path.join(OUT, 'aerial_keep.bin'), 'wb').write(keep_b.tobytes() + keep_t.tobytes())

# photo vegetation (0..255) on the land-cover grid (2.5 m over 2560 m): where the bush and the woodland really
# are, so the runtime raises its canopy relief only under real canopy
cn, cc = G['cover']['n'], G['cover']['cell']
cg = (np.arange(cn) + 0.5) * cc - cn * cc / 2
vx = cg[None, :].repeat(cn, 0).ravel(); vz = cg[:, None].repeat(cn, 1).ravel()
pv = photo_at(vx, vz)
gv = greenness(np.nan_to_num(pv, nan=128.0)); lv = np.nan_to_num(pv, nan=128.0).mean(1)
veg = np.clip((gv - 0.03) / 0.06, 0, 1)
veg = np.maximum(veg, np.clip((85 - lv) / 25, 0, 1) * np.clip(gv / 0.03, 0, 1))
veg = veg.reshape(cn, cn)
veg = np.where(height(vx, vz).reshape(cn, cn) < 0.3, 0, veg)
veg = blur(veg.astype(np.float32), 1)
Image.fromarray(np.clip(veg * 255 + 0.5, 0, 255).astype(np.uint8), 'L').save(os.path.join(OUT, 'aerial_veg.png'), optimize=True)
print('aerial_veg.png:', os.path.getsize(os.path.join(OUT, 'aerial_veg.png')) // 1024, 'KB; vegetated', round(float((veg > 0.5).mean()) * 100), '%')
meta['keep'] = {'bld': int(nb), 'trees': int(nt), 'bldKept': int(keep_b.sum()), 'genKept': int(keep_b[gen].sum()), 'gen': int(gen.sum()), 'treesKept': int(keep_t.sum())}
print('keep:', meta['keep'])
meta['downloaded'] = time.strftime('%Y-%m-%d')
json.dump(meta, open(os.path.join(OUT, 'aerial.json'), 'w'), indent=1)
total += os.path.getsize(os.path.join(OUT, 'aerial_keep.bin')) + os.path.getsize(os.path.join(OUT, 'aerial_veg.png'))
print(f'tiles fetched this run: {fetched}; imagery written: {total / 1e6:.2f} MB')
