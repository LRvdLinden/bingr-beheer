#!/usr/bin/env python3
"""Zet de nieuwste build in versions/<Platform>/v<versie>/ en werk versions/latest.json en versions/README.md bij.

Indeling (per platform alleen de laatste build):
  versions/Android/v1.0.0/Bingr-1.0.0-build74.apk (+ notes.md)
  versions/Apple/v1.0.0/Bingr-1.0.0-build74-Xcode.zip (+ notes.md)
  versions/Samsung TV/v1.0.0/Bingr-1.0.0-build74-testsigned.wgt (+ notes.md)

Gebruik: python3 tools/add_version.py <os> <build> <bestand> [--notes notes.md] [--version 1.0.0]
<os>: android (APK, ook Android TV/Google TV/Fire TV), tizen (Samsung TV .wgt) of apple (Xcode-project iOS/iPadOS/tvOS/macOS).
Wordt ook gebruikt door de workflows van bingr-android en iptv-ios-appletv.
"""
import argparse, datetime, json, os, shutil, sys
from urllib.parse import quote

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "versions")
FOLDER = {"android": "Android", "apple": "Apple", "tizen": "Samsung TV"}
DESC = {"android": "Android, Android TV, Google TV en Fire TV (APK)",
        "apple": "iOS, iPadOS, tvOS en macOS (Xcode-project)",
        "tizen": "Samsung TV / Tizen (.wgt)"}
RAW = "https://raw.githubusercontent.com/LRvdLinden/bingr-beheer/main/versions/"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("os", choices=sorted(FOLDER)); p.add_argument("build", type=int); p.add_argument("file")
    p.add_argument("--notes"); p.add_argument("--version", default="1.0.0")
    a = p.parse_args()
    path = os.path.join(ROOT, "latest.json")
    data = json.load(open(path)) if os.path.exists(path) else {}
    if data.get(a.os, {}).get("build", 0) > a.build:
        print(f"nieuwere build {data[a.os]['build']} staat er al; niets gedaan"); return
    rel = f"{FOLDER[a.os]}/v{a.version}"
    dest = os.path.join(ROOT, rel)
    os.makedirs(dest, exist_ok=True)
    # alleen de laatste build per platform: oude bestanden in deze map weg
    for f in os.listdir(dest):
        os.remove(os.path.join(dest, f))
    name = os.path.basename(a.file)
    shutil.copyfile(a.file, os.path.join(dest, name))
    if a.notes and os.path.exists(a.notes):
        shutil.copyfile(a.notes, os.path.join(dest, "notes.md"))
    data[a.os] = {"version": a.version, "build": a.build, "file": name, "path": f"{rel}/{name}",
                  "url": RAW + quote(f"{rel}/{name}"), "size": os.path.getsize(a.file),
                  "date": datetime.date.today().isoformat()}
    json.dump(data, open(path, "w"), indent=1, ensure_ascii=False); open(path, "a").write("\n")
    readme(data)
    print(f"versions/{rel}/{name}")


def readme(data):
    lines = ["# Versies", "",
             "De nieuwste build van Bingr per platform: `<Platform>/v<versie>/`.",
             "[`latest.json`](latest.json) beschrijft ze; de website gebruikt dat voor de downloadknoppen.",
             "Bijgewerkt door de workflows van bingr-android en iptv-ios-appletv (tools/add_version.py).", "",
             "| Platform | Versie | Build | Bestand |", "|---|---|---|---|"]
    for k in ("android", "apple", "tizen"):
        v = data.get(k)
        if v:
            lines.append(f"| {DESC[k]} | {v['version']} | {v['build']} | [{v['file']}]({quote(v['path'])}) |")
    open(os.path.join(ROOT, "README.md"), "w").write("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
