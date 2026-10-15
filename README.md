# Bingr-beheer

Het beheer-dashboard van **Bingr**, op **https://beheer.bingr.online**. Het dashboard stond eerder op `bingr.online/admindashboard` in de repo bingr-website.

**Deze repo is openbaar.** Iedereen kan de code, de commits en de logs van de workflows lezen. Daarom:

- **Geen geheimen**: wachtwoorden, tokens, SMTP-gegevens, `service_role`-sleutels en dergelijke alleen als GitHub-secrets (zie hieronder), nooit in een bestand, commit, issue of log. Wel toegestaan: de publieke Supabase-URL en de publishable key (`web/config.js`, `ios/…/AdminAPI.swift`) en de project-ref die daarin staat.
- **Geen persoonsgegevens**: geen e-mailadressen, namen, account-id's, tickets of exports van gebruikers, ook niet als testdata of in screenshots.
- **Geen logs met servergegevens**: workflows en scripts schrijven geen secrets, interne adressen, FTP-mappen, volledige serverantwoorden met gebruikersgegevens of stacktraces met configuratie naar het log; zet zulke stappen op een korte melding (`::notice::` / `::warning::`) zonder waarden.
- De beveiliging hangt niet af van geheimhouding van de code: alles achter het inloggen loopt via de functie `admin` met een ondertekend token.

- `web/` — het dashboard zelf (statische HTML/JS/CSS, geen build-stap): overzicht, gebruikers, berichten, supporttickets en status. Alles staat erin (`config.js` met de publieke Supabase-URL en publishable key, favicon). `robots.txt` blokkeert alles en de pagina heeft `noindex`.
- `ios/` — de native app **Bingr Beheer** (iOS/iPadOS 17+) met dezelfde onderdelen als het web-dashboard; zie *iOS-app* hieronder.
- `supabase/functions/admin` — de Supabase Edge Function `admin` waar het dashboard mee praat (inloggen, statistieken, gebruikers, berichten en mail, de tab Status via de functie `status` en de tab Support via de functie `support`). `supabase/functions/_shared/mail.ts` is een kopie van die in iptv-ios-appletv.

Wat er **niet** in staat: het databaseschema (ook de beheertabellen), de functies `device-auth`, `web-proxy` en `status`, en de statusplanning. Die staan in de openbare repo [LRvdLinden/iptv-ios-appletv](https://github.com/LRvdLinden/iptv-ios-appletv) (`supabase/`, workflow *Backend*). De afmeldpagina `bingr.online/unsubscribe/` staat op de gewone site en roept alleen de actie `unsubscribe` van `admin` aan; dat is het enige wat bingr.online mag.

Beveiliging (build 97):

- Het token (12 uur) bevat geen inlognaam meer, wel een **tokenversie** (tabel `admin_token_state`); elk verzoek controleert die. **Overal uitloggen** (Instellingen, web en app; actie `logout_all`) verhoogt de versie: alle sessies vervallen meteen. Een ander `BINGR_ADMIN_PASSWORD` doet dat vanzelf.
- Limieten per IP: na inloggen 300 verzoeken per minuut, afmelden (`unsubscribe`) 20 per 10 minuten (one-click vanaf mailservers 200 per 10 minuten).
- Het logboek (`admin_audit`) bevat ook inzage van persoonsgegevens (`user_view`, `users_search`, `support_view`: alleen actie en id/nummer, geen inhoud), geblokkeerde inlogpogingen (`login_locked`) en mislukte acties (`<actie>_failed` met foutcode).
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

Function-secrets gelden voor het hele Supabase-project, dus voor alle functies tegelijk. De tab **Support** gebruikt het geheim `SUPPORT_ADMIN_SECRET`; dat maakt de workflow *Backend* in iptv-ios-appletv één keer zelf aan (hier niets voor nodig). De afzender van supportmails (`BINGR_SUPPORT_FROM`, standaard `Bingr Support <support@bingr.online>`) en het adres voor meldingen (`BINGR_SUPPORT_EMAIL`, standaard `support@bingr.online`) staan, als je ze wilt aanpassen, als secrets in iptv-ios-appletv. Zolang `BINGR_ADMIN_USER` / `BINGR_ADMIN_PASSWORD` hier nog niet staan, gebruikt de functie de waarden die al op de server staan. De `STATUS_CRON_SECRET` voor de tab Status zet de workflow *Backend* in iptv-ios-appletv; hier hoeft die niet.

## Gebruikers: blokkeren en verwijderen

In de lade van een gebruiker (web en app):

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

## iOS-app (Bingr Beheer)

Native SwiftUI-app voor iPhone en iPad (iOS/iPadOS 17+, bundle-id `nl.lrvdlinden.bingr.beheer`) in `ios/`, met een XcodeGen-project (`ios/project.yml`). Ze praat met dezelfde functie `admin` als het web-dashboard (publieke Supabase-URL en publishable key ingebouwd, geen geheimen) en heeft alle tabs: Overzicht (kengetallen en grafieken met Swift Charts), Gebruikers (zoeken, details, apparaten, wachtwoord-reset), Support (filters, zoeken, gesprek met interne notities, antwoorden, status/prioriteit, inbox-import en *Nu ophalen*), Berichten (NL/EN met voorbeeld, e-mailen in batches, verder verzenden, verwijderen) en Status (monitors, storingen, reactietijd, controleren, monitors toevoegen/bewerken). Tabbalk op de iPhone, zijbalk op de iPad. Het token staat in de Keychain (alleen dit apparaat, geen iCloud); vergrendelen met Face ID / toegangscode staat sinds build 6 standaard aan bij de eerste keer inloggen (uit te zetten in Instellingen). In Instellingen ook **Overal uitloggen**. `bingrbeheer://support/1001` opent een ticket.

- **Workflow *Beheer-app*** (`.github/workflows/build-ios.yml`, bij een push naar `main` die `ios/` raakt): `xcodegen generate` en een build voor een generiek iOS-apparaat zonder ondertekening. Lukt dat, dan zet de workflow het Xcode-project (ios/ met het gegenereerde `BingrBeheer.xcodeproj`) als `versions/Beheer/v<versie>/Bingr-Beheer-<versie>-build<N>-Xcode.zip` in deze repo (alleen de nieuwste) en werkt `versions/latest.json` (sleutel `beheer`) en `versions/README.md` bij. Fouten staan als annotaties bij de run en in `latest.txt` op de branch `ci-logs-beheer`.
- **Installeren**: zip uitpakken, `ios/BingrBeheer.xcodeproj` openen in Xcode 16, bij *Signing & Capabilities* je Team kiezen (staat standaard op het Bingr-team) en op je iPhone/iPad draaien. Zelf genereren kan ook: `brew install xcodegen && cd ios && xcodegen generate`.
- Versie en build staan in `ios/project.yml` (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`): een eigen reeks, los van de Bingr-buildnummers. App-icoon: `python3 ios/tools/make_icon.py`.
- Nooit in de changelog van Bingr.

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
