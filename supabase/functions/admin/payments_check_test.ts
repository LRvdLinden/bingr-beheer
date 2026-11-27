import { assertEquals } from "jsr:@std/assert@1";
import { buildDays, buildPaymentsCheck, findMissing, notificationCounts, shortId, stripePaidFrom, type PaymentsInput } from "./payments_check.ts";

const NOW = Date.parse("2026-11-27T18:00:00Z");
const base = (o: Partial<PaymentsInput> = {}): PaymentsInput => ({
  now: NOW, sales: [], lastSalesDate: "2026-11-26", appleSubs: [], applePurchases: [], notifications: [],
  pendingOverHour: 0, incompleteOverDay: 0, pastDue: 0, recorded7d: 0, knownIds: new Set(), stripe: { paid: [], truncated: false }, ...o,
});

Deno.test("dagen: 8 dagen, oudste eerst, verkopen en koppelingen per dag", () => {
  const d = buildDays(base({
    sales: [{ date: "2026-11-25", kind: "sale", units: 2 }, { date: "2026-11-25", kind: "refund", units: 1 }],
    appleSubs: [{ created_at: "2026-11-25T10:00:00Z", user_id: null, claim_notified_at: null }],
    applePurchases: [{ created_at: "2026-11-27T08:00:00Z" }],
  }));
  assertEquals(d.length, 8);
  assertEquals(d[0].date, "2026-11-20");
  assertEquals(d[7].date, "2026-11-27");
  assertEquals(d.find((x) => x.date === "2026-11-25"), { date: "2026-11-25", apple_sold: 2, apple_new: 1, apple_lifetime: 0 });
  assertEquals(d[7].apple_lifetime, 1);
});

Deno.test("alles in orde: verdict ok zonder afwijkingen", () => {
  const r = buildPaymentsCheck(base());
  assertEquals(r.verdict, "ok");
  assertEquals(r.issues, []);
  assertEquals(r.stripe.queried, true);
});

Deno.test("Stripe-betaling die ontbreekt: error, alleen laatste 6 tekens van het id", () => {
  const paid = [{ kind: "checkout" as const, id: "cs_live_abcdef123456", amount_cents: 499, paid_at: "2026-11-26T09:00:00Z" },
    { kind: "invoice" as const, id: "in_known0000", amount_cents: 299, paid_at: "2026-11-26T10:00:00Z" }];
  const r = buildPaymentsCheck(base({ stripe: { paid, truncated: false }, knownIds: new Set(["in_known0000"]) }));
  assertEquals(r.verdict, "attention");
  assertEquals(r.stripe.missing, [{ kind: "checkout", short_id: "123456", amount_cents: 499, paid_at: "2026-11-26T09:00:00Z" }]);
  assertEquals(r.issues[0].level, "error");
  assertEquals(r.issues[0].key, "stripe_missing");
  assertEquals(JSON.stringify(r).includes("abcdef"), false);
});

Deno.test("Stripe niet bevraagd: waarschuwing, geen fout, queried false", () => {
  const r = buildPaymentsCheck(base({ stripe: null, stripeWhy: "no_key" }));
  assertEquals(r.stripe.queried, false);
  assertEquals(r.stripe.paid_in_stripe_7d, null);
  assertEquals(r.issues.map((x) => [x.level, x.key]), [["warn", "stripe_unqueried"]]);
});

Deno.test("Apple: ongekoppeld zonder mail, achterlopende cijfers, meldingen zonder aankoop", () => {
  const r = buildPaymentsCheck(base({
    lastSalesDate: "2026-11-20",
    appleSubs: [{ created_at: "2026-11-26T10:00:00Z", user_id: null, claim_notified_at: null }, { created_at: "2026-11-26T11:00:00Z", user_id: null, claim_notified_at: "2026-11-26T12:00:00Z" }],
    notifications: [{ result: "bad_transaction_x" }, { result: "unknown_purchase" }, { result: "premium_trialing_upsert" }],
  }));
  assertEquals(r.apple.unlinked_7d, 2);
  assertEquals(r.apple.unlinked_no_mail, 1);
  assertEquals(r.apple.notifications_3d, { bad_transaction_x: 1, unknown_purchase: 1, premium_trialing_upsert: 1 });
  assertEquals(r.issues.map((x) => x.key).sort(), ["apple_notify", "apple_sales_stale", "apple_unlinked"]);
});

Deno.test("Apple-verkoop zonder koppeling telt pas na 2 dagen (rapporten lopen achter)", () => {
  const recent = buildPaymentsCheck(base({ sales: [{ date: "2026-11-27", kind: "sale", units: 3 }, { date: "2026-11-26", kind: "sale", units: 1 }] }));
  assertEquals(recent.issues, []);
  const old = buildPaymentsCheck(base({ sales: [{ date: "2026-11-24", kind: "sale", units: 2 }], appleSubs: [{ created_at: "2026-11-24T08:00:00Z", user_id: "x", claim_notified_at: null }] }));
  assertEquals(old.issues.map((x) => x.key), ["apple_sales_gap"]);
});

Deno.test("Stripe hangende zaken geven waarschuwingen", () => {
  const r = buildPaymentsCheck(base({ pendingOverHour: 1, incompleteOverDay: 2, pastDue: 1 }));
  assertEquals(r.issues.map((x) => x.key), ["stripe_pending", "stripe_incomplete", "stripe_past_due"]);
  assertEquals(r.issues.every((x) => x.level === "warn"), true);
});

Deno.test("stripePaidFrom: alleen live, betaald, sessies in modus payment; facturen met bedrag", () => {
  const r = stripePaidFrom(
    { has_more: false, data: [
      { id: "cs_1", livemode: true, mode: "payment", payment_status: "paid", amount_total: 499, created: 1795000000 },
      { id: "cs_2", livemode: true, mode: "subscription", payment_status: "paid", amount_total: 299, created: 1795000000 },
      { id: "cs_3", livemode: false, mode: "payment", payment_status: "paid", amount_total: 499, created: 1795000000 },
      { id: "cs_4", livemode: true, mode: "payment", payment_status: "unpaid", amount_total: 499, created: 1795000000 }] },
    { has_more: true, data: [
      { id: "in_1", livemode: true, status: "paid", amount_paid: 299, created: 1795000000, status_transitions: { paid_at: 1795000100 } },
      { id: "in_2", livemode: true, status: "paid", amount_paid: 0, created: 1795000000 }] });
  assertEquals(r.paid.map((x) => x.id), ["cs_1", "in_1"]);
  assertEquals(r.truncated, true);
});

Deno.test("hulpfuncties", () => {
  assertEquals(shortId("cs_live_abcdef"), "abcdef");
  assertEquals(notificationCounts([{ result: null }, { result: "a" }, { result: "a" }]), { onbekend: 1, a: 2 });
  assertEquals(findMissing([], new Set()), []);
});
