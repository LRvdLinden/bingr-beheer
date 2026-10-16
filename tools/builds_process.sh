# shellcheck shell=bash
# Verwerkt aangeleverde buildpakketten voor de afgesloten map builds/ op de server (workflow Builds).
# Wordt gesourced NA tools/ftps.sh en ftps_connect. Omgeving: ROTATE (true = nieuwe sleutels), REF (Supabase-project),
# IMPORT_REPO (true = eenmalig de oude pakketten uit versions/ van deze repo overzetten).
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

# aangeleverde pakketten op de branches inbox-<platform>
builds_inbox(){
  local plat ref sha d k iv
  for plat in $PLATS; do
    sha=$(git ls-remote origin "refs/heads/inbox-$plat" | awk '{print $1}')
    [ -n "$sha" ] || continue
    d="$BW/in-$plat"; mkdir -p "$d"
    git fetch -q --depth 1 origin "refs/heads/inbox-$plat" || { echo "::warning::$plat: inbox niet op te halen"; continue; }
    for x in pkg.enc key.enc meta.json; do git show "FETCH_HEAD:$x" > "$d/$x" 2>/dev/null || true; done
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
    rm -rf "$d"
    # branch weg, alleen als er intussen niets nieuws op staat
    git push -q --force-with-lease="refs/heads/inbox-$plat:$sha" origin ":refs/heads/inbox-$plat" 2>/dev/null \
      || echo "::notice::$plat: inbox-branch niet verwijderd (intussen een nieuwere build?); volgende ronde."
  done
}

builds_finish(){
  if [ "${BUILDS_CHANGED:-0}" = 1 ]; then
    srv_put "$BW/srv/manifest.json" manifest.json 600 || { echo "::error::Manifest niet op de server gezet."; return 1; }
  fi
  rm -rf "$BW"
}
