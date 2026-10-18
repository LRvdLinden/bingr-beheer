#!/usr/bin/env python3
"""Maakt Bingr-PressKit.zip uit de repo (workflow PressKit, ook lokaal te draaien).

    python3 tools/make_presskit.py --version 1.7 --out /tmp/Bingr-PressKit.zip [--date 2026-10-18]

Inhoud volgens presskit/presskit.json: per map een bron in deze repo (Brand uit presskit/brand, Apple uit appstore/en,
Promo als die er is). README.txt wordt hier gemaakt (versie, datum, inhoud, gebruiksvoorwaarden). Verborgen bestanden
(.DS_Store e.d.) gaan niet mee. Vaste tijdstempels en volgorde, zodat dezelfde inhoud dezelfde zip geeft.
Schrijft alleen naar --out; drukt een JSON-regel {file, size, sha256, files} af.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def walk(src, include=None):
    """Bestanden onder src als (relatief pad, volledig pad), gesorteerd; include = alleen deze namen op het eerste niveau."""
    out = []
    names = sorted(os.listdir(src))
    for n in names:
        if n.startswith(".") or (include is not None and n not in include):
            continue
        p = os.path.join(src, n)
        if os.path.isdir(p):
            for d, dirs, files in os.walk(p):
                dirs[:] = sorted(x for x in dirs if not x.startswith("."))
                for fn in sorted(files):
                    if not fn.startswith("."):
                        full = os.path.join(d, fn)
                        out.append((os.path.relpath(full, src).replace(os.sep, "/"), full))
        elif os.path.isfile(p):
            out.append((n, p))
    return out


def readme(cfg, version, date, entries, has_credits):
    by_top = {}
    for rel, _ in entries:
        top = rel.split("/", 1)[0]
        by_top[top] = by_top.get(top, 0) + 1
    lines = []
    for d in cfg["dirs"]:
        if d["to"] in by_top:
            lines.append(f"  {d['to'] + '/':<12}{str(by_top[d['to']]) + ' files':>10}   {d.get('label') or ''}".rstrip())
    credits_en = ("Film and series images that appear in the screenshots: credit them as listed in CREDITS.txt."
                  if has_credits else
                  "The screenshots use a demo library with made-up titles and self-drawn artwork.")
    credits_nl = ("Film- en seriebeelden in de screenshots: naamsvermelding volgens CREDITS.txt."
                  if has_credits else
                  "De screenshots gebruiken een demobibliotheek met verzonnen titels en zelfgemaakte afbeeldingen.")
    return f"""Bingr - press kit
=================

Version {version}, {date}
Latest version: https://bingr.online/presskit
Website: https://bingr.online  -  Support: https://support.bingr.online

Bingr is a media player for your own IPTV subscription on iPhone, iPad, Apple TV, Mac,
Android, Android TV / Google TV / Fire TV, Samsung TV and in the browser. Bingr does not
provide, sell or host any channels, movies or series.

CONTENTS
  README.txt              this file
{"  CREDITS.txt             credits for the film and series images in the screenshots" + chr(10) if has_credits else ""}{chr(10).join(lines)}
  Planned: {", ".join(x + "/" for x in cfg.get("planned", []))}

TERMS OF USE FOR PRESS
  Free to use for news coverage, reviews and articles about Bingr, in print and online.
  Do not alter the logo or the screenshots beyond cropping and resizing, and do not use them
  to suggest endorsement or for other products.
  {credits_en}
  Apple, iPhone, iPad, Apple TV and Mac are trademarks of Apple Inc. Android, Google TV and
  Android TV are trademarks of Google LLC, Fire TV of Amazon.com, Inc., Samsung and Tizen of
  Samsung Electronics Co., Ltd.

Questions: https://support.bingr.online


NEDERLANDS
  Persmap van Bingr, versie {version} ({date}). Vrij te gebruiken voor berichtgeving over
  Bingr (nieuws, recensies, artikelen; print en online). Logo en screenshots niet bewerken
  behalve bijsnijden en schalen. {credits_nl}
  Nieuwste versie: https://bingr.online/presskit
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", default=None, help="YYYY-MM-DD (standaard vandaag, Nederlandse tijd)")
    a = ap.parse_args()
    if not re.fullmatch(r"[0-9][0-9A-Za-z.\-]{0,19}", a.version):
        sys.exit("ongeldige versie")
    date = a.date
    if not date:
        try:
            from zoneinfo import ZoneInfo
            date = datetime.datetime.now(ZoneInfo("Europe/Amsterdam")).date().isoformat()
        except Exception:
            date = datetime.date.today().isoformat()
    cfg = json.load(open(os.path.join(ROOT, "presskit", "presskit.json"), encoding="utf-8"))
    name = cfg.get("name", "Bingr-PressKit")

    entries = []  # (pad in de zip zonder hoofdmap, volledig pad)
    for d in cfg["dirs"]:
        src = os.path.join(ROOT, d["from"])
        if not os.path.isdir(src):
            if d.get("optional"):
                continue
            sys.exit(f"bron ontbreekt: {d['from']}")
        files = walk(src, d.get("include"))
        if d.get("include") and not d.get("optional"):
            have = {r.split("/", 1)[0] for r, _ in files}
            missing = [x for x in d["include"] if x not in have]
            if missing:
                sys.exit(f"ontbreekt in {d['from']}: {', '.join(missing)}")
        entries += [(f"{d['to']}/{r}", p) for r, p in files]
    has_credits = False
    for f in cfg.get("files", []):
        p = os.path.join(ROOT, f["from"])
        if os.path.isfile(p):
            entries.append((f["to"], p))
            has_credits = has_credits or f["to"] == "CREDITS.txt"
        elif not f.get("optional"):
            sys.exit(f"bron ontbreekt: {f['from']}")
    if not any(r.startswith("Apple/") for r, _ in entries):
        sys.exit("geen Apple-bestanden")
    entries.sort(key=lambda e: (e[0].count("/") > 0, e[0]))

    text = readme(cfg, a.version, date, entries, has_credits)
    stamp = (1980, 1, 1, 0, 0, 0)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        def add(arc, data=None, path=None):
            zi = zipfile.ZipInfo(f"{name}/{arc}", stamp)
            zi.compress_type = zipfile.ZIP_STORED if arc.lower().endswith((".png", ".jpg", ".zip")) else zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            if data is None:
                with open(path, "rb") as fh:
                    data = fh.read()
            z.writestr(zi, data)
        add("README.txt", text.encode("utf-8"))
        for arc, p in entries:
            add(arc, path=p)
    h = hashlib.sha256()
    with open(a.out, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    print(json.dumps({"file": os.path.basename(a.out), "size": os.path.getsize(a.out), "sha256": h.hexdigest(),
                      "files": len(entries) + 1, "date": date, "version": a.version}))


if __name__ == "__main__":
    main()
