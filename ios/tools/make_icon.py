#!/usr/bin/env python3
"""App-icoon van BingrBeheer (1024x1024, zonder transparantie): zwart, wit BINGR, rode balk eronder.

Gebruik: python3 ios/tools/make_icon.py  (schrijft BingrBeheer/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png)
"""
import os
from PIL import Image, ImageDraw, ImageFont

S = 1024
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "BingrBeheer", "Resources", "Assets.xcassets", "AppIcon.appiconset", "AppIcon.png")
FONTS = ["/usr/share/fonts/opentype/inter/Inter-Black.otf", "/System/Library/Fonts/SFNS.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def font(size):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


img = Image.new("RGB", (S, S), (0, 0, 0))
d = ImageDraw.Draw(img)
text = "BINGR"
f = font(250)
l, t, r, b = d.textbbox((0, 0), text, font=f)
w, h = r - l, b - t
x = (S - w) / 2 - l
y = (S - h) / 2 - t - 40
d.text((x, y), text, font=f, fill=(255, 255, 255))
# rode balk onder het woordmerk (zoals op bingr.online)
bar_h = 30
bw = w * 0.92
bx = (S - bw) / 2
by = y + t + h + 46
d.rounded_rectangle((bx, by, bx + bw, by + bar_h), radius=bar_h / 2, fill=(229, 9, 20))
img.save(OUT, "PNG")
print(OUT)
