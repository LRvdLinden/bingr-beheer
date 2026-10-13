# Bingr-beheer (privé)

Het beheer-dashboard van **Bingr**, op **https://beheer.bingr.online**. Deze repo is privé; het dashboard stond eerder op `bingr.online/admindashboard` in de openbare repo bingr-website.

- `web/` — het dashboard zelf (statische HTML/JS/CSS, geen build-stap): overzicht, gebruikers, berichten en status. Alles staat erin (`config.js` met de publieke Supabase-URL en publishable key, favicon). `robots.txt` blokkeert alles en de pagina heeft `noindex`.
- `supabase/functions/admin` — de Supabase Edge Function `admin` waar het dashboard mee praat (inloggen, statistieken, gebruikers, berichten en mail, en de tab Status via de functie `status`). `supabase/functions/_shared/mail.ts` is een kopie van die in iptv-ios-appletv.

Wat er **niet** in staat: het databaseschema (ook de beheertabellen), de functies `device-auth`, `web-proxy` en `status`, en de statusplanning. Die staan in de openbare repo [LRvdLinden/iptv-ios-appletv](https://github.com/LRvdLinden/iptv-ios-appletv) (`supabase/`, workflow *Backend*). De afmeldpagina `bingr.online/unsubscribe/` staat op de gewone site en roept alleen de actie `unsubscribe` van `admin` aan; dat is het enige wat bingr.online mag.

Wijzigingen in deze repo komen **nooit** in de openbare changelog (`docs/changelog.json`), niet op bingr.online en niet in de release-notities.

## GitHub-secrets

*Settings → Secrets and variables → Actions → New repository secret*. Ontbreekt er een, dan geeft de workflow een waarschuwing en slaat hij de stap over (geen fout).

**Dashboard (workflow *Dashboard*, `deploy-site.yml`)**

| Secret | Wat |
| --- | --- |
| `FTP_SERVER` | FTP-server van de hoster (dezelfde als bij bingr-website) |
| `FTP_USERNAME` | FTP-gebruikersnaam |
| `FTP_PASSWORD` | FTP-wachtwoord |
| `FTP_DIR` | de map waar beheer.bingr.online naar wijst, gezien vanaf de FTP-login (bv. `beheer.bingr.online` of `domains/bingr.online/beheer`) |
| `FTP_USERNAME_ALT` | optioneel: tweede gebruikersnaam om te proberen |

De workflow uploadt altijd precies naar `FTP_DIR` (en weigert de hoofdmap of `public_html` van bingr.online). Daarna controleert hij of https://beheer.bingr.online/ het dashboard toont; zo niet, dan een waarschuwing (subdomein, DNS of SSL nog niet klaar).

**Functie admin (workflow *Admin-functie*, `deploy-admin.yml`)**

| Secret | Wat |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | persoonlijk token van supabase.com/dashboard/account/tokens (hetzelfde als in iptv-ios-appletv) |
| `BINGR_ADMIN_USER` | gebruikersnaam voor het dashboard |
| `BINGR_ADMIN_PASSWORD` | wachtwoord voor het dashboard (minstens 12 tekens) |
| `SUPABASE_PROJECT_REF` | optioneel; standaard `vjewsncmsxmhmhnoxwqx` (uit de publieke Supabase-URL) |
| `BINGR_SMTP_HOST`, `BINGR_SMTP_PORT` (465), `BINGR_SMTP_USER`, `BINGR_SMTP_PASSWORD`, `BINGR_SMTP_FROM` | optioneel: mail voor berichten. Staan ook in iptv-ios-appletv (de functie `status` mailt storingen); zet ze hier alleen als ze daar gelijk zijn |

Function-secrets gelden voor het hele Supabase-project, dus voor alle functies tegelijk. Zolang `BINGR_ADMIN_USER` / `BINGR_ADMIN_PASSWORD` hier nog niet staan, gebruikt de functie de waarden die al op de server staan. De `STATUS_CRON_SECRET` voor de tab Status zet de workflow *Backend* in iptv-ios-appletv; hier hoeft die niet.

## Subdomein beheer.bingr.online instellen (eenmalig, bij de hoster)

1. Maak in het hostingpaneel (bij *Domeinen* / *Subdomeinen*) het subdomein **beheer.bingr.online** aan en laat het naar een **eigen map** wijzen, buiten de webmap van bingr.online (dus niet `public_html/beheer`, anders staat het dashboard ook op bingr.online/beheer). Veel panelen maken zelf een map als `beheer.bingr.online` of `domains/bingr.online/beheer` aan.
2. Zoek op hoe die map heet vanaf de FTP-login (log in met een FTP-programma en kijk in de hoofdmap) en zet dat pad in het secret `FTP_DIR`.
3. Staat de DNS niet bij de hoster zelf: maak een A-record (of CNAME naar bingr.online) voor `beheer` aan.
4. Vraag in het hostingpaneel een SSL-certificaat aan voor beheer.bingr.online (meestal *SSL / Let's Encrypt*, gratis). Zet, als het paneel dat kan, *HTTPS forceren* aan.
5. Start *Actions → Dashboard → Run workflow*. Bij een groen vinkje zonder waarschuwing staat het dashboard op https://beheer.bingr.online.

## Lokaal testen

De functie staat ook `http://localhost` en `http://127.0.0.1` toe. Bijvoorbeeld: `python3 -m http.server 8080 -d web` en dan http://localhost:8080 openen.
