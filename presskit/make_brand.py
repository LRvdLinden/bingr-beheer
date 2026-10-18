#!/usr/bin/env python3
"""Maakt het Bingr-logo als SVG voor de presskit (presskit/brand/logo/), met de letters als paden (geen lettertype nodig).

Zelfde opbouw als .logo in bingr-website/assets/css/site.css: BINGR in Inter Black (900), letter-spacing .02em,
line-height 1, daaronder een rode balk (#E50914) van 4 % tot 96 % van de breedte, .11em hoog, onderaan een padding van .16em.
De PNG's maakt presskit/render_brand.mjs (Playwright/Chromium) uit deze SVG's.

    python3 presskit/make_brand.py [--font /pad/naar/Inter-Black.otf]
"""
import argparse
import os

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

RED = "#E50914"
TEXT = "BINGR"
EM = 1000.0  # eenheden per em in de SVG


def build(font_path):
    f = TTFont(font_path)
    upm = f["head"].unitsPerEm
    asc, desc = f["hhea"].ascent / upm, -f["hhea"].descent / upm
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    s = EM / upm
    # CSS: line-height 1 -> basislijn op (1 - (asc + desc)) / 2 + asc
    base = ((1 - (asc + desc)) / 2 + asc) * EM
    x = 0.0
    paths, bounds = [], [None, None, None, None]
    for ch in TEXT:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        # y omdraaien (SVG: omlaag positief)
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, base)))
        paths.append(pen.getCommands())
        bp = BoundsPen(gs)
        gs[g].draw(TransformPen(bp, (s, 0, 0, -s, x, base)))
        if bp.bounds:
            b = bp.bounds
            bounds = [min(v, w) if v is not None else w for v, w in zip(bounds[:2], b[:2])] + \
                     [max(v, w) if v is not None else w for v, w in zip(bounds[2:], b[2:])]
        x += f["hmtx"][g][0] * s + 0.02 * EM  # letter-spacing .02em na elke letter (zoals CSS)
    width = x
    bar = (0.04 * width, 1.05 * EM, 0.92 * width, 0.11 * EM)  # x, y, w, h (padding-bottom .16em, balk .11em)
    x0 = min(bounds[0], bar[0])
    y0 = bounds[1]
    x1 = max(bounds[2], bar[0] + bar[2])
    y1 = bar[1] + bar[3]
    return paths, bar, (x0, y0, x1 - x0, y1 - y0)


def svg(paths, bar, box, fill):
    x0, y0, w, h = box
    r = bar[3] / 2
    d = " ".join(paths)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.1f} {y0:.1f} {w:.1f} {h:.1f}" '
        f'width="{w:.0f}" height="{h:.0f}" role="img" aria-label="Bingr">\n'
        '  <title>Bingr</title>\n'
        f'  <path fill="{fill}" d="{d}"/>\n'
        f'  <rect fill="{RED}" x="{bar[0]:.1f}" y="{bar[1]:.1f}" width="{bar[2]:.1f}" height="{bar[3]:.1f}" rx="{r:.1f}"/>\n'
        '</svg>\n'
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default="/usr/share/fonts/opentype/inter/Inter-Black.otf")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "brand", "logo"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    paths, bar, box = build(a.font)
    for name, fill in (("Bingr-logo-white.svg", "#FFFFFF"), ("Bingr-logo-black.svg", "#000000")):
        with open(os.path.join(a.out, name), "w", encoding="utf-8") as fh:
            fh.write(svg(paths, bar, box, fill))
    print("logo:", " x ".join(f"{v:.0f}" for v in box[2:]))


if __name__ == "__main__":
    main()
