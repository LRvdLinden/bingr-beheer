// deno test supabase/functions/admin/apple_revenue_test.ts
// Omzet: Apple (App Store Connect) naast de website. Alleen verzonnen bedragen; geen gegevens per persoon.
import {
  addTotals, appleCsvLines, appleSeries, appleStatusText, appleTotals, cleanAppleRows, cleanCommission, cleanFxInput, cleanSalesRange,
  combinedCsv, commissionOf, exVat, mergeApple, refreshView,
} from "./apple_revenue.ts";
import { buildRevenue, cleanRows, revenueCsv, revenuePlan, tileRanges, totals } from "./revenue.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
// zondag 18 oktober 2026, 14:37 Nederlandse tijd
const NOW = Date.parse("2026-10-18T12:37:00Z");

Deno.test("rekenen: prijs zonder btw uit de opbrengst en de commissie; commissie = zonder btw − opbrengst", () => {
  // NL: 4,99 incl. 21% btw = 4,12 zonder btw; 15% commissie = 0,62; opbrengst 3,50
  eq(exVat(350, 499, 15), 412, "4,12 zonder btw");
  eq(exVat(350, 499, 30), 499, "nooit meer dan bruto");
  eq([commissionOf(30), commissionOf(80), commissionOf("x"), commissionOf(0)], [30, 15, 15, 0], "commissie 0–50, anders 15");
  const t = appleTotals({ units: 4, gross: 1996, proceeds: 1400, refund_units: 1, refunds: 499, refund_proceeds: 350, linked: 3,
    unconverted: [{ currency: "USD", units: 2, refund_units: 0 }, { currency: "<x>", units: 1 }] }, 15);
  eq([t.count, t.gross, t.net, t.vat], [4, 1996, 1647, 349], "bruto, zonder btw, btw");
  eq([t.commission_gross, t.commission_back, t.fees], [247, 62, 185], "commissie − terug bij terugbetaling");
  eq([t.refunds, t.refunds_net, t.refunds_vat, t.refund_count], [499, 412, 87, 1], "terugbetaald");
  eq(t.proceeds, 1400 - 350, "netto opbrengst = opbrengst − teruggenomen opbrengst");
  eq(t.net - t.fees - t.refunds_net, t.proceeds, "zelfde formule als de website");
  eq([t.linked, t.unconverted], [3, [{ currency: "USD", units: 2, refund_units: 0 }]], "gekoppeld en niet omgerekend");
  const e = appleTotals(null, 15);
  eq([e.count, e.gross, e.proceeds, e.fees], [0, 0, 0, 0], "leeg");
  const sum = addTotals(totals({ count: 1, gross: 499, vat: 87, fees: 37 }), t);
  eq([sum.count, sum.gross, sum.fees, sum.proceeds], [5, 2495, 222, 412 - 37 + 1050], "website + Apple");
});

Deno.test("invoer: koersen, commissie en bereik", () => {
  eq(cleanFxInput({ usd: "0,92", GBP: 1.15 }), { USD: 0.92, GBP: 1.15 }, "koersen");
  eq(cleanFxInput({}), {}, "leeg mag (alles wissen)");
  for (const bad of [null, [], { EUR: 1 }, { USD: 0 }, { USD: -1 }, { US: 1 }, { USD: "abc" }, { USD: 0.1234567 }, { USD: 100000 }]) eq(cleanFxInput(bad), null, JSON.stringify(bad));
  eq(cleanFxInput(Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, 1]))), null, "max. 60");
  eq([cleanCommission(15), cleanCommission("30"), cleanCommission("15,5"), cleanCommission(51), cleanCommission(-1), cleanCommission("x")], [15, 30, 15.5, null, null, null], "commissie");
  eq(cleanSalesRange("2026-10-01", "2026-10-17", NOW), { from: "2026-10-01", to: "2026-10-17", days: 17 }, "bereik");
  eq(cleanSalesRange("2026-10-19", "2026-10-19", NOW), { error: "bad_range" }, "toekomst");
  eq(cleanSalesRange("2026-10-10", "2026-10-01", NOW), { error: "bad_range" }, "omgekeerd");
  eq(cleanSalesRange("2026-02-30", "2026-03-01", NOW), { error: "bad_range" }, "geen datum");
  eq(cleanSalesRange("2025-10-18", "2026-10-18", NOW), { error: "range_too_long" }, "366 dagen");
  eq((cleanSalesRange("2025-10-19", "2026-10-18", NOW) as { days: number }).days, 365, "365 dagen mag");
});

Deno.test("antwoord van apple-sales: alleen aantallen en de datum", () => {
  eq(refreshView({ configured: true, days: 7, ok: 3, empty: 2, not_ready: 1, failed: 1, rows: 9, through: "2026-10-17", vendor: "80000000" }),
    { configured: true, days: 7, ok: 3, empty: 2, not_ready: 1, failed: 1, rows: 9, through: "2026-10-17", error: null }, "aantallen");
  eq(refreshView({ configured: false }).configured, false, "niet ingesteld");
  eq(refreshView({ configured: true, error: "asc_unauthorized" }).error, "asc_unauthorized", "sleutel geweigerd");
  ok(!JSON.stringify(refreshView({ vendor: "80000000", key: "abc" })).includes("80000000"), "nooit het vendornummer");
});

Deno.test("samen: totalen, series (website + Apple), per aanbieder, land en methode, bijgewerkt t/m", () => {
  const p = revenuePlan({ period: "week", offset: 0, step: "day", mode: null }, NOW);
  const n = p.edges.length - 1; // 14
  const s = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
  const webRange = { count: 1, gross: 499, vat: 87, fees: 37, refunds: 0, refunds_vat: 0, with_tax: 0,
    by_method: [{ key: "ideal", count: 1, gross: 499 }], by_country: [{ key: "NL", count: 1, gross: 499 }],
    by_provider: [{ key: "stripe", count: 1, gross: 499 }] };
  const web = buildRevenue(p, {
    rate: 21, live_count: 1, test_count: 0,
    series: { count: s((i) => (i === 7 ? 1 : 0)), gross: s((i) => (i === 7 ? 499 : 0)), vat: s((i) => (i === 7 ? 87 : 0)), fees: s((i) => (i === 7 ? 37 : 0)),
      refunds: s(() => 0), refunds_vat: s(() => 0), refund_count: s(() => 0) },
    ranges: Object.fromEntries(tileRanges(p, NOW).map((r) => [r.key, webRange])),
  }, NOW, { mode: "live", stripeTax: false, billing: { enabled: true, mode: "live" } });
  const appleRange = { units: 2, gross: 998, proceeds: 700, refund_units: 0, refunds: 0, refund_proceeds: 0, linked: 1,
    unconverted: [{ currency: "USD", units: 1, refund_units: 0 }], by_country: [{ key: "NL", count: 1, gross: 499 }, { key: "BE", count: 1, gross: 499 }] };
  const raw = {
    commission: 15, fx_rates: { USD: 0.92, bad: 1 }, rows: 3, first_date: "2026-10-01", last_date: "2026-10-17",
    status: { through: "2026-10-17", last_run: { at: "2026-10-18T13:37:00Z", action: "run", ok: 5, empty: 1, not_ready: 1, failed: 0 } },
    series: { units: s((i) => (i === 8 ? 2 : 0)), gross: s((i) => (i === 8 ? 998 : 0)), proceeds: s((i) => (i === 8 ? 700 : 0)),
      refund_units: s(() => 0), refunds: s(() => 0), refund_proceeds: s(() => 0) },
    ranges: Object.fromEntries(tileRanges(p, NOW).map((r) => [r.key, appleRange])),
  };
  const d = mergeApple(web, p, raw, NOW, { configured: true });
  eq([d.totals.all.count, d.totals.all.gross], [3, 1497], "totaal = website + Apple");
  eq(d.sources.web.all.gross, 499, "website apart");
  eq([d.sources.apple.all.gross, d.sources.apple.all.net, d.sources.apple.all.fees, d.sources.apple.all.proceeds], [998, 824, 124, 700], "Apple apart");
  eq(d.totals.all.proceeds, (499 - 87 - 37) + 700, "netto opbrengst totaal");
  const g = (k: string) => d.series.find((x) => x.key === k)!;
  eq(g("gross").values.slice(0, 3), [499, 998, 0], "bruto per dag: ma website, di Apple");
  eq(g("web_gross").values.slice(0, 2), [499, 0], "reeks Website");
  eq(g("apple_gross").values.slice(0, 2), [0, 998], "reeks Apple");
  eq([g("apple_gross").values.length, g("apple_gross").prev_values.length], [7, 7], "deze en vorige week");
  eq(g("count").summary?.total, 3, "aankopen");
  eq(d.by_provider.map((b) => [b.key, b.count, b.gross]), [["stripe", 1, 499], ["apple", 2, 998]], "per aanbieder uit het rapport");
  eq(d.by_country.map((b) => [b.key, b.gross]), [["NL", 998], ["BE", 499]], "per land samen");
  eq(d.by_method.map((b) => b.key), ["app_store", "ideal"], "App Store als methode");
  eq([d.apple.through, d.apple.linked_all, d.apple.unconverted.map((u) => u.currency), d.apple.fx_rates], ["2026-10-17", 1, ["USD"], { USD: 0.92 }], "info");
  ok(d.apple.text.startsWith("Apple bijgewerkt t/m 17 oktober 2026"), d.apple.text);
  eq(d.apple.last_run?.ok, 5, "laatste ronde");
  ok(!d.empty, "niet leeg");
  // zonder Apple-gegevens: website gelijk, Apple 0
  const z = mergeApple(web, p, { commission: 15, ranges: {}, series: {} }, NOW, { configured: false });
  eq([z.totals.all.gross, g("gross").values.length, z.series.find((x) => x.key === "gross")!.values[0]], [499, 7, 499], "geen Apple");
  eq(z.by_provider.map((b) => b.key), ["stripe"], "alleen Stripe");
  ok(z.apple.text.includes("nog niet ingesteld"), "tekst niet ingesteld");
  eq(appleStatusText(true, null), "Apple nog niet bijgewerkt.", "nog niets");
  eq(appleSeries({ series: { gross: [1] } }, 14, 15), null, "series ontbreken");
});

Deno.test("CSV: website en Apple, Apple-regels met afgeleide btw en commissie; niet omgerekend apart", () => {
  const webRows = cleanRows([{ at: "2026-10-12T10:00:00Z", kind: "purchase", amount: 499, vat: 87, fee: 37, method: "ideal", country: "NL", tax: false }]);
  const apple = cleanAppleRows([
    { day: "2026-10-13", kind: "sale", country: "NL", units: 2, customer_currency: "EUR", proceeds_currency: "EUR", customer_price: 4.99, developer_proceeds: 3.5, gross: 998, proceeds: 700 },
    { day: "2026-10-13", kind: "refund", country: "NL", units: 1, customer_currency: "EUR", proceeds_currency: "EUR", customer_price: 4.99, developer_proceeds: 3.5, gross: 499, proceeds: 350 },
    { day: "2026-10-13", kind: "sale", country: "US", units: 1, customer_currency: "USD", proceeds_currency: "USD", customer_price: 4.99, developer_proceeds: 4.24, gross: null, proceeds: null },
    { day: "kapot", kind: "sale", country: "US", units: 1, customer_currency: "USD", proceeds_currency: "USD" },
  ]);
  eq(apple.length, 3, "ongeldige regel weg");
  const lines = appleCsvLines(apple, 15);
  eq(lines[0], '"2026-10-13";"Apple-verkoop";9,98;1,74;8,24;1,24;7,00;"App Store";"NL";"afgeleid (commissie 15%)";"Apple (App Store)";2', "verkoop");
  ok(lines[1].includes('"Apple-terugbetaling";-4,99;') && lines[1].endsWith(";-1"), "terugbetaling negatief");
  ok(lines[2].includes("niet omgerekend: 1 × 4,99 USD"), "niet omgerekend");
  const csv = combinedCsv(revenueCsv(webRows), webRows, apple, 15);
  const rows = csv.replace(/^﻿/, "").trim().split("\r\n");
  eq(rows.length, 1 + 1 + 3, "kop + website + Apple");
  ok(rows[0].includes('"kosten (Stripe / Apple-commissie)"') && rows[0].endsWith('"aanbieder";"aantal"'), "kop");
  ok(rows[1].endsWith(';"Website (Stripe)";1'), "website-regel");
  ok(csv.startsWith("﻿"), "BOM voor Excel");
});
