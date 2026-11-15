#!/usr/bin/env python3
"""
Fetches the NSW 5 m elevation model (NSW Spatial Services "NSW_5M_Elevation" image service, CC BY; see
src/landmarks/human/CREDITS.md) around the Woonona Beach standing spot for tools/build-woonona.mjs.

    python3 -I tools/fetch-nsw-dem.py <rawDir>

Writes <rawDir>/nsw5m/{fine,coarse}.f32 (little-endian float32, row 0 = north) and .json (the extent the
server returned, in degrees, and the size). Two requests in EPSG:4326, which is linear in the bake's local
metre frame:
  fine    the 2560 m fine height grid (+ margin) sampled every 2.5 m
  coarse  the 20.48 km coarse height grid (+ margin) sampled every 20 m
"""
import json, math, os, re, sys, time, urllib.request
import numpy as np
from PIL import Image

RAW = sys.argv[1] if len(sys.argv) > 1 else None
if not RAW: print(__doc__); sys.exit(1)
URL = ('https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer/exportImage'
       '?bbox={w},{s},{e},{n}&bboxSR=4326&imageSR=4326&size={W},{H}&format=tiff&pixelType=F32'
       '&interpolation=RSP_BilinearInterpolation&f={f}')
UA = 'Mozilla/5.0 (compatible; open-data-fetch)'
site = open('src/landmarks/human/site.ts', encoding='utf8').read()
LAT0 = float(re.search(r'ORIGIN_LAT\s*=\s*(-?[\d.]+)', site).group(1))
LON0 = float(re.search(r'ORIGIN_LON\s*=\s*(-?[\d.]+)', site).group(1))
f0 = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * f0) + 1.175 * math.cos(4 * f0)
M_LON = 111412.84 * math.cos(f0) - 93.5 * math.cos(3 * f0)
os.makedirs(os.path.join(RAW, 'nsw5m'), exist_ok=True)

for name, half, step in (('fine', 1280 + 40, 2.5), ('coarse', 10240 + 200, 20.0)):
    out = os.path.join(RAW, 'nsw5m', name)
    if os.path.exists(out + '.f32'):
        print(name, 'cached'); continue
    H = int(round(2 * half / step))
    lon0, lon1 = LON0 - half / M_LON, LON0 + half / M_LON
    lat0, lat1 = LAT0 - half / M_LAT, LAT0 + half / M_LAT
    W = int(round(H * (half / M_LON) / (half / M_LAT)))  # square pixels in degrees
    args = dict(w=f'{lon0:.7f}', s=f'{lat0:.7f}', e=f'{lon1:.7f}', n=f'{lat1:.7f}', W=W, H=H)
    # the json answer carries the extent the server used and a link to the rendered file (one render)
    info = json.load(urllib.request.urlopen(urllib.request.Request(URL.format(f='json', **args), headers={'User-Agent': UA}), timeout=600))
    time.sleep(1)
    try:
        tif = urllib.request.urlopen(urllib.request.Request(info['href'].replace('http://', 'https://'), headers={'User-Agent': UA}), timeout=600).read()
    except Exception:  # the rendered file can expire: ask for the image itself
        time.sleep(2)
        tif = urllib.request.urlopen(urllib.request.Request(URL.format(f='image', **args), headers={'User-Agent': UA}), timeout=900).read()
    tmp = out + '.tif'
    open(tmp, 'wb').write(tif)
    a = np.asarray(Image.open(tmp)).astype('<f4')
    assert a.shape == (info['height'], info['width']), (a.shape, info)
    a.tofile(out + '.f32')
    json.dump({'extent': info['extent'], 'width': info['width'], 'height': info['height'],
               'source': URL.split('?')[0], 'downloaded': time.strftime('%Y-%m-%d')}, open(out + '.json', 'w'))
    os.remove(tmp)
    print(name, a.shape, 'min', float(a.min()), 'max', float(a.max()))
