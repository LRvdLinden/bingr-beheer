// Bingr: beheer (https://beheer.bingr.online, openbare repo LRvdLinden/bingr-beheer; geheimen alleen als function-secrets).
// Los van device-auth; nooit in de changelog.
// POST /functions/v1/admin met JSON {action, token?, ...}; header `apikey`.
// Inloggegevens alleen als function-secrets BINGR_ADMIN_USER / BINGR_ADMIN_PASSWORD (uit de GitHub-secrets).
//   login               {user, password}  -> {token, expires_at}   (5 fouten per IP = 15 min geblokkeerd: 429 {error:"locked", retry_after})
//                       (build 95: 5 pogingen per IP per 15 min, en > 60 pogingen per uur van alle IP's samen = alles 15 min dicht)
//                       (build 97: het token bevat geen inlognaam meer, wel de tokenversie v uit admin_token_state; elk
//                       verzoek controleert v. Een ander wachtwoord verhoogt de versie vanzelf.)
//   logout_all          {token}           -> {ok}    (build 97: overal uitloggen: versie + 1, alle tokens vervallen)
//   widget_token        {token}           -> {widget_token, expires_at, scope:"widget"}  (alleen met een beheer-token: een apart
//                       token voor de widgets van de app BingrBeheer, 30 dagen geldig, met eigen sleutel en scope "widget" en
//                       dezelfde tokenversie v; overal uitloggen of een ander wachtwoord trekt het in. In admin_audit zonder token.)
//   widget_summary      {token: widget-token} -> {status: {level, components:[{id, name, group, level}], counts, active_notices,
//                       open_incidents, checked_at} | null, support: {new, open, pending, resolved, closed, active, unread,
//                       total, last_7d} | null, generated_at}   (ALLEEN met een widget-token; een widget-token mag niets anders,
//                       een beheer-token geeft hier 401. Alleen aantallen en statusnamen, geen persoonsgegevens of adressen;
//                       max. 30 per minuut per IP. Zie widget.ts / widget_test.ts.)
//   build 97: na inloggen max. 300 verzoeken per minuut per IP (429 {error:"rate_limited", retry_after}); unsubscribe
//   max. 20 per 10 min per IP (one-click vanaf mailservers: 200 per 10 min). Inzage van persoonsgegevens (user_detail,
//   users met zoekterm, support_get), geblokkeerde inlogpogingen en mislukte acties (met foutcode) staan in admin_audit.
//   stats               {token}           -> {total_users, …, days:[…], platforms:[…], versions:[…], smtp}
//                       signup_guard: {rejected_24h:{total, rate_limit, disposable, name, honeypot, too_fast (build 138)}, rejected_7d:{…}, allowed_24h,
//                       allowed_7d, unconfirmed_deleted_24h, unconfirmed_deleted_7d, disposable_domains} | null (build 134)
//                       (build 133: purchases_paid, purchases_refunded, purchases_7d, revenue_cents = som van de betaalde
//                       Lifetime-aankopen via Stripe; users/user_detail: plan.purchased_at/amount/currency/status van de laatste
//                       aankoop, user_detail.purchases (zonder Stripe-id's). Schema in iptv-ios-appletv, docs/ACCOUNT.md "Betalen")
//   insights            {token, metric: accounts|signins|streams|push|support|purchases, period: hour|day|week|month|year|24h|7d|30d,
//                       offset?: 0, -1, …, events?: bool} -> {step, edges:[…], now_index, has_prev, has_next, series:[{key, label,
//                       agg, available, values:[n|null], prev_values, summary}], events?:[{kind, name, from, to}]}
//                       (alleen aantallen per tijdvak, plus storingen/onderhoud van de statuspagina; insights.ts)
//   streams_now         {token}           -> {total, accounts, by_kind, by_platform, items:[{user_id, email (gemaskeerd), name, plan,
//                       country, device_name, platform, platform_group, app_version, profile_name, title, series_title,
//                       kind: live|movie|episode, started_at, last_ping}]}  (tegel Kijkt nu; ping in de laatste 90 s; titels en
//                       profielnamen in het geheugen ontsleuteld (streams.ts). Nooit gelogd; in admin_audit alleen het aantal)
//   countries           {token}           -> {accounts, known, items:[{country, accounts, active_30d}]}  (laatst gezien land per
//                       account: alleen de landcode uit cf-ipcountry, gezet door device-auth; nooit een IP-adres)
//   server              {token, period: 7d|30d|90d|1y, offset?: 0, -1, …, now?: bool} -> {period, step, edges, now_index,
//                       has_prev, has_next, functions, sources:{database|storage|rows|accounts_total|accounts|devices|streams|
//                       auth|proxy|proxy_bytes|push|mail|fn_calls|fn_errors|fn_ms: {label, desc, series:[…zoals insights]}},
//                       now?: {db, today, counts, tables, devices, storage, cron, queues, proxy_30d}}  (tab Server; alleen
//                       aantallen en groottes uit admin_server_daily en bingr_admin_server_now; server.ts)
//   (landen) users: filter ook "country:NL" of "country:?" (onbekend); items[].country; user_detail.country en devices[].country
//   revenue             {token, period: day|week|month|year|7d|30d, offset?: 0, -1, …, bucket?: auto|hour|day|week|month,
//                       mode?: live|test|all (standaard de modus van STRIPE_SECRET_KEY, zonder sleutel all)}
//                       -> {step, edges, now_index, has_prev, has_next, series:[{key: gross|net|proceeds|vat|fees|refunds|count|
//                       refund_count, label, money, values, prev_values, summary}], totals:{period, prev_period, month, prev_month,
//                       year, all: {count, gross, vat, net, fees, refunds, proceeds, …}}, by_method, by_country, vat:{source, rate,
//                       text, note}, billing:{enabled, mode}, live_count, test_count, empty}   (tab Omzet; alleen aantallen en
//                       bedragen in centen, nooit gegevens per persoon; bingr_admin_revenue in iptv-ios-appletv; revenue.ts)
//   revenue_export      {token, period, offset?, bucket?, mode?} -> {csv, file_name, rows}  (per aankoop/terugbetaling alleen datum,
//                       soort, bedrag, btw, kosten, netto, methode en land; geen e-mail, naam, account of Stripe-id)
//   revenue_backfill    {token} -> {checked, updated, remaining}  (ontbrekende Stripe-kosten ophalen met STRIPE_SECRET_KEY, max. 20
//                       per keer; 503 billing_unavailable zonder sleutel)
//   revenue_vat_set     {token, rate: 0–50} -> {ok, rate}  (app_settings.revenue_vat: btw-tarief zonder Stripe Tax, standaard 21)
//   users               {token, q?, page?, page_size?, filter?: "blocked"|"free"|"lifetime"|"custom"}
//                       -> {total, blocked_total, lifetime_total, free_total, page, page_size, items:[…]}
//                       (e-mail gemaskeerd; items[].blocked = {until, created_at} bij een actieve blokkade;
//                       items[].plan = {plan, max_streams?, max_devices?, source?}; items[].first_name / last_name uit
//                       user_metadata, of null. q zoekt op het begin van e-mailadres, voornaam, achternaam of "voornaam achternaam")
//   user_detail         {token, id}       -> {…, first_name, last_name, devices:[…], banned_until, block (actief of null), blocks:[…] (laatste 20)}
//   (servers) user_detail: servers = [{host, name?, active, deleted: false}] | null: alleen niet-verwijderde Xtream-bronnen uit
//                       account_sources (in het geheugen ontsleuteld met BINGR_SOURCES_KEY), alleen schema + host + poort
//                       (geen gebruikersnaam, wachtwoord, token, pad of query), de naam van de klant en of het mainSourceID is.
//                       M3U en andere soorten niet. null = onbekend (sleutel ontbreekt of ontsleutelen mislukt). Nooit gelogd,
//                       niets extra in admin_audit (servers.ts / servers_test.ts).
//   (nieuwsbrief) users: items[].newsletter = true|false|null; user_detail: newsletter = {subscribed, email_opt_out,
//                       newsletter_opt_out} | null (null = onbekend, bv. kolom newsletter_opt_out nog niet aangemaakt)
//   user_newsletter_set {token, id, subscribed: bool} -> {ok, newsletter}  (account_email_prefs.newsletter_opt_out; heeft de
//                       klant alle mail uit (email_opt_out), dan 409 email_opted_out: dat zet alleen de klant terug.
//                       503 newsletter_prefs_unavailable als de kolom ontbreekt. In admin_audit alleen subscribed.)
//   user_set_name       {token, id, first_name, last_name} -> {ok, first_name, last_name}  (opgeschoond, max. 50 tekens elk;
//                       leeg = weg; via auth.admin.updateUserById user_metadata, de rest van de metadata blijft. In admin_audit
//                       alleen of de namen gezet zijn, nooit de naam zelf; zie names.ts)
//   user_email          {token, id}       -> {email}  (het volledige e-mailadres na een klik op het oog; in admin_audit als
//                       user_email_view met alleen het account-id, nooit het adres)
//   user_block          {token, id, reason, until? (ISO; leeg/"onbepaald" = onbepaalde tijd), notify? (standaard true)}
//                       -> {ok, until, streams_stopped, email_sent, email_error?}  (ban op het auth-account, record in
//                       account_blocks, lopende streams gestopt, mail vanaf support@ met reden en einddatum). Sessies blijven
//                       bestaan: vernieuwen geeft dan user_banned, zodat de apps de melding "geblokkeerd" tonen (ACCOUNT.md).
//   user_unblock        {token, id, notify? (standaard true)} -> {ok, email_sent, email_error?}
//   user_delete         {token, id, confirm (volledig of gemaskeerd e-mailadres), notify? (standaard true), delete_tickets?,
//                       reason? (intern, alleen in het logboek)} -> {ok, email_sent, tickets_deleted}
//                       (alle accountgegevens via on delete cascade, profielfoto's, daarna de bevestigingsmail vanaf support@)
//   send_reset          {token, user_id}  -> {ok}    (standaard reset-mail van Supabase; beheer ziet of zet nooit wachtwoorden)
//   user_confirm        {token, id} -> {ok, already}  (e-mailadres handmatig bevestigen: auth.admin.updateUserById email_confirm
//                       true; voor accounts die de bevestigingsmail niet kregen. In admin_audit alleen of het al bevestigd was)
//   user_resend_confirm {token, id} -> {ok}  (de bevestigingsmail opnieuw: POST /auth/v1/resend type signup, terug naar
//                       bingr.online/account/; al bevestigd = 409 already_confirmed, te snel (60 s per adres) = 429 confirm_too_soon)
//   (build 14 Beheer-app: de oude acties announce, announce_send, announcements_list en announcement_delete zijn weg;
//   de tab Pushmeldingen en de widget Laatste pushmeldingen gebruiken alleen push_history.)
//   Pushmeldingen (docs/PUSH.md in iptv-ios-appletv): doorgegeven aan de functie `push` met het geheim PUSH_ADMIN_SECRET
//   (header x-push-secret; zet de Backend-workflow daar klaar), net als support. Zie push.ts / push_test.ts.
//   push_count          {token, target}   -> {devices, by_platform:{ios,ipados,macos,android,web}, accounts?} | {devices:null}
//                       (voor de bevestiging vóór versturen: rechtstreeks geteld in push_devices; null = nog niet te tellen)
//   push_send           {token, title_nl, body_nl, title_en?, body_en?, url? (alleen https), target: {all:true} |
//                       {accounts:[uuid…]} (max. 500) | {platforms:[ios|ipados|macos|android|web…]}} -> {message_id, devices}
//                       (push: admin_send; tvos/androidtv/tizen hebben geen systeem-push: 400 no_push_platform. In admin_audit
//                       alleen soort doelgroep, aantallen en lengtes: nooit tekst, link of ontvangers. Max. 20 per uur per IP.)
//   push_progress       {token, message_id} -> {message_id, devices, queued, sent, failed, invalid, done, notes}  (push:
//                       admin_progress; herhalen tot done)
//   push_history        {token, page?}    -> {items:[{id, kind: release|admin|reminder, created_at, title, body, url, target:
//                       {type, count?|platforms?}, platform_group, version, build, devices, queued, sent, failed, invalid, done,
//                       notes}], page, has_more}  (push: admin_history; zonder account-id's)
//                       Fouten: push_not_configured (geen PUSH_ADMIN_SECRET), push_not_deployed, push_forbidden, push_unreachable.
//   push_subscribers    {token}           -> {accounts, devices, by_platform:{ios,ipados,macos,android,web}, new_7d:{devices,
//                       accounts}} | {devices:null}  (pushabonnees van de Bingr-apps, uit push_devices; alleen tellingen)
//   Pushmeldingen van de app BingrBeheer zelf (tabel admin_push_devices, schema in iptv-ios-appletv; de cron van de functie
//   push stuurt ze, topic nl.lrvdlinden.bingr.beheer). Zie admin_push.ts / admin_push_test.ts. In admin_audit alleen de
//   actie en het platform, nooit device_id of token.
//   admin_push_register   {token, device_id, apns_token, platform: ios|ipados|macos, sandbox, app_build, prefs:{tickets,
//                         replies, builds, status}} -> {ok}  (upsert op device_id; een token die al bij een ander device_id
//                         hoort, gaat eerst weg. Max. 30 per uur per IP.)
//   admin_push_unregister {token, device_id} -> {ok, removed}
//   admin_push_prefs      {token, device_id, prefs} -> {ok} | 404 not_registered
//   admin_push_test       {token, device_id} -> {ok} | 503 apns_not_configured | 404 not_registered | 410 apns_invalid
//                         (testmelding rechtstreeks via APNs naar alleen dit apparaat: ES256-JWT met de function-secrets
//                         APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID, topic BEHEER_APNS_TOPIC of nl.lrvdlinden.bingr.beheer,
//                         sandbox of productie per apparaat. Max. 10 per uur per IP.)
//   Overal uitloggen (logout_all) maakt admin_push_devices ook leeg.
//   status              {token, op: overview|checks|monitor_save|monitor_delete|run|notice_save|notice_update|notice_delete|
//                        subscribers|mail_run, …} -> antwoord van de functie `status` (meldingen: storingen en gepland onderhoud)
//   support_counts      {token}           -> {new, open, pending, resolved, closed, active, unread, total, last_7d, smtp}
//   support_list        {token, status?: active|all|new|open|pending|resolved|closed, q?, page?, page_size?} -> {total, items:[…], counts}
//   support_get         {token, number}   -> {ticket, messages (ook interne notities), account}
//   support_reply       {token, number, message, status?} -> {ok, status, email_sent, push_devices}  (mail aan de klant vanaf
//                       support@bingr.online; build 146: bij een ticket met account ook een pushmelding naar de apparaten)
//   support_get         build 146: berichten met `diagnostics` (diagnose-bijlage uit de app, ontsleuteld door support) en bij
//                       het ticket device_type, device_model en source ("app"); het beheer toont ze als kaart, nooit als JSON
//   support_status      {token, number, status?, priority?, notify?} -> {ok, status, email_sent}  (opgelost/gesloten: mail aan de klant)
//   support_note        {token, number, message} -> {ok}  (interne notitie, de klant ziet hem nooit)
//   support_inbox       {token}           -> {configured, agents, state, log}  (inbox-import: laatste ronde, fout, logboek)
//   support_poll        {token}           -> {ok, fetched, imported, …} | {skipped} | {busy}  (nu mails ophalen)
//                       De support_*-acties gaan door naar de functie `support` (LRvdLinden/iptv-ios-appletv) met het geheim
//                       SUPPORT_ADMIN_SECRET (zet de Backend-workflow daar klaar). Supporttickets komen nooit in de changelog.
//   plan_get            {token, id}       -> {plan, max_streams, max_devices, source, note, granted_by, updated_at, defaults, effective}
//   plan_set            {token, id, plan: "free"|"lifetime", max_streams: int|null, max_devices: int|null, note?}
//                       -> {ok, …zoals plan_get}  (abonnement van een account; null = standaard van het abonnement;
//                       granted_by "beheer" (niet de inlognaam: de klant kan zijn eigen rij lezen), source 'admin';
//                       Gratis zonder eigen limieten en notitie = rij weg)
//   app_settings_get    {token}           -> {upgrade_link:{apple, android, androidtv, tizen, web, webos}}
//   app_settings_set    {token, upgrade_link:{apple, android, androidtv, tizen, web, webos?}} -> {ok, upgrade_link}
//                       Abonnementen: tabellen account_plans en app_settings (schema in iptv-ios-appletv, docs/ACCOUNT.md).
//   builds              {token}           -> {ready, platforms: {android|android-aab|tizen|windows|apple|beheer: {version, build, file, path, size,
//                       sha256, date, notes, history:[…]}} | null, updated?, reason?: "not_configured"|"no_builds"|"unreachable"}
//                       (tab Downloads: builds/manifest.json van de server van beheer.bingr.online, opgehaald via dl.php met
//                       een token van 60 s; de buildpakketten staan niet op GitHub)
//                       release_push: {"apple:114": {sent_at, devices, queued, sent, failed, invalid, done}, …} (verstuurde
//                       releasemeldingen per build; leeg = nog niet verstuurd)
//                       presskit: {public_url, stats: {total, version, version_total, last_7d, last_30d, days:[{date, n}]} | null}
//                       als platforms.presskit er is (workflow PressKit; teller builds/presskit-stats.json via dl.php, alleen aantallen)
//                       windows_public: {public_url, stats: {…zelfde vorm, version = build}} | null als platforms.windows er is
//                       (openbare installer via bingr.online/windows -> dl.php?app=windows; teller builds/windows-stats.json)
//   build_push          {token, platform: "apple"|"android", file? (standaard de nieuwste)} -> {ok, duplicate, devices, build,
//                       missing_channels, push} (releasemelding van die build via push: release met PUSH_ADMIN_SECRET; één
//                       keer per build; niet automatisch, want de stores keuren pas later goed; in admin_audit platform en build)
//   build_link          {token, platform: "android"|"android-aab"|"tizen"|"windows"|"webos"|"apple"|"beheer"|"presskit", file? (standaard de nieuwste; anders alleen
//                       een bestand uit het manifest)} -> {url, expires_at, file, size}  (https://beheer.bingr.online/dl.php?t=…,
//                       10 minuten geldig; in admin_audit als build_link met platform en build, nooit de link of het token)
//                       Tokens: HMAC-SHA256 met het function-secret BINGR_BUILDS_KEY (gezet door de workflow Builds, dezelfde
//                       sleutel als builds/key.php op de server); zie builds.ts. Zonder sleutel: ready=false / 503 builds_not_configured.
//   Nieuwsbrief (functie `newsletter` in iptv-ios-appletv, header x-newsletter-secret = function-secret
//   NEWSLETTER_ADMIN_SECRET; zie newsletter.ts / newsletter_test.ts). Alleen aantallen terug, nooit adressen.
//   newsletter_status      {token}           -> {enabled, next:{key, at} | null, recipients:{nl, en, total}, editions:[{key,
//                          created_at, recipients, sent, failed, done}]}
//   newsletter_set_enabled {token, enabled: bool} -> {ok, enabled}  (in admin_audit met enabled)
//   newsletter_preview     {token, to, lang?: nl|en} -> {ok}  (de huidige editie alleen naar dat adres; het adres wordt
//                          gecontroleerd en nooit gelogd: in admin_audit alleen "preview" en de taal. Max. 10 per uur per IP.)
//   newsletter_render      {token, lang?}    -> {subject, html}  (alleen doorgeven, voor de voorbeeldweergave)
//   welcome_preview        {token, to, lang?: nl|en} -> {ok}  (de welkomstmail met een voorbeeldnaam alleen naar dat adres;
//                          adres nooit gelogd, in admin_audit alleen "welcome_preview" en de taal; limiet gedeeld met
//                          newsletter_preview)
//   welcome_render         {token, lang?}    -> {subject, html}  (welkomstmail voor de voorbeeldweergave)
//                          newsletter_status bevat welcome: {sent_7d, pending} | null (alleen aantallen).
//                          Fouten: newsletter_not_configured (geen geheim), newsletter_not_deployed, newsletter_forbidden,
//                          newsletter_unreachable, en van newsletter zelf bv. bad_email, rate_limited, tmdb_unavailable,
//                          smtp_not_configured.
//   Eigen mailing (tab Nieuwsbrief, blok Eigen mailing; functie `newsletter`, docs/NEWSLETTER.md "Eigen mailing vanuit het
//   beheer" in iptv-ios-appletv; mailing.ts / mailing_test.ts). Alleen onderwerpen en aantallen terug, nooit adressen.
//   mailing_status      {token} -> {active, mailings:[{id, created_at, finished_at, audience, status, subject:{nl,en},
//                       recipients:{nl,en,total}, sent, failed, skipped, cancelled, left}], audiences:{newsletter, service},
//                       per_hour, batch, sent_last_hour}
//   mailing_render      {token, content, audience?, lang?} -> {subject, html}
//   mailing_test        {token, to, content, audience?, lang?: nl|en|both} -> {ok, sent}  (adres nooit gelogd; in admin_audit
//                       alleen taal en doelgroep; limiet gedeeld met newsletter_preview)
//   mailing_send        {token, request_id (uuid), content, audience: newsletter|service, service_ack?} -> {ok, id, duplicate,
//                       recipients}  (service alleen met service_ack: true; in admin_audit id, doelgroep en aantallen)
//   mailing_cancel      {token, id} -> {ok, cancelled}
//                       content = {nl:{subject, body, button}, en:{…}, image, button_url}
//                       Afbeelding (image.ts / image_test.ts): mailing_render, mailing_test en mailing_send controleren een
//                       ingevulde afbeelding-URL server-side (https, openbare host: geen interne/private IP's, max. 3
//                       doorverwijzingen, GET binnen 8 s, content-type image/png|jpeg|gif met passende inhoud, max. 2 MB;
//                       SVG en WebP geweigerd). Testmail en versturen stoppen dan met de foutcode (image_*); het voorbeeld
//                       toont de mail wel, met image_error erbij. Nooit de URL of de host in een log of in admin_audit.
//   mailing_image_check {token, url} -> {ok, type, size} | 400 {error: image_*|bad_image_url, service?}  (service = bekende
//                       deeldienst, bv. Google, iCloud, Dropbox; max. 120 per uur per IP)
//   mailing_image_upload {token, data (base64 van een PNG, JPEG of GIF, max. 2 MB)} -> {url, type, size}  (openbare bucket
//                       mail-assets, schema in iptv-ios-appletv; willekeurige naam m/<jjjj>/<mm>/<32 hex>.<ext>, schrijven
//                       alleen met de service role; max. 30 per uur per IP; in admin_audit alleen type en grootte)
//   unsubscribe         {t}               -> {ok}    (openbaar; t = ondertekend token uit de e-mail)
//   mailtest_account_mails {to, lang?}    -> {ok, sent:{deleted, blocked, unblocked}}  (alleen met header x-bingr-mailtest van de
//                       mailtest in iptv-ios-appletv, workflow Diagnose; zie _shared/mail.ts. De drie accountmails met
//                       voorbeeldgegevens naar één testadres support+ci-…@bingr.online; er wordt geen account aangeraakt.)
//   POST ?unsubscribe=t (List-Unsubscribe=One-Click, RFC 8058) -> 200 "unsubscribed"; GET ?unsubscribe=t -> 303 naar bingr.online/unsubscribe/
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isMailtestAddress, MAILTEST_HEADER, mailtestOk, smtpConfigured, smtpFrom, transport, withName } from "../_shared/mail.ts";
import { blockMail, deletedMail, type Mail, unblockMail } from "./mails.ts";
import { accountLang, banDuration, cleanReason, confirmMatches, parseUntil } from "./blocks.ts";
import { cleanName } from "./names.ts";
import { serversFromRow } from "./servers.ts";
import { streamsView } from "./streams.ts";
import { buildServer, nowView, parseServer, planRange, serverPlan } from "./server.ts";
import { build as buildInsights, parseQuery as parseInsights, plan as planInsights } from "./insights.ts";
import {
  buildRevenue, cleanRate, cleanRows, defaultMode, detailsFromPaymentIntent, detailsPatch, isPaymentIntent, parseRevenue, revenueCsv,
  revenuePlan, tileRanges,
} from "./revenue.ts";
import {
  buildUrl, cleanManifest, findBuild, isBuildPlatform, isReleasePushPlatform, isValidBuildFile, MIN_KEY, PRESSKIT_PUBLIC_URL, PRESSKIT_STATS, WINDOWS_PUBLIC_URL, WINDOWS_STATS,
  presskitStatsView, releaseKey, releaseKeys, releaseOf, releasePushView, signBuildToken,
} from "./builds.ts";
import { actionAllowed, readToken, signToken, summarizeStatus, summarizeSupport, WIDGET_SCOPE, WIDGET_TTL_MS } from "./widget.ts";
import { auditDetail, cleanPushInput, cleanTarget, historyView, pageInput, progressView, PUSH_PLATFORMS, type PushTarget } from "./push.ts";
import {
  apnsHost, apnsJwt, apnsResult, cleanDeviceId, cleanPrefs, cleanRegister, DEFAULT_TOPIC, importApnsKey, summarizeSubscribers, testPayload,
} from "./admin_push.ts";
import {
  cleanEmail, cleanEnabled, cleanLang, missingColumn, newsletterCall, planPrefChange, prefMap, prefView, renderView, statusView,
} from "./newsletter.ts";
import {
  cleanAudience, cleanContent as cleanMailingContent, cleanMailingId, cleanRequestId, cleanTestLang, mailingStatusView, sendAudit,
} from "./mailing.ts";
import { checkImageUrl, type CheckResult, cleanUpload, IMAGE_MAX, isOwnAsset, MAIL_BUCKET, objectName, publicUrl } from "./image.ts";

const SITE = Deno.env.get("BINGR_SITE") ?? "https://bingr.online";
const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TOKEN_TTL_MS = 12 * 3600 * 1000;

// ---- abonnementen (zelfde standaarden als supabase/functions/_shared/plans.ts in iptv-ios-appletv) ----
const PLAN_DEFAULTS = { free: { streams: 1, devices: 8, servers: 1 }, lifetime: { streams: 3, devices: 15, servers: null } } as const;
// build 147: webos (LG TV); bij app_settings_set optioneel (oudere Beheer-apps sturen hem niet mee: dan blijft de huidige)
const LINK_KEYS = ["apple", "android", "androidtv", "tizen", "web", "webos"] as const;
const LINK_OPTIONAL = ["webos"];
const DEFAULT_LINK: Record<string, boolean> = { apple: false, android: true, androidtv: true, tizen: true, web: true, webos: true };
// eigen limiet: null/leeg = standaard; anders een geheel getal binnen [1, cap]; ongeldig = undefined (fout)
function limitInput(v: unknown, cap: number): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 1 && n <= cap ? n : undefined;
}
function planView(row: Record<string, unknown> | null) {
  const plan = row?.plan === "lifetime" ? "lifetime" : "free";
  const d = PLAN_DEFAULTS[plan];
  const ms = (row?.max_streams as number | null) ?? null, md = (row?.max_devices as number | null) ?? null;
  return {
    plan, max_streams: ms, max_devices: md, source: row?.source ?? null, note: row?.note ?? null, granted_by: row?.granted_by ?? null,
    created_at: row?.created_at ?? null, updated_at: row?.updated_at ?? null,
    defaults: PLAN_DEFAULTS, effective: { streams: ms ?? d.streams, devices: md ?? d.devices, servers: d.servers },
  };
}
const linkView = (v: unknown) => {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  return Object.fromEntries(LINK_KEYS.map((k) => [k, typeof o[k] === "boolean" ? o[k] : DEFAULT_LINK[k]]));
};

// ---- omzet (tab Omzet): Stripe alleen voor revenue_backfill; sleutel nooit in een log of foutmelding ----
const stripeKey = () => { const k = env("STRIPE_SECRET_KEY").trim(); return /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(k) ? k : ""; };
const stripeTaxOn = () => /^(1|true|yes|on|ja)$/i.test(env("STRIPE_AUTOMATIC_TAX").trim());
async function stripeGet(key: string, path: string, params: [string, string][]): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://api.stripe.com/v1/${path}${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2025-03-31.basil" }, signal: ctl.signal,
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
  } catch (e) {
    // nooit de URL (betaal-id) of de headers (sleutel) in de fout
    throw new Error(`stripe_unreachable ${e instanceof Error ? e.name : ""}`.trim());
  } finally { clearTimeout(timer); }
}

// ---- downloads (tab Downloads): builds/manifest.json op de server van beheer.bingr.online, alleen via dl.php ----
// De sleutel (BINGR_BUILDS_KEY) zet de workflow Builds; zonder sleutel is de tab "nog niet ingericht". Nooit de sleutel,
// een token of een downloadlink loggen (ook niet in een foutmelding van fetch: die bevat de URL).
const buildsKey = () => env("BINGR_BUILDS_KEY").trim();
type Manifest = NonNullable<ReturnType<typeof cleanManifest>>;
type BuildsReason = "not_configured" | "no_builds" | "unreachable";
async function fetchManifest(): Promise<{ ok: true; manifest: Manifest } | { ok: false; reason: BuildsReason }> {
  const key = buildsKey();
  if (key.length < MIN_KEY) return { ok: false, reason: "not_configured" };
  const { token } = await signBuildToken(key, "manifest.json", 60);
  const fail = (reason: BuildsReason, why: string) => {
    console.error("admin", "builds", "manifest", why);
    return { ok: false as const, reason };
  };
  let res: Response;
  try {
    res = await fetch(buildUrl(token), { redirect: "error", signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
  } catch (e) {
    return fail("unreachable", e instanceof Error ? e.name : "fetch");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    // 404: geen manifest (nog geen builds); 503: dl.php zonder builds/key.php; 403: sleutel op de server is anders
    if (res.status === 404) return fail("no_builds", "HTTP 404");
    if (res.status === 503 || res.status === 403) return fail("not_configured", `HTTP ${res.status}`);
    return fail("unreachable", `HTTP ${res.status}`);
  }
  let raw: unknown;
  try {
    const text = await res.text();
    if (text.length > 1_000_000) return fail("unreachable", "te groot");
    raw = JSON.parse(text);
  } catch (e) {
    return fail("unreachable", e instanceof Error ? e.name : "json");
  }
  const manifest = cleanManifest(raw);
  if (!manifest) return fail("unreachable", "geen manifest");
  if (!Object.keys(manifest.platforms).length) return { ok: false, reason: "no_builds" };
  return { ok: true, manifest };
}

// Downloadteller van de presskit of de Windows-installer (builds/<naam>-stats.json via dl.php met een token van 60 s).
// Fout of nog geen teller = null.
async function fetchDownloadStats(file: string = PRESSKIT_STATS): Promise<unknown> {
  const key = buildsKey();
  if (key.length < MIN_KEY) return null;
  const { token } = await signBuildToken(key, file, 60);
  try {
    const res = await fetch(buildUrl(token), { redirect: "error", signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
    const text = await res.text();
    return text.length > 200_000 ? null : JSON.parse(text);
  } catch (e) {
    console.error("admin", "builds", file === WINDOWS_STATS ? "windows-stats" : "presskit-stats", e instanceof Error ? e.name : "fetch");
    return null;
  }
}

// Het dashboard staat op https://beheer.bingr.online (http://localhost om te testen). De site bingr.online mag alleen
// `unsubscribe` aanroepen (afmeldpagina bingr.online/unsubscribe/); al het andere vanaf daar wordt geweigerd.
const BEHEER_ORIGIN = /^https:\/\/beheer\.bingr\.online$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const SITE_ORIGIN = /^https:\/\/(www\.)?bingr\.online$/;
const PUBLIC_ACTIONS = new Set(["unsubscribe"]);

// action = null: preflight (OPTIONS), de actie is dan nog niet bekend
function corsFor(req: Request, action: string | null): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const ok = BEHEER_ORIGIN.test(origin) || (SITE_ORIGIN.test(origin) && (action === null || PUBLIC_ACTIONS.has(action)));
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ---- crypto ----
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function sha256(s: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function hmacKey(material: string) {
  return crypto.subtle.importKey("raw", await sha256(material), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function hmac(material: string, data: string) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(material), enc.encode(data)));
}
// sleutel voor beheer-tokens: wijzigt het wachtwoord (of build 97: de gebruikersnaam), dan vervallen alle tokens
const adminMaterial = () => `bingr-admin-v2|${env("BINGR_ADMIN_USER")}|${env("BINGR_ADMIN_PASSWORD")}|${env("SUPABASE_SERVICE_ROLE_KEY")}`;
// sleutel voor widget-tokens (scope "widget", alleen widget_summary): apart van de beheer-sleutel, zodat het ene token nooit
// als het andere geldt; vervalt ook bij een ander wachtwoord of andere gebruikersnaam (zie widget.ts)
const widgetMaterial = () => `bingr-admin-widget-v1|${env("BINGR_ADMIN_USER")}|${env("BINGR_ADMIN_PASSWORD")}|${env("SUPABASE_SERVICE_ROLE_KEY")}`;
// sleutel voor afmeldlinks: blijft geldig (BINGR_SOURCES_KEY wordt nooit vervangen)
const unsubMaterial = () => `bingr-unsub-v1|${env("BINGR_SOURCES_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")}`;

// build 97: tokenversie (tabel admin_token_state, schema in iptv-ios-appletv). De functie geeft de sleutel-hash van het
// wachtwoord mee (HMAC met de service-role-sleutel, nooit het wachtwoord zelf); is die anders dan de opgeslagen, dan verhoogt
// de database eerst de versie, zodat een nieuw wachtwoord alle oude tokens intrekt (ook als de sleutel zelf gelijk zou blijven).
async function pwHash() {
  return b64u(await hmac(`bingr-admin-pw|${env("SUPABASE_SERVICE_ROLE_KEY")}`, env("BINGR_ADMIN_PASSWORD")));
}
async function tokenVersion(): Promise<number> {
  const { data, error } = await admin.rpc("bingr_admin_token_version", { p_pw_hash: await pwHash() });
  if (error) throw new Error(`token_version: ${error.message}`);
  return Number(data);
}
// build 97: geen inlognaam meer in het token (het payload-deel is gewoon leesbaar); wel versie v en een willekeurige id
// (widgets: ondertekenen en controleren via widget.ts, dezelfde vorm als vroeger: {v, exp, j}, zonder scope)
async function makeToken() {
  const { token, exp } = await signToken(adminMaterial(), await tokenVersion(), TOKEN_TTL_MS);
  return { token, expires_at: new Date(exp).toISOString() };
}
async function validToken(token: unknown) {
  if (!env("BINGR_ADMIN_PASSWORD")) return false;
  // scope null: een widget-token (andere sleutel, met s) geldt hier nooit
  const p = await readToken(adminMaterial(), token, null);
  // pas na een geldige handtekening naar de database (een vervalst token kost geen databaseverzoek)
  return p !== null && p.v === await tokenVersion();
}
// widget-token (scope "widget", 30 dagen): alleen voor widget_summary; gebonden aan dezelfde tokenversie
async function makeWidgetToken() {
  const { token, exp } = await signToken(widgetMaterial(), await tokenVersion(), WIDGET_TTL_MS, WIDGET_SCOPE);
  return { widget_token: token, expires_at: new Date(exp).toISOString(), scope: WIDGET_SCOPE };
}
async function validWidgetToken(token: unknown) {
  if (!env("BINGR_ADMIN_PASSWORD")) return false;
  const p = await readToken(widgetMaterial(), token, WIDGET_SCOPE);
  return p !== null && p.v === await tokenVersion();
}
// samenvatting voor de widgets: status (functie status, actie admin) en supporttellers (functie support), elk los;
// mislukt er een, dan is dat deel null. Alleen aantallen en statusnamen (widget.ts), geen persoonsgegevens.
async function widgetSummary() {
  const base = env("SUPABASE_URL").replace(/\/+$/, "");
  const post = async (fn: string, header: string, secret: string, action: string) => {
    if (!secret) return null;
    try {
      const res = await fetch(`${base}/functions/v1/${fn}`, {
        method: "POST", headers: { "Content-Type": "application/json", [header]: secret },
        body: JSON.stringify({ action }), signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); console.error("admin", "widget", fn, `HTTP ${res.status}`); return null; }
      return await res.json();
    } catch (e) {
      console.error("admin", "widget", fn, e instanceof Error ? e.name : "fetch");
      return null;
    }
  };
  const [st, sp] = await Promise.all([
    post("status", "x-status-secret", env("STATUS_CRON_SECRET"), "admin"),
    post("support", "x-support-secret", env("SUPPORT_ADMIN_SECRET"), "admin_counts"),
  ]);
  return { status: summarizeStatus(st), support: summarizeSupport(sp), generated_at: new Date().toISOString() };
}
async function unsubUser(t: unknown): Promise<string | null> {
  if (typeof t !== "string" || t.length > 120) return null;
  const [id, sig] = t.split(".");
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || !sig) return null;
  try {
    return sameBytes(unb64u(sig), (await hmac(unsubMaterial(), `unsub:${id}`)).subarray(0, 18)) ? id.toLowerCase() : null;
  } catch { return null; }
}

// ---- landen (account_country en account_devices.country, schema in iptv-ios-appletv): alleen landcodes ----
const CC = /^[A-Z]{2}$/;
async function accountCountries(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data, error } = await admin.from("account_country").select("user_id,country").in("user_id", ids.slice(0, 100));
  if (error) { if (error.code !== "42P01" && error.code !== "PGRST205") console.error("admin", "countries", error.code ?? "fout"); return {}; }
  return Object.fromEntries((data ?? []).filter((r) => CC.test(String(r.country))).map((r) => [String(r.user_id).toLowerCase(), String(r.country)]));
}
async function userCountry(id: string): Promise<{ account: string | null; devices: { name: unknown; created_at: unknown; country: string | null }[] }> {
  const [a, d] = await Promise.all([
    admin.from("account_country").select("country").eq("user_id", id).maybeSingle(),
    admin.from("account_devices").select("name,created_at,country").eq("user_id", id).limit(200),
  ]);
  const account = !a.error && CC.test(String(a.data?.country ?? "")) ? String(a.data!.country) : null;
  const devices = d.error ? [] : (d.data ?? []).map((x) => ({ name: x.name, created_at: x.created_at, country: CC.test(String(x.country ?? "")) ? String(x.country) : null }));
  return { account, devices };
}

// ---- hulpjes ----
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function maskEmail(e: unknown) {
  const s = String(e ?? "");
  const at = s.lastIndexOf("@");
  if (at < 1) return s ? "***" : "";
  const local = s.slice(0, at), domain = s.slice(at + 1);
  const ml = local.length <= 2 ? local[0] + "***" : `${local[0]}***${local[local.length - 1]}`;
  const dot = domain.lastIndexOf(".");
  const md = dot > 0 ? `${domain[0]}***${domain.slice(dot)}` : "***";
  return `${ml}@${md}`;
}
// build 95: het IP voor de inlogblokkade. Niet meer de eerste waarde van X-Forwarded-For (die kiest de aanvaller zelf),
// maar cf-connecting-ip (zet Cloudflare altijd zelf), anders de LAATSTE waarde van X-Forwarded-For (toegevoegd door de proxy
// vóór de functie). Security L7: geen x-real-ip meer (zelf mee te sturen) en alleen een geldig IP-adres telt, anders "?".
const IP_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:.]{2,45})$/i;
const validIp = (s: string) => s.length <= 45 && IP_RE.test(s) && (s.includes(":") || s.split(".").every((p) => Number(p) <= 255));
function clientIp(req: Request) {
  const h = (k: string) => (req.headers.get(k) ?? "").trim();
  const cf = h("cf-connecting-ip");
  if (cf && validIp(cf)) return cf;
  const xff = h("x-forwarded-for").split(",").map((s) => s.trim()).filter(Boolean);
  const last = xff[xff.length - 1] ?? "";
  return validIp(last) ? last : "?";
}
// Accountmails (blokkeren, opheffen, verwijderen) gaan vanaf support@ (BINGR_SUPPORT_FROM, zoals de supportmails); weigert
// de SMTP-server die afzender, dan met BINGR_SMTP_FROM als afzender en support@ als Reply-To. Antwoorden komen zo bij support.
// altijd met weergavenaam: een kaal adres in BINGR_SUPPORT_FROM wordt "Bingr Support <adres>"
const SUPPORT_FROM = () => withName(env("BINGR_SUPPORT_FROM") || "support@bingr.online", "Bingr Support");
const addressOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim();
async function sendAccountMail(to: string, m: Mail, kind: "blocked" | "unblocked" | "deleted"): Promise<{ ok: boolean; error?: string }> {
  if (!smtpConfigured()) return { ok: false, error: "smtp_not_configured" };
  const base = { to, subject: m.subject, html: m.html, text: m.text, headers: { "Auto-Submitted": "auto-generated", "X-Bingr-Mail": `account-${kind}` } };
  const tx = transport();
  try {
    try {
      await tx.sendMail({ ...base, from: SUPPORT_FROM(), replyTo: addressOf(SUPPORT_FROM()) });
    } catch (e) {
      if (!smtpFrom() || addressOf(smtpFrom()).toLowerCase() === addressOf(SUPPORT_FROM()).toLowerCase()) throw e;
      console.error("account mail (support-afzender)", e instanceof Error ? e.message : e);
      await tx.sendMail({ ...base, from: withName(addressOf(smtpFrom()), "Bingr Support"), replyTo: addressOf(SUPPORT_FROM()) });
    }
    return { ok: true };
  } catch (e) {
    console.error("account mail", e instanceof Error ? e.message : e);
    return { ok: false, error: "send_failed" };
  } finally { tx.close(); }
}
type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> };
async function authUser(id: string): Promise<AuthUser | null> {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error && (error as { status?: number }).status !== 404) throw new Error(error.message);
  return (data?.user as AuthUser | undefined) ?? null;
}

// build 97: een mislukte insert niet meer stil negeren (wel doorgaan: de actie zelf is al gebeurd)
async function audit(action: string, ip: string, target?: string | null, detail?: unknown) {
  try {
    const { error } = await admin.from("admin_audit").insert({ action, ip, target_user: target ?? null, detail: detail ?? null });
    if (error) console.error("admin", "audit", action, error.message);
  } catch (e) { console.error("admin", "audit", action, e instanceof Error ? e.message : e); }
}
// build 97: limiet per sleutel (bingr_rate_hit, schema in iptv-ios-appletv). Werkt de teller niet, dan doorlaten (en loggen).
async function rateOk(key: string, max: number, windowSec: number): Promise<boolean> {
  const { data, error } = await admin.rpc("bingr_rate_hit", { p_key: key, p_max: max, p_window: windowSec });
  if (error) { console.error("admin", "rate", key.split(":")[0], error.message); return true; }
  return data !== false;
}
const UNSUB_MAX = 20, UNSUB_ONECLICK_MAX = 200, UNSUB_WINDOW = 600, AUTHED_MAX = 300, AUTHED_WINDOW = 60, WIDGET_MAX = 30;
// afmelden met één klik (RFC 8058) uit oudere berichtenmails: de mailclient doet POST <functie-URL>?unsubscribe=<token>
// met List-Unsubscribe=One-Click. Een GET gaat door naar de afmeldpagina op bingr.online; die vraagt eerst.
async function unsubscribe(t: unknown): Promise<boolean> {
  const id = await unsubUser(t);
  if (!id) return false;
  const { error } = await admin.from("account_email_prefs").upsert({ user_id: id, email_opt_out: true, updated_at: new Date().toISOString() });
  // account bestaat niet meer (foreign key): er wordt toch al niets meer gestuurd
  if (error && !/foreign key/i.test(error.message)) throw new Error(error.message);
  return true;
}

// ---- pushmeldingen: doorgeven aan de functie `push` (iptv-ios-appletv) met PUSH_ADMIN_SECRET, zoals support ----
// Nooit het geheim, tokens of serverantwoorden met gebruikersgegevens loggen; push.ts haalt account-id's uit de antwoorden.
const PUSH_MAX = 20, PUSH_WINDOW = 3600;
const errCode = (v: unknown) => (typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v) ? v : "server_error");
async function pushCall(action: string, payload: Record<string, unknown>): Promise<{ status: number; out: Record<string, unknown> }> {
  if (!env("PUSH_ADMIN_SECRET")) return { status: 503, out: { error: "push_not_configured" } };
  let res: Response;
  try {
    res = await fetch(`${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-push-secret": env("PUSH_ADMIN_SECRET") },
      body: JSON.stringify({ ...payload, action }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    console.error("admin", "push", action, e instanceof Error ? e.name : "fetch");
    return { status: 502, out: { error: "push_unreachable" } };
  }
  const out = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (res.status === 401 || res.status === 403) return { status: 502, out: { error: "push_forbidden" } };
  if (res.status === 404 && !out?.error) return { status: 503, out: { error: "push_not_deployed" } };
  if (!res.ok || !out || typeof out !== "object") {
    console.error("admin", "push", action, `HTTP ${res.status}`);
    return { status: res.ok ? 502 : res.status, out: { error: errCode(out?.error) } };
  }
  return { status: 200, out };
}
// ---- nieuwsbrief: doorgeven aan de functie `newsletter` (iptv-ios-appletv) met NEWSLETTER_ADMIN_SECRET ----
// Nooit het geheim of het adres van een voorbeeldmail loggen (newsletter.ts logt alleen actie en HTTP-status).
const NL_PREVIEW_MAX = 10, NL_PREVIEW_WINDOW = 3600;
const nlCall = (action: string, payload: Record<string, unknown> = {}) =>
  newsletterCall(env("SUPABASE_URL"), env("NEWSLETTER_ADMIN_SECRET"), action, payload);

// ---- afbeelding van een eigen mailing (image.ts): controle van een URL en uploaden naar de bucket mail-assets ----
// Nooit de URL, de host of een serverantwoord loggen (alleen de naam van een fout).
const IMG_CHECK_MAX = 120, IMG_UPLOAD_MAX = 30, IMG_WINDOW = 3600;
// A- en AAAA-records; kan de runtime zelf geen DNS opzoeken (niet ondersteund), dan via DNS-over-HTTPS (Cloudflare)
async function resolveHost(host: string): Promise<string[]> {
  const kinds = ["A", "AAAA"] as const;
  const own = await Promise.allSettled(kinds.map((k) => Deno.resolveDns(host, k)));
  const ips = own.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (ips.length) return ips;
  const notFound = own.every((r) => r.status === "rejected" && (r.reason instanceof Deno.errors.NotFound || /NotFound|no record/i.test(String((r.reason as Error)?.name ?? r.reason))));
  if (notFound) return [];
  console.error("admin", "image", "dns", own.map((r) => (r.status === "rejected" ? (r.reason as Error)?.name ?? "fout" : "leeg")).join(","));
  const doh = await Promise.allSettled(kinds.map(async (k) => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${k}`, {
      headers: { Accept: "application/dns-json" }, redirect: "error", signal: AbortSignal.timeout(4000),
    });
    const j = await r.json() as { Answer?: { type: number; data: string }[] };
    return (j.Answer ?? []).filter((a) => a.type === (k === "A" ? 1 : 28)).map((a) => a.data);
  }));
  return doh.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
const checkMailImage = (url: string): Promise<CheckResult> =>
  checkImageUrl(url, { fetch: (u, init) => fetch(u, init), resolve: resolveHost, trusted: (u) => isOwnAsset(env("SUPABASE_URL"), u) });
const imageFail = (r: CheckResult) => (r.ok ? null : r.service ? { error: r.error, service: r.service } : { error: r.error });

// Nieuwsbrief per account (account_email_prefs.newsletter_opt_out; schema in iptv-ios-appletv). Bestaat de kolom nog
// niet, dan is de stand onbekend (null) en geen fout.
async function newsletterPref(id: string) {
  const { data, error } = await admin.from("account_email_prefs").select("email_opt_out,newsletter_opt_out").eq("user_id", id).maybeSingle();
  if (error) { console.error("admin", "newsletter_pref", missingColumn(error) ? "kolom ontbreekt" : error.code ?? "db"); return null; }
  return prefView(data);
}
async function newsletterPrefs(ids: string[]): Promise<Record<string, boolean> | null> {
  if (!ids.length) return {};
  const { data, error } = await admin.from("account_email_prefs").select("user_id,email_opt_out,newsletter_opt_out").in("user_id", ids);
  if (error) { console.error("admin", "newsletter_prefs", missingColumn(error) ? "kolom ontbreekt" : error.code ?? "db"); return null; }
  return prefMap(ids, data);
}

// Servers (alleen adres van Xtream-bronnen) van een account, uit account_sources (schema in iptv-ios-appletv). Leesfout of
// ontsleutelen mislukt = null (onbekend). Bewust geen log: alleen een korte code bij een databasefout, nooit inhoud of adressen.
async function accountServers(id: string) {
  const { data, error } = await admin.from("account_sources").select("data").eq("user_id", id).maybeSingle();
  if (error) { console.error("admin", "servers", error.code ?? "db"); return null; }
  return await serversFromRow(data?.data ?? null, env("BINGR_SOURCES_KEY"));
}

// Stand van de releasemeldingen voor de builds in Downloads (push_messages, schema in iptv-ios-appletv): per
// "platform:build" wanneer en de aantallen. Fout = leeg (de tab werkt dan gewoon, zonder stand).
async function releasePushes(manifest: Manifest, keys = releaseKeys(manifest)) {
  if (!keys.length) return {};
  const { data, error } = await admin.from("push_messages").select("dedup_key,created_at,devices,counts,finished_at")
    .eq("kind", "release").in("dedup_key", keys);
  if (error) { console.error("admin", "release_push", error.message); return {}; }
  return releasePushView(data);
}

// Aantal apparaten voor de bevestiging (push_count): rechtstreeks in push_devices (schema in iptv-ios-appletv; kolommen
// user_id en platform uit docs/PUSH.md). Alleen platforms met systeem-push. null = (nog) niet te tellen.
async function countDevices(target: PushTarget) {
  const by: Record<string, number> = Object.fromEntries(PUSH_PLATFORMS.map((p) => [p, 0]));
  const plats = "platforms" in target ? target.platforms : [...PUSH_PLATFORMS];
  if ("accounts" in target) {
    // per 100 accounts (korte URL), alleen platform en account: tellen hier
    const reached = new Set<string>();
    for (let i = 0; i < target.accounts.length; i += 100) {
      const { data, error } = await admin.from("push_devices").select("user_id,platform")
        .in("user_id", target.accounts.slice(i, i + 100)).in("platform", plats).limit(5000);
      if (error) { console.error("admin", "push_count", error.message); return null; }
      for (const r of data ?? []) { by[r.platform] = (by[r.platform] ?? 0) + 1; reached.add(r.user_id); }
    }
    return { devices: Object.values(by).reduce((a, b) => a + b, 0), by_platform: by, accounts: reached.size };
  }
  for (const p of plats) {
    const { count, error } = await admin.from("push_devices").select("user_id", { count: "exact", head: true }).eq("platform", p);
    if (error) { console.error("admin", "push_count", error.message); return null; }
    by[p] = count ?? 0;
  }
  return { devices: Object.values(by).reduce((a, b) => a + b, 0), by_platform: by };
}

// Pushabonnees van de Bingr-apps (push_subscribers): alle rijen van push_devices per 1000 (alleen user_id, platform en
// created_at), geteld in admin_push.ts. Hoogstens 200.000 rijen; daarboven telt de rest niet mee. null = niet te tellen.
async function countSubscribers() {
  const rows: unknown[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await admin.from("push_devices").select("user_id,platform,created_at")
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { console.error("admin", "push_subscribers", error.message); return null; }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return summarizeSubscribers(rows);
}

// ---- pushmeldingen van de Beheer-app: testmelding rechtstreeks via APNs (zelfde function-secrets als de functie push) ----
// Provider token 50 minuten in het geheugen (Apple: max. 60). Nooit de sleutel, de JWT of het devicetoken loggen.
const PUSHREG_MAX = 30, PUSHREG_WINDOW = 3600, PUSHTEST_MAX = 10, PUSHTEST_WINDOW = 3600;
const apnsConfigured = () => !!(env("APNS_KEY_P8") && env("APNS_KEY_ID") && env("APNS_TEAM_ID"));
let apnsAuth: { jwt: string; at: number; kid: string } | null = null;
async function apnsBearer(): Promise<string> {
  const now = Date.now(), kid = env("APNS_KEY_ID");
  if (apnsAuth && apnsAuth.kid === kid && now - apnsAuth.at < 50 * 60_000) return apnsAuth.jwt;
  const jwt = await apnsJwt(await importApnsKey(env("APNS_KEY_P8")), kid, env("APNS_TEAM_ID"), Math.floor(now / 1000));
  apnsAuth = { jwt, at: now, kid };
  return jwt;
}
async function sendApnsTest(token: string, sandbox: boolean): Promise<{ ok: true } | { ok: false; invalid: boolean; error: string }> {
  let bearer: string;
  try { bearer = await apnsBearer(); } catch (e) {
    console.error("admin", "push_test", "sleutel", e instanceof Error ? e.name : "key");
    return { ok: false, invalid: false, error: "apns_bad_key" };
  }
  let res: Response;
  try {
    // HTTP/2: Deno-fetch onderhandelt h2 via ALPN (zoals de functie push)
    res = await fetch(`${apnsHost(sandbox)}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${bearer}`,
        "apns-topic": env("BEHEER_APNS_TOPIC") || DEFAULT_TOPIC,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
        "content-type": "application/json",
      },
      body: JSON.stringify(testPayload()),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error("admin", "push_test", e instanceof Error ? e.name : "fetch");
    return { ok: false, invalid: false, error: "apns_unreachable" };
  }
  let reason = "";
  if (res.status !== 200) { try { reason = String((await res.json())?.reason ?? ""); } catch { /* geen json */ } }
  else await res.body?.cancel().catch(() => {});
  const r = apnsResult(res.status, reason);
  if (!r.ok) {
    if (/ProviderToken/.test(reason)) apnsAuth = null;
    console.error("admin", "push_test", r.error);
  }
  return r;
}

Deno.serve(async (req) => {
  let cors = corsFor(req, null);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const oneClick = new URL(req.url).searchParams.get("unsubscribe");
  if (oneClick !== null) {
    const plain = (text: string, status: number) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    if (req.method === "GET" || req.method === "HEAD") {
      return new Response(null, { status: 303, headers: { Location: `${SITE}/unsubscribe/?t=${encodeURIComponent(oneClick)}`, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } });
    }
    if (req.method !== "POST") return plain("method not allowed", 405);
    try {
      // build 97: limiet per IP; ruimer dan de afmeldpagina, want one-click komt van (gedeelde) mailservers
      if (!(await rateOk(`admin-unsub1:${clientIp(req)}`, UNSUB_ONECLICK_MAX, UNSUB_WINDOW))) return plain("too many requests", 429);
      return (await unsubscribe(oneClick)) ? plain("unsubscribed", 200) : plain("invalid link", 400);
    } catch (e) {
      console.error("admin", "one-click unsubscribe", e instanceof Error ? e.message : e);
      return plain("server error", 500);
    }
  }
  cors = corsFor(req, "");
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    // alleen het uploaden van een mailafbeelding mag groter zijn (base64 van max. 2 MB)
    if (text.length > Math.ceil(IMAGE_MAX / 3) * 4 + 16 * 1024) return json({ error: "too_large" }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    if (text.length > 64 * 1024 && body.action !== "mailing_image_upload") return json({ error: "too_large" }, 413);
  } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body.action ?? "");
  cors = corsFor(req, action);
  // vanaf de openbare site alleen de afmeldactie (beheer draait op beheer.bingr.online)
  if (SITE_ORIGIN.test(req.headers.get("Origin") ?? "") && !PUBLIC_ACTIONS.has(action)) return json({ error: "forbidden_origin" }, 403);
  try {
    return await handle(req, body, json);
  } catch (e) {
    console.error("admin", action, e instanceof Error ? e.message : e);
    return json({ error: "server_error" }, 500);
  }
});

async function handle(req: Request, body: Record<string, unknown>, json: (b: unknown, s?: number) => Response): Promise<Response> {
  const ip = clientIp(req);
  const action = String(body.action ?? "");

  if (action === "login") {
    if (!env("BINGR_ADMIN_USER") || !env("BINGR_ADMIN_PASSWORD")) return json({ error: "not_configured" }, 503);
    // build 95: één atomaire stap vóór de wachtwoordcontrole (bingr_admin_attempt): telt de poging alvast als fout, per IP
    // en globaal, en zegt of hij door mag. Zo kunnen parallelle verzoeken niet langs de grens tussen controle en telling.
    const { data: att, error: ae } = await admin.rpc("bingr_admin_attempt", { p_ip: ip });
    if (ae) throw new Error(ae.message);
    if (!att?.allowed) {
      // build 97: geblokkeerde pogingen ook in het logboek, hoogstens 5 per IP per 15 min (geen logboek vol bij een aanval)
      if (await rateOk(`admin-auditlock:${ip}`, 5, 900)) await audit("login_locked", ip, null, { retry_after: att?.retry_after ?? 900 });
      return json({ error: "locked", retry_after: att?.retry_after ?? 900 }, 429);
    }
    // altijd allebei vergelijken, op hashes van gelijke lengte (geen timing-verschil)
    const [a, b, c, d] = await Promise.all([sha256(String(body.user ?? "")), sha256(env("BINGR_ADMIN_USER")),
      sha256(String(body.password ?? "")), sha256(env("BINGR_ADMIN_PASSWORD"))]);
    const ok = sameBytes(a, b) && sameBytes(c, d);
    // build 95: alleen gelukt hoeft nog terug naar de database (teller van dit IP weg); fout is al geteld
    if (ok) {
      const { error: re } = await admin.rpc("bingr_admin_result", { p_ip: ip, p_ok: true });
      if (re) console.error("admin", "login reset", re.message);
    }
    await audit(ok ? "login" : "login_failed", ip);
    if (!ok) return json({ error: "invalid_credentials" }, 401);
    return json(await makeToken());
  }

  if (action === "unsubscribe") {
    // build 97: max. 20 per 10 minuten per IP
    if (!(await rateOk(`admin-unsub:${ip}`, UNSUB_MAX, UNSUB_WINDOW))) return json({ error: "rate_limited", retry_after: UNSUB_WINDOW }, 429);
    if (!(await unsubscribe(body.t))) return json({ error: "invalid_token" }, 400);
    return json({ ok: true });
  }

  if (action === "mailtest_account_mails") {
    // mailtest (workflow Diagnose in iptv-ios-appletv): alleen naar een testadres en met de tijdelijke sleutel uit app_settings
    if (!isMailtestAddress(body.to) ||
      !(await mailtestOk(req.headers.get(MAILTEST_HEADER), async () => (await admin.from("app_settings").select("value").eq("key", "mailtest").maybeSingle()).data?.value))) {
      return json({ error: "forbidden" }, 403);
    }
    if (!(await rateOk("admin-mailtest", 10, 3600))) return json({ error: "rate_limited", retry_after: 3600 }, 429);
    const to = String(body.to).trim(), lang = accountLang(body.lang);
    const sample = lang === "en" ? "Sample (mail test)" : "Voorbeeld (mailtest)";
    const sent = {
      deleted: (await sendAccountMail(to, deletedMail(lang, { email: to, ticketsDeleted: false, firstName: "Test" }), "deleted")).ok,
      blocked: (await sendAccountMail(to, blockMail(lang, { email: to, reason: sample, until: new Date(Date.now() + 7 * 864e5), firstName: "Test" }), "blocked")).ok,
      unblocked: (await sendAccountMail(to, unblockMail(lang, { email: to, firstName: "Test" }), "unblocked")).ok,
    };
    await audit("mailtest_account_mails", ip, null, { lang, sent });
    return json({ ok: sent.deleted && sent.blocked && sent.unblocked, sent });
  }

  if (action === "widget_summary") {
    // widgets van de app: alleen met een widget-token (een gewoon beheer-token wordt hier geweigerd)
    if (!(await validWidgetToken(body.token))) return json({ error: "not_signed_in" }, 401);
    if (!(await rateOk(`admin-widget:${ip}`, WIDGET_MAX, AUTHED_WINDOW))) return json({ error: "rate_limited", retry_after: AUTHED_WINDOW }, 429);
    return json(await widgetSummary());
  }

  // een widget-token geldt hier niet (andere sleutel en scope, zie widget.ts)
  if (!(await validToken(body.token))) return json({ error: "not_signed_in" }, 401);
  // build 97: na inloggen max. 300 verzoeken per minuut per IP
  if (!(await rateOk(`admin:${ip}`, AUTHED_MAX, AUTHED_WINDOW))) return json({ error: "rate_limited", retry_after: AUTHED_WINDOW }, 429);

  // build 97: mislukte acties (ook serverfouten) met foutcode in het logboek; user_block/user_delete loggen hun eigen
  // mislukking al (user_block_failed, user_delete_failed)
  let res: Response;
  try {
    res = await authed(action, body, ip, json);
  } catch (e) {
    console.error("admin", action, e instanceof Error ? e.message : e);
    res = json({ error: "server_error" }, 500);
  }
  if (res.status >= 400) {
    const code = String((await res.clone().json().catch(() => ({})))?.error ?? res.status).slice(0, 60);
    if (!(code === "block_failed" || code === "delete_failed")) {
      const t = [body.id, body.user_id].find(isUuid) as string | undefined;
      await audit(`${action.slice(0, 40) || "?"}_failed`, ip, t?.toLowerCase() ?? null, {
        error: code, status: res.status, number: typeof body.number === "number" ? body.number : undefined,
        op: action === "status" ? String(body.op ?? "").slice(0, 30) : undefined,
      });
    }
  }
  return res;
}

async function authed(action: string, body: Record<string, unknown>, ip: string, json: (b: unknown, s?: number) => Response): Promise<Response> {
  // beheer-token: alles behalve de widget-acties (die lopen alleen met een widget-token, zie handle)
  if (!actionAllowed(null, action)) return json({ error: "unknown_action" }, 400);
  switch (action) {
    case "widget_token": {
      // widgets van de app: apart token (30 dagen, scope widget) dat alleen widget_summary mag; vervalt bij overal uitloggen
      const out = await makeWidgetToken();
      await audit("widget_token", ip, null, { expires_at: out.expires_at });
      return json(out);
    }
    case "logout_all": {
      // build 97: overal uitloggen (web en app): tokenversie + 1
      const { data, error } = await admin.rpc("bingr_admin_logout_all");
      if (error) throw new Error(error.message);
      // pushmeldingen van de Beheer-app: alle apparaten afmelden (na opnieuw inloggen meldt de app zich weer aan)
      const { count: pushRemoved, error: pe } = await admin.from("admin_push_devices").delete({ count: "exact" }).neq("device_id", "");
      if (pe) console.error("admin", "logout_all push", pe.message);
      await audit("logout_all", ip, null, { version: data, push_devices: pe ? null : pushRemoved ?? 0 });
      return json({ ok: true });
    }
    case "stats": {
      // build 134 (iptv-ios-appletv): registratiebescherming, alleen aantallen; ontbreekt de functie nog, dan signup_guard null
      const [{ data, error }, guard] = await Promise.all([admin.rpc("bingr_admin_stats"), admin.rpc("bingr_admin_signup_guard")]);
      if (error) throw new Error(error.message);
      if (guard.error && guard.error.code !== "PGRST202") console.error("admin", "signup_guard", guard.error.message);
      return json({ ...data, signup_guard: guard.error ? null : guard.data ?? null, smtp: smtpConfigured() });
    }
    case "streams_now": {
      // tegel Kijkt nu: persoonsgegevens alleen in dit antwoord (e-mail gemaskeerd); in het logboek alleen het aantal
      const { data, error } = await admin.rpc("bingr_admin_streams_now");
      if (error?.code === "PGRST202") return json({ error: "server_not_configured" }, 503);
      if (error) throw new Error(error.message);
      const out = await streamsView(data, maskEmail, env("BINGR_SOURCES_KEY"));
      await audit("streams_view", ip, null, { streams: out.total });
      return json(out);
    }
    case "countries": {
      const { data, error } = await admin.rpc("bingr_admin_countries");
      if (error?.code === "PGRST202") return json({ error: "server_not_configured" }, 503);
      if (error) throw new Error(error.message);
      const items = (Array.isArray(data?.items) ? data.items : []).filter((x: { country?: unknown }) => typeof x?.country === "string" && /^[A-Z]{2}$/.test(x.country))
        .slice(0, 250).map((x: Record<string, unknown>) => ({ country: x.country, accounts: Number(x.accounts) || 0, active_30d: Number(x.active_30d) || 0 }));
      return json({ accounts: Number(data?.accounts) || 0, known: Number(data?.known) || 0, items });
    }
    case "server": {
      // tab Server: dagrijen (admin_server_daily) als Insights-reeksen, plus desgevraagd de actuele stand
      const q = parseServer(body);
      if ("error" in q) return json({ error: q.error }, 400);
      const now = Date.now(), p = serverPlan(q, now), r = planRange(p);
      const [days, cur] = await Promise.all([
        admin.rpc("bingr_admin_server_days", { p_from: r.from, p_to: r.to }),
        body.now === true ? admin.rpc("bingr_admin_server_now") : null,
      ]);
      if (days.error?.code === "PGRST202") return json({ error: "server_not_configured" }, 503);
      if (days.error) throw new Error(days.error.message);
      if (cur?.error) console.error("admin", "server now", cur.error.code ?? "fout");
      return json({ ...buildServer(p, days.data, now), ...(cur ? { now: cur.error ? null : nowView(cur.data) } : {}) });
    }
    case "insights": {
      // grafieken van het overzicht (zoals Homey Insights): aantallen per tijdvak, nooit gegevens per persoon (insights.ts)
      const q = parseInsights(body);
      if ("error" in q) return json({ error: q.error }, 400);
      const now = Date.now(), p = planInsights(q, now);
      const iso = (t: number) => new Date(t).toISOString();
      // events: true = storingen en onderhoud (statuspagina) als banden op de tijdas
      const [{ data, error }, ev] = await Promise.all([
        admin.rpc("bingr_admin_insights", { p_metric: p.metric, p_edges: p.edges.map(iso), p_daily: p.daily }),
        body.events === true ? admin.rpc("bingr_admin_insights_events", { p_from: iso(p.cur[0]), p_to: iso(p.cur[p.cur.length - 1]) }) : null,
      ]);
      // schema nog niet bijgewerkt (workflow Backend in iptv-ios-appletv)
      if (error?.code === "PGRST202") return json({ error: "insights_not_configured" }, 503);
      if (error) throw new Error(error.message);
      if (ev?.error) console.error("admin", "insights events", ev.error.message);
      return json(buildInsights(p, data, now, ev ? (ev.error ? [] : ev.data) : undefined));
    }
    case "revenue": case "revenue_export": {
      // tab Omzet: bedragen per tijdvak en totalen, nooit gegevens per persoon (revenue.ts)
      const q = parseRevenue(body);
      if ("error" in q) return json({ error: q.error }, 400);
      const now = Date.now(), p = revenuePlan(q, now), key = stripeKey();
      const mode = q.mode ?? defaultMode(key);
      const iso = (t: number) => new Date(t).toISOString();
      if (action === "revenue_export") {
        const { data, error } = await admin.rpc("bingr_admin_revenue_rows", { p_from: iso(p.cur[0]), p_to: iso(p.cur[p.cur.length - 1]), p_mode: mode });
        if (error?.code === "PGRST202") return json({ error: "revenue_not_configured" }, 503);
        if (error) throw new Error(error.message);
        const rows = cleanRows(data);
        const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date(p.cur[0]));
        await audit("revenue_export", ip, null, { period: q.period, offset: q.offset, mode, rows: rows.length });
        return json({ csv: revenueCsv(rows), file_name: `bingr-omzet-${q.period}-${day}${mode === "all" ? "" : "-" + mode}.csv`, rows: rows.length });
      }
      const { data, error } = await admin.rpc("bingr_admin_revenue", { p_edges: p.edges.map(iso), p_mode: mode, p_ranges: tileRanges(p, now) });
      // schema nog niet bijgewerkt (workflow Backend in iptv-ios-appletv)
      if (error?.code === "PGRST202") return json({ error: "revenue_not_configured" }, 503);
      if (error) throw new Error(error.message);
      if (data === null) return json({ error: "bad_period" }, 400);
      return json(buildRevenue(p, data, now, {
        mode, stripeTax: stripeTaxOn(), billing: { enabled: !!key, mode: key ? (/_live_/.test(key) ? "live" : "test") : null },
      }));
    }
    case "revenue_backfill": {
      const key = stripeKey();
      if (!key) return json({ error: "billing_unavailable" }, 503);
      const sel = () => admin.from("billing_purchases").select("id,payment_intent", { count: "exact" }).is("fee", null)
        .in("status", ["paid", "refunded", "disputed"]).not("payment_intent", "is", null);
      const { data, error } = await sel().order("paid_at", { ascending: false }).limit(20);
      if (error) throw new Error(error.message);
      let updated = 0, checked = 0;
      for (const r of (data ?? []) as { id: number; payment_intent: string }[]) {
        if (!isPaymentIntent(r.payment_intent)) continue;
        checked++;
        const res = await stripeGet(key, `payment_intents/${r.payment_intent}`, [["expand[]", "latest_charge.balance_transaction"]]);
        if (!res.ok) { console.error("admin", "revenue_backfill stripe", res.status); continue; }
        const d = detailsFromPaymentIntent(res.body);
        if (!d) continue;
        const { error: ue } = await admin.from("billing_purchases").update(detailsPatch(d, new Date().toISOString())).eq("id", r.id);
        if (ue) throw new Error(ue.message);
        if (d.fee !== null) updated++;
      }
      const { count } = await sel().limit(1);
      await audit("revenue_backfill", ip, null, { checked, updated, remaining: count ?? null });
      return json({ checked, updated, remaining: count ?? 0 });
    }
    case "revenue_vat_set": {
      const rate = cleanRate(body.rate);
      if (rate === null) return json({ error: "bad_rate" }, 400);
      const { error } = await admin.from("app_settings").upsert({ key: "revenue_vat", value: { rate }, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await audit("revenue_vat_set", ip, null, { rate });
      return json({ ok: true, rate });
    }
    case "users": {
      const size = Math.min(Math.max(Number(body.page_size ?? 25) || 25, 1), 50);
      const page = Math.max(Math.floor(Number(body.page ?? 0) || 0), 0);
      // zoekterm: begin van e-mailadres, voornaam, achternaam of "voornaam achternaam" (bingr_admin_users); spaties samengevoegd
      const q = String(body.q ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 100);
      // filter alleen meesturen als hij gekozen is (zo werkt de lijst ook met een ouder schema)
      const { data, error } = await admin.rpc("bingr_admin_users", {
        p_search: q, p_limit: size, p_offset: page * size,
        ...(["blocked", "free", "lifetime", "custom"].includes(String(body.filter)) || /^country:([A-Z]{2}|\?)$/.test(String(body.filter))
          ? { p_filter: String(body.filter) } : {}),
      });
      if (error) throw new Error(error.message);
      // build 97: zoeken in accounts (op e-mailadres of naam) in het logboek; alleen lengte van de zoekterm, niet de term zelf
      if (q) await audit("users_search", ip, null, { q_length: q.length, filter: body.filter || undefined, page, results: data?.total ?? 0 });
      const rows = (data?.items ?? []) as Record<string, unknown>[];
      // nieuwsbrief per account (true/false; null = onbekend, bv. kolom nog niet aangemaakt)
      const ids = rows.map((u) => String(u.id ?? "")).filter(isUuid).map((id) => id.toLowerCase());
      const [nl, cc] = await Promise.all([newsletterPrefs(ids), accountCountries(ids)]);
      const items = rows.map((u) => ({
        ...u, email: maskEmail(u.email), newsletter: nl && isUuid(u.id) ? nl[String(u.id).toLowerCase()] ?? null : null,
        country: isUuid(u.id) ? cc[String(u.id).toLowerCase()] ?? null : null,
      }));
      return json({
        total: data?.total ?? 0, blocked_total: data?.blocked_total ?? null, lifetime_total: data?.lifetime_total ?? null,
        free_total: data?.free_total ?? null, page, page_size: size, items,
      });
    }
    case "user_detail": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const { data, error } = await admin.rpc("bingr_admin_user", { p_id: body.id });
      if (error) throw new Error(error.message);
      if (!data) return json({ error: "not_found" }, 404);
      // build 97: inzage van een account in het logboek (wie, geen inhoud)
      await audit("user_view", ip, String(body.id).toLowerCase());
      const uid = String(body.id).toLowerCase();
      const [newsletter, servers, country] = await Promise.all([newsletterPref(uid), accountServers(uid), userCountry(uid)]);
      const devices = Array.isArray(data.devices) ? data.devices.map((d: Record<string, unknown>) =>
        ({ ...d, country: country.devices.find((x) => Date.parse(String(x.created_at)) === Date.parse(String(d.created_at)) && x.name === d.name)?.country ?? null })) : data.devices;
      return json({ ...data, devices, email: maskEmail(data.email), newsletter, servers, country: country.account });
    }
    case "user_email": {
      // het volledige e-mailadres (oog naast het gemaskeerde adres); in het logboek alleen dat het bekeken is
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      await audit("user_email_view", ip, id);
      return json({ email: user.email ?? "" });
    }
    case "user_set_name": {
      // voor- en achternaam (user_metadata first_name / last_name); leeg = weg. De rest van de metadata (taal e.d.) blijft:
      // de huidige metadata gaat mee, alleen deze twee sleutels veranderen (null = verwijderen).
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const fn = cleanName(body.first_name), ln = cleanName(body.last_name);
      if (!fn.ok) return json({ error: fn.error, field: "first_name" }, 400);
      if (!ln.ok) return json({ error: ln.error, field: "last_name" }, 400);
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const before = user.user_metadata ?? {};
      const { error } = await admin.auth.admin.updateUserById(id, {
        user_metadata: { ...before, first_name: fn.value, last_name: ln.value },
      });
      if (error) { console.error("user_set_name", error.message); return json({ error: "name_failed" }, 502); }
      // logboek: alleen of er een naam staat en of hij veranderde, nooit de naam zelf
      await audit("user_set_name", ip, id, {
        first_name: fn.value !== null, last_name: ln.value !== null,
        changed: (before.first_name ?? null) !== fn.value || (before.last_name ?? null) !== ln.value,
      });
      return json({ ok: true, first_name: fn.value, last_name: ln.value });
    }
    case "user_newsletter_set": {
      // nieuwsbrief van een account aan/uit (account_email_prefs.newsletter_opt_out). Alle mail uit (email_opt_out) wordt
      // niet overschreven: dan 409 email_opted_out. In admin_audit alleen aan/uit, nooit het e-mailadres.
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const subscribed = body.subscribed;
      if (typeof subscribed !== "boolean") return json({ error: "bad_enabled" }, 400);
      const id = String(body.id).toLowerCase();
      if (!(await authUser(id))) return json({ error: "not_found" }, 404);
      const cur = await newsletterPref(id);
      if (!cur) return json({ error: "newsletter_prefs_unavailable" }, 503);
      const plan = planPrefChange(cur, subscribed);
      if (!plan.ok) return json({ error: plan.error, newsletter: cur }, 409);
      if (plan.changed) {
        const { error } = await admin.from("account_email_prefs").upsert(
          { user_id: id, newsletter_opt_out: plan.newsletter_opt_out, updated_at: new Date().toISOString() }, { onConflict: "user_id" },
        );
        if (error) {
          if (missingColumn(error)) return json({ error: "newsletter_prefs_unavailable" }, 503);
          throw new Error(error.message);
        }
      }
      await audit("user_newsletter_set", ip, id, { subscribed });
      return json({ ok: true, newsletter: prefView({ email_opt_out: cur.email_opt_out, newsletter_opt_out: plan.newsletter_opt_out }) });
    }
    case "plan_get": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const { data, error } = await admin.from("account_plans").select("*").eq("user_id", String(body.id).toLowerCase()).maybeSingle();
      if (error) throw new Error(error.message);
      return json(planView(data));
    }
    case "plan_set": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      if (body.plan !== "free" && body.plan !== "lifetime") return json({ error: "bad_plan" }, 400);
      const ms = limitInput(body.max_streams, 50), md = limitInput(body.max_devices, 200);
      if (ms === undefined) return json({ error: "bad_max_streams" }, 400);
      if (md === undefined) return json({ error: "bad_max_devices" }, 400);
      const note = String(body.note ?? "").trim().slice(0, 500) || null;
      if (!(await authUser(id))) return json({ error: "not_found" }, 404);
      // build 95: leesfout niet negeren (anders kan een gekochte Lifetime als 'admin' worden overschreven)
      const { data: before, error: pe } = await admin.from("account_plans").select("plan,max_streams,max_devices,source").eq("user_id", id).maybeSingle();
      if (pe) throw new Error(pe.message);
      let row: Record<string, unknown> | null = null;
      if (body.plan === "free" && ms === null && md === null && !note) {
        // gewoon Gratis: geen rij nodig
        const { error } = await admin.from("account_plans").delete().eq("user_id", id);
        if (error) throw new Error(error.message);
      } else {
        // bron: een gekochte Lifetime blijft 'purchase' zolang het Lifetime blijft; anders 'admin'
        const source = before?.source === "purchase" && body.plan === "lifetime" ? "purchase" : "admin";
        const { data, error } = await admin.from("account_plans").upsert({
          user_id: id, plan: body.plan, max_streams: ms, max_devices: md, note, source,
          granted_by: "beheer", updated_at: new Date().toISOString(),
        }).select("*").single();
        if (error) throw new Error(error.message);
        row = data;
      }
      await audit("plan_set", ip, id, { from: before ?? { plan: "free" }, plan: body.plan, max_streams: ms, max_devices: md, note: note ? true : undefined });
      return json({ ok: true, ...planView(row) });
    }
    case "app_settings_get": {
      const { data, error } = await admin.from("app_settings").select("value").eq("key", "upgrade_link").maybeSingle();
      if (error) throw new Error(error.message);
      return json({ upgrade_link: linkView(data?.value) });
    }
    case "app_settings_set": {
      const v = body.upgrade_link;
      if (!v || typeof v !== "object" || Array.isArray(v)) return json({ error: "bad_settings" }, 400);
      const o = v as Record<string, unknown>;
      if (!LINK_KEYS.every((k) => typeof o[k] === "boolean" || (LINK_OPTIONAL.includes(k) && o[k] === undefined))) return json({ error: "bad_settings" }, 400);
      let cur: Record<string, boolean> | null = null;
      if (LINK_OPTIONAL.some((k) => o[k] === undefined)) {
        const { data } = await admin.from("app_settings").select("value").eq("key", "upgrade_link").maybeSingle();
        cur = linkView(data?.value);
      }
      const value = Object.fromEntries(LINK_KEYS.map((k) => [k, typeof o[k] === "boolean" ? o[k] : cur![k]]));
      const { error } = await admin.from("app_settings").upsert({ key: "upgrade_link", value, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await audit("app_settings_set", ip, null, { upgrade_link: value });
      return json({ ok: true, upgrade_link: value });
    }
    case "send_reset": {
      if (!isUuid(body.user_id)) return json({ error: "bad_id" }, 400);
      const { data: u } = await admin.auth.admin.getUserById(String(body.user_id));
      const email = u?.user?.email;
      if (!email) return json({ error: "not_found" }, 404);
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/reset/` });
      if (error) {
        const st = (error as { status?: number }).status ?? 500;
        console.error("send_reset", error.message);
        return json({ error: st === 429 ? "too_soon" : "reset_failed" }, st === 429 ? 429 : 502);
      }
      await audit("send_reset", ip, String(body.user_id));
      return json({ ok: true });
    }
    case "user_confirm": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const already = !!user.email_confirmed_at;
      if (!already) {
        const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true });
        if (error) { console.error("user_confirm", error.message); return json({ error: "confirm_failed" }, 502); }
      }
      await audit("user_confirm", ip, id, { already });
      return json({ ok: true, already });
    }
    case "user_resend_confirm": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const user = await authUser(id);
      if (!user?.email) return json({ error: "not_found" }, 404);
      if (user.email_confirmed_at) return json({ error: "already_confirmed" }, 409);
      const { error } = await admin.auth.resend({ type: "signup", email: user.email, options: { emailRedirectTo: `${SITE}/account/` } });
      if (error) {
        const st = (error as { status?: number }).status ?? 500;
        console.error("user_resend_confirm", st);
        return json({ error: st === 429 ? "confirm_too_soon" : "resend_failed" }, st === 429 ? 429 : 502);
      }
      await audit("user_resend_confirm", ip, id);
      return json({ ok: true });
    }
    case "user_block": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const reason = cleanReason(body.reason);
      if (!reason) return json({ error: "reason_missing" }, 400);
      const u = parseUntil(body.until);
      if (!u.ok) return json({ error: u.error }, 400);
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const until = u.until?.toISOString() ?? null;
      // build 95: eerst het record, dan pas de ban. Mislukt de ban, dan wordt het nieuwe record weer weggehaald en blijft
      // een vorige blokkade gewoon staan; zo is er nooit een ban zonder record (of een record zonder ban).
      const { data: row, error: ie } = await admin.from("account_blocks").insert({ user_id: id, reason, until }).select("id").single();
      if (ie) throw new Error(ie.message);
      const { error: be } = await admin.auth.admin.updateUserById(id, { ban_duration: banDuration(u.until) });
      if (be) {
        console.error("user_block", be.message);
        const { error: ue } = await admin.from("account_blocks").delete().eq("id", row.id);
        if (ue) {
          // weghalen lukt niet: dan het record als mislukt afsluiten, zodat het niet als actieve blokkade telt
          console.error("user_block undo", ue.message);
          await admin.from("account_blocks").update({ lifted_at: new Date().toISOString(), lifted_by: "mislukt" }).eq("id", row.id);
        }
        await audit("user_block_failed", ip, id, { until, stage: "ban" });
        return json({ error: "block_failed" }, 502);
      }
      // een vorige blokkade die nog liep, is hiermee vervangen (build 95: fout niet meer negeren)
      const { error: re } = await admin.from("account_blocks").update({ lifted_at: new Date().toISOString(), lifted_by: "vervangen" })
        .eq("user_id", id).is("lifted_at", null).neq("id", row.id);
      if (re) console.error("user_block replaced", re.message);
      // Sessies NIET intrekken: met een bestaande sessie geeft het vernieuwen door de ban de fout user_banned, en daaraan
      // herkennen de apps (build 82) en de website dat het account geblokkeerd is (melding in plaats van gewoon uitloggen).
      // device-auth weigert lopende access tokens van een geblokkeerd account met 401 {error:"user_banned", banned:true}.
      // Lopende streams tellen meteen niet meer mee.
      const { data: stopped, error: se } = await admin.from("account_streams").delete().eq("user_id", id).select("user_id");
      if (se) console.error("user_block streams", se.message);
      let mail: { ok: boolean; error?: string } = { ok: false };
      if (body.notify !== false && user.email) {
        mail = await sendAccountMail(user.email, blockMail(accountLang(user.user_metadata?.lang), { email: user.email, reason, until: u.until, firstName: user.user_metadata?.first_name }), "blocked");
        if (mail.ok) await admin.from("account_blocks").update({ notified: true }).eq("id", row.id);
      }
      await audit("user_block", ip, id, { until, notify: body.notify !== false, email_sent: mail.ok, streams: stopped?.length ?? null, length: reason.length });
      return json({ ok: true, id: row.id, until, streams_stopped: stopped?.length ?? 0, email_sent: mail.ok, email_error: mail.error });
    }
    case "user_unblock": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const { error: be } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
      if (be) { console.error("user_unblock", be.message); return json({ error: "unblock_failed" }, 502); }
      // build 95: fout niet negeren; de ban is al weg, dus wel doorgaan, maar loggen en melden in het logboek
      const { data: lifted, error: le } = await admin.from("account_blocks").update({ lifted_at: new Date().toISOString(), lifted_by: "beheer" })
        .eq("user_id", id).is("lifted_at", null).select("id");
      if (le) console.error("user_unblock record", le.message);
      let mail: { ok: boolean; error?: string } = { ok: false };
      if (body.notify !== false && user.email) {
        mail = await sendAccountMail(user.email, unblockMail(accountLang(user.user_metadata?.lang), { email: user.email, firstName: user.user_metadata?.first_name }), "unblocked");
      }
      await audit("user_unblock", ip, id, { notify: body.notify !== false, email_sent: mail.ok, lifted: lifted?.length ?? 0, record_error: le ? true : undefined });
      return json({ ok: true, email_sent: mail.ok, email_error: mail.error });
    }
    case "user_delete": {
      if (!isUuid(body.id)) return json({ error: "bad_id" }, 400);
      const id = String(body.id).toLowerCase();
      const user = await authUser(id);
      if (!user) return json({ error: "not_found" }, 404);
      const email = user.email ?? "";
      if (!confirmMatches(body.confirm, email, maskEmail(email))) return json({ error: "confirm_mismatch" }, 400);
      const notify = body.notify !== false && !!email;
      const delTickets = body.delete_tickets === true;
      // aankopen blijven bewaard zonder koppeling aan het account (fiscale bewaarplicht, 7 jaar; user_id null via on delete
      // set null, schema in iptv-ios-appletv, docs/ACCOUNT.md "Bewaarplicht"); de mail noemt dat alleen als er aankopen zijn
      const { count: buys, error: be } = await admin.from("billing_purchases").select("id", { count: "exact", head: true })
        .eq("user_id", id).in("status", ["paid", "refunded", "disputed"]);
      if (be) console.error("user_delete purchases", be.code ?? "fout");
      const purchasesKept = !be && (buys ?? 0) > 0;
      // e-mailadres en taal vastleggen vóór het verwijderen; de mail gaat pas als het verwijderen gelukt is
      const mail = notify ? deletedMail(accountLang(user.user_metadata?.lang), { email, ticketsDeleted: delTickets, firstName: user.user_metadata?.first_name, purchasesKept }) : null;
      // security H1: supporttickets horen alleen via user_id bij een account (nooit op e-mailadres); tellen vóór het
      // verwijderen, want de trigger bingr_support_user_deleted (schema in iptv-ios-appletv) wist ze bij het verwijderen
      const { count: ownTickets, error: te } = await admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("user_id", id);
      if (te) console.error("user_delete tickets count", te.code ?? "fout");
      // build 95: eerst de gebruiker zelf; alle tabellen (profielen, servers, instellingen, apparaten, sessies, streams,
      // kijkgeschiedenis, statistieken, blokkades, e-mailvoorkeuren, tv-codes) gaan mee via on delete cascade. Mislukt dit,
      // dan wordt er niets anders verwijderd (geen foto's, geen tickets) en komt de mislukking in het logboek.
      const { error: de } = await admin.auth.admin.deleteUser(id);
      if (de) {
        console.error("user_delete", de.message);
        await audit("user_delete_failed", ip, id, { email: maskEmail(email), stage: "auth" });
        return json({ error: "delete_failed" }, 502);
      }
      // pas daarna de profielfoto's (opslag gaat niet mee met de cascade)
      let avatarsOk = true;
      for (let i = 0; i < 20; i++) {
        const { data: files, error: le } = await admin.storage.from("avatars").list(id, { limit: 1000 });
        if (le) { console.error("user_delete avatars list", le.message); avatarsOk = false; break; }
        if (!files?.length) break;
        const { error: rm } = await admin.storage.from("avatars").remove(files.map((f) => `${id}/${f.name}`));
        if (rm) { console.error("user_delete avatars", rm.message); avatarsOk = false; break; }
      }
      // supporttickets van het account (user_id) zijn al weg via de trigger bij het verwijderen; gast-tickets met hetzelfde
      // e-mailadres blijven altijd staan (security H1: een account op hetzelfde adres is geen bewijs van eigendom)
      let ticketsDeleted = 0, ticketsOk = !te;
      if (delTickets) {
        const { data: a, error: ta } = await admin.from("support_tickets").delete().eq("user_id", id).select("id");
        if (ta) { console.error("user_delete tickets", ta.code ?? "fout"); ticketsOk = false; }
        ticketsDeleted = (ownTickets ?? 0) + (a?.length ?? 0);
      }
      const sent = mail ? await sendAccountMail(email, mail, "deleted") : { ok: false };
      await audit("user_delete", ip, id, {
        email: maskEmail(email), notify, email_sent: sent.ok, tickets_deleted: delTickets ? ticketsDeleted : undefined,
        purchases_kept: purchasesKept ? buys : undefined,
        avatars_error: avatarsOk ? undefined : true, tickets_error: ticketsOk ? undefined : true,
        reason: cleanReason(body.reason).slice(0, 500) || undefined,
      });
      return json({ ok: true, email_sent: sent.ok, email_error: sent.error, tickets_deleted: ticketsDeleted });
    }
    case "push_count": {
      const t = cleanTarget(body.target);
      if (!t.ok) return json({ error: t.error }, 400);
      return json((await countDevices(t.value)) ?? { devices: null });
    }
    case "push_send": {
      const r = cleanPushInput(body);
      if (!r.ok) return json({ error: r.error, field: r.field }, 400);
      if (!(await rateOk(`admin-push:${ip}`, PUSH_MAX, PUSH_WINDOW))) return json({ error: "rate_limited", retry_after: PUSH_WINDOW }, 429);
      const { title_nl, body_nl, title_en, body_en, url, target } = r.value;
      const { status, out } = await pushCall("admin_send", {
        title_nl, body_nl, ...(title_en ? { title_en, body_en } : {}), ...(url ? { url } : {}), target,
      });
      if (status !== 200) return json(out, status);
      // logboek: soort doelgroep, aantallen en lengtes; nooit de tekst, de link of wie de ontvangers zijn
      await audit("push_send", ip, null, auditDetail(r.value, out));
      const p = progressView(out);
      return json({ message_id: p.message_id, devices: p.devices, queued: p.queued, sent: p.sent, failed: p.failed, invalid: p.invalid, done: p.done, notes: p.notes });
    }
    case "push_progress": {
      const id = body.message_id;
      if (!((typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id)) || (typeof id === "number" && Number.isSafeInteger(id) && id > 0))) {
        return json({ error: "bad_id" }, 400);
      }
      const { status, out } = await pushCall("admin_progress", { message_id: id });
      if (status !== 200) return json(out, status);
      return json(progressView({ message_id: id, ...out }));
    }
    case "push_history": {
      const page = pageInput(body.page);
      const { status, out } = await pushCall("admin_history", { page });
      if (status !== 200) return json(out, status);
      return json(historyView(out, page));
    }
    case "push_subscribers": {
      // pushabonnees van de Bingr-apps: alleen tellingen (overzicht en tab Pushmeldingen)
      return json((await countSubscribers()) ?? { devices: null });
    }
    case "newsletter_status": {
      const { status, out } = await nlCall("status");
      if (status !== 200) return json(out, status);
      return json(statusView(out));
    }
    case "newsletter_set_enabled": {
      const enabled = cleanEnabled(body.enabled);
      if (enabled === null) return json({ error: "bad_enabled" }, 400);
      const { status, out } = await nlCall("set_enabled", { enabled });
      if (status !== 200) return json(out, status);
      const now = typeof out.enabled === "boolean" ? out.enabled : enabled;
      await audit("newsletter_set_enabled", ip, null, { enabled: now });
      return json({ ok: true, enabled: now });
    }
    case "newsletter_preview": {
      // voorbeeldmail naar één adres: nooit het adres loggen of in het logboek zetten
      const to = cleanEmail(body.to);
      if (!to) return json({ error: "bad_email" }, 400);
      const lang = cleanLang(body.lang);
      if (!lang) return json({ error: "bad_lang" }, 400);
      if (!(await rateOk(`admin-nlpreview:${ip}`, NL_PREVIEW_MAX, NL_PREVIEW_WINDOW))) {
        return json({ error: "rate_limited", retry_after: NL_PREVIEW_WINDOW }, 429);
      }
      const { status, out } = await nlCall("preview", { to, lang });
      if (status !== 200) return json(out, status);
      await audit("newsletter_preview", ip, null, { kind: "preview", lang });
      return json({ ok: true });
    }
    case "welcome_preview": {
      // welkomstmail als voorbeeld naar één adres: nooit het adres loggen of in het logboek zetten
      const to = cleanEmail(body.to);
      if (!to) return json({ error: "bad_email" }, 400);
      const lang = cleanLang(body.lang);
      if (!lang) return json({ error: "bad_lang" }, 400);
      // zelfde teller als newsletter_preview: samen max. NL_PREVIEW_MAX per uur
      if (!(await rateOk(`admin-nlpreview:${ip}`, NL_PREVIEW_MAX, NL_PREVIEW_WINDOW))) {
        return json({ error: "rate_limited", retry_after: NL_PREVIEW_WINDOW }, 429);
      }
      const { status, out } = await nlCall("welcome_preview", { to, lang });
      if (status !== 200) return json(out, status);
      await audit("welcome_preview", ip, null, { lang });
      return json({ ok: true });
    }
    case "welcome_render": {
      const lang = cleanLang(body.lang);
      if (!lang) return json({ error: "bad_lang" }, 400);
      const { status, out } = await nlCall("welcome_render", { lang });
      if (status !== 200) return json(out, status);
      const r = renderView(out);
      return r ? json(r) : json({ error: "server_error" }, 502);
    }
    case "newsletter_render": {
      const lang = cleanLang(body.lang);
      if (!lang) return json({ error: "bad_lang" }, 400);
      const { status, out } = await nlCall("render", { lang });
      if (status !== 200) return json(out, status);
      const r = renderView(out);
      return r ? json(r) : json({ error: "server_error" }, 502);
    }
    case "mailing_status": {
      const { status, out } = await nlCall("mailing_status");
      if (status !== 200) return json(out, status);
      return json(mailingStatusView(out));
    }
    case "mailing_render": {
      const audience = cleanAudience(body.audience);
      if (!audience) return json({ error: "bad_audience" }, 400);
      const lang = cleanLang(body.lang);
      if (!lang) return json({ error: "bad_lang" }, 400);
      const c = cleanMailingContent(body.content, [lang]);
      if (!c.ok) return json({ error: c.error }, 400);
      // afbeelding tegelijk controleren: het voorbeeld komt er wel, met de fout erbij (zoals de mail er dan uit zou zien)
      const [{ status, out }, img] = await Promise.all([
        nlCall("mailing_render", { content: c.content, audience, lang }),
        c.content.image ? checkMailImage(c.content.image) : Promise.resolve(null),
      ]);
      if (status !== 200) return json(out, status);
      const r = renderView(out);
      if (!r) return json({ error: "server_error" }, 502);
      const bad = img ? imageFail(img) : null;
      return json(bad ? { ...r, image_error: bad.error, image_service: bad.service ?? null } : r);
    }
    case "mailing_image_check": {
      if (typeof body.url !== "string" || !body.url.trim()) return json({ error: "bad_image_url" }, 400);
      if (!(await rateOk(`admin-mlimg:${ip}`, IMG_CHECK_MAX, IMG_WINDOW))) return json({ error: "rate_limited", retry_after: IMG_WINDOW }, 429);
      const r = await checkMailImage(body.url.trim().slice(0, 500));
      return r.ok ? json({ ok: true, type: r.type, size: r.size }) : json(imageFail(r), 400);
    }
    case "mailing_image_upload": {
      const u = cleanUpload(body.data);
      if (!u.ok) return json({ error: u.error }, 400);
      if (!(await rateOk(`admin-mlup:${ip}`, IMG_UPLOAD_MAX, IMG_WINDOW))) return json({ error: "rate_limited", retry_after: IMG_WINDOW }, 429);
      const name = objectName(u.ext);
      const { error } = await admin.storage.from(MAIL_BUCKET).upload(name, u.bytes, { contentType: u.type, cacheControl: "31536000", upsert: false });
      if (error) {
        const msg = String(error.message ?? "");
        console.error("admin", "image", "upload", /bucket/i.test(msg) && /not.?found/i.test(msg) ? "bucket ontbreekt" : (error as { statusCode?: string }).statusCode ?? "fout");
        return json({ error: /bucket/i.test(msg) && /not.?found/i.test(msg) ? "upload_not_configured" : "upload_failed" }, /not.?found/i.test(msg) ? 503 : 502);
      }
      await audit("mailing_image_upload", ip, null, { type: u.type, size: u.bytes.length });
      return json({ url: publicUrl(env("SUPABASE_URL"), name), type: u.type, size: u.bytes.length });
    }
    case "mailing_test": {
      // testmail naar één adres: nooit het adres loggen of in het logboek zetten
      const to = cleanEmail(body.to);
      if (!to) return json({ error: "bad_email" }, 400);
      const audience = cleanAudience(body.audience);
      if (!audience) return json({ error: "bad_audience" }, 400);
      const lang = cleanTestLang(body.lang);
      if (!lang) return json({ error: "bad_lang" }, 400);
      const c = cleanMailingContent(body.content, lang === "both" ? ["nl", "en"] : [lang]);
      if (!c.ok) return json({ error: c.error }, 400);
      if (c.content.image) { const img = await checkMailImage(c.content.image); if (!img.ok) return json(imageFail(img), 400); }
      // zelfde teller als newsletter_preview: samen max. NL_PREVIEW_MAX per uur
      if (!(await rateOk(`admin-nlpreview:${ip}`, NL_PREVIEW_MAX, NL_PREVIEW_WINDOW))) {
        return json({ error: "rate_limited", retry_after: NL_PREVIEW_WINDOW }, 429);
      }
      const { status, out } = await nlCall("mailing_test", { to, content: c.content, audience, lang });
      if (status !== 200) return json(out, status);
      await audit("mailing_test", ip, null, { lang, audience });
      return json({ ok: true, sent: typeof out.sent === "number" ? out.sent : lang === "both" ? 2 : 1 });
    }
    case "mailing_send": {
      const audience = cleanAudience(body.audience);
      if (!audience) return json({ error: "bad_audience" }, 400);
      // servicebericht (ook naar wie zich afmeldde): alleen met een expliciete bevestiging uit het dashboard
      if (audience === "service" && body.service_ack !== true) return json({ error: "service_ack_required" }, 400);
      const request_id = cleanRequestId(body.request_id);
      if (!request_id) return json({ error: "bad_request_id" }, 400);
      const c = cleanMailingContent(body.content, ["nl", "en"]);
      if (!c.ok) return json({ error: c.error }, 400);
      // nooit een mailing met een afbeelding die niet te laden is (gebroken-afbeelding-vlak bovenaan bij iedereen)
      if (c.content.image) { const img = await checkMailImage(c.content.image); if (!img.ok) return json(imageFail(img), 400); }
      const { status, out } = await nlCall("mailing_send", { request_id, content: c.content, audience, service_ack: audience === "service" });
      if (status !== 200) return json(out, status);
      const a = sendAudit(out, audience);
      if (!a.duplicate) await audit("mailing_send", ip, null, a);
      return json({ ok: true, id: a.id, duplicate: a.duplicate, recipients: a.recipients });
    }
    case "mailing_cancel": {
      const id = cleanMailingId(body.id);
      if (!id) return json({ error: "bad_mailing_id" }, 400);
      const { status, out } = await nlCall("mailing_cancel", { id });
      if (status !== 200) return json(out, status);
      const cancelled = typeof out.cancelled === "number" ? Math.max(0, Math.floor(out.cancelled)) : 0;
      await audit("mailing_cancel", ip, null, { id, cancelled });
      return json({ ok: true, cancelled });
    }
    case "admin_push_register": {
      // pushmeldingen van de Beheer-app op dit apparaat (de cron van de functie push leest admin_push_devices)
      const r = cleanRegister(body);
      if (!r.ok) return json({ error: r.error }, 400);
      if (!(await rateOk(`admin-pushreg:${ip}`, PUSHREG_MAX, PUSHREG_WINDOW))) return json({ error: "rate_limited", retry_after: PUSHREG_WINDOW }, 429);
      const v = r.value;
      // dezelfde APNs-token bij een ander device_id (app opnieuw geïnstalleerd): die rij eerst weg (token is uniek)
      const { error: de } = await admin.from("admin_push_devices").delete().eq("token", v.apns_token).neq("device_id", v.device_id);
      if (de) throw new Error(de.message);
      const { error } = await admin.from("admin_push_devices").upsert({
        device_id: v.device_id, token: v.apns_token, platform: v.platform, sandbox: v.sandbox, prefs: v.prefs,
        app_build: v.app_build, updated_at: new Date().toISOString(), last_error: null,
      }, { onConflict: "device_id" });
      if (error) throw new Error(error.message);
      await audit("admin_push_register", ip, null, { platform: v.platform });
      return json({ ok: true });
    }
    case "admin_push_unregister": {
      const id = cleanDeviceId(body.device_id);
      if (!id) return json({ error: "bad_device_id" }, 400);
      const { data, error } = await admin.from("admin_push_devices").delete().eq("device_id", id).select("platform");
      if (error) throw new Error(error.message);
      await audit("admin_push_unregister", ip, null, { platform: data?.[0]?.platform ?? null });
      return json({ ok: true, removed: (data?.length ?? 0) > 0 });
    }
    case "admin_push_prefs": {
      const id = cleanDeviceId(body.device_id);
      if (!id) return json({ error: "bad_device_id" }, 400);
      const prefs = cleanPrefs(body.prefs);
      if (!prefs) return json({ error: "bad_prefs" }, 400);
      const { data, error } = await admin.from("admin_push_devices").update({ prefs, updated_at: new Date().toISOString() })
        .eq("device_id", id).select("platform");
      if (error) throw new Error(error.message);
      if (!data?.length) return json({ error: "not_registered" }, 404);
      await audit("admin_push_prefs", ip, null, { platform: data[0].platform ?? null });
      return json({ ok: true });
    }
    case "admin_push_test": {
      // testmelding naar alleen dit apparaat, rechtstreeks via APNs (zonder de functie push)
      const id = cleanDeviceId(body.device_id);
      if (!id) return json({ error: "bad_device_id" }, 400);
      if (!apnsConfigured()) return json({ error: "apns_not_configured" }, 503);
      if (!(await rateOk(`admin-pushtest:${ip}`, PUSHTEST_MAX, PUSHTEST_WINDOW))) return json({ error: "rate_limited", retry_after: PUSHTEST_WINDOW }, 429);
      const { data: dev, error } = await admin.from("admin_push_devices").select("token,sandbox,platform").eq("device_id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!dev) return json({ error: "not_registered" }, 404);
      const r = await sendApnsTest(String(dev.token), dev.sandbox === true);
      await audit("admin_push_test", ip, null, { platform: dev.platform ?? null });
      if (r.ok) {
        await admin.from("admin_push_devices").update({ last_error: null }).eq("device_id", id);
        return json({ ok: true });
      }
      if (r.invalid) {
        // token verlopen of hoort niet bij deze app/omgeving: opruimen; de app meldt zich bij de volgende start opnieuw aan
        await admin.from("admin_push_devices").delete().eq("device_id", id);
        return json({ error: "apns_invalid", detail: r.error }, 410);
      }
      await admin.from("admin_push_devices").update({ last_error: r.error.slice(0, 120) }).eq("device_id", id);
      return json({ error: "apns_failed", detail: r.error }, 502);
    }
    case "status": {
      // tab Status: doorgeven aan de functie `status` met het geheim (staat alleen op de server)
      const op = String(body.op ?? "");
      const map: Record<string, string> = {
        overview: "admin", checks: "checks", monitor_save: "monitor_save", monitor_delete: "monitor_delete", run: "run",
        notice_save: "notice_save", notice_update: "notice_update", notice_delete: "notice_delete", subscribers: "subscribers", mail_run: "mail_run",
      };
      if (!map[op]) return json({ error: "unknown_action" }, 400);
      if (!env("STATUS_CRON_SECRET")) return json({ error: "status_not_configured" }, 503);
      const { action: _a, token: _t, op: _o, ...rest } = body;
      const res = await fetch(`${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-status-secret": env("STATUS_CRON_SECRET") },
        body: JSON.stringify({ ...rest, action: map[op], ...(op === "run" ? { force: true, source: "admin" } : {}) }),
        signal: AbortSignal.timeout(60000),
      });
      const out = await res.json().catch(() => ({ error: "server_error" }));
      if (["monitor_save", "monitor_delete", "run", "notice_save", "notice_update", "notice_delete", "mail_run"].includes(op) && res.ok) {
        await audit(`status_${op}`, ip, null, op === "run" ? { checked: out.checked, down: out.down }
          : op === "mail_run" ? { sent: out.sent ?? 0 }
          : op.startsWith("notice_") ? { id: out.id ?? rest.id, status: rest.status, notify: rest.notify !== false } : { id: out.id ?? rest.id });
      }
      return json(out, res.status);
    }
    case "support_counts": case "support_list": case "support_get":
    case "support_reply": case "support_status": case "support_note": case "support_inbox": case "support_poll": {
      // tab Support: doorgeven aan de functie `support` met het geheim (staat alleen op de server)
      if (!env("SUPPORT_ADMIN_SECRET")) return json({ error: "support_not_configured" }, 503);
      const { action: _a, token: _t, ...rest } = body;
      const res = await fetch(`${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-support-secret": env("SUPPORT_ADMIN_SECRET") },
        body: JSON.stringify({ ...rest, action: action.replace(/^support_/, "admin_") }),
        signal: AbortSignal.timeout(60000),
      });
      const out = await res.json().catch(() => ({ error: "server_error" }));
      if (res.status === 403) return json({ error: "support_forbidden" }, 502);
      if (res.status === 404 && !out?.error) return json({ error: "support_not_deployed" }, 503);
      // build 97: inzage van een ticket (met berichten en accountgegevens) in het logboek: alleen het nummer
      if (res.ok && action === "support_get") await audit("support_view", ip, null, { number: rest.number });
      if (res.ok && action === "support_poll") {
        await audit(action, ip, null, { ok: out.ok ?? null, fetched: out.fetched, imported: out.imported, agent: out.agent, new_tickets: out.new_tickets, skipped: out.skipped ? true : undefined });
      }
      if (res.ok && ["support_reply", "support_status", "support_note"].includes(action)) {
        // geen berichttekst in het logboek, alleen wat er gebeurde
        await audit(action, ip, null, {
          number: rest.number, status: out.status ?? undefined, priority: action === "support_status" ? out.priority : undefined,
          email_sent: out.email_sent ?? undefined, length: typeof rest.message === "string" ? rest.message.length : undefined,
        });
      }
      return json(out, res.status);
    }
    case "builds": {
      // tab Downloads: het manifest (alle velden), nooit de sleutel of een token
      const r = await fetchManifest();
      if (!r.ok) return json({ ready: false, platforms: null, reason: r.reason });
      const pk = r.manifest.platforms.presskit;
      const win = r.manifest.platforms.windows;
      const [release_push, pkRaw, winRaw] = await Promise.all([releasePushes(r.manifest), pk ? fetchDownloadStats(PRESSKIT_STATS) : Promise.resolve(null),
        win ? fetchDownloadStats(WINDOWS_STATS) : Promise.resolve(null)]);
      const presskit = pk ? { public_url: PRESSKIT_PUBLIC_URL, stats: presskitStatsView(pkRaw, pk.version) } : null;
      // teller van de Windows-installer telt per build (dl.php gebruikt het buildnummer als "versie")
      const windows_public = win ? { public_url: WINDOWS_PUBLIC_URL, stats: presskitStatsView(winRaw, win.build == null ? null : String(win.build)) } : null;
      return json({ ready: true, platforms: r.manifest.platforms, updated: r.manifest.updated, release_push, presskit, windows_public });
    }
    case "build_push": {
      // knop "Pushmelding versturen" bij een build van apple of android: releasemelding via de functie push (actie
      // release, met PUSH_ADMIN_SECRET). Eén keer per build; wie die build al heeft, krijgt niets.
      const platform = String(body.platform ?? "");
      if (!isReleasePushPlatform(platform)) return json({ error: "no_push_platform" }, 400);
      const file = body.file === undefined || body.file === null || body.file === "" ? undefined : body.file;
      if (file !== undefined && !isValidBuildFile(file)) return json({ error: "bad_file" }, 400);
      if (!(await rateOk(`admin-push:${ip}`, PUSH_MAX, PUSH_WINDOW))) return json({ error: "rate_limited", retry_after: PUSH_WINDOW }, 429);
      const r = await fetchManifest();
      if (!r.ok) {
        if (r.reason === "unreachable") return json({ error: "builds_unreachable" }, 502);
        if (r.reason === "no_builds") return json({ error: "build_not_found" }, 404);
        return json({ error: "builds_not_configured" }, 503);
      }
      const rel = releaseOf(findBuild(r.manifest, platform, file));
      if (!rel) return json({ error: "build_not_found" }, 404);
      const { status, out } = await pushCall("release", { platform_group: platform, version: rel.version, build: rel.build });
      if (status !== 200) return json(out, status);
      const duplicate = out.duplicate === true;
      const devices = typeof out.devices === "number" ? out.devices : null;
      await audit("build_push", ip, null, { platform, build: rel.build, devices, duplicate });
      const missing = Array.isArray(out.missing_channels)
        ? out.missing_channels.filter((x): x is string => typeof x === "string" && /^[a-z0-9_]{1,30}$/.test(x)).slice(0, 5) : [];
      const state = (await releasePushes(r.manifest, [releaseKey(platform, rel.build)]))[`${platform}:${rel.build}`] ?? null;
      return json({ ok: true, duplicate, devices, build: rel.build, missing_channels: missing, push: state });
    }
    case "build_link": {
      const platform = String(body.platform ?? "");
      if (!isBuildPlatform(platform)) return json({ error: "bad_platform" }, 400);
      const file = body.file === undefined || body.file === null || body.file === "" ? undefined : body.file;
      if (file !== undefined && !isValidBuildFile(file)) return json({ error: "bad_file" }, 400);
      const r = await fetchManifest();
      if (!r.ok) {
        if (r.reason === "unreachable") return json({ error: "builds_unreachable" }, 502);
        if (r.reason === "no_builds") return json({ error: "build_not_found" }, 404);
        return json({ error: "builds_not_configured" }, 503);
      }
      // alleen een bestand dat in het manifest staat (nieuwste of history van dit platform)
      const b = findBuild(r.manifest, platform, file);
      if (!b) return json({ error: "build_not_found" }, 404);
      const { token, exp } = await signBuildToken(buildsKey(), `${platform}/${b.file}`, 600);
      // logboek: welk platform en welke build, nooit de link of het token
      await audit("build_link", ip, null, {
        platform, build: typeof b.build === "number" ? b.build : (String(b.build ?? b.version ?? "").slice(0, 20) || null),
        latest: b.file === r.manifest.platforms[platform]?.file,
      });
      return json({ url: buildUrl(token), expires_at: new Date(exp * 1000).toISOString(), file: b.file, size: typeof b.size === "number" ? b.size : null });
    }
    default:
      return json({ error: "unknown_action" }, 400);
  }
}
