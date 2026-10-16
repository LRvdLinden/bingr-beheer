# shellcheck shell=bash
# Verwerkt aangeleverde buildpakketten voor de afgesloten map builds/ op de server (workflow Builds).
# Wordt gesourced NA tools/ftps.sh en ftps_connect. Omgeving: ROTATE (true = nieuwe sleutels), REF (Supabase-project),
# IMPORT_REPO (true = eenmalig de oude pakketten uit versions/ van deze repo overzetten),
# INBOX_REPO (privé inbox-repo, standaard LRvdLinden/bingr-inbox) en INBOX_TOKEN (secret BINGR_INBOX_READ_TOKEN:
# Contents read+write op alleen die repo, om branches na verwerking te verwijderen).
# H3: iptv-ios-appletv en bingr-android leveren aan bij de privé inbox-repo (geen schrijftoken meer op deze openbare repo);
# inbox-branches in deze repo zelf (Beheer-app via GITHUB_TOKEN, en oude pakketten van vóór de overgang) worden ook verwerkt.
# Het log is openbaar: alleen platform, build en gelukt/mislukt; nooit sleutels, mappen of serverantwoorden.

# --- bestanden op de server (relatief aan builds/) ---
srv_dir(){ printf '%s/builds' "$FTPS_TARGET"; }
srv_get(){ ftps_try "get \"$(srv_dir)/$1\" -o \"$2\"" >/dev/null 2>&1; [ -s "$2" ]; }
srv_put(){ ftps_run "mkdir -p -f \"$(srv_dir)/$(dirname "$2")\"; put \"$1\" -o \"$(srv_dir)/$2\"; chmod ${3:-644} \"$(srv_dir)/$2\"" >/dev/null 2>&1; }
srv_rm(){ ftps_try "rm -f \"$(srv_dir)/$1\"" >/dev/null 2>&1 || true; }

PLATS="apple android tizen beheer"

builds_init(){
  BW=$(mktemp -d); mkdir -p "$BW/srv"
  srv_get manifest.json "$BW/srv/manifest.json" || echo '{"platforms":{}}' > "$BW/srv/manifest.json"
  srv_get key.php "$BW/srv/key.php" || true
  srv_get private.pem "$BW/srv/private.pem" || true
  if [ "${ROTATE:-false}" = true ] || [ ! -s "$BW/srv/key.php" ] || [ ! -s "$BW/srv/private.pem" ]; then
    local k; k=$(openssl rand -hex 32)
    printf "<?php\n// Sleutel voor de downloadlinks (gelijk aan het function-secret BINGR_BUILDS_KEY); map builds/ is niet via de webserver bereikbaar.\nreturn '%s';\n" "$k" > "$BW/srv/key.php"
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$BW/srv/private.pem" 2>/dev/null
    srv_put "$BW/srv/private.pem" private.pem 600 || { echo "::error::Sleutel niet op de server gezet."; return 1; }
    srv_put "$BW/srv/key.php" key.php 600 || { echo "::error::Sleutel niet op de server gezet."; return 1; }
    echo "::notice::Nieuwe sleutels gemaakt (downloadlinks en versleuteling)."
  fi
  BUILDS_KEY=$(grep -oE "'[0-9a-f]{64}'" "$BW/srv/key.php" | tr -d "'")
  [ -n "$BUILDS_KEY" ] || { echo "::error::Sleutel op de server is ongeldig; draai Builds met 'Sleutels opnieuw maken'."; return 1; }
  echo "::add-mask::$BUILDS_KEY"
  openssl pkey -in "$BW/srv/private.pem" -pubout -out "$BW/pub.pem" 2>/dev/null
}

# pakket toevoegen: <platform> <bestand> <meta.json>
builds_add(){
  local plat="$1" f="$2" meta="$3" name del
  name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["file"])' "$meta")
  [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$ ]] || { echo "::error::$plat: ongeldige bestandsnaam"; return 1; }
  srv_put "$f" "$plat/$name" 644 || { echo "::error::$plat: uploaden mislukt"; return 1; }
  # manifest bijwerken; bestanden die uit de geschiedenis vallen (meer dan 2 oude builds) weghalen
  del=$(python3 - "$BW/srv/manifest.json" "$plat" "$meta" "$f" <<'PY'
import hashlib, json, os, sys, datetime
mp, plat, metap, path = sys.argv[1:5]
m = json.load(open(mp)); m.setdefault("platforms", {})
meta = json.load(open(metap))
h = hashlib.sha256()
with open(path, "rb") as f:
    for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
e = {k: meta.get(k) for k in ("version", "build", "date", "notes")}
e.update(file=meta["file"], path=f"{plat}/{meta['file']}", size=os.path.getsize(path), sha256=h.hexdigest())
cur = m["platforms"].get(plat)
hist = []
if cur:
    hist = cur.pop("history", [])
    if cur.get("file") != e["file"]: hist.insert(0, cur)
hist = [x for x in hist if x.get("file") != e["file"]]
keep, drop = hist[:2], hist[2:]
e["history"] = keep
m["platforms"][plat] = e
m["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
json.dump(m, open(mp, "w"), indent=1)
print("\n".join(x["path"] for x in drop if x.get("path")))
PY
)
  for x in $del; do srv_rm "$x"; done
  BUILDS_CHANGED=1
  echo "::notice::$plat build $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["build"])' "$meta") op de server gezet."
}

# huidig build van een platform in het manifest (0 = geen)
builds_current(){ python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("platforms",{}).get(sys.argv[2]) or {}).get("build",0))' "$BW/srv/manifest.json" "$1"; }

# eenmalig: de pakketten die nog in versions/ van deze repo staan (al openbaar) overzetten
builds_import_repo(){
  [ -f versions/latest.json ] || return 0
  local key plat path build
  for key in android tizen apple beheer; do
    plat=$key
    path=$(python3 -c 'import json,sys; print((json.load(open("versions/latest.json")).get(sys.argv[1]) or {}).get("path",""))' "$key")
    build=$(python3 -c 'import json,sys; print((json.load(open("versions/latest.json")).get(sys.argv[1]) or {}).get("build",0))' "$key")
    [ -n "$path" ] && [ -f "versions/$path" ] || continue
    [ "$(builds_current "$plat")" -ge "$build" ] && continue
    python3 - "$BW/meta-$plat.json" "$key" "versions/$path" <<'PY'
import json, os, sys
out, key, path = sys.argv[1:4]
v = json.load(open("versions/latest.json"))[key]
notes = os.path.join(os.path.dirname(path), "notes.md")
txt = open(notes, encoding="utf-8").read()[:4000].strip() if os.path.isfile(notes) else ""
json.dump({"version": v.get("version"), "build": v.get("build"), "date": v.get("date"), "file": v.get("file"), "notes": txt}, open(out, "w"))
PY
    builds_add "$plat" "versions/$path" "$BW/meta-$plat.json"
  done
}

# --- privé inbox-repo (H3) ---
# Eigen lege git-map, los van de checkout (die heeft het GITHUB_TOKEN van deze repo als extraheader); het inbox-token
# gaat alleen via GIT_CONFIG_* mee (niet in een URL, niet in .git/config, niet in argv) en wordt gemaskeerd.
inbox_ready(){
  INBOX_REPO="${INBOX_REPO:-LRvdLinden/bingr-inbox}"
  INBOX_TOKEN=$(printf '%s' "${INBOX_TOKEN:-}" | tr -d '[:space:]')
  [ -n "$INBOX_TOKEN" ] || return 1
  [[ "$INBOX_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "::error::Ongeldige INBOX_REPO"; return 1; }
  if [ -z "${INBOX_GIT:-}" ]; then
    INBOX_AUTH=$(printf 'x-access-token:%s' "$INBOX_TOKEN" | base64 | tr -d '\n')
    [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$INBOX_AUTH"
    INBOX_GIT=$(mktemp -d)
    git init -q --bare "$INBOX_GIT"
    git -C "$INBOX_GIT" remote add inbox "${INBOX_REMOTE:-https://github.com/$INBOX_REPO.git}"   # INBOX_REMOTE alleen voor tests
  fi
}
inbox_git(){
  GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $INBOX_AUTH" git -C "$INBOX_GIT" "$@"
}
# git voor een bron: origin = deze repo (checkout), inbox = de privé inbox-repo
src_git(){ local src="$1"; shift; if [ "$src" = inbox ]; then inbox_git "$@"; else git "$@"; fi; }

# aantal inbox-branches (deze repo + inbox-repo), voor de stap "Iets te doen?"; waarschuwt als het inbox-token ontbreekt
builds_pending(){
  local n m=0 out
  n=$(git ls-remote origin 'refs/heads/inbox-*' | grep -c . || true)
  if inbox_ready; then
    if out=$(inbox_git ls-remote inbox 'refs/heads/inbox-*' 2>/dev/null); then m=$(printf '%s' "$out" | grep -c . || true)
    else echo "::warning::Inbox-repo $INBOX_REPO niet te lezen met BINGR_INBOX_READ_TOKEN (bestaat de repo, klopt het token?)." >&2; fi
  else
    echo "::warning::Secret BINGR_INBOX_READ_TOKEN ontbreekt: pakketten uit de privé inbox-repo (${INBOX_REPO:-LRvdLinden/bingr-inbox}) worden niet opgehaald. Zie README.md (H3)." >&2
  fi
  echo $((n + m))
}

# aangeleverde pakketten op de branches inbox-<platform>: eerst in deze repo (overgang en Beheer-app), dan in de inbox-repo
builds_inbox(){
  builds_inbox_from origin
  if inbox_ready; then builds_inbox_from inbox
  else echo "::warning::Secret BINGR_INBOX_READ_TOKEN ontbreekt: inbox-repo overgeslagen."; fi
  [ -n "${INBOX_GIT:-}" ] && rm -rf "$INBOX_GIT"
  INBOX_GIT=""; INBOX_AUTH=""
}

builds_inbox_from(){
  local src="$1" remote plat sha d k iv
  remote=$([ "$src" = inbox ] && echo inbox || echo origin)
  for plat in $PLATS; do
    sha=$(src_git "$src" ls-remote "$remote" "refs/heads/inbox-$plat" 2>/dev/null | awk '{print $1}') || sha=""
    [ -n "$sha" ] || continue
    d="$BW/in-$src-$plat"; rm -rf "$d"; mkdir -p "$d"
    src_git "$src" fetch -q --depth 1 "$remote" "refs/heads/inbox-$plat" 2>/dev/null || { echo "::warning::$plat ($src): inbox niet op te halen"; continue; }
    for x in pkg.enc key.enc meta.json; do src_git "$src" show "FETCH_HEAD:$x" > "$d/$x" 2>/dev/null || true; done
    if ! openssl pkeyutl -decrypt -inkey "$BW/srv/private.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
        -pkeyopt rsa_mgf1_md:sha256 -in "$d/key.enc" -out "$d/kiv" 2>/dev/null; then
      echo "::warning::$plat: pakket niet te ontsleutelen (andere sleutel?); laat het opnieuw bouwen."; continue
    fi
    k=$(head -c 32 "$d/kiv" | od -An -v -tx1 | tr -d ' \n'); iv=$(tail -c 16 "$d/kiv" | od -An -v -tx1 | tr -d ' \n'); rm -f "$d/kiv"
    if ! openssl enc -d -aes-256-cbc -K "$k" -iv "$iv" -in "$d/pkg.enc" -out "$d/pkg" 2>/dev/null; then
      echo "::warning::$plat: ontsleutelen mislukt"; continue
    fi
    if ! python3 - "$d/meta.json" "$d/pkg" "$plat" <<'PY'
import hashlib, json, re, sys
meta, path, plat = sys.argv[1:4]
m = json.load(open(meta))
h = hashlib.sha256()
with open(path, "rb") as f:
    for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
ok = m.get("platform") == plat and h.hexdigest() == m.get("sha256") and isinstance(m.get("build"), int) \
     and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,150}", str(m.get("file", "")))
sys.exit(0 if ok else 1)
PY
    then echo "::warning::$plat: controle van het pakket mislukt (checksum of gegevens)"; continue; fi
    builds_add "$plat" "$d/pkg" "$d/meta.json" || continue
    builds_note_release "$plat" "$d/meta.json"
    rm -rf "$d"
    # branch weg, alleen als er intussen niets nieuws op staat
    src_git "$src" push -q --force-with-lease="refs/heads/inbox-$plat:$sha" "$remote" ":refs/heads/inbox-$plat" 2>/dev/null \
      || echo "::notice::$plat ($src): inbox-branch niet verwijderd (intussen een nieuwere build?); volgende ronde."
  done
}

builds_finish(){
  if [ "${BUILDS_CHANGED:-0}" = 1 ]; then
    srv_put "$BW/srv/manifest.json" manifest.json 600 || { echo "::error::Manifest niet op de server gezet."; return 1; }
  fi
  rm -rf "$BW"
  # pas na het manifest: het pakket staat dan echt klaar
  builds_release_push
}

# --- releasemelding (pushmelding, docs/PUSH.md in iptv-ios-appletv) ---
# Alleen voor Bingr-pakketten uit de inbox: apple (iOS, iPadOS, macOS) en android; niet tizen (geen push) en niet beheer.
# De functie push zoekt zelf de apparaten met een lagere build en stuurt één melding per (platform_group, build): een
# tweede aanroep met dezelfde build (bv. als de inbox-branch niet weg kon) doet niets.
PUSH_RELEASES=""
builds_note_release(){
  local plat="$1" meta="$2" vb
  case "$plat" in apple|android) ;; *) return 0;; esac
  vb=$(python3 - "$meta" <<'PY'
import json, re, sys
m = json.load(open(sys.argv[1]))
v, b = str(m.get("version") or ""), m.get("build")
ok = re.fullmatch(r"[0-9A-Za-z.+-]{1,20}", v) and isinstance(b, int) and not isinstance(b, bool) and 0 < b < 10**7
print(f"{v}:{b}" if ok else "")
PY
) || vb=""
  [ -n "$vb" ] || { echo "::warning::$plat: geen geldige versie/build in het pakket; geen releasemelding."; return 0; }
  # per platform alleen de laatste (inbox van deze repo en de privé inbox kunnen allebei iets hebben)
  PUSH_RELEASES="$(printf '%s\n' $PUSH_RELEASES | grep -v "^$plat:" || true) $plat:$vb"
}

# Roept push aan met {action:"release", platform_group, version, build} en header x-push-secret = PUSH_RELEASE_SECRET
# (GitHub-secret van deze repo; dezelfde waarde staat als function-secret PUSH_RELEASE_SECRET, zie README.md). Ontbreekt
# het secret of mislukt de aanroep: waarschuwing, nooit een fout (het pakket staat al klaar). Het secret gaat via stdin
# naar curl (niet in argv of een URL) en wordt gemaskeerd; in het log alleen platform, build, HTTP-code en aantallen.
builds_release_push(){
  local e plat v b secret url body out code res
  [ -n "${PUSH_RELEASES// /}" ] || return 0
  secret=$(printf '%s' "${PUSH_RELEASE_SECRET:-}" | tr -d '\r\n')
  if [ -z "$secret" ]; then
    echo "::warning::Secret PUSH_RELEASE_SECRET ontbreekt: geen releasemelding (pushmelding) verstuurd. Zie README.md."
    return 0
  fi
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$secret"
  url="${PUSH_FUNCTION_URL:-https://${REF:-vjewsncmsxmhmhnoxwqx}.supabase.co/functions/v1/push}"   # PUSH_FUNCTION_URL alleen voor tests
  for e in $PUSH_RELEASES; do
    IFS=: read -r plat v b <<<"$e"
    body=$(python3 -c 'import json,sys; print(json.dumps({"action":"release","platform_group":sys.argv[1],"version":sys.argv[2],"build":int(sys.argv[3])}))' "$plat" "$v" "$b")
    out=$(mktemp)
    code=$(printf 'x-push-secret: %s\n' "$secret" | curl -s --max-time 60 -o "$out" -w '%{http_code}' -X POST "$url" \
      -H @- -H "Content-Type: application/json" --data-binary "$body" 2>/dev/null) || code=000
    if [ "${code:0:1}" = 2 ]; then
      # alleen aantallen uit het antwoord
      res=$(python3 - "$out" <<'PY' 2>/dev/null || true
import json, sys
try: o = json.load(open(sys.argv[1]))
except Exception: o = {}
if not isinstance(o, dict): o = {}
n = lambda k: o.get(k) if isinstance(o.get(k), int) and not isinstance(o.get(k), bool) else None
if o.get("duplicate") or o.get("skipped") == "duplicate": print("al eerder verstuurd")
elif n("devices") is not None: print(f"{n('devices')} apparaten")
else: print("aangenomen")
PY
)
      echo "::notice::Releasemelding $plat build $b: ${res:-aangenomen}."
    else
      echo "::warning::Releasemelding $plat build $b niet verstuurd (HTTP $code). Klopt PUSH_RELEASE_SECRET en staat de functie push online?"
    fi
    rm -f "$out"
  done
  PUSH_RELEASES=""
}
