#!/usr/bin/env bash
# Levert een buildpakket VERSLEUTELD aan voor de afgesloten map builds/ op de server van beheer.bingr.online.
# Gebruik (vanuit een clone van bingr-beheer):
#   TOKEN=<token met Contents: write op bingr-beheer> tools/seal_build.sh <apple|android|tizen|beheer> <bestand> <versie> <build> [notities.md]
# Het pakket wordt versleuteld met AES-256 (willekeurige sleutel per pakket); die sleutel met RSA-OAEP (SHA-256) en de
# publieke sleutel builds.pub.pem (in deze repo; de privésleutel staat alleen op de server). Het resultaat gaat als enige
# commit naar de branch inbox-<platform> en de workflow Builds wordt gestart; die zet het pakket op de server en
# verwijdert de branch. Er komt dus nooit een onversleuteld pakket op GitHub. Het log noemt alleen platform en build.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
plat="${1:?platform}"; file="${2:?bestand}"; ver="${3:?versie}"; build="${4:?build}"; notes="${5:-}"
case "$plat" in apple|android|tizen|beheer) ;; *) echo "::error::Onbekend platform: $plat"; exit 1 ;; esac
[[ "$build" =~ ^[0-9]{1,6}$ ]] || { echo "::error::Ongeldig buildnummer"; exit 1; }
[[ "$ver" =~ ^[0-9][0-9.]{0,15}$ ]] || { echo "::error::Ongeldige versie"; exit 1; }
name="$(basename "$file")"
[[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$ ]] || { echo "::error::Ongeldige bestandsnaam"; exit 1; }
[ -s "$file" ] || { echo "::error::Bestand ontbreekt of is leeg"; exit 1; }
pub="$here/builds.pub.pem"
if [ ! -s "$pub" ]; then
  echo "::warning::builds.pub.pem ontbreekt in bingr-beheer: draai eerst de workflow Builds daar. Pakket niet aangeleverd."; exit 0
fi
TOKEN=$(printf '%s' "${TOKEN:-}" | tr -d '[:space:]')
[ -n "$TOKEN" ] || { echo "::warning::Geen token: pakket niet aangeleverd."; exit 0; }

hex(){ od -An -v -tx1 "$1" | tr -d ' \n'; }
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
mkdir "$w/out"
openssl rand 32 > "$w/k"; openssl rand 16 > "$w/iv"
openssl enc -aes-256-cbc -K "$(hex "$w/k")" -iv "$(hex "$w/iv")" -in "$file" -out "$w/out/pkg.enc"
cat "$w/k" "$w/iv" > "$w/kiv"
openssl pkeyutl -encrypt -pubin -inkey "$pub" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
  -pkeyopt rsa_mgf1_md:sha256 -in "$w/kiv" -out "$w/out/key.enc"
rm -f "$w/k" "$w/iv" "$w/kiv"
python3 - "$w/out/meta.json" "$plat" "$ver" "$build" "$name" "$file" "$notes" <<'PY'
import hashlib, json, os, sys, datetime
out, plat, ver, build, name, path, notes = sys.argv[1:8]
h = hashlib.sha256()
with open(path, "rb") as f:
    for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
txt = open(notes, encoding="utf-8").read()[:4000] if notes and os.path.isfile(notes) else ""
json.dump({"platform": plat, "version": ver, "build": int(build), "file": name, "size": os.path.getsize(path),
           "sha256": h.hexdigest(), "date": datetime.date.today().isoformat(), "notes": txt.strip(),
           "source": os.environ.get("GITHUB_REPOSITORY", ""), "commit": os.environ.get("GITHUB_SHA", "")[:12]},
          open(out, "w"), indent=1)
PY
cd "$w/out"
git init -q -b "inbox-$plat"
git add pkg.enc key.enc meta.json
git -c user.name=github-actions -c user.email=actions@github.com commit -qm "Inbox: $plat build $build (versleuteld)"
remote="${BEHEER_REMOTE:-https://x-access-token:${TOKEN}@github.com/LRvdLinden/bingr-beheer.git}"   # BEHEER_REMOTE alleen voor tests
ok=""
for i in 1 2 3; do
  if git push -qf "$remote" "HEAD:refs/heads/inbox-$plat" 2>"$w/push.err"; then ok=1; break; fi
  echo "::warning::Aanleveren mislukt (poging $i): $(tr '\n' ' ' < "$w/push.err" | sed 's#x-access-token:[^@]*@#***@#g' | head -c 200)"
  sleep 10
done
[ -n "$ok" ] || { echo "::error::Pakket niet aangeleverd bij bingr-beheer."; exit 1; }
[ -n "${BEHEER_REMOTE:-}" ] && exit 0
# workflow Builds starten (lukt dit niet, dan pakt de controle elk uur hem op)
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/LRvdLinden/bingr-beheer/dispatches -d '{"event_type":"builds"}' || true)
if [ "$code" = 204 ]; then echo "::notice::$plat build $build versleuteld aangeleverd; workflow Builds gestart."
else echo "::notice::$plat build $build versleuteld aangeleverd; de workflow Builds pakt hem binnen een uur op (starten gaf HTTP $code)."; fi
