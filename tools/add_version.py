#!/usr/bin/env python3
"""Zet een build in versions/<os>/<versie>-build<N>/ en werk versions/latest.json en versions/README.md bij.

Gebruik: python3 tools/add_version.py <os> <build> <bestand> [--notes notes.md] [--version 1.0.0]
<os>: android (APK, ook Android TV/Google TV/Fire TV), tizen (Samsung TV .wgt) of apple (Xcode-project iOS/iPadOS/tvOS/macOS).
Wordt ook gebruikt door de workflows van bingr-android en iptv-ios-appletv.
"""
import argparse, datetime, json, os, shutil, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "versions")
OS = {"android": "Android, Android TV, Google TV en Fire TV (APK)",
      "tizen": "Samsung TV / Tizen (.wgt)",
      "apple": "iOS, iPadOS, tvOS en macOS (Xcode-project)"}
RAW = "https://raw.githubusercontent.com/LRvdLinden/bingr-beheer/main/versions/"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("os", choices=sorted(OS)); p.add_argument("build", type=int); p.add_argument("file")
    p.add_argument("--notes"); p.add_argument("--version", default="1.0.0")
    a = p.parse_args()
    folder = f"{a.version}-build{a.build}"
    dest = os.path.join(ROOT, a.os, folder)
    os.makedirs(dest, exist_ok=True)
    name = os.path.basename(a.file)
    shutil.copyfile(a.file, os.path.join(dest, name))
    if a.notes and os.path.exists(a.notes):
        shutil.copyfile(a.notes, os.path.join(dest, "notes.md"))
    path = os.path.join(ROOT, "latest.json")
    data = json.load(open(path)) if os.path.exists(path) else {}
    cur = data.get(a.os, {})
    if cur.get("build", 0) <= a.build:
        data[a.os] = {"version": a.version, "build": a.build, "file": name, "path": f"{a.os}/{folder}/{name}",
                      "url": RAW + f"{a.os}/{folder}/{name}", "size": os.path.getsize(a.file),
                      "date": datetime.date.today().isoformat()}
    json.dump(data, open(path, "w"), indent=1, ensure_ascii=False); open(path, "a").write("\n")
    readme()
    print(f"versions/{a.os}/{folder}/{name}")


def readme():
    lines = ["# Versies", "",
             "Alle gebouwde pakketten van Bingr, per platform en per versie (`<os>/<versie>-build<N>/`).",
             "De nieuwste per platform staat in [`latest.json`](latest.json); die gebruikt de website voor de downloadknoppen.",
             "Wordt bijgewerkt door de workflows van bingr-android en iptv-ios-appletv (tools/add_version.py).", ""]
    for os_ in ("android", "tizen", "apple"):
        d = os.path.join(ROOT, os_)
        if not os.path.isdir(d):
            continue
        lines += [f"## {OS[os_]}", ""]
        for v in sorted(os.listdir(d), key=lambda s: int(s.rsplit("build", 1)[-1]) if s.rsplit("build", 1)[-1].isdigit() else 0, reverse=True):
            files = sorted(f for f in os.listdir(os.path.join(d, v)) if f != "notes.md")
            links = " · ".join(f"[{f}]({os_}/{v}/{f})" for f in files)
            notes = " · [notities](%s/%s/notes.md)" % (os_, v) if os.path.exists(os.path.join(d, v, "notes.md")) else ""
            lines.append(f"- **{v}**: {links}{notes}")
        lines.append("")
    open(os.path.join(ROOT, "README.md"), "w").write("\n".join(lines))


if __name__ == "__main__":
    sys.exit(main())
