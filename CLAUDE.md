# Bingr-beheer: werkafspraken

- Privé-repo met het beheer-dashboard van Bingr (https://beheer.bingr.online) en de Supabase Edge Function `admin`. Niets hiervan hoort in de openbare repo's (iptv-ios-appletv, bingr-website, bingr-android).
- Wijzigingen hier komen **nooit** in de changelog (`docs/changelog.json` in iptv-ios-appletv), niet op bingr.online en niet in release-notities. Ze krijgen ook geen buildnummer.
- Geheimen alleen als GitHub-secrets (zie README.md), nooit in de repo of in een log. De publieke Supabase-URL en de publishable key (`web/config.js`) mogen er wel in.
- Deploy:
  - `web/` → workflow *Dashboard* (`deploy-site.yml`): FTPS-upload naar `FTP_DIR` (de map van het subdomein), of zonder `FTP_DIR` naar de hoofdmap van de FTP-login (eigen FTP-account van het subdomein; nooit als dat de webmap van bingr.online is), daarna controle van https://beheer.bingr.online/. Houd `noindex` in `web/index.html` en `Disallow: /` in `web/robots.txt`.
  - `supabase/functions/admin` → workflow *Admin-functie* (`deploy-admin.yml`): deploy van `admin`, de secrets BINGR_ADMIN_USER / BINGR_ADMIN_PASSWORD (en optioneel BINGR_SMTP_*), en een rooktest (fout wachtwoord = 401 met CORS voor https://beheer.bingr.online).
  - Controleer na elke push met `gh run list -R LRvdLinden/bingr-beheer` dat de workflows geslaagd zijn.
- `ios/` is de native app Bingr Beheer (SwiftUI, iOS/iPadOS 17+, XcodeGen; eigen versie/build in `ios/project.yml`): workflow *Beheer-app* (`build-ios.yml`) bouwt hem en zet het Xcode-project in `versions/Beheer/` (latest.json-sleutel `beheer`); nieuwe functies van het web-dashboard ook in de app overnemen. Nooit in de changelog.
- Function-secrets gelden voor het hele Supabase-project; verander BINGR_SMTP_* hier alleen samen met iptv-ios-appletv (de functie `status` gebruikt ze ook).
- Het databaseschema (ook `announcements`, `admin_login_attempts`, `admin_audit` en de functies `bingr_admin_*`), `status`, `device-auth` en `web-proxy` staan in iptv-ios-appletv (`supabase/`, workflow *Backend*). Heeft het dashboard een schemawijziging nodig, dan gaat die daar in `supabase/schema.sql`, zonder changelog-item.
- `supabase/functions/_shared/mail.ts` is een kopie van die in iptv-ios-appletv; houd ze gelijk.
- CORS van `admin`: https://beheer.bingr.online en localhost voor alles; https://bingr.online alleen voor `unsubscribe` (afmeldpagina bingr.online/unsubscribe/).
- Commitberichten in het Nederlands.
