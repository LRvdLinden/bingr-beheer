#!/usr/bin/env bash
# Levert een buildpakket VERSLEUTELD aan voor de afgesloten map builds/ op de server van beheer.bingr.online.
# Gebruik (vanuit een anonieme clone van bingr-beheer, of na een anonieme download van dit script en builds.pub.pem):
#   TOKEN=<token met alleen Contents: write op de inbox-repo> tools/seal_build.sh <apple|android|android-aab|tizen|windows|beheer> <bestand> <versie> <build> [notities.md]
# Doel: de PRIVÉ repo ${BINGR_INBOX_REPO:-LRvdLinden/bingr-inbox} (H3: aanleverende repo's hebben geen schrijftoken meer op
# de openbare repo bingr-beheer, zodat niemand daarmee het dashboard of de functie admin kan vervangen). Alleen de
# workflow Beheer-app van bingr-beheer zelf levert met zijn eigen GITHUB_TOKEN aan bij bingr-beheer, en dan alleen
# platform beheer (BINGR_INBOX_REPO=LRvdLinden/bingr-beheer).
# Het pakket wordt versleuteld met AES-256 (willekeurige sleutel per pakket); die sleutel met RSA-OAEP (SHA-256) en de
# publieke sleutel builds.pub.pem (openbaar in bingr-beheer; de privésleutel staat alleen op de server). Het resultaat
# gaat als enige commit naar de branch inbox-<platform> van de inbox-repo; de workflow Builds van bingr-beheer haalt hem
# daar op (elke 15 minuten, of meteen na een repository_dispatch als het token dat mag), zet het pakket op de server en
# verwijdert de branch. Er komt dus nooit een onversleuteld pakket op GitHub. Het log noemt alleen platform en build.
# Het token komt nooit in een URL of op de opdrachtregel: git krijgt het via GIT_CONFIG_* (alleen voor de push).
# Publieke sleutel: builds.pub.pem naast dit script, of het bestand in BINGR_PUB_PEM.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
plat="${1:?platform}"; file="${2:?bestand}"; ver="${3:?versie}"; build="${4:?build}"; notes="${5:-}"
case "$plat" in apple|android|android-aab|tizen|windows|beheer) ;; *) echo "::error::Onbekend platform: $plat"; exit 1 ;; esac
[[ "$build" =~ ^[0-9]{1,6}$ ]] || { echo "::error::Ongeldig buildnummer"; exit 1; }
[[ "$ver" =~ ^[0-9][0-9.]{0,15}$ ]] || { echo "::error::Ongeldige versie"; exit 1; }
name="$(basename "$file")"
[[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$ ]] || { echo "::error::Ongeldige bestandsnaam"; exit 1; }
[ -s "$file" ] || { echo "::error::Bestand ontbreekt of is leeg"; exit 1; }
pub="${BINGR_PUB_PEM:-$here/builds.pub.pem}"
if [ ! -s "$pub" ]; then
  echo "::warning::builds.pub.pem ontbreekt in bingr-beheer: draai eerst de workflow Builds daar. Pakket niet aangeleverd."; exit 0
fi
repo="${BINGR_INBOX_REPO:-LRvdLinden/bingr-inbox}"
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "::error::Ongeldige BINGR_INBOX_REPO"; exit 1; }
# de openbare repo bingr-beheer neemt alleen het eigen pakket (Beheer-app, met zijn eigen GITHUB_TOKEN) aan
if [ "$repo" = LRvdLinden/bingr-beheer ] && [ "$plat" != beheer ]; then
  echo "::error::Pakketten van $plat gaan naar de privé inbox-repo, niet naar bingr-beheer."; exit 1
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
remote="${INBOX_REMOTE:-${BEHEER_REMOTE:-https://github.com/$repo.git}}"   # INBOX_REMOTE/BEHEER_REMOTE alleen voor tests
# token als Authorization-kop, alleen voor deze git-aanroepen (niet in de URL, niet in .git/config, niet in argv)
auth=$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$auth"
ok=""
for i in 1 2 3; do
  if GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
     GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth" git push -qf "$remote" "HEAD:refs/heads/inbox-$plat" 2>"$w/push.err"; then ok=1; break; fi
  echo "::warning::Aanleveren mislukt (poging $i): $(tr '\n' ' ' < "$w/push.err" | sed -e 's#x-access-token:[^@]*@#***@#g' -e 's#basic [A-Za-z0-9+/=]*#basic ***#g' | head -c 200)"
  sleep 10
done
unset auth
[ -n "$ok" ] || { echo "::error::Pakket niet aangeleverd bij $repo."; exit 1; }
[ -n "${INBOX_REMOTE:-}${BEHEER_REMOTE:-}" ] && exit 0
# Workflow Builds meteen starten kan alleen binnen bingr-beheer zelf (Beheer-app, GITHUB_TOKEN). Het inbox-token heeft
# geen rechten op bingr-beheer; dan pakt de geplande run van Builds (elke 15 minuten) het pakket op.
if [ "$repo" = LRvdLinden/bingr-beheer ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/LRvdLinden/bingr-beheer/dispatches -d '{"event_type":"builds"}' || true)
  if [ "$code" = 204 ]; then echo "::notice::$plat build $build versleuteld aangeleverd; workflow Builds gestart."
  else echo "::notice::$plat build $build versleuteld aangeleverd; de workflow Builds pakt hem binnen 15 minuten op (starten gaf HTTP $code)."; fi
else
  echo "::notice::$plat build $build versleuteld aangeleverd bij de inbox; de workflow Builds van bingr-beheer pakt hem binnen 15 minuten op."
fi
