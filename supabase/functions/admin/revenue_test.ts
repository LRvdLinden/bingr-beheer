// deno test supabase/functions/admin/revenue_test.ts
// Alleen verzonnen bedragen; geen gegevens per persoon.
import {
  breakdown, buildRevenue, BUCKETS, cleanRate, cleanRows, defaultMode, detailsFromCharge, detailsFromPaymentIntent, detailsPatch, parseRevenue,
  REV_SERIES, revenueCsv, revenuePlan, revenueRange, tileRanges, totals, vatBasis,
} from "./revenue.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const iso = (t: number) => new Date(t).toISOString();
// zondag 18 oktober 2026, 14:37 Nederlandse tijd
const NOW = Date.parse("2026-10-18T12:37:00Z");

Deno.test("aanvraag: periode, bladeren, resolutie en modus", () => {
  eq(parseRevenue({}, NOW), { period: "month", offset: 0, step: "day", mode: null }, "standaard deze maand per dag");
  eq(parseRevenue({ period: "year" }, NOW), { period: "year", offset: 0, step: "month", mode: null }, "jaar per maand");
  eq(parseRevenue({ period: "year", bucket: "week" }, NOW), { period: "year", offset: 0, step: "week", mode: null }, "jaar per week");
  eq(parseRevenue({ period: "week", bucket: "hour", mode: "test" }, NOW), { period: "week", offset: 0, step: "hour", mode: "test" }, "week per uur");
  eq(parseRevenue({ period: "hour" }, NOW), { error: "bad_period" }, "geen uur");
  eq(parseRevenue({ period: "month", bucket: "hour" }, NOW), { error: "bad_bucket" }, "maand niet per uur");
  eq(parseRevenue({ period: "day", offset: 1 }, NOW), { error: "bad_offset" }, "toekomst");
  eq(parseRevenue({ period: "day", offset: 1.5 }, NOW), { error: "bad_offset" }, "geen geheel getal");
  eq(parseRevenue({ period: "year", offset: -10 }, NOW), { error: "bad_offset" }, "te ver terug");
  eq(parseRevenue({ mode: "prod" }, NOW), { error: "bad_mode" }, "modus");
  for (const [p, steps] of Object.entries(BUCKETS)) ok(steps.length >= 1, p);
  eq([defaultMode("sk_live_abc"), defaultMode("rk_test_abc"), defaultMode("")], ["live", "test", "all"], "modus uit de sleutel");
});

Deno.test("periodes: jaar per maand, aansluitend op het vorige jaar", () => {
  const e = revenueRange({ period: "year", step: "month" }, 0, NOW);
  eq([e.length - 1, iso(e[0]), iso(e[3]), iso(e[12])], [12, "2025-12-31T23:00:00.000Z", "2026-03-31T22:00:00.000Z", "2026-12-31T23:00:00.000Z"], "maanden 2026");
  const p = revenuePlan({ period: "year", offset: 0, step: "month", mode: null }, NOW);
  eq([p.prev.length - 1, p.edges.length - 1, p.prev[12] === p.cur[0]], [12, 24, true], "vorige ++ huidige");
  const w = revenuePlan({ period: "week", offset: -1, step: "day", mode: null }, NOW);
  eq([w.cur.length - 1, iso(w.cur[0])], [7, "2026-10-04T22:00:00.000Z"], "vorige week");
  const r = Object.fromEntries(tileRanges(revenuePlan({ period: "month", offset: 0, step: "day", mode: null }, NOW), NOW).map((x) => [x.key, [x.from, x.to]]));
  eq(r.month, ["2026-09-30T22:00:00.000Z", "2026-10-31T23:00:00.000Z"], "deze maand");
  eq(r.prev_month, ["2026-08-31T22:00:00.000Z", "2026-09-30T22:00:00.000Z"], "vorige maand");
  eq(r.year, ["2025-12-31T23:00:00.000Z", "2026-12-31T23:00:00.000Z"], "dit jaar");
  eq(r.period, r.month, "gekozen periode = deze maand");
  // januari: vorige maand is december van het jaar ervoor
  const jan = Object.fromEntries(tileRanges(revenuePlan({ period: "month", offset: 0, step: "day", mode: null }, Date.parse("2027-01-10T10:00:00Z")), Date.parse("2027-01-10T10:00:00Z")).map((x) => [x.key, x.from]));
  eq(jan.prev_month, "2026-11-30T23:00:00.000Z", "december 2026");
});

Deno.test("totalen: netto, opbrengst, terugbetaling excl. btw", () => {
  const t = totals({ count: 3, gross: 1497, vat: 259, fees: 122, refunds: 599, refunds_vat: 104, refund_count: 2, missing_fees: 1, with_tax: 1 });
  eq([t.net, t.refunds_net, t.proceeds], [1238, 495, 1238 - 122 - 495], "afgeleid");
  eq(totals(null), { count: 0, gross: 0, vat: 0, net: 0, fees: 0, refunds: 0, refunds_vat: 0, refunds_net: 0, proceeds: 0, refund_count: 0, dispute_count: 0, missing_fees: 0, with_tax: 0 }, "leeg");
  eq(totals({ gross: 100, vat: 500, refunds: -5 }).vat, 100, "btw nooit meer dan bruto");
});

Deno.test("btw-uitgangspunt: vast tarief, Stripe Tax of gemengd", () => {
  const z = totals({});
  eq(vatBasis(21, false, z).text.startsWith("Btw berekend als 21% NL"), true, "vast");
  ok(vatBasis(21, false, z).text.includes("21/121"), "formule");
  eq(vatBasis(21, true, z).source, "stripe_tax", "Stripe Tax aan, nog geen aankopen");
  eq(vatBasis(21, true, totals({ count: 4, with_tax: 4 })).text, "Btw volgens Stripe Tax", "alles met Stripe Tax");
  eq(vatBasis(9, true, totals({ count: 4, with_tax: 1 })).source, "mixed", "gemengd");
  ok(vatBasis(9, true, totals({ count: 4, with_tax: 1 })).text.includes("9% NL"), "ander tarief");
  eq(vatBasis(99, false, z).rate, 21, "ongeldig tarief");
  ok(vatBasis(21, false, z).note.includes("geen btw-aangifte"), "noot");
});

Deno.test("antwoord: series per tijdvak, toekomst leeg, opbrengst kan negatief", () => {
  const p = revenuePlan({ period: "week", offset: 0, step: "day", mode: null }, NOW);
  const n = p.edges.length - 1; // 14
  const s = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
  const raw = {
    rate: 21, live_count: 2, test_count: 1,
    series: {
      count: s((i) => (i === 7 ? 2 : 0)), gross: s((i) => (i === 7 ? 998 : 0)), vat: s((i) => (i === 7 ? 173 : 0)),
      fees: s((i) => (i === 7 ? 80 : 0)), refunds: s((i) => (i === 8 ? 499 : 0)), refunds_vat: s((i) => (i === 8 ? 87 : 0)),
      refund_count: s((i) => (i === 8 ? 1 : 0)),
    },
    ranges: { all: { count: 2, gross: 998, vat: 173, fees: 80, refunds: 499, refunds_vat: 87, with_tax: 0,
      by_method: [{ key: "ideal", count: 1, gross: 499 }, { key: "apple_pay", count: 1, gross: 499 }, { key: "<script>", count: 1, gross: 1 }],
      by_country: [{ key: "NL", count: 2, gross: 998 }, { key: "nl", count: 1, gross: 1 }] } },
  };
  raw.ranges = { ...raw.ranges, period: raw.ranges.all } as typeof raw.ranges;
  const d = buildRevenue(p, raw, NOW, { mode: "live", stripeTax: false, billing: { enabled: true, mode: "live" } });
  eq(d.series.map((x) => x.key), REV_SERIES.map((x) => x.key), "volgorde");
  const g = (k: string) => d.series.find((x) => x.key === k)!;
  eq(g("gross").values.slice(0, 3), [998, 0, 0], "bruto maandag");
  eq(g("net").values[0], 825, "netto");
  eq(g("proceeds").values[0], 745, "opbrengst = netto − kosten");
  eq(g("proceeds").values[1], -412, "dag met alleen een terugbetaling: − excl. btw");
  eq(g("count").summary?.total, 2, "aankopen");
  eq(d.now_index, 6, "zondag");
  eq([d.has_prev, d.has_next, d.mode, d.empty], [true, false, "live", false], "vlaggen");
  eq(d.totals.all.proceeds, 825 - 80 - 412, "totaal opbrengst");
  eq(d.by_method.map((x) => x.label), ["iDEAL", "Apple Pay"], "methodes (onbekende code weg)");
  eq(d.by_country.map((x) => [x.key, x.label]), [["NL", "Nederland"]], "landen");
  ok(d.vat.text.includes("21% NL"), "btw-tekst");
  ok(!JSON.stringify(d).includes("@"), "geen e-mailadressen");
  // database oud of kapot: niet beschikbaar
  const e = buildRevenue(p, { series: { gross: [1] } }, NOW, { mode: "all", stripeTax: false, billing: { enabled: false, mode: null } });
  eq([e.series[0].available, e.series[0].values.length, e.empty], [false, 0, true], "leeg");
  // volgende week (toekomst) leeg
  const f = buildRevenue(revenuePlan({ period: "month", offset: 0, step: "day", mode: null }, NOW), null, NOW, { mode: "all", stripeTax: false, billing: { enabled: false, mode: null } });
  eq(f.series[0].available, false, "zonder gegevens");
});

Deno.test("CSV: alleen datum, soort, bedragen, methode en land", () => {
  const rows = cleanRows([
    { at: "2026-10-02T10:00:00+00:00", kind: "purchase", amount: 499, vat: 87, fee: 40, method: "ideal", country: "NL", tax: false, email: "x@y.nl", user_id: "u" },
    { at: "2026-10-07T10:00:00+00:00", kind: "refund", amount: -499, vat: -87, fee: 0, method: "card", country: "BE", tax: true },
    { at: "2026-10-08T10:00:00+00:00", kind: "purchase", amount: 499, vat: 87, fee: null, method: "Bad!", country: "Nederland" },
    { at: "kapot", kind: "purchase", amount: 1 },
  ]);
  eq(rows.length, 3, "kapotte datum weg");
  eq(Object.keys(rows[0]).sort(), ["amount", "at", "country", "fee", "kind", "method", "tax", "vat"], "alleen deze velden");
  eq([rows[2].method, rows[2].country, rows[2].fee], [null, null, null], "opgeschoond");
  const csv = revenueCsv(rows);
  const lines = csv.replace("﻿", "").trim().split("\r\n");
  eq(lines.length, 4, "kop + 3");
  eq(lines[1], '"2026-10-02 12:00";"Aankoop";4,99;0,87;4,12;0,40;3,72;"iDEAL";"NL";"berekend"', "aankoop (NL-tijd)");
  eq(lines[2], '"2026-10-07 12:00";"Terugbetaling";-4,99;-0,87;-4,12;0,00;-4,12;"Kaart";"BE";"Stripe Tax"', "terugbetaling");
  eq(lines[3].split(";")[5], "", "kosten onbekend");
  ok(!csv.includes("@") && !csv.includes("user"), "geen persoonsgegevens");
});

Deno.test("backfill: kosten uit de PaymentIntent, btw-tarief", () => {
  const pi = { object: "payment_intent", latest_charge: { object: "charge", id: "ch_1", balance_transaction: { fee: 39, net: 460 },
    payment_method_details: { type: "card", card: { country: "NL", wallet: { type: "apple_pay" } } } } };
  eq(detailsFromPaymentIntent(pi), { chargeId: "ch_1", fee: 39, net: 460, method: "apple_pay", country: "NL" }, "Apple Pay");
  eq(detailsFromCharge({ object: "charge", balance_transaction: "txn_1", payment_method_details: { type: "bancontact", bancontact: {} } })?.fee, null, "nog niet uitgeklapt");
  eq(detailsPatch({ chargeId: null, fee: 39, net: null, method: null, country: null }, "T"), { details_at: "T", updated_at: "T", fee: 39 }, "alleen bekend");
  eq([cleanRate(21), cleanRate("9"), cleanRate("21,5"), cleanRate(0), cleanRate(51), cleanRate("x"), cleanRate(21.123)], [21, 9, 21.5, 0, null, null, null], "tarief");
  eq(breakdown("x", "method"), [], "geen lijst");
});
