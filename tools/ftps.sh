# shellcheck shell=bash
# FTPS-verbinding met de server van beheer.bingr.online (zelfde aanpak als de workflow Dashboard).
# Gebruik:  source tools/ftps.sh; ftps_connect; ftps_run "cd \"$FTPS_TARGET\"; ls"
# Nodig in de omgeving: FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, optioneel FTP_USERNAME_ALT en FTP_DIR.
# Alleen FTPS met gecontroleerd certificaat. Het log is openbaar: geen gebruikersnamen, mappen, IP-adressen of
# serverantwoorden, alleen gelukt/mislukt.

_ftps_common="set cmd:fail-exit true; set net:max-retries 3; set net:timeout 30; set net:reconnect-interval-base 5; set ftp:passive-mode true"
_ftps_common="$_ftps_common; set ftp:ssl-force true; set ftp:ssl-protect-data true; set ftp:ssl-protect-list true"
_ftps_common="$_ftps_common; set ssl:verify-certificate yes; set ssl:check-hostname yes; set ssl:ca-file /tmp/ftp-ca.pem"

_ftps_trim(){ printf '%s' "$1" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
_ftps_ips(){ (getent ahosts "$1" || true) | awk '{print $1}' | sort -u; }
_ftps_classify(){
  if grep -qiE "doesn.?t match|does not match|not match.*host|hostname mismatch" /tmp/ftps-err.txt; then echo hostname
  elif grep -qiE "certificate|verif|gnutls|ssl|tls" /tmp/ftps-err.txt; then echo tls
  elif grep -qiE "login incorrect|530|authentication|not logged in" /tmp/ftps-err.txt; then echo login
  else echo connect; fi
}
_ftps_try(){ lftp -e "$_ftps_common; open --env-password -u \"$2\" \"$1\"; cls -1 > /tmp/ftps-root.txt; bye" >/dev/null 2>/tmp/ftps-err.txt; }
_ftps_add_chain(){
  local h="$1" aia
  aia=$(timeout 30 openssl s_client -connect "$h:21" -starttls ftp -servername "$h" </dev/null 2>/dev/null \
    | openssl x509 -noout -text 2>/dev/null | grep -oE 'CA Issuers - URI:[^ ]+' | sed 's/CA Issuers - URI://' | head -1 || true)
  [ -n "$aia" ] || return 0
  curl -fsSL --max-time 20 "$aia" -o /tmp/ftps-inter.bin 2>/dev/null || return 0
  openssl x509 -inform DER -in /tmp/ftps-inter.bin -out /tmp/ftps-inter.pem 2>/dev/null \
    || openssl x509 -in /tmp/ftps-inter.bin -out /tmp/ftps-inter.pem 2>/dev/null || return 0
  grep -q "$(sed -n 2p /tmp/ftps-inter.pem)" /tmp/ftp-ca.pem || cat /tmp/ftps-inter.pem >> /tmp/ftp-ca.pem
}
_ftps_cert_host(){
  local host="$1" names n want got ptr cand=""
  names=$(timeout 25 openssl s_client -connect "$host:21" -starttls ftp -servername "$host" </dev/null 2>/dev/null \
    | openssl x509 -noout -ext subjectAltName -subject 2>/dev/null \
    | grep -oE '(DNS:|CN ?= ?)[A-Za-z0-9*._-]+' | sed -E 's/^(DNS:|CN ?= ?)//' | tr 'A-Z' 'a-z' | sort -u) || true
  want=$(_ftps_ips "$host"); [ -n "$want" ] || return 1
  ptr=$(getent hosts "$(echo "$want" | head -1)" 2>/dev/null | awk '{print $2}' | sed 's/\.$//' | tr 'A-Z' 'a-z' || true)
  for n in $ptr $names; do
    if [[ "$n" == \*.* ]]; then n="${host%%.*}.${n#\*.}"; fi
    [[ "$n" == *\** || "$n" == "$host" ]] && continue
    got=$(_ftps_ips "$n"); [ -n "$got" ] || continue
    if [ -z "$(comm -23 <(echo "$got") <(echo "$want"))" ]; then cand="$n"; break; fi
  done
  [ -n "$cand" ] && { printf '%s' "$cand"; return 0; }
  return 1
}

# Zet FTPS_USER, FTPS_SERVER en FTPS_TARGET (de map van beheer.bingr.online); stopt met een fout als het niet lukt.
ftps_connect(){
  local k v t base srv u attempt last="" alt
  for k in FTP_SERVER FTP_USERNAME FTP_PASSWORD; do
    v="${!k:-}"; [ -n "$v" ] || { echo "::error::Secret $k ontbreekt."; return 1; }
    t=$(_ftps_trim "$v"); printf -v "$k" '%s' "$t"
  done
  export LFTP_PASSWORD="$FTP_PASSWORD"
  cp /etc/ssl/certs/ca-certificates.crt /tmp/ftp-ca.pem
  FTPS_USER=""; FTPS_SERVER=""
  for attempt in 1 2 3; do
    [ "$attempt" -gt 1 ] && sleep 45
    for base in "$FTP_SERVER" ftp.bingr.online bingr.online; do
      [ -n "$(_ftps_ips "$base")" ] || continue
      srv="$base"; [ "$attempt" = 1 ] && _ftps_add_chain "$base"
      for u in "$FTP_USERNAME" "${FTP_USERNAME_ALT:-}"; do
        [ -z "$u" ] && continue
        if _ftps_try "$srv" "$u"; then FTPS_USER="$u"; FTPS_SERVER="$srv"; break 3; fi
        last=$(_ftps_classify)
        if [ "$last" = hostname ] || [ "$last" = tls ]; then
          if alt=$(_ftps_cert_host "$base"); then
            srv="$alt"
            if _ftps_try "$srv" "$u"; then FTPS_USER="$u"; FTPS_SERVER="$srv"; break 3; fi
            last=$(_ftps_classify)
          fi
        fi
        [ "$last" = hostname ] || [ "$last" = tls ] && break
      done
      [ "$last" = login ] && break 2
    done
    [ "$last" = hostname ] || [ "$last" = tls ] && break
  done
  rm -f /tmp/ftps-err.txt
  [ -n "$FTPS_USER" ] || { echo "::error::Geen FTPS-verbinding met de server (soort fout: ${last:-onbekend})."; return 1; }
  FTPS_TARGET="${FTP_DIR%/}"
  if [ -z "$FTPS_TARGET" ]; then
    FTPS_TARGET="."
    # nooit in de webmap van bingr.online
    if grep -qxE '(koppelen|changelog|status|unsubscribe|account)/?' /tmp/ftps-root.txt; then
      echo "::error::Deze FTP-login komt uit in de webmap van bingr.online."; return 1
    fi
  fi
  t="${FTPS_TARGET#/}"
  if [[ "$t" == public_html/* ]] && ! grep -qx 'public_html/\?' /tmp/ftps-root.txt; then FTPS_TARGET="${t#public_html/}"; fi
  rm -f /tmp/ftps-root.txt
  echo "::notice::Verbonden met de server (FTPS, certificaat gecontroleerd)."
}

# lftp-commando's uitvoeren op de server; uitvoer naar stdout (niet naar het log sturen als er servergegevens in staan)
ftps_run(){ lftp -e "$_ftps_common; open --env-password -u \"$FTPS_USER\" \"$FTPS_SERVER\"; $1; bye"; }
# zoals ftps_run, maar fouten negeren (bv. een bestand dat nog niet bestaat)
ftps_try(){ lftp -e "$_ftps_common; set cmd:fail-exit false; open --env-password -u \"$FTPS_USER\" \"$FTPS_SERVER\"; $1; bye"; }
