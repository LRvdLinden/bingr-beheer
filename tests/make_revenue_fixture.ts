// Maakt tests/fixtures/revenue_apple.json: een antwoord van de actie revenue (website + Apple) met verzonnen bedragen,
// voor de dashboard-rooktest (tests/dashboard_smoke.py). Opnieuw maken na een wijziging aan revenue.ts of apple_revenue.ts:
//   deno run --allow-write=tests/fixtures tests/make_revenue_fixture.ts
import { buildRevenue, revenuePlan, tileRanges } from "../supabase/functions/admin/revenue.ts";
import { mergeApple } from "../supabase/functions/admin/apple_revenue.ts";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const p = revenuePlan({ period: "month", offset: 0, step: "day", mode: null }, NOW);
const n = p.edges.length - 1;
const s = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
const web = buildRevenue(p, {
  rate: 21, live_count: 4, test_count: 1,
  series: { count: s((i) => i % 5 === 0 ? 1 : 0), gross: s((i) => i % 5 === 0 ? 499 : 0), vat: s((i) => i % 5 === 0 ? 87 : 0),
    fees: s((i) => i % 5 === 0 ? 37 : 0), refunds: s(() => 0), refunds_vat: s(() => 0), refund_count: s(() => 0) },
  ranges: Object.fromEntries(tileRanges(p, NOW).map((r) => [r.key, { count: 4, gross: 1996, vat: 348, fees: 148, refunds: 499, refunds_vat: 87,
    refund_count: 1, with_tax: 0, by_method: [{ key: "ideal", count: 4, gross: 1996 }], by_country: [{ key: "NL", count: 4, gross: 1996 }],
    by_provider: [{ key: "stripe", count: 4, gross: 1996 }] }])),
}, NOW, { mode: "live", stripeTax: false, billing: { enabled: true, mode: "live" } });
const d = mergeApple(web, p, {
  commission: 15, fx_rates: { USD: 0.92 }, rows: 6, first_date: "2026-10-01", last_date: "2026-11-05",
  status: { through: "2026-11-05", last_run: { at: "2026-11-06T14:37:00Z", action: "run", ok: 5, empty: 1, not_ready: 1, failed: 0 } },
  series: { units: s((i) => i % 3 === 0 ? 2 : 0), gross: s((i) => i % 3 === 0 ? 998 : 0), proceeds: s((i) => i % 3 === 0 ? 700 : 0),
    refund_units: s(() => 0), refunds: s(() => 0), refund_proceeds: s(() => 0) },
  ranges: Object.fromEntries(tileRanges(p, NOW).map((r) => [r.key, { units: 6, gross: 2994, proceeds: 2100, refund_units: 1, refunds: 499,
    refund_proceeds: 350, linked: 4, unconverted: [{ currency: "JPY", units: 1, refund_units: 0 }],
    by_country: [{ key: "NL", count: 4, gross: 1996 }, { key: "BE", count: 2, gross: 998 }] }])),
}, NOW, { configured: true });
await Deno.writeTextFile("tests/fixtures/revenue_apple.json", JSON.stringify(d, null, 1) + "\n");
