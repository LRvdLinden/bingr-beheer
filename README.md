# Bingr-beheer

Het beheer-dashboard van **Bingr**, op **https://beheer.bingr.online**. Het dashboard stond eerder op `bingr.online/admindashboard` in de repo bingr-website.

**Deze repo is openbaar.** Iedereen kan de code, de commits en de logs van de workflows lezen. Daarom:

- **Geen geheimen**: wachtwoorden, tokens, SMTP-gegevens, `service_role`-sleutels en dergelijke alleen als GitHub-secrets (zie hieronder), nooit in een bestand, commit, issue of log. Wel toegestaan: de publieke Supabase-URL en de publishable key (`web/config.js`, `ios/…/AdminAPI.swift`) en de project-ref die daarin staat.
- **Geen persoonsgegevens**: geen e-mailadressen, namen, account-id's, tickets of exports van gebruikers, ook niet als testdata of in screenshots.
- **Geen logs met servergegevens**: workflows en scripts schrijven geen secrets, interne adressen, FTP-mappen, volledige serverantwoorden met gebruikersgegevens of stacktraces met configuratie naar het log; zet zulke stappen op een korte melding (`::notice::` / `::warning::`) zonder waarden.
- De beveiliging hangt niet af van geheimhouding van de code: alles achter het inloggen loopt via de functie `admin` met een ondertekend token.

- `web/` — het dashboard zelf (statische HTML/JS/CSS, geen build-stap): overzicht, gebruikers, berichten, supporttickets, status en downloads. Alles staat erin (`config.js` met de publieke Supabase-URL en publishable key, favicon). `robots.txt` blokkeert alles en de pagina heeft `noindex`.
- `ios/` — de native app **BingrBeheer** (iOS/iPadOS 17+) met dezelfde onderdelen als het web-dashboard; zie *iOS-app* hieronder.
- `supabase/functions/admin` — de Supabase Edge Function `admin` waar het dashboard mee praat (inloggen, statistieken, gebruikers, berichten en mail, de tab Status via de functie `status` en de tab Support via de functie `support`). `supabase/functions/_shared/mail.ts` is een kopie van die in iptv-ios-appletv.

Wat er **niet** in staat: het databaseschema (ook de beheertabellen), de functies `device-auth`, `web-proxy` en `status`, en de statusplanning. Die staan in de openbare repo [LRvdLinden/iptv-ios-appletv](https://github.com/LRvdLinden/iptv-ios-appletv) (`supabase/`, workflow *Backend*). De afmeldpagina `bingr.online/unsubscribe/` staat op de gewone site en roept alleen de actie `unsubscribe` van `admin` aan; dat is het enige wat bingr.online mag.

Beveiliging (build 97):

- Het token (12 uur) bevat geen inlognaam meer, wel een **tokenversie** (tabel `admin_token_state`); elk verzoek controleert die. **Overal uitloggen** (Instellingen en het menu rechtsboven, web en app; actie `logout_all`) verhoogt de versie: alle sessies vervallen meteen. Een ander `BINGR_ADMIN_PASSWORD` doet dat vanzelf.
- Limieten per IP: na inloggen 300 verzoeken per minuut, afmelden (`unsubscribe`) 20 per 10 minuten (one-click vanaf mailservers 200 per 10 minuten).
- Het logboek (`admin_audit`) bevat ook inzage van persoonsgegevens (`user_view`, `users_search`, `user_email_view`, `support_view`: alleen actie en id/nummer, geen inhoud; `user_set_name` zonder de naam zelf), geblokkeerde inlogpogingen (`login_locked`) en mislukte acties (`<actie>_failed` met foutcode).
- Het dashboard heeft een strikte Content-Security-Policy (`web/.htaccess`, ook als meta in `index.html`): geen inline scripts of styles, alleen verbinding met de eigen Supabase-URL.
- Bulkmail houdt per ontvanger bij wat verstuurd is (`announcement_sends`); stopt de functie midden in een batch, dan komen de overgebleven ontvangers na 10 minuten opnieuw aan de beurt.
- De GitHub Actions staan vast op een commit-SHA en de Supabase CLI op een vaste versie; de unittests blokkeren de deploy.

Wijzigingen in deze repo komen **nooit** in de openbare changelog (`docs/changelog.json`), niet op bingr.online en niet in de release-notities.

## GitHub-secrets

*Settings → Secrets and variables → Actions → New repository secret*. Ontbreekt er een, dan geeft de workflow een waarschuwing en slaat hij de stap over (geen fout).

**Dashboard (workflow *Dashboard*, `deploy-site.yml`)**

| Secret | Wat |
| --- | --- |
| `FTP_SERVER` | FTP-server, bij voorkeur de hostnaam die op het TLS-certificaat van de FTP-server staat. Alleen FTPS met een gecontroleerd certificaat (geen gewone FTP, geen andere server); staat het certificaat op een andere naam van dezelfde server, dan gebruikt de workflow die naam |
| `FTP_USERNAME` | FTP-gebruikersnaam van het eigen FTP-account van beheer.bingr.online (komt direct uit in de map van het subdomein; dan is `FTP_DIR` niet nodig) |
| `FTP_PASSWORD` | FTP-wachtwoord |
| `FTP_DIR` | optioneel; leeg als de FTP-login (een eigen FTP-account van het subdomein) direct in de map van beheer.bingr.online uitkomt. Anders de map waar beheer.bingr.online naar wijst, gezien vanaf de FTP-login (bv. `beheer.bingr.online` of `domains/bingr.online/beheer`) |
| `FTP_USERNAME_ALT` | optioneel: tweede gebruikersnaam om te proberen |

De workflow uploadt naar `FTP_DIR`, of zonder `FTP_DIR` naar de hoofdmap van de FTP-login (en weigert de hoofdmap of `public_html` van bingr.online). Daarna controleert hij of https://beheer.bingr.online/ het dashboard toont; zo niet, dan een waarschuwing (subdomein, DNS of SSL nog niet klaar).

**Functie admin (workflow *Admin-functie*, `deploy-admin.yml`)**

| Secret | Wat |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | persoonlijk token van supabase.com/dashboard/account/tokens (hetzelfde als in iptv-ios-appletv) |
| `BINGR_ADMIN_USER` | gebruikersnaam voor het dashboard |
| `BINGR_ADMIN_PASSWORD` | wachtwoord voor het dashboard (minstens 12 tekens) |
| `SUPABASE_PROJECT_REF` | optioneel; standaard `vjewsncmsxmhmhnoxwqx` (uit de publieke Supabase-URL) |
| `BINGR_SMTP_HOST`, `BINGR_SMTP_PORT` (465), `BINGR_SMTP_USER`, `BINGR_SMTP_PASSWORD`, `BINGR_SMTP_FROM` | optioneel: mail voor berichten. Staan ook in iptv-ios-appletv (de functie `status` mailt storingen); zet ze hier alleen als ze daar gelijk zijn |

**Buildpakketten (workflow *Builds*, `builds.yml`)**

| Secret | Wat |
| --- | --- |
| `BINGR_INBOX_READ_TOKEN` | fine-grained token met **alleen** de privé repo `LRvdLinden/bingr-inbox`, *Contents: Read and write* (lezen van de inbox-branches en ze na verwerking verwijderen). Ontbreekt hij, dan meldt *Builds* een waarschuwing en verwerkt hij alleen de inbox-branches in deze repo |
| `FTP_*`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | dezelfde als hierboven |

Optioneel de *variabele* (niet secret) `BINGR_INBOX_REPO` als de inbox-repo anders heet (standaard `LRvdLinden/bingr-inbox`).

In **iptv-ios-appletv** en **bingr-android** staat het secret `BINGR_INBOX_TOKEN`: fine-grained token met **alleen** `LRvdLinden/bingr-inbox`, *Contents: Read and write*. Daar staat **geen** token voor bingr-beheer meer (zie *Aanleveren via de privé inbox-repo*).

Function-secrets gelden voor het hele Supabase-project, dus voor alle functies tegelijk. `BINGR_BUILDS_KEY` (tab Downloads) zet de workflow *Builds*; zie *Downloads (buildpakketten)*. De tab **Support** gebruikt het geheim `SUPPORT_ADMIN_SECRET`; dat maakt de workflow *Backend* in iptv-ios-appletv één keer zelf aan (hier niets voor nodig). De afzender van supportmails (`BINGR_SUPPORT_FROM`, standaard `Bingr Support <support@bingr.online>`) en het adres voor meldingen (`BINGR_SUPPORT_EMAIL`, standaard `support@bingr.online`) staan, als je ze wilt aanpassen, als secrets in iptv-ios-appletv. Zolang `BINGR_ADMIN_USER` / `BINGR_ADMIN_PASSWORD` hier nog niet staan, gebruikt de functie de waarden die al op de server staan. De `STATUS_CRON_SECRET` voor de tab Status zet de workflow *Backend* in iptv-ios-appletv; hier hoeft die niet.

## Dashboard (tab Overzicht)

Het overzicht is een instelbaar dashboard met widgets, op het web en in de app (zelfde model). Zonder eigen indeling toont het de standaardindeling (lijkt op het vroegere vaste overzicht): tien kengetallen (gebruikers, nieuw, actief vandaag/30 dagen, apparaten, kijkt nu, open tickets, geblokkeerd, Gratis, Lifetime), servicestatus, nieuwe gebruikers en inlogs per dag, apparaten per platform en app-versies.

- **Wijzig** zet de wijzigmodus aan. Per widget: grootte **S** (1×1), **M** (2×1) of **L** (2×2), verplaatsen (web: slepen met de muis, of de pijlknoppen *naar voren* / *naar achteren* met het toetsenbord; app: lang drukken en slepen, de pijlen, of de grepen in *Widgets*), **instellen** (schuifjes: getoonde gegevens) en **verbergen**. **Widget toevoegen** (web) / **Widgets** (app) toont verborgen widgets (tonen of verwijderen) en de galerij. **Standaard herstellen** zet alles terug; *Standaard voor deze widget* doet dat voor één widget.
- Raster: web 4 kolommen, 2 onder 1000 px, 1 kolom op telefoonbreedte (≤ 600 px); app 4 kolommen op de iPad (regular), 2 op de iPhone. Widgets vullen de eerste vrije plek (geen gaten; web `grid-auto-flow: row dense`).
- Gegevens komen uit bestaande acties: `stats` (altijd), `support_counts` (elke 2 minuten, zoals de badge), `status` met `op: overview` (alleen als er een zichtbare widget Servicestatus of *Nu actieve apparaten* is) en `announcements_list` (alleen met een zichtbare widget Laatste berichten). Geen nieuwe serveracties.
- Opslag per apparaat: web in `localStorage` onder `bingrAdmin.dashboard`, app in `UserDefaults` onder `dashboardLayout` (JSON-tekst). Niet op de server en niet gedeeld tussen apparaten; doordat beide hetzelfde JSON gebruiken, kan synchroniseren later via een serveractie.

### JSON-model (versie 1)

```json
{
  "version": 1,
  "widgets": [
    { "id": "users", "type": "metric", "size": "s", "hidden": false, "options": { "metric": "users_total" } },
    { "id": "chart_new", "type": "daily_chart", "size": "l", "hidden": false, "options": { "series": "new_users", "days": 30, "display": "chart" } }
  ]
}
```

- `version`: altijd `1`. Een andere versie, geen geldige JSON of geen enkele geldige widget = standaardindeling.
- `widgets`: volgorde = plaats op het dashboard; max. 40. `id`: `[A-Za-z0-9_-]{1,40}`, uniek (ongeldig of dubbel = nieuw id `<type>_<n>`). Een widget met onbekend `type` valt weg (de rest blijft). `size`: `s`, `m` of `l`, alleen de maten van het type (anders de standaardmaat). `hidden`: verborgen maar bewaard (standaard `false`). `options`: alleen de sleutels hieronder; een ontbrekende of ongeldige waarde krijgt de standaard (**vet**).

| `type` | maten (standaard) | `options` |
| --- | --- | --- |
| `metric` (Kengetal) | s, m (**s**) | `metric`: **`users_total`**, `users_new_7d`, `active_today`, `active_30d`, `devices`, `watching_now`, `blocked`, `plan_free`, `plan_lifetime`, `plan_custom`, `opted_out` |
| `daily_chart` (Per dag) | s, m, l (**l**) | `series`: **`new_users`**, `signins`, `active_users`; `days`: 7, 14, **30**; `display`: **`chart`**, `number` (S toont altijd het getal) |
| `platforms` (Apparaten per platform) | m, l (**l**) | `source`: **`30d`** (stats) of `live` (laatste 15 min, uit `status`); `platforms`: lijst platformnamen zoals in de gegevens (**leeg = alle**) |
| `versions` (App-versies) | m, l (**l**) | `platforms`: als hierboven |
| `plans` (Abonnementen) | s, m, l (**m**) | `plans`: deelverzameling van **`free`, `lifetime`, `custom`** (niet leeg) |
| `support` (Supporttickets) | s, m, l (**s**) | `statuses`: deelverzameling van `new`, `open`, `pending`, `resolved`, `closed` (**new, open, pending**; niet leeg); `display`: **`number`**, `list` |
| `status` (Servicestatus) | s, m, l (**m**) | `show_incidents`: **true**; `show_notices`: **true** |
| `announcements` (Laatste berichten) | m, l (**l**) | `count`: **3**, 5; `only_active`: **false** |

Code: web in `web/admin.js` (blok *overzicht: instelbaar widget-dashboard*, `normLayout`), app in `ios/BingrBeheer/Models/Dashboard.swift` (`DashLayout.normalized()`) en `ios/BingrBeheer/Views/Overview/`. Houd beide gelijk als je een type of optie toevoegt (en verhoog `version` alleen als oude indelingen niet meer kloppen). Niets hiervan komt in de changelog.

## Gebruikers: blokkeren en verwijderen

Accounts hebben een voor- en achternaam (Supabase `user_metadata` `first_name` / `last_name`, gevraagd bij het aanmelden). De lijst toont de naam boven het gemaskeerde e-mailadres; zoeken werkt op het begin van het e-mailadres en op het begin van een woord in de naam (voornaam, achternaam of "voornaam achternaam"; `bingr_admin_users` in iptv-ios-appletv). In de lade (web en app):

- **Naam → Wijzig**: voor- en achternaam (actie `user_set_name`, opgeschoond, max. 50 tekens elk, leeg = geen naam; de rest van de metadata blijft staan). De beheermails (blokkeren, opheffen, verwijderen en berichten per e-mail) beginnen met *Hoi <voornaam>,* (*Hi <first name>,*) als de voornaam bekend is.
- **Oog naast het e-mailadres**: toont het volledige adres (actie `user_email`, in het logboek als `user_email_view` zonder het adres); nog een keer klikken verbergt het weer.

- **Blokkeren…**: reden (de klant ziet hem), duur (1 dag, 7 dagen, 30 dagen, onbepaald of een eigen datum) en *Klant mailen*. De functie zet een inlogblokkade op het account, trekt alle sessies in (apps en website loggen uit) en bewaart reden en einddatum in `account_blocks`. De klant krijgt een mail vanaf support@bingr.online met reden, einddatum (Nederlandse tijd) en een link naar support.bingr.online/nieuw/ (een ticket kan zonder inloggen). Na de einddatum kan de klant vanzelf weer inloggen.
- **Blokkade opheffen**, optioneel met de mail *Je Bingr-account is weer actief*. De lijst toont een chip *Geblokkeerd* en heeft het filter *Geblokkeerd*; het overzicht telt de geblokkeerde accounts. Elke blokkade staat in de geschiedenis.
- **Account verwijderen** (gevarenzone): typ het e-mailadres (volledig, of precies zoals in het beheer). Alle accountgegevens gaan weg; supporttickets blijven standaard bewaard (los van het account), of worden op verzoek mee verwijderd. Daarna gaat de bevestiging *Je Bingr-account is verwijderd* naar de klant.

Alle acties staan in het logboek (`admin_audit`). Niets hiervan komt in de changelog.

## Tab Support

Supporttickets van https://support.bingr.online (repo LRvdLinden/bingr-support). Lijst met nummer (#1001), onderwerp, klant, status en leeftijd; een rode stip = de klant wacht op een reactie die je nog niet hebt gezien. Klik een ticket voor het gesprek, de accountgegevens van de klant (apparaten, platforms, versies), een antwoordvak (de klant krijgt een gebrande mail vanaf support@bingr.online met #nummer in het onderwerp), de status en prioriteit, en interne notities (nooit zichtbaar voor de klant). Een link als `https://beheer.bingr.online/#support/1001` (uit de meldingsmail) opent dat ticket direct. Supporttickets en wijzigingen hieraan komen nooit in de changelog.

### Antwoorden per e-mail (inbox-import)

De functie `support` haalt elke 2 minuten nieuwe mails uit de INBOX van support@bingr.online (IMAP over TLS, pg_cron-taak `bingr-support-inbox`, ingesteld door de workflow *Backend* in iptv-ios-appletv) en zet ze in het ticket:

- **Klant antwoordt op een ticketmail** (onderwerp `[#1007]` of een antwoord op onze Message-ID) vanaf het adres van het ticket: bericht van de klant (label *✉ per e-mail*), status weer *In behandeling*, ticket ongelezen. Een ander adres met hetzelfde ticketnummer wordt geweigerd en blijft ongelezen in de mailbox staan.
- **Jij antwoordt vanuit je mailbox** op een melding (*Nieuw ticket* / *Reactie van klant*): de Reply-To van die meldingen is support@ zelf, dus je antwoord komt via de import in het ticket en gaat als gebrande mail naar de klant. Dat werkt vanaf support@ zelf en vanaf de adressen in het secret `BINGR_SUPPORT_AGENTS` (iptv-ios-appletv). Schrijf boven de regel *-- Antwoord boven deze lijn --*; citaten en handtekeningen worden weggeknipt.
- **Nieuwe mail aan support@** zonder ticket: nieuw ticket (categorie Overig) met bevestigingsmail; max. 3 per adres en 100 in totaal per uur. Reactie op een gesloten ticket: nieuw vervolgticket.
- Genegeerd (blijven staan): onze eigen meldingen (X-Bingr-Ticket), afwezigheidsmeldingen, bounces, nieuwsbrieven en spam. Verwerkte mails worden gelezen en naar de map **Bingr-verwerkt** verplaatst als die bestaat (maak hem zelf aan in de mailbox). Bijlagen worden niet overgenomen (alleen een regel met de naam).

Boven de ticketlijst staat de status van de import (laatste ronde, fout, *IMAP niet ingesteld*), een knop **Nu ophalen** en het logboek van de laatste mails. Zonder `BINGR_IMAP_*` blijft alles zoals vroeger (Reply-To van meldingen = de klant).

## Downloads (buildpakketten)

De buildpakketten van Bingr (Android/Android TV-APK, Samsung TV-`.wgt`, Apple Xcode-project) en van BingrBeheer (Xcode-project) staan **niet** op GitHub: niet in een repo, niet als release en niet als onversleuteld artefact. Ze staan op de server van beheer.bingr.online in de afgesloten map `builds/` (`web/builds/.htaccess` weigert elke rechtstreekse aanvraag), met `builds/manifest.json` (per platform versie, build, bestand, grootte, SHA-256, datum, notities en de vorige builds die nog op de server staan).

- **Workflow *Builds*** zet de pakketten (versleuteld aangeleverd door de bouwworkflows), het manifest en `builds/key.php` op de server, en zet dezelfde sleutel als function-secret **`BINGR_BUILDS_KEY`** (64 hex-tekens) in Supabase. Hier hoeft niets voor; de workflow *Admin-functie* zet of verwijdert die sleutel niet.
- **Aanleveren via de privé inbox-repo (H3):** de bouwworkflows van iptv-ios-appletv en bingr-android versleutelen hun pakket met `tools/seal_build.sh` (anoniem gekloond uit deze openbare repo, samen met de publieke sleutel `builds.pub.pem`) en pushen het naar de branch `inbox-<platform>` van de **privé** repo `LRvdLinden/bingr-inbox`, met het secret `BINGR_INBOX_TOKEN` (alleen schrijfrechten op die repo; het token gaat als kopregel mee, nooit in een URL). Zonder dat secret leveren ze niets aan (met een waarschuwing) en vallen ze niet terug op een ander token. *Builds* draait elke 15 minuten (stopt meteen als er niets klaarstaat), haalt de pakketten daar op met `BINGR_INBOX_READ_TOKEN` en verwijdert de branch. Zo heeft geen andere repo nog schrijfrechten op deze openbare repo, waarmee iemand het dashboard of de functie `admin` zou kunnen vervangen. De Beheer-app (*Beheer-app*, `build-ios.yml`) levert met het eigen `GITHUB_TOKEN` aan op `inbox-beheer` van deze repo zelf en start *Builds* meteen; `seal_build.sh` weigert andere platforms naar bingr-beheer. Inbox-branches die nog in deze repo staan (van vóór de overgang) verwerkt *Builds* ook en verwijdert ze daarna.
- **Eenmalig instellen (eigenaar):**
  1. Maak op GitHub de **privé** repo `LRvdLinden/bingr-inbox` (leeg, zonder README is prima; geen Actions nodig).
  2. Maak een fine-grained token *Bingr inbox schrijven* (*Settings → Developer settings → Fine-grained tokens*): Resource owner LRvdLinden, *Only select repositories* = `bingr-inbox`, *Repository permissions → Contents: Read and write* (verder niets), met een vervaldatum. Zet het als secret **`BINGR_INBOX_TOKEN`** in **iptv-ios-appletv** én **bingr-android**.
  3. Maak een tweede fine-grained token *Bingr inbox verwerken*: alleen `bingr-inbox`, *Contents: Read and write*. Zet het als secret **`BINGR_INBOX_READ_TOKEN`** in **bingr-beheer**.
  4. Verwijder het secret **`BINGR_BEHEER_TOKEN`** uit iptv-ios-appletv en bingr-android, en **trek het token zelf in** (*Fine-grained tokens* → het token met schrijfrechten op bingr-beheer → *Delete*). Controleer in *Settings → Collaborators* en *Deploy keys* van bingr-beheer dat er geen andere schrijftoegang meer is dan jijzelf.
  5. Start in bingr-beheer *Actions → Builds → Run workflow* (controle: geen waarschuwing over `BINGR_INBOX_READ_TOKEN`), en daarna een build in iptv-ios-appletv of bingr-android (*Run workflow*): binnen 15 minuten staat hij in de tab Downloads.
- **Ophalen** kan alleen via `https://beheer.bingr.online/dl.php?t=<token>` (`web/dl.php`). Het token maakt de functie `admin` na inloggen: `<payload>.<sig>`, payload = base64url (zonder `=`) van `{"f": "<platform>/<bestand>" | "manifest.json", "e": <verloop, unix-seconden>}`, sig = base64url(HMAC-SHA256(`BINGR_BUILDS_KEY`, payload)). dl.php weigert tokens die langer dan 15 minuten geldig zijn. Code en tests: `supabase/functions/admin/builds.ts`, `builds_test.ts`.
- **Tab Downloads** (web en app; acties `builds` en `build_link`): per platform de nieuwste build met versie, datum, grootte en notities, een knop **Downloaden** en de oudere builds. Een downloadlink is 10 minuten geldig en komt (platform en build, niet de link) in het logboek (`admin_audit`, actie `build_link`). Zonder `BINGR_BUILDS_KEY` meldt de tab *Downloads nog niet ingericht*; zonder manifest *Nog geen builds op de server*.
- Oude links naar `raw.githubusercontent.com/…/versions/…` (en naar de `versions/`-map in de repo's) werken niet meer. Gebruik de tab Downloads.
- Downloads en wijzigingen daaraan komen nooit in de changelog.

## iOS-app (BingrBeheer)

Native SwiftUI-app voor iPhone en iPad (iOS/iPadOS 17+, bundle-id `nl.lrvdlinden.bingr.beheer`) in `ios/`, met een XcodeGen-project (`ios/project.yml`). Ze praat met dezelfde functie `admin` als het web-dashboard (publieke Supabase-URL en publishable key ingebouwd, geen geheimen) en heeft alle tabs: Overzicht (instelbaar dashboard met widgets, grafieken met Swift Charts; zie *Dashboard*), Gebruikers (zoeken, details, apparaten, wachtwoord-reset), Support (filters, zoeken, gesprek met interne notities, antwoorden, status/prioriteit, inbox-import en *Nu ophalen*), Berichten (NL/EN met voorbeeld, e-mailen in batches, verder verzenden, verwijderen) en Status (monitors, storingen, reactietijd, controleren, monitors toevoegen/bewerken), en sinds build 7 Downloads (zie *Downloads (buildpakketten)*). Tabbalk op de iPhone, zijbalk op de iPad; rechtsboven een menu met het app-icoon (alle onderdelen, op de iPhone ook Downloads en Instellingen, Overal uitloggen en Uitloggen), net als het menu rechtsboven in het web-dashboard. Het token staat in de Keychain (alleen dit apparaat, geen iCloud); vergrendelen met Face ID / toegangscode staat sinds build 6 standaard aan bij de eerste keer inloggen (uit te zetten in Instellingen). In Instellingen ook **Overal uitloggen**. `bingrbeheer://support/1001` opent een ticket; `bingrbeheer://support`, `bingrbeheer://status` en `bingrbeheer://overview` openen die tab. Met homescherm- en toegangsschermwidgets voor servicestatus en supporttickets; zie *Beheer-app: widgets*.

- **Workflow *Beheer-app*** (`.github/workflows/build-ios.yml`, bij een push naar `main` die `ios/` raakt): `xcodegen generate` en een build voor een generiek iOS-apparaat zonder ondertekening. Lukt dat, dan levert de workflow het Xcode-project (ios/ met het gegenereerde `BingrBeheer.xcodeproj`) als `Bingr-Beheer-<versie>-build<N>-Xcode.zip` versleuteld aan voor de map `builds/beheer/` op de server (workflow *Builds*); ophalen via de tab **Downloads**. Het staat niet meer in deze repo. Fouten staan als annotaties bij de run en in `latest.txt` op de branch `ci-logs-beheer`.
- **Installeren**: zip ophalen via *Downloads* (web of app), uitpakken, `ios/BingrBeheer.xcodeproj` openen in Xcode 16, bij *Signing & Capabilities* je Team kiezen (staat standaard op het Bingr-team) en op je iPhone/iPad draaien. Zelf genereren kan ook: `brew install xcodegen && cd ios && xcodegen generate`.
- Versie en build staan in `ios/project.yml` (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`): een eigen reeks, los van de Bingr-buildnummers. App-icoon: `python3 ios/tools/make_icon.py`.
- Nooit in de changelog van Bingr.

### Beheer-app: widgets

WidgetKit-extensie `BingrBeheerWidgets` (bundle-id `nl.lrvdlinden.bingr.beheer.widgets`, iOS/iPadOS 17+, map `ios/BingrBeheerWidgets/`; gedeelde code in `ios/Shared/`), ingebed in de app. Drie widgets (lang indrukken → *Wijzig widget* voor de instellingen):

| Widget | Formaten | Instellingen | Tik opent |
| --- | --- | --- | --- |
| **Servicestatus**: algemene status (werkt, onderhoud, verminderd, gedeeltelijke/grote storing) en per onderdeel, problemen eerst | klein, middel, toegangsscherm (rechthoek, rond) | *Alleen problemen tonen* | `bingrbeheer://status` (tab Status) |
| **Supporttickets**: nieuw, open (in behandeling, desgewenst incl. *wacht op klant*) en afgerond (opgelost + gesloten), plus *wacht op reactie* | klein, middel, toegangsscherm (rechthoek, rond) | welke tellers, *wacht op klant meetellen*, hoofdteller voor rond | `bingrbeheer://support` (tab Support) |
| **BingrBeheer**: beide naast/onder elkaar | middel, groot | — | de helft waarop je tikt |

- **Gegevens**: de actie `widget_summary` van de functie `admin` (status via de functie `status` zoals de tab Status, tellers via `support_counts`). Alleen statusnamen en aantallen: geen e-mailadressen, namen, tickets, monitor-adressen of foutmeldingen. Elke ~20 minuten een nieuwe stand (WidgetKit kiest het precieze moment); de app werkt de widgets ook meteen bij na inloggen, uitloggen en het laden van Support of Status. Zonder verbinding toont de widget de laatst bekende stand (met een *geen verbinding*-icoon).
- **Widget-token** (los van de inlogsessie van 12 uur):
  - Na het inloggen vraagt de app met de gewone sessie de actie `widget_token` aan. Die geeft een apart token met scope `widget`, 30 dagen geldig, ondertekend met een **eigen sleutel** (afgeleid van dezelfde function-secrets, ander domein) en met de **tokenversie** `v` uit `admin_token_state`.
  - Een widget-token mag **alleen** `widget_summary`; een gewoon token wordt door `widget_summary` geweigerd (401) en een widget-token door alle andere acties (andere sleutel én scope). Een widget-token kan geen nieuw widget-token aanvragen.
  - **Overal uitloggen** of een ander `BINGR_ADMIN_PASSWORD` trekt ook alle widget-tokens in. De app vraagt hoogstens eens per dag een nieuw token aan zolang je ingelogd bent; verloopt alleen de sessie van 12 uur, dan blijven de widgets werken tot het widget-token verloopt.
  - Het aanvragen staat in het logboek (`admin_audit`, actie `widget_token`, zonder token); `widget_summary` niet (wel max. 30 per minuut per IP).
  - Code en tests: `supabase/functions/admin/widget.ts`, `widget_test.ts` (blokkeren de deploy).
- **Opslag**: het widget-token staat in de Keychain-toegangsgroep `<Team-ID>.nl.lrvdlinden.bingr.beheer.shared` (keychain-access-groups in de entitlements van app en extensie, `ios/project.yml`), alleen op dit apparaat (niet in iCloud), leesbaar na de eerste ontgrendeling. Het gewone sessietoken blijft in de eigen groep van de app; de widget kan dat niet lezen.
- **Uitloggen** in de app wist het widget-token; de widgets tonen dan *Open BingrBeheer om in te loggen* (ook na Overal uitloggen of als het token verlopen is). In **Instellingen → Widgets** kun je ze uitzetten (token weg). Let op: widgets zijn zichtbaar zonder Face ID; de tellers zijn gemarkeerd als privacygevoelig (`privacySensitive`), zodat iOS ze op een vergrendeld toestel kan verbergen.
- **Installeren**: bij een eigen Team ook voor het target *BingrBeheerWidgets* het Team kiezen (Signing & Capabilities); de Keychain-groep gaat automatisch mee. Widgets en wijzigingen daaraan komen nooit in de changelog.

## Subdomein beheer.bingr.online instellen (eenmalig, bij de hoster)

1. Maak in het hostingpaneel (bij *Domeinen* / *Subdomeinen*) het subdomein **beheer.bingr.online** aan en laat het naar een **eigen map** wijzen, bij voorkeur buiten de webmap van bingr.online. Veel panelen maken zelf een map als `beheer.bingr.online` of `domains/bingr.online/beheer` aan.
2. Zoek op hoe die map heet vanaf de FTP-login (log in met een FTP-programma en kijk in de hoofdmap) en zet dat pad in het secret `FTP_DIR`. Let op: de huidige FTP-login komt direct uit in de webmap van bingr.online. Kan het subdomein alleen naar een map daarbinnen wijzen (bv. `beheer.bingr.online/`), dan is dat prima: `web/.htaccess` stuurt elke andere host (zoals bingr.online/beheer.bingr.online/) door naar https://beheer.bingr.online, en de workflow *Website* van bingr-website verwijdert die map niet (hij uploadt zonder `--delete`).
3. Staat de DNS niet bij de hoster zelf: maak een A-record (of CNAME naar bingr.online) voor `beheer` aan.
4. Vraag in het hostingpaneel een SSL-certificaat aan voor beheer.bingr.online (meestal *SSL / Let's Encrypt*, gratis). Zet, als het paneel dat kan, *HTTPS forceren* aan.
5. Start *Actions → Dashboard → Run workflow*. Bij een groen vinkje zonder waarschuwing staat het dashboard op https://beheer.bingr.online.

## GitHub Actions in een openbare repo

- De logs van elke run zijn openbaar: schrijf nooit secrets, interne adressen, FTP-mappen of gebruikersgegevens naar het log (GitHub maskeert secrets, maar niet wat ervan is afgeleid).
- Secrets gaan niet naar workflows van pull requests uit forks; de deploys draaien alleen bij een push naar `main` of handmatig.
- Elke `uses:` staat vast op een commit-SHA (met de tag erachter als commentaar); werk die bij door de SHA van de nieuwe tag op te zoeken (`git ls-remote https://github.com/<eigenaar>/<action> refs/tags/<tag>`, bij een geannoteerde tag de regel met `^{}`).
- Openbare repo's gebruiken geen betaalde Actions-minuten.

## Lokaal testen

De functie staat ook `http://localhost` en `http://127.0.0.1` toe. Bijvoorbeeld: `python3 -m http.server 8080 -d web` en dan http://localhost:8080 openen.
