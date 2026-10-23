#!/usr/bin/env python3
"""Notities voor de Beheer-app (BingrBeheer) in de tab Downloads, uit de interne changelog ios/changelog.json.

Dit is NIET de openbare Bingr-changelog (docs/changelog.json in iptv-ios-appletv): niets hiervan gaat naar bingr.online.

Gebruik:
  python3 tools/beheer_notes.py <build>              notities voor build N op stdout (Markdown-achtig:
                                                      **Nieuw** / **Verbeterd** / **Opgelost** met opsommingen)
  python3 tools/beheer_notes.py <build> --fallback   zonder item voor N: de onderwerpregels van de commits sinds de
                                                      vorige BingrBeheer-build die ios/, web/ of supabase/functions/admin
                                                      raken (git-geschiedenis nodig; checkout met fetch-depth 0)
  python3 tools/beheer_notes.py --manifest <manifest.json>
                                                      werkt de notities van platform beheer (nieuwste en history) bij
                                                      voor elke build met een item; exit 0 = gewijzigd, 3 = niets
Nooit een uitpak-uitleg; nooit persoonsgegevens of geheimen (alleen wat in de changelog of de commitregels staat).
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANGELOG = os.path.join(ROOT, "ios", "changelog.json")
TYPES = (("new", "Nieuw"), ("improved", "Verbeterd"), ("fixed", "Opgelost"))
PATHS = ("ios", "web", "supabase/functions/admin")


def load():
    try:
        with open(CHANGELOG, encoding="utf-8") as f:
            return {int(b["build"]): b for b in json.load(f).get("builds", []) if str(b.get("build", "")).isdigit()}
    except (OSError, ValueError):
        return {}


def clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def from_changelog(entry):
    parts = []
    for key, label in TYPES:
        lines = [clean(i.get("nl")) for i in entry.get("items", []) if i.get("type") == key and clean(i.get("nl"))]
        if lines:
            parts.append(f"**{label}**\n\n" + "\n".join(f"- {x}" for x in lines))
    return "\n\n".join(parts)


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True, check=False).stdout


def from_commits():
    # commits die CURRENT_PROJECT_VERSION in ios/project.yml veranderden: [0] = huidige build, [1] = de vorige
    bumps = git("log", "--format=%H", "-G", "CURRENT_PROJECT_VERSION", "--", "ios/project.yml").split()
    rng = f"{bumps[1]}..HEAD" if len(bumps) > 1 else "HEAD"
    subs = []
    for s in git("log", "--no-merges", "--format=%s", rng, "--", *PATHS).splitlines():
        s = re.sub(r"[;,]?\s*(BingrBeheer|Beheer-app)\s+build\s+\d+\s*$", "", clean(s)).strip(" ;,")
        if s and s not in subs:
            subs.append(s)
    if not subs:
        return ""
    return "**Wijzigingen**\n\n" + "\n".join(f"- {x}" for x in subs[:30])


def notes_for(build, fallback):
    entry = load().get(build)
    txt = from_changelog(entry) if entry else ""
    if not txt and fallback:
        txt = from_commits()
    return txt[:4000]


def update_manifest(path):
    cl = load()
    with open(path, encoding="utf-8") as f:
        m = json.load(f)
    cur = (m.get("platforms") or {}).get("beheer")
    if not cur:
        return False
    changed = False
    for e in [cur, *(cur.get("history") or [])]:
        try:
            b = int(e.get("build"))
        except (TypeError, ValueError):
            continue
        if b in cl:
            txt = from_changelog(cl[b])[:4000]
            if txt and e.get("notes") != txt:
                e["notes"] = txt
                changed = True
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(m, f, indent=1)
    return changed


def main(argv):
    if len(argv) >= 2 and argv[0] == "--manifest":
        return 0 if update_manifest(argv[1]) else 3
    if not argv or not argv[0].isdigit():
        print(__doc__, file=sys.stderr)
        return 2
    sys.stdout.write(notes_for(int(argv[0]), "--fallback" in argv[1:]) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
