// deno test supabase/functions/admin/premium_test.ts
// Build 181 (Bingr Premium): kaart Premium in het beheer (invoer, bevestiging, waarschuwingen, stand, totalen, setup).
// Alleen verzonnen gegevens; geen adressen of echte account-id's.
import { cleanSet, cleanUserId, confirmNeeded, MAILING_DRAFT, phase, setupView, settingsView, statsView, warnings } from "./premium.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const DEF = settingsView({ enabled: false, existing_from: "2026-12-01T00:01:00+01:00", trial_days: 3, show_prices_web: false, grace_days: 3,
  prices: { month: 499, half: 1999, year: 2999, lifetime: 4999 }, stripe_prices: { test: {}, live: {} }, stripe_portal: { test: null, live: null }, test_users: [] });

Deno.test("settingsView: standaard en opschonen", () => {
  eq(DEF.prices, { month: 499, half: 1999, year: 2999, lifetime: 4999 }, "prijzen");
  const v = settingsView({ stripe_prices: { test: { month: "price_a", year: "bad" } }, stripe_portal: { live: "bpc_x" }, test_users: ["x", "00000000-0000-4000-8000-000000000001"] });
  eq(v.stripe_prices.test, { month: "price_a" }, "alleen geldige price-id's");
  eq([v.stripe_portal.live, v.test_users.length, v.enabled], ["bpc_x", 1, false], "portal, testaccounts, uit");
});
Deno.test("cleanSet: grenzen en patch", () => {
  eq(cleanSet({ enabled: "ja" }, DEF), { ok: false, error: "bad_enabled" }, "boolean");
  eq(cleanSet({ trial_days: 15 }, DEF), { ok: false, error: "bad_trial_days" }, "proef max 14");
  eq(cleanSet({ grace_days: -1 }, DEF), { ok: false, error: "bad_grace_days" }, "grace");
  eq(cleanSet({ prices: { lifetime: 2999 } }, DEF), { ok: false, error: "lifetime_not_above_year" }, "lifetime > jaar");
  eq(cleanSet({ prices: { week: 100 } }, DEF), { ok: false, error: "bad_prices" }, "onbekend plan");
  eq(cleanSet({ new_from_web: "morgen" }, DEF), { ok: false, error: "bad_new_from_web" }, "tijd");
  eq(cleanSet({ test_users: [] }, DEF), { ok: false, error: "bad_key" }, "test_users via eigen actie");
  eq(cleanSet({ enabled: true, existing_from: null }, DEF), { ok: false, error: "existing_from_required" }, "aan zonder existing_from");
  const r = cleanSet({ enabled: true, new_from_web: "2026-11-21T12:00:00+01:00", trial_days: 3 }, DEF);
  ok(r.ok && r.changed, "geldig");
  if (r.ok) eq(r.patch, { enabled: true, new_from_web: "2026-11-21T12:00:00+01:00" }, "alleen wat verandert");
  const same = cleanSet({ trial_days: 3 }, DEF);
  ok(same.ok && !same.changed, "niets veranderd");
  const off = cleanSet({ new_from_web: "" }, { ...DEF, new_from_web: "2026-11-21T12:00:00+01:00" });
  ok(off.ok && off.patch.new_from_web === null, "leeg = uit");
});
Deno.test("confirmNeeded", () => {
  const a = { ...DEF, enabled: true, new_from_web: "2026-11-21T12:00:00+01:00", show_prices_web: true, prices: { ...DEF.prices, month: 599 } };
  eq(confirmNeeded(DEF, a), ["enable", "new_from_web", "show_prices", "prices"], "alles met gevolgen");
  eq(confirmNeeded(a, { ...a, new_from_web: null, show_prices_web: false }), [], "uitzetten vraagt niets");
  eq(confirmNeeded(a, { ...a, existing_from: "2026-12-02T00:00:00+01:00", trial_days: 0 }), ["existing_from", "trial"], "verzetten terwijl aan");
});
Deno.test("warnings en stand", () => {
  const ready = { ...DEF.stripe_prices, test: { month: "price_a", half: "price_b", year: "price_c", lifetime: "price_d" } };
  const v = { ...DEF, enabled: true, new_from_web: "2026-11-21T12:00:00+01:00", new_from_apple: "2026-11-20T12:00:00+01:00", existing_from: "2026-11-19T00:00:00+01:00" };
  eq(warnings(v, "test"), ["stripe_not_ready", "apple_before_web", "existing_before_new"], "waarschuwingen");
  eq(warnings({ ...v, stripe_prices: ready, new_from_apple: null, existing_from: "2026-12-01T00:01:00+01:00" }, "test"), [], "klaar");
  eq(warnings({ ...DEF, new_from_web: "2026-11-21T12:00:00+01:00", stripe_prices: ready, test_users: ["00000000-0000-4000-8000-000000000001"] }, "test"), ["dates_without_enabled", "test_users"], "datum zonder hoofdschakelaar");
  eq(phase({ ...v, existing_from: "2026-12-01T00:01:00+01:00" }, Date.parse("2026-11-25T00:00:00Z")), { web: true, apple: true, existing: false, test: 0 }, "stand voor 1 december");
  eq(phase(DEF, Date.parse("2026-12-05T00:00:00Z")), { web: false, apple: false, existing: false, test: 0 }, "uit");
});
Deno.test("statsView en setupView: alleen totalen en Stripe-id's", () => {
  const s = statsView({ active: 3, trialing: 1, mrr_cents: 1747, by: [{ provider: "stripe", plan: "month", active: 2, mrr_cents: 998, email: "x@example.invalid" }],
    monthly: [{ month: "2026-11", mode: "live", count: 1, gross: 499 }, { month: "kapot" }], stripe_revenue: { live: { count: 1, gross: 499 } } });
  eq([s.active, s.trialing, s.mrr_cents, s.by.length, s.monthly.length, s.stripe_revenue.live.gross], [3, 1, 1747, 1, 1, 499], "totalen");
  ok(!JSON.stringify(s).includes("@"), "geen adressen");
  const u = setupView({ ok: true, mode: "test", products: { sub: "bingr_premium", lifetime: "x" }, prices: { month: "price_1", year: "nope" }, portal: "bpc_1", created: ["price_month", "<b>"] });
  eq([u.products.sub, u.products.lifetime, u.prices.month, u.prices.year, u.portal, u.created], ["bingr_premium", null, "price_1", null, "bpc_1", ["price_month"]], "setup");
  eq([cleanUserId("00000000-0000-4000-8000-00000000000A"), cleanUserId("x")], ["00000000-0000-4000-8000-00000000000a", null], "account-id");
});
Deno.test("conceptmailing: NL en EN, binnen de grenzen van Eigen mailing, zonder Apple", () => {
  for (const l of ["nl", "en"] as const) {
    ok(MAILING_DRAFT[l].subject.length <= 150 && MAILING_DRAFT[l].body.length <= 8000 && MAILING_DRAFT[l].button.length <= 40, `grenzen ${l}`);
    ok(!/App Store|Apple/.test(MAILING_DRAFT[l].body), `geen Apple ${l}`);
  }
  ok(MAILING_DRAFT.url.startsWith("https://bingr.online/"), "knop naar de site");
});
