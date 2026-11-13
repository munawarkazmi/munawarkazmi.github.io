#!/usr/bin/env python3
"""Recolour the project figures into the site's palette.

The figures in projects/img/ and assets/ are rendered by each project's own
repository, in that repository's colours. This writes a copy of each into
projects/imgp/ with the same pixels in the site's colours: greens and blues
become periwinkle, reds become orange, tans become a pale periwinkle, the
plot background becomes transparent, and a white-background figure is
turned dark first. Only colour changes; no mark is moved, added or removed.

    python tools/recolour_figures.py        rewrite every recoloured copy

Run it again whenever a figure in projects/img/ is refreshed from its repository.
Needs Pillow and numpy.
"""
from pathlib import Path
import colorsys, re, sys
import numpy as np
from PIL import Image

SITE = Path(__file__).resolve().parent.parent
OUT = SITE / "projects" / "imgp"
EXTRA = ["assets/legibility-bounds-intervals.png", "assets/degregorio-blowup-regimes.png"]


def remap(h, s, v):
    """h in degrees, s and v in 0..1 (numpy arrays). Returns the site-palette h, s, v."""
    H, S, V = h.copy(), s.copy(), v.copy()
    grey = s < 0.12
    red = ~grey & ((h >= 345) | (h < 20))
    tan = ~grey & (h >= 20) & (h < 60)
    green = ~grey & (h >= 60) & (h < 170)
    blue = ~grey & (h >= 170) & (h < 345)
    H[grey] = 228; S[grey] = s[grey] * 0.5 + 0.02
    H[red] = 24; S[red] = np.maximum(s[red], 0.72); V[red] = np.minimum(1, v[red] * 1.12)
    H[tan] = 228; S[tan] = np.minimum(s[tan], 0.30) * 0.6; V[tan] = np.minimum(1, v[tan] * 1.15)
    H[green] = 228; S[green] = 0.52; V[green] = np.minimum(1, v[green] * 1.25)
    H[blue] = 228
    return H, S, V


def rgb_to_hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1); d = mx - mn
    h = np.zeros_like(mx); m = d > 1e-9
    i = m & (mx == r); h[i] = ((g - b)[i] / d[i]) % 6
    i = m & (mx == g) & (mx != r); h[i] = (b - r)[i] / d[i] + 2
    i = m & (mx == b) & (mx != r) & (mx != g); h[i] = (r - g)[i] / d[i] + 4
    s = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0)
    return h * 60, s, mx


def hsv_to_rgb(h, s, v):
    h = (h % 360) / 60; i = np.floor(h); f = h - i
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    i = i.astype(int) % 6
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)


def recolour_array(im):
    """RGBA floats in, RGBA floats out."""
    rgb, alpha = im[..., :3], im[..., 3].copy()
    corner = rgb[3, 3]
    if corner.mean() > 0.6:                       # a white-background figure: turn it dark, hue kept
        h, s, v = rgb_to_hsv(rgb)
        lum = rgb.max(-1) / 2 + rgb.min(-1) / 2
        target = 1 - lum                          # flip lightness
        v2 = np.clip(target * 2 / (2 - s + 1e-9), 0, 1)
        rgb = hsv_to_rgb(h, np.where(target > 0.92, s * 0.3, s), v2)
        corner = rgb[3, 3]
    alpha[np.abs(rgb - corner).max(-1) < 0.02] = 0   # the plot background shows the page through
    h, s, v = rgb_to_hsv(rgb)
    return np.dstack([hsv_to_rgb(*remap(h, s, v)), alpha])


def to_image(a):
    return Image.fromarray((a * 255).round().astype("uint8"), "RGBA")


def recolour_png(src: Path, dst: Path):
    to_image(recolour_array(np.asarray(Image.open(src).convert("RGBA")).astype(float) / 255)).save(dst, optimize=True)


def recolour_gif(src: Path, dst: Path):
    """An animation keeps a solid plate behind it, since GIF transparency is one bit."""
    g = Image.open(src); frames, times = [], []
    for i in range(getattr(g, "n_frames", 1)):
        g.seek(i)
        f = to_image(recolour_array(np.asarray(g.convert("RGBA")).astype(float) / 255))
        plate = Image.new("RGBA", f.size, (15, 16, 21, 255)); plate.alpha_composite(f)
        frames.append(plate.convert("P", palette=Image.ADAPTIVE, colors=128)); times.append(g.info.get("duration", 80))
    frames[0].save(dst, save_all=True, append_images=frames[1:], duration=times, loop=0, optimize=True)


def recolour_hex(hexs: str) -> str:
    r, g, b = (int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    H, S, V = remap(np.array([h * 360]), np.array([s]), np.array([v]))
    r, g, b = colorsys.hsv_to_rgb(H[0] / 360, S[0], V[0])
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


def recolour_svg(src: Path, dst: Path):
    t = src.read_text(encoding="utf-8")
    t = re.sub(r'(<rect width="\d+" height="\d+" fill=")#121214(")', r"\1none\2", t, count=1)
    t = re.sub(r"#[0-9A-Fa-f]{6}\b", lambda m: recolour_hex(m.group(0)), t)
    t = t.replace('font-family="Segoe UI, Arial, sans-serif"', 'font-family="IBM Plex Sans, Segoe UI, Arial, sans-serif"')
    dst.write_text(t, encoding="utf-8")


def main():
    OUT.mkdir(exist_ok=True)
    n = 0
    for src in sorted((SITE / "projects" / "img").glob("*.png")) + [SITE / p for p in EXTRA]:
        recolour_png(src, OUT / src.name); n += 1
    for src in sorted((SITE / "projects" / "img").glob("*.svg")):
        recolour_svg(src, OUT / src.name); n += 1
    recolour_gif(SITE / "assets" / "legible-motion-bench.gif", OUT / "legible-motion-bench.gif"); n += 1
    print(f"recoloured {n} figures into {OUT.relative_to(SITE)}")


if __name__ == "__main__":
    sys.exit(main())
