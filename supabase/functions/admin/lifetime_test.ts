// deno test supabase/functions/admin/lifetime_test.ts
// Build 167 (alleen Lifetime): instellingen, bevestiging, totalen, mail en codes. Alleen verzonnen gegevens; geen adressen
// of account-id's.
import {
  assignView, cleanAssign, cleanMailKind, previewView, unclaimedList,
  allView, cleanAll, cleanGenerate, cleanMailLang, cleanMailMode, cleanSettings, codeView, confirmNeeded, DEFAULT_SETTINGS,
  FIXED_CUTOVER, suggestion, generateView, LIFETIME_CALLS, lifetimeCall, mailNeedsConfirm, mailView, settingsAudit, settingsView, statsView,
  warnings, writeValue,
} from "./lifetime.ts";
import { breakdown, buildRevenue, revenuePlan } from "./revenue.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
// vrijdag 6 november 2026, 15:00 Nederlandse tijd
const NOW = Date.parse("2026-11-06T14:00:00Z");
const CUT = "2026-12-06T00:00:00+01:00";

Deno.test("instellingen: standaard en opschonen", () => {
  eq(settingsView(null), DEFAULT_SETTINGS, "niets opgeslagen = standaard (uit)");
  eq(settingsView({ enabled: "ja", discount_pct: 300, trial_days: -1, cutover_at: "morgen" }), DEFAULT_SETTINGS, "rommel = standaard");
  eq(settingsView({ enabled: true, cutover_at: CUT, discount_pct: 25, trial_days: 7 }),
    { ...DEFAULT_SETTINGS, enabled: true, cutover_at: CUT, discount_pct: 25, trial_days: 7 }, "geldige waarden blijven");
  eq(DEFAULT_SETTINGS, { enabled: false, announce_at: null, cutover_at: null, discount_pct: 30, code_valid_until: null, trial_days: 0,
    new_paid_from: null, new_paid_from_apple: null }, "contract (build 168: new_paid_from* standaard null)");
});

Deno.test("voorstel: vaste overgang 1 december 2026 00:00 Amsterdam (aanvulling 2)", () => {
  eq(FIXED_CUTOVER, "2026-12-01T00:00:00+01:00", "vaste datum");
  eq(new Date(FIXED_CUTOVER).toISOString(), "2026-11-30T23:00:00.000Z", "in UTC");
  eq(suggestion(), { suggested_cutover_at: FIXED_CUTOVER, suggested_code_valid_until: FIXED_CUTOVER }, "code geldig tot dezelfde datum");
  const r = cleanSettings({ enabled: true, cutover_at: FIXED_CUTOVER, code_valid_until: FIXED_CUTOVER }, DEFAULT_SETTINGS, NOW);
  ok(r.ok, "voorstel is geldig om aan te zetten");
});

Deno.test("instellingen controleren", () => {
  const cur = DEFAULT_SETTINGS;
  eq(cleanSettings({ enabled: true }, cur, NOW), { ok: false, error: "cutover_required" }, "aan zonder datum");
  eq(cleanSettings({ enabled: true, cutover_at: "2026-11-01T00:00:00+01:00" }, cur, NOW), { ok: false, error: "cutover_past" }, "datum voorbij");
  eq(cleanSettings({ cutover_at: "6 december" }, cur, NOW), { ok: false, error: "bad_cutover_at" }, "geen ISO");
  eq(cleanSettings({ discount_pct: 0 }, cur, NOW), { ok: false, error: "bad_discount_pct" }, "korting 0");
  eq(cleanSettings({ discount_pct: 30.5 }, cur, NOW), { ok: false, error: "bad_discount_pct" }, "geen geheel getal");
  eq(cleanSettings({ trial_days: 91 }, cur, NOW), { ok: false, error: "bad_trial_days" }, "proef te lang");
  eq(cleanSettings({ enabled: 1 }, cur, NOW), { ok: false, error: "bad_enabled" }, "enabled geen bool");
  eq(cleanSettings({ cutover_at: CUT, announce_at: "2026-12-07T00:00:00+01:00" }, cur, NOW), { ok: false, error: "announce_after_cutover" }, "aankondiging na overgang");
  eq(cleanSettings({ cutover_at: CUT, code_valid_until: "2026-12-20T00:00:00+01:00" }, cur, NOW), { ok: false, error: "code_after_cutover" }, "code na overgang");
  const r = cleanSettings({ enabled: true, announce_at: "2026-11-06T15:00:00+01:00", cutover_at: CUT, code_valid_until: CUT }, cur, NOW);
  ok(r.ok, "geldig");
  if (r.ok) eq([r.value.enabled, r.value.discount_pct, r.value.trial_days], [true, 30, 0], "rest blijft standaard");
  // een lopende overgang (al voorbij) mag blijven staan zolang de datum niet verandert
  const live = { ...DEFAULT_SETTINGS, enabled: true, cutover_at: "2026-11-01T00:00:00+01:00" };
  ok(cleanSettings({ trial_days: 3 }, live, NOW).ok, "na de overgang andere velden aanpassen");
  eq(cleanSettings({ cutover_at: null }, live, NOW), { ok: false, error: "cutover_required" }, "datum weghalen terwijl aan");
  ok(cleanSettings({ enabled: false, cutover_at: null }, live, NOW).ok, "uitzetten en datum weg");
  eq(cleanSettings([], cur, NOW), { ok: false, error: "bad_settings" }, "geen object");
});

Deno.test("bevestiging bij gevolgen voor klanten", () => {
  const off = allView(null, null, { apple: false, android: true });
  eq(off, { lifetime_only: DEFAULT_SETTINGS, iap: { apple: false }, upgrade_link: { apple_eu: false } }, "standaard alles uit");
  const on = cleanAll({ lifetime_only: { enabled: true, cutover_at: CUT }, iap: { apple: true }, upgrade_link: { apple_eu: true } }, off, NOW);
  ok(on.ok && on.changed, "geldig en veranderd");
  if (!on.ok) return;
  eq(confirmNeeded(off, on.value), ["enable", "iap_apple", "apple_eu"], "aanzetten, koopknop en EU-link");
  const moved = cleanAll({ lifetime_only: { cutover_at: "2026-12-13T00:00:00+01:00", trial_days: 7 } }, on.value, NOW);
  ok(moved.ok, "verzetten");
  if (moved.ok) eq(confirmNeeded(on.value, moved.value), ["cutover", "trial"], "verzetten terwijl aan");
  const offAgain = cleanAll({ lifetime_only: { enabled: false }, iap: { apple: false } }, on.value, NOW);
  ok(offAgain.ok, "uitzetten");
  if (offAgain.ok) eq(confirmNeeded(on.value, offAgain.value), [], "uitzetten zonder bevestiging");
  const pct = cleanAll({ lifetime_only: { discount_pct: 25 } }, off, NOW);
  if (pct.ok) eq(confirmNeeded(off, pct.value), [], "korting aanpassen terwijl uit");
  const same = cleanAll({ iap: { apple: false } }, off, NOW);
  ok(same.ok && !same.changed, "niets veranderd");
  eq(cleanAll({ iap: { apple: "ja" } }, off, NOW), { ok: false, error: "bad_iap" }, "iap geen bool");
  eq(cleanAll({ upgrade_link: {} }, off, NOW), { ok: false, error: "bad_apple_eu" }, "apple_eu ontbreekt");
  eq(settingsAudit(off, []).confirmed, undefined, "logboek zonder bevestiging");
});

Deno.test("codes: totalen en aanmaken (vormen van bingr_admin_lifetime_stats en billing)", () => {
  const st = statsView({ created: 120, ready: 118, pending_stripe: 2, mailed: 110, mail_error: 3, reminded: 40, remind_error: 1, redeemed: 12,
    expired: 0, candidates: 5, mail_pending: 7, remind_pending: 60, unclaimed: 2 });
  eq(st, { created: 120, ready: 118, pending_stripe: 2, mailed: 110, mail_error: 3, reminded: 40, remind_error: 1, redeemed: 12, expired: 0,
    open: 108, candidates: 5, mail_pending: 7, remind_pending: 60, unclaimed: 2 }, "totalen");
  eq(statsView(null).created, 0, "niets");
  eq(cleanGenerate({}), { dry_run: true, confirm: false }, "standaard droog");
  eq(cleanGenerate({ dry_run: "false" }), { dry_run: true, confirm: false }, "alleen echt false is echt");
  eq(cleanGenerate({ dry_run: false, confirm: true }), { dry_run: false, confirm: true }, "echt");
  const dry = generateView({ ok: true, dry_run: true, candidates: 6, pending_stripe: 1, coupon: "bingr_lifetime_30_20261201",
    valid_until: "2026-12-01T00:00:00+01:00", discount_pct: 30, mode: "live" }, true);
  eq([dry.candidates, dry.pending_stripe, dry.created, dry.done, dry.coupon, dry.mode], [6, 1, 0, true, "bingr_lifetime_30_20261201", "live"], "droog");
  const b1 = generateView({ ok: true, created: 50, stripe_created: 50, stripe_errors: 0, remaining: 12, coupon: "bingr_lifetime_30_20261201", user_ids: ["x"] }, false);
  eq([b1.created, b1.stripe_created, b1.remaining, b1.done], [50, 50, 12, false], "batch, nog niet klaar");
  ok(!JSON.stringify(b1).includes("user_ids"), "geen lijsten in het antwoord");
  eq(generateView({ created: 12, stripe_created: 11, stripe_errors: 1, remaining: 0 }, false).done, true, "klaar bij remaining 0");
  eq(generateView({ coupon: "x y <z>" }, true).coupon, null, "vreemde coupon-id niet doorgeven");
});
Deno.test("mail: modi, bevestiging en alleen aantallen (vormen van lifetime-notice)", () => {
  eq([cleanMailMode(undefined), cleanMailMode("send"), cleanMailMode("remind"), cleanMailMode("preview"), cleanMailMode("all")],
    ["dry_run", "send", "remind", "preview", null], "modi");
  eq([cleanMailLang(undefined), cleanMailLang("en"), cleanMailLang("de")], ["both", "en", null], "taal testmail");
  eq([cleanMailKind(undefined), cleanMailKind("remind"), cleanMailKind("x")], ["notice", "remind", null], "soort mail");
  eq(["dry_run", "test", "send", "remind", "preview"].map((m) => mailNeedsConfirm(m as "send")), [false, false, true, true, false], "versturen vraagt bevestiging");
  const d = mailView({ ok: true, notice_pending: 100, remind_pending: 0, remind_window: false, enabled: true, smtp: true }, "dry_run");
  eq([d.notice_pending, d.remind_window, d.enabled, d.smtp, d.sent, d.done], [100, false, true, true, 0, true], "droog");
  const v = mailView({ ok: true, sent: 50, failed: 1, retry: 0, errors: { smtp_550: 1, "<x@y>": 3 }, remaining: 49, emails: ["niet tonen"] }, "send");
  eq([v.sent, v.failed, v.remaining, v.done, v.errors], [50, 1, 49, false, { smtp_550: 1 }], "batch");
  eq(mailView({ sent: 1, remaining: 0 }, "remind").done, true, "klaar");
  eq(mailView({ sent: 0, retry: 0, remaining: 5 }, "send").done, true, "niets meer te doen: stoppen");
  eq(mailView({ sent: 0, retry: 3, remaining: 5 }, "send").done, false, "tijdelijke fout: nog een ronde");
  ok(!JSON.stringify(v).includes("@") && !JSON.stringify(v).includes("niet tonen"), "geen adressen");
  eq(previewView({ subject: "Bingr wordt Lifetime", html: "<p>x</p>", to: "y" }), { subject: "Bingr wordt Lifetime", html: "<p>x</p>" }, "voorbeeld");
});
Deno.test("code bij de accountdetails (bingr_lifetime_code_of)", () => {
  const base = { code: "BINGR-7K2Q-9FXM", created_at: "2026-11-06T10:00:00Z", expires_at: FIXED_CUTOVER, mailed_at: null, mail_error: null,
    reminded_at: null, redeemed_at: null, status: "ready", stripe_promotion_code_id: "promo_x", purchase_id: 7, user_id: "00000000-0000-4000-8000-000000000000" };
  const v = codeView(base, NOW);
  eq(v?.status, "ready", "status van de server");
  ok(v && !("stripe_promotion_code_id" in v) && !("purchase_id" in v) && !("user_id" in v), "geen Stripe-id's of account-id");
  eq(codeView({ ...base, status: "pending_stripe" }, NOW)?.status, "pending_stripe", "nog niet in Stripe");
  eq(codeView({ ...base, status: undefined, mailed_at: "2026-11-06T11:00:00Z" }, NOW)?.status, "mailed", "afgeleid: gemaild");
  eq(codeView({ ...base, status: "x", mail_error: "smtp 550 <x@y>" }, NOW)?.mail_error, "smtp550xy", "foutcode opgeschoond");
  eq(codeView({ ...base, status: undefined }, Date.parse("2026-12-02T00:00:00Z"))?.status, "expired", "afgeleid: verlopen");
  eq(codeView(null, NOW), null, "geen code");
  eq(codeView({ ...base, code: "bingr-0000" }, NOW), null, "vreemde vorm");
});
Deno.test("namen zoals docs/ACCOUNT.md Build 167", () => {
  eq([LIFETIME_CALLS.secretEnv, LIFETIME_CALLS.header], ["LIFETIME_ADMIN_SECRET", "x-lifetime-secret"], "geheim");
  eq([LIFETIME_CALLS.generate, LIFETIME_CALLS.stats], [{ fn: "billing", action: "admin_codes_generate" }, { fn: "billing", action: "admin_codes_stats" }], "billing");
  eq([LIFETIME_CALLS.mail, LIFETIME_CALLS.preview, LIFETIME_CALLS.mailStats],
    [{ fn: "lifetime-notice", action: "admin_send" }, { fn: "lifetime-notice", action: "admin_preview" }, { fn: "lifetime-notice", action: "admin_stats" }], "lifetime-notice");
  eq(LIFETIME_CALLS.rpc, { settings: "bingr_admin_lifetime_settings", stats: "bingr_admin_lifetime_stats", codeOf: "bingr_lifetime_code_of",
    unclaimed: "bingr_admin_unclaimed", assign: "bingr_admin_purchase_assign" }, "RPC's");
});

Deno.test("doorgeven aan de server: geheim in de header, fouten vertaald", async () => {
  eq(await lifetimeCall("https://x.supabase.co", "", "billing", "a", {}), { status: 503, out: { error: "lifetime_not_configured" } }, "zonder geheim");
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (status: number, body: unknown) => (url: string, init?: RequestInit) => {
    seen = { url, init: init ?? {} };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  const r = await lifetimeCall("https://x.supabase.co/", "geheim", "billing", "admin_codes_generate", { dry_run: true }, fake(200, { eligible: 3 }));
  eq(r, { status: 200, out: { eligible: 3 } }, "ok");
  const s = seen as unknown as { url: string; init: RequestInit };
  eq(s.url, "https://x.supabase.co/functions/v1/billing", "url");
  eq((s.init.headers as Record<string, string>)[LIFETIME_CALLS.header], "geheim", "header");
  eq(JSON.parse(String(s.init.body)), { dry_run: true, action: "admin_codes_generate" }, "body met actie");
  eq((await lifetimeCall("https://x", "g", "billing", "a", {}, fake(403, {}))).out, { error: "lifetime_forbidden" }, "403");
  eq(await lifetimeCall("https://x", "g", "lifetime-notice", "a", {}, fake(404, {})), { status: 503, out: { error: "lifetime_not_deployed" } }, "404");
  eq(await lifetimeCall("https://x", "g", "billing", "a", {}, fake(400, { error: "stripe_unavailable" })), { status: 400, out: { error: "stripe_unavailable" } }, "eigen fout");
  eq((await lifetimeCall("https://x", "g", "billing", "a", {}, fake(500, { error: "Fout met <x@y>" }))).out, { error: "server_error" }, "rare fout");
  eq((await lifetimeCall("https://x", "g", "billing", "a", {}, () => Promise.reject(new TypeError("net")))).out, { error: "lifetime_unreachable" }, "onbereikbaar");
});

Deno.test("omzet per aanbieder (Stripe en Apple)", () => {
  eq(breakdown([{ key: "apple", count: 2, gross: 998 }, { key: "Stripe!", count: 1, gross: 1 }], "provider"),
    [{ key: "apple", label: "Apple (In-app aankoop)", count: 2, gross: 998 }], "geldige sleutels");
  const now = Date.parse("2026-10-18T12:37:00Z");
  const p = revenuePlan({ period: "month", offset: 0, step: "day", mode: null }, now);
  const out = buildRevenue(p, { ranges: { period: { by_provider: [{ key: "apple", count: 1, gross: 499 }, { key: "stripe", count: 3, gross: 1497 }] } } }, now,
    { mode: "all", stripeTax: false, billing: { enabled: false, mode: null } });
  eq(out.by_provider.map((b) => b.key), ["stripe", "apple"], "Stripe eerst");
  eq(out.by_provider_all, [], "ouder schema: leeg");
});

Deno.test("niet geclaimde aankopen: vorm van bingr_admin_unclaimed, nooit e-mail of id's", () => {
  const raw = { total: 3, items: [
    { id: 12, provider: "stripe", created_at: "2026-12-08T09:59:00Z", paid_at: "2026-12-08T10:00:00Z", amount: 499, currency: "eur", status: "paid",
      mode: "live", claim_mailed: true, token_valid: true, has_email_hash: true, claim_email_hash: "ab12", stripe_session_id: "cs_live_abc" },
    { id: 13, provider: "apple", amount: 499, status: "paid", mode: "test", has_email_hash: false },
    { id: "x" },
  ] };
  const v = unclaimedList(raw);
  eq([v.total, v.paid, v.items.length], [3, 2, 2], "aantallen");
  eq(v.items[0], { id: 12, provider: "stripe", status: "paid", amount: 499, currency: "eur", paid_at: "2026-12-08T10:00:00Z",
    created_at: "2026-12-08T09:59:00Z", mode: "live", email_known: true, claim_mailed: true, token_valid: true }, "stripe");
  eq([v.items[1]?.provider, v.items[1]?.mode, v.items[1]?.email_known], ["apple", "test", false], "apple");
  const s = JSON.stringify(v);
  ok(!s.includes("cs_") && !s.includes("ab12"), "geen id's of hashes");
  eq(unclaimedList(null), { total: 0, paid: 0, items: [] }, "leeg");
  eq(cleanAssign({ purchase_id: 12, user_id: "00000000-0000-4000-8000-000000000000" }), { ok: false, error: "confirm_required", status: 409 }, "bevestiging");
  eq(cleanAssign({ purchase_id: 0, user_id: "x", confirm: true }), { ok: false, error: "bad_purchase_id", status: 400 }, "id");
  eq(cleanAssign({ purchase_id: "12", user_id: "nee", confirm: true }), { ok: false, error: "bad_id", status: 400 }, "account");
  eq(cleanAssign({ purchase_id: "12", user_id: "00000000-0000-4000-8000-00000000000A", confirm: true }),
    { ok: true, purchase_id: 12, user_id: "00000000-0000-4000-8000-00000000000a" }, "geldig");
  eq(assignView({ ok: true, result: "assigned" }), { ok: true }, "gekoppeld");
  eq(assignView({ ok: false, result: "not_assignable" }), { ok: false, error: "not_assignable", status: 409 }, "kan niet");
  eq(assignView({ ok: false, result: "no_user" }), { ok: false, error: "not_found", status: 404 }, "geen account");
  eq(assignView(null), { ok: false, error: "assign_failed", status: 502 }, "leeg");
});

// ---------------- build 168: nieuwe accounts eerst kopen ----------------
Deno.test("168: new_paid_from en new_paid_from_apple controleren", () => {
  const live = { ...DEFAULT_SETTINGS, enabled: true, cutover_at: FIXED_CUTOVER };
  const NP = "2026-11-08T12:00:00+01:00";
  eq(settingsView({ new_paid_from: "morgen", new_paid_from_apple: 3 }), DEFAULT_SETTINGS, "rommel = null");
  eq(cleanSettings({ new_paid_from: "8 november" }, live, NOW), { ok: false, error: "bad_new_paid_from" }, "geen ISO");
  eq(cleanSettings({ new_paid_from_apple: "x" }, live, NOW), { ok: false, error: "bad_new_paid_from_apple" }, "geen ISO (Apple)");
  eq(cleanSettings({ new_paid_from: NP }, DEFAULT_SETTINGS, NOW), { ok: false, error: "new_paid_requires_enabled" }, "alleen met Lifetime-only aan");
  ok(cleanSettings({ enabled: true, cutover_at: FIXED_CUTOVER, new_paid_from: NP }, DEFAULT_SETTINGS, NOW).ok, "tegelijk aanzetten mag");
  eq(cleanSettings({ new_paid_from: "2026-12-02T00:00:00+01:00" }, live, NOW), { ok: false, error: "new_paid_after_cutover" }, "na de overgang");
  const r = cleanSettings({ new_paid_from: NP }, live, NOW);
  ok(r.ok && r.value.new_paid_from === NP && r.value.new_paid_from_apple === null, "web en Android apart van Apple");
  ok(cleanSettings({ new_paid_from: "2026-11-01T00:00:00+01:00" }, live, NOW).ok, "datum in het verleden mag (geldt vanaf aanmaken op of na die datum)");
  // uitzetten kan altijd, ook als Lifetime-only uit gaat
  const set = { ...live, new_paid_from: NP };
  ok(cleanSettings({ new_paid_from: null }, set, NOW).ok, "datum weg");
  ok(cleanSettings({ enabled: false }, set, NOW).ok, "Lifetime-only uit met datum blijft mogelijk");
});
Deno.test("168: bevestiging en waarschuwingen", () => {
  const live = allView({ enabled: true, cutover_at: FIXED_CUTOVER }, { apple: false }, {});
  const web = cleanAll({ lifetime_only: { new_paid_from: "2026-11-08T12:00:00+01:00" } }, live, NOW);
  ok(web.ok, "web");
  if (!web.ok) return;
  eq(confirmNeeded(live, web.value), ["new_paid"], "web en Android vraagt bevestiging");
  eq(warnings(web.value), [], "geen waarschuwing voor web");
  const apple = cleanAll({ lifetime_only: { new_paid_from_apple: "2026-11-20T12:00:00+01:00" } }, web.value, NOW);
  ok(apple.ok, "apple");
  if (!apple.ok) return;
  eq(confirmNeeded(web.value, apple.value), ["new_paid_apple"], "Apple apart bevestigen");
  eq(warnings(apple.value), ["new_paid_apple_no_iap"], "Apple-datum zonder koopknop: waarschuwing");
  eq(warnings({ ...apple.value, iap: { apple: true } }), [], "met koopknop geen waarschuwing");
  const off = cleanAll({ lifetime_only: { new_paid_from: null, new_paid_from_apple: null } }, apple.value, NOW);
  if (off.ok) eq(confirmNeeded(apple.value, off.value), [], "uitzetten zonder bevestiging");
  eq(warnings(allView({ enabled: false, new_paid_from: "2026-11-08T12:00:00+01:00" }, {}, {})), ["new_paid_disabled"], "datum zonder Lifetime-only");
});
Deno.test("168: opslaan werkt ook met een database van vóór build 168", () => {
  const cur = settingsView({ enabled: true, cutover_at: FIXED_CUTOVER });
  const w = writeValue({ ...cur, trial_days: 3 }, cur);
  ok(!("new_paid_from" in w) && !("new_paid_from_apple" in w), "null en ongewijzigd: sleutels niet meesturen");
  eq(writeValue({ ...cur, new_paid_from: "2026-11-08T12:00:00+01:00" }, cur).new_paid_from, "2026-11-08T12:00:00+01:00", "gezet: wel");
  const set = { ...cur, new_paid_from: "2026-11-08T12:00:00+01:00" };
  ok("new_paid_from" in writeValue({ ...set, new_paid_from: null }, set), "uitzetten: null meesturen");
});
