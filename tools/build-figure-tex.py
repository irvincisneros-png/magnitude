"""
Textures of the `human` landmark's figure from the Microsoft Rocketbox avatar Male_Adult_01 (MIT).

  python3 -I tools/build-figure-tex.py <rocketbox_dir> [<more_dirs>…] <out_dir>

The input folders hold the m002_*.tga textures of Male_Adult_01 (colour, normal, specular, opacity).
Writes into <out_dir> (public/assets/human/figure/), per tier (2048 'h', 1024 'l'):
  body_{h,l}.jpg, head_{h,l}.jpg   colour (sRGB), UV-island gutters padded so mipmaps don't bleed black
  hairc_{h,l}.webp                 hair cards: colour + opacity in alpha
  bodyn_{h,l}.jpg, headn_{h,l}.jpg tangent-space normal XY in RG (Z is rebuilt), specular level in B
  mask.png (512²)                  R: bare skin on the body texture, G: bare skin on the head texture,
                                   B: the hair painted on the head texture (the scalp under the cards)
Needs Pillow and numpy.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter

SRCS, OUT = sys.argv[1:-1], sys.argv[-1]
os.makedirs(OUT, exist_ok=True)


def load(name, mode='RGB'):
    path = next(os.path.join(d, name) for d in SRCS if os.path.exists(os.path.join(d, name)))
    return Image.open(path).convert(mode)


def pad(rgb, mask, rounds=9):
    """Fill pixels outside mask (UV gutters) with the colour of the nearest island, pyramid style."""
    c = np.asarray(rgb, dtype=np.float32)
    m = np.asarray(mask, dtype=np.float32)[..., None] / 255.0
    out = c * m
    filled = m.copy()
    acc_c, acc_m = c * m, m
    for r in range(rounds):
        k = 2 ** r
        bc = np.asarray(Image.fromarray(np.clip(acc_c, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(k)), dtype=np.float32)
        bm = np.asarray(Image.fromarray((acc_m[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(k)), dtype=np.float32)[..., None] / 255.0
        est = bc / np.maximum(bm, 1e-4)
        need = (filled < 0.5) & (bm > 0.02)
        out = np.where(need, est, out)
        filled = np.where(need, 1.0, filled)
        acc_c, acc_m = out * filled, filled
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def coverage(rgb, thr=6):
    a = np.asarray(rgb, dtype=np.int32).sum(-1) > thr
    return Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))


def skin_mask(rgb):
    hsv = np.asarray(rgb.convert('HSV'), dtype=np.float32) / 255.0
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    d = np.abs(h - 12.0)
    d = np.minimum(d, 360.0 - d)
    hue = np.clip(1 - np.maximum(d - 16, 0) / 10, 0, 1)
    sat = np.clip((s - 0.16) / 0.08, 0, 1)
    val = np.clip((v - 0.30) / 0.08, 0, 1)
    m = (hue * sat * val * 255).astype(np.uint8)
    # morphological opening removes the thin brown edges of the shirt's stripes
    return Image.fromarray(m).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(2))


def save(img, name, size, **kw):
    if img.mode == 'RGBA':
        # resize colour and alpha apart: Pillow resizes RGBA premultiplied, which blackens the padded
        # colour under alpha 0 (and the mipmaps then fringe the cards' edges)
        rgb = img.convert('RGB').resize((size, size), Image.LANCZOS)
        rgb.putalpha(img.split()[3].resize((size, size), Image.LANCZOS))
        img = rgb
    else:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, name), **kw)


body = load('m002_body_color.tga')
head = load('m002_head_color.tga')
cov_b, cov_h = coverage(body), coverage(head)
body_p, head_p = pad(body, cov_b), pad(head, cov_h)
for tag, size in (('h', 2048), ('l', 1024)):
    save(body_p, f'body_{tag}.jpg', size, quality=88, optimize=True, progressive=True)
    save(head_p, f'head_{tag}.jpg', size, quality=88, optimize=True, progressive=True)

# hair cards: colour padded under the opacity so the soft edges of the strands don't fringe (the
# source's semi-transparent fringe texels carry a pale matte colour: only near-solid strands are kept)
hair = load('m002_opacity_color.tga', 'RGBA')
alpha = hair.split()[3]
hc = pad(hair.convert('RGB'), alpha.point(lambda a: 255 if a > 170 else 0))
# feather the cards' straight cut edges (the roots, seen as hard lines from above): close the strands
# into the card's outline, then fade the alpha over the last ~1% of the texture inside that outline
# (the strand tips are already soft, they only lose their last few texels)
poly = alpha.point(lambda a: 255 if a > 40 else 0).filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))
fb = np.asarray(poly.filter(ImageFilter.GaussianBlur(10)), dtype=np.float32) / 255.0
feather = np.clip((fb - 0.5) / 0.45, 0, 1)
feather = feather * feather * (3 - 2 * feather)
alpha = Image.fromarray((np.asarray(alpha, dtype=np.float32) * feather).round().astype(np.uint8))
hrgba = hc.copy()
hrgba.putalpha(alpha)
for tag, size in (('h', 2048), ('l', 1024)):
    # exact: keep the padded colour under alpha 0 (WebP otherwise blackens it, and the mipmaps fringe)
    save(hrgba, f'hairc_{tag}.webp', size, quality=88, method=6, exact=True)

# normal maps: XY in RG, specular level in B
for part, nfile, sfile, cov in (('body', 'm002_body_normal.tga', 'm002_body_specular.tga', cov_b), ('head', 'm002_head_normal.tga', 'm002_head_specular.tga', cov_h)):
    n = load(nfile)
    s = load(sfile).convert('L')
    r, g, _ = pad(n, cov).split()
    s = pad(s.convert('RGB'), cov).convert('L')
    img = Image.merge('RGB', (r, g, s))
    for tag, size in (('h', 2048), ('l', 1024)):
        save(img, f'{part}n_{tag}.jpg', size, quality=90, optimize=True)



def hair_mask(rgb, skin):
    """The dark hair painted on the head texture (top half), minus the face (skin with its holes closed)."""
    v = np.asarray(rgb.convert('HSV'), dtype=np.float32)[..., 2] / 255.0
    rows = (np.arange(v.shape[0]) / v.shape[0] < 0.5)[:, None]
    m = Image.fromarray((np.clip((0.42 - v) / 0.12, 0, 1) * rows * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MinFilter(15)).filter(ImageFilter.MaxFilter(15))
    face = skin.filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.MinFilter(41))
    m = np.asarray(m, dtype=np.float32) * (1 - np.asarray(face, dtype=np.float32) / 255.0)
    return Image.fromarray(m.astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))


mb = skin_mask(body)
mh = skin_mask(head)
mask = Image.merge('RGB', (mb, mh, hair_mask(head, mh)))
mask = pad(mask, Image.fromarray(np.maximum(np.asarray(cov_b), np.asarray(cov_h))))
mask.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'mask.png'), optimize=True)
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))
