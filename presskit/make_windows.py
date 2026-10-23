#!/usr/bin/env python3
"""Maakt de map Windows van de presskit (presskit/windows/): app-iconen en schermafbeeldingen in een Windows 11-venster.

- Iconen: uit bingr-windows (src-tauri/icons: icon.ico met 16-256 px, icon.png 512 px, 128x128@2x.png 256 px).
- Schermafbeeldingen: een venster in de stijl van Windows 11 (titelbalk met app-icoon en "Bingr", knoppen minimaliseren,
  maximaliseren en sluiten; afgeronde hoeken en schaduw) rond de schermafbeeldingen uit appstore/en/Mac/raw (de echte app
  in screenshotstand, met vrije filmbeelden: zie CREDITS.txt; zenders en profielnamen verzonnen). De macOS-balk bovenaan
  gaat eraf. Geen Windows-logo, geen taakbalk, geen TMDB-posters, geen persoonsgegevens of koppelcodes.
  Illustratief: de Windows-app laadt de webspeler van bingr.online/web, die er net zo uitziet.

    python3 presskit/make_windows.py [--windows ../bingr-windows]
"""
import argparse
import os
import shutil

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "appstore", "en", "Mac", "raw")
OUT = os.path.join(ROOT, "presskit", "windows")
# welke schermen (zonder 06-picker en 07-categories: daar staat "iCloud" in beeld)
SHOTS = [("01-home", "01-home"), ("02-detail", "02-detail"), ("03-live", "03-live"),
         ("04-guide", "04-guide"), ("05-top10", "05-top10"), ("08-multiview", "06-multiview")]
MAC_BAR = 38          # hoogte van de macOS-balk in de bron (1440 x 900)
SCALE = 2             # alles op 2x (scherper; de bron wordt met LANCZOS vergroot)
TITLE = 32            # hoogte titelbalk (Windows 11)
RADIUS = 8            # afgeronde hoeken (Windows 11)
PAD = 64              # ruimte rond het venster voor de schaduw
FONTS = ["/usr/share/fonts/opentype/inter/Inter-Regular.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def font(size):
    for f in FONTS:
        if os.path.isfile(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def window(shot, icon):
    s = SCALE
    src = Image.open(shot).convert("RGB")
    body = src.crop((0, MAC_BAR, src.width, src.height))
    body = body.resize((body.width * s, body.height * s), Image.LANCZOS)
    w, h = body.width, body.height + TITLE * s
    win = Image.new("RGB", (w, h), (32, 32, 32))
    win.paste(body, (0, TITLE * s))
    d = ImageDraw.Draw(win)
    # titelbalk: app-icoon 16 px, titel, en de drie knoppen (46 px breed) rechts
    ic = icon.resize((16 * s, 16 * s), Image.LANCZOS)
    win.paste(ic, (12 * s, 8 * s), ic)
    d.text((40 * s, 16 * s), "Bingr", font=font(12 * s), fill=(255, 255, 255), anchor="lm")
    cy, lw, col = 16 * s, max(1, s), (255, 255, 255)
    x = w - 46 * s * 3
    # minimaliseren
    cx = x + 23 * s
    d.line((cx - 5 * s, cy, cx + 5 * s, cy), fill=col, width=lw)
    # maximaliseren
    cx = x + 46 * s + 23 * s
    d.rounded_rectangle((cx - 5 * s, cy - 5 * s, cx + 5 * s, cy + 5 * s), radius=s, outline=col, width=lw)
    # sluiten
    cx = x + 92 * s + 23 * s
    d.line((cx - 5 * s, cy - 5 * s, cx + 5 * s, cy + 5 * s), fill=col, width=lw)
    d.line((cx - 5 * s, cy + 5 * s, cx + 5 * s, cy - 5 * s), fill=col, width=lw)
    # dunne rand (Windows 11)
    d.rectangle((0, 0, w - 1, h - 1), outline=(70, 70, 70), width=1)
    return win


def compose(win):
    s = SCALE
    pad = PAD * s
    W, H = win.width + 2 * pad, win.height + 2 * pad
    # achtergrond: donker verloop met een rode gloed (huisstijl), geen bureaublad of taakbalk
    bg = Image.new("RGB", (W, H), (0, 0, 0))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-W // 4, -H // 2, W // 2, H // 2), fill=(90, 8, 14))
    bg = Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(W // 8)), 1.0)
    mask = Image.new("L", win.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, win.width - 1, win.height - 1), radius=RADIUS * s, fill=255)
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + 12 * s, pad + win.width, pad + win.height + 12 * s), radius=RADIUS * s, fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(24 * s))
    bg.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), shadow)
    bg.paste(win, (pad, pad), mask)
    return bg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--windows", default=os.path.join(ROOT, "..", "bingr-windows"), help="map van de repo bingr-windows")
    a = ap.parse_args()
    icons = os.path.join(a.windows, "src-tauri", "icons")
    os.makedirs(os.path.join(OUT, "Screenshots"), exist_ok=True)
    shutil.copyfile(os.path.join(icons, "icon.ico"), os.path.join(OUT, "Bingr.ico"))
    shutil.copyfile(os.path.join(icons, "128x128@2x.png"), os.path.join(OUT, "AppIcon-256.png"))
    shutil.copyfile(os.path.join(icons, "icon.png"), os.path.join(OUT, "AppIcon-512.png"))
    icon = Image.open(os.path.join(icons, "icon.png")).convert("RGBA")
    for src, dst in SHOTS:
        win = window(os.path.join(SRC, src + ".png"), icon)
        compose(win).save(os.path.join(OUT, "Screenshots", dst + ".png"), optimize=True)
    print("presskit/windows bijgewerkt:", len(SHOTS), "schermafbeeldingen")


if __name__ == "__main__":
    main()
