// Omzet: Apple (App Store Connect) naast de website (Stripe) in de tab Omzet, web en app. Eigen bestand naast revenue.ts:
// pure hulpjes zonder netwerk of database, getest in apple_revenue_test.ts. De cijfers van Apple komen uit
// apple_sales_daily (dagrapporten van Sales and Trends, functie apple-sales in iptv-ios-appletv) via
// bingr_admin_revenue_apple; de website uit bingr_admin_revenue met modus web_* (alleen Stripe). billing_purchases met
// provider apple blijft alleen voor de koppeling aan accounts (hier `linked`).
//
// Rekenen (docs/ACCOUNT.md, "Omzet: Apple (App Store Connect)"): Apple geeft per stuk de klantprijs (incl. btw, in de
// valuta van de klant) en de opbrengst (developer proceeds, na btw en commissie). De btw per land kennen we niet, de
// commissie wel (app_settings.apple_commission, 15% in het Small Business Program, anders 30%) en die gaat over de prijs
// zonder btw. Dus: prijs zonder btw = opbrengst / (1 − commissie), btw = bruto − prijs zonder btw, Apple-commissie =
// prijs zonder btw − opbrengst. Netto opbrengst = opbrengst verkopen − opbrengst terugbetalingen (precies wat Apple
// uitbetaalt, op afronding en wisselkoers na). Bedragen in een andere valuta dan EUR alleen met een vaste koers
// (app_settings.fx_rates); zonder koers tellen ze niet mee en staan ze apart (`unconverted`).
import { summarize } from "./insights.ts";
import { breakdown, type Breakdown, type RevenueOut, type RevenuePlan, type RevenueRow, type RevMode, type RevSeriesOut, type Totals } from "./revenue.ts";

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : 0);
const pos = (v: unknown) => Math.max(0, int(v));
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** Commissie in % (0–50); ongeldig = 15. */
export function commissionOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : 15;
}
/** Prijs zonder btw uit de opbrengst (nooit meer dan bruto). */
export function exVat(proceeds: number, gross: number, commission: number): number {
  const c = commissionOf(commission) / 100;
  return Math.min(gross, Math.round(proceeds / (1 - c)));
}

export type AppleTotals = Totals & {
  /** wat Apple uitbetaalt voor de verkopen / wat Apple terugneemt bij terugbetalingen (eurocent) */
  apple_proceeds: number; refund_proceeds: number; commission_gross: number; commission_back: number;
  /** aantal Apple-aankopen dat in die periode via apple_verify aan een account gekoppeld is */
  linked: number;
  unconverted: { currency: string; units: number; refund_units: number }[];
};
/** Totalen van Apple in dezelfde vorm als de website (Totals), uit bingr_apple_sales_sum. */
export function appleTotals(raw: unknown, commission: number): AppleTotals {
  const o = obj(raw);
  const gross = pos(o.gross), p = pos(o.proceeds), refunds = pos(o.refunds), rp = pos(o.refund_proceeds);
  const net = exVat(p, gross, commission), rn = exVat(rp, refunds, commission);
  const commGross = Math.max(0, net - p), commBack = Math.max(0, rn - rp);
  const unconverted = Array.isArray(o.unconverted) ? o.unconverted.slice(0, 50).flatMap((u) => {
    const x = obj(u), c = String(x.currency ?? "");
    return /^[A-Z]{3}$/.test(c) ? [{ currency: c, units: pos(x.units), refund_units: pos(x.refund_units) }] : [];
  }) : [];
  return {
    count: pos(o.units), gross, vat: gross - net, net, fees: commGross - commBack, refunds, refunds_vat: refunds - rn, refunds_net: rn,
    proceeds: p - rp, refund_count: pos(o.refund_units), dispute_count: 0, missing_fees: 0, with_tax: 0,
    apple_proceeds: p, refund_proceeds: rp, commission_gross: commGross, commission_back: commBack, linked: pos(o.linked), unconverted,
  };
}
const KEYS = ["count", "gross", "vat", "net", "fees", "refunds", "refunds_vat", "refunds_net", "proceeds", "refund_count", "dispute_count", "missing_fees", "with_tax"] as const;
/** Website + Apple (totaal). */
export function addTotals(a: Totals, b: Totals): Totals {
  const out = {} as Totals;
  for (const k of KEYS) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return out;
}

/** Series van Apple per tijdvak (lengte n = vorige + huidige periode), afgeleid zoals appleTotals. null = ontbreekt. */
export function appleSeries(raw: unknown, n: number, commission: number): Record<string, number[]> | null {
  const sr = obj(obj(raw).series);
  const arr = (k: string) => (Array.isArray(sr[k]) && (sr[k] as unknown[]).length === n ? (sr[k] as unknown[]).map(pos) : null);
  const g = arr("gross"), p = arr("proceeds"), u = arr("units"), r = arr("refunds"), rp = arr("refund_proceeds"), ru = arr("refund_units");
  if (!g || !p || !u || !r || !rp || !ru) return null;
  const net = g.map((x, i) => exVat(p[i], x, commission)), rn = r.map((x, i) => exVat(rp[i], x, commission));
  return {
    gross: g, vat: g.map((x, i) => x - net[i]), net, fees: net.map((x, i) => Math.max(0, x - p[i]) - Math.max(0, rn[i] - rp[i])),
    refunds: r, proceeds: p.map((x, i) => x - rp[i]), count: u, refund_count: ru,
  };
}

export const APPLE_SOURCE_SERIES = [
  // bruto (incl. btw) van de website en van Apple als extra reeksen in de geldgrafiek
  { key: "web_gross", label: "Website" },
  { key: "apple_gross", label: "Apple" },
] as const;

export type AppleInfo = {
  /** function-secrets ASC_* gezet (de functie admin ziet alleen of ze er zijn, nooit de waarde) */
  configured: boolean;
  rows: number; first_date: string | null; last_date: string | null;
  /** "Apple bijgewerkt t/m" (laatste dag met een rapport of zonder verkopen) */
  through: string | null;
  last_run: { at: string | null; action: string | null; ok: number; empty: number; not_ready: number; failed: number } | null;
  commission: number; fx_rates: Record<string, number>;
  unconverted: AppleTotals["unconverted"]; unconverted_all: AppleTotals["unconverted"];
  linked: number; linked_all: number;
  text: string;
};
export type RevenueWithApple = RevenueOut & {
  sources: { web: Record<string, Totals>; apple: Record<string, AppleTotals> };
  apple: AppleInfo;
};
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymdOr = (v: unknown) => (typeof v === "string" && YMD.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
export function cleanFxView(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v)).slice(0, 200)) {
    const n = typeof x === "number" ? x : NaN;
    if (/^[A-Z]{3}$/.test(k) && k !== "EUR" && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/**
 * Website (uit buildRevenue met modus web_*) en Apple (bingr_admin_revenue_apple) samen: totalen en series zijn het
 * totaal (website + Apple), `sources` per bron, by_provider/by_country met Apple uit de rapporten, en de series
 * web_gross / apple_gross voor de grafiek.
 */
export function mergeApple(web: RevenueOut, p: RevenuePlan, raw: unknown, now: number, opts: { configured: boolean }): RevenueWithApple {
  const data = obj(raw), commission = commissionOf(data.commission);
  const np = p.prev.length - 1, nc = p.cur.length - 1, n = np + nc;
  const rg = obj(data.ranges);
  const appleT: Record<string, AppleTotals> = {}, webT: Record<string, Totals> = {}, total: Record<string, Totals> = {};
  for (const k of Object.keys(web.totals)) {
    appleT[k] = appleTotals(rg[k], commission);
    webT[k] = web.totals[k];
    total[k] = addTotals(web.totals[k], appleT[k]);
  }
  // series: website per tijdvak (vorige ++ huidige; null = toekomst) + Apple
  const aS = appleSeries(raw, n, commission);
  const at = (edges: number[], i: number, x: number): number | null => (edges[i] > now ? null : x);
  const series: RevSeriesOut[] = web.series.map((s) => {
    const a = aS?.[s.key];
    if (!s.available || !a) return s;
    const prev = s.prev_values.map((v, i) => (v === null ? null : v + a[i]));
    const values = s.values.map((v, i) => (v === null ? null : v + a[np + i]));
    return { ...s, prev_values: prev, values, summary: summarize(values, prev, "sum") };
  });
  const webGross = web.series.find((s) => s.key === "gross");
  if (webGross?.available) {
    const g = aS?.gross ?? new Array(n).fill(0);
    const mk = (key: string, label: string, pv: (number | null)[], v: (number | null)[]): RevSeriesOut => ({
      key, label, agg: "sum", money: true, down: false, available: true, values: v, prev_values: pv, summary: summarize(v, pv, "sum"),
    });
    const pa = Array.from({ length: np }, (_, i) => at(p.prev, i, g[i])), ca = Array.from({ length: nc }, (_, i) => at(p.cur, i, g[np + i]));
    series.push(mk("web_gross", APPLE_SOURCE_SERIES[0].label, webGross.prev_values, webGross.values));
    series.push(mk("apple_gross", APPLE_SOURCE_SERIES[1].label, pa, ca));
  }
  const prov = (wb: Breakdown[], a: AppleTotals): Breakdown[] => {
    const out = wb.filter((b) => b.key !== "apple");
    if (a.count || a.gross) out.push({ key: "apple", label: "Apple (App Store)", count: a.count, gross: a.gross });
    return out.filter((b) => b.count || b.gross);
  };
  // per land: website + Apple
  const countries = new Map<string, Breakdown>();
  for (const b of [...web.by_country, ...breakdown(obj(rg.period).by_country, "country")]) {
    const c = countries.get(b.key);
    if (c) { c.count += b.count; c.gross += b.gross; } else countries.set(b.key, { ...b });
  }
  const ap = appleT.period;
  const byMethod = [...web.by_method, ...(ap.count ? [{ key: "app_store", label: "App Store (Apple)", count: ap.count, gross: ap.gross }] : [])]
    .sort((a, b) => b.gross - a.gross);
  const st = obj(data.status), lr = st.last_run && typeof st.last_run === "object" ? obj(st.last_run) : null;
  const through = ymdOr(st.through);
  const info: AppleInfo = {
    configured: opts.configured, rows: pos(data.rows), first_date: ymdOr(data.first_date), last_date: ymdOr(data.last_date), through,
    last_run: lr ? {
      at: typeof lr.at === "string" ? lr.at : null, action: typeof lr.action === "string" ? lr.action : null,
      ok: pos(lr.ok), empty: pos(lr.empty), not_ready: pos(lr.not_ready), failed: pos(lr.failed),
    } : null,
    commission, fx_rates: cleanFxView(data.fx_rates),
    unconverted: appleT.period.unconverted, unconverted_all: appleT.all.unconverted,
    linked: appleT.period.linked, linked_all: appleT.all.linked,
    text: appleStatusText(opts.configured, through),
  };
  const all = total.all;
  return {
    ...web, mode: web.mode as RevMode, series, totals: total,
    by_provider: prov(web.by_provider, appleT.period), by_provider_all: prov(web.by_provider_all, appleT.all),
    by_method: byMethod, by_country: [...countries.values()].sort((a, b) => b.gross - a.gross || a.key.localeCompare(b.key)),
    empty: all.count === 0 && all.refunds === 0,
    sources: { web: webT, apple: appleT }, apple: info,
  };
}

const NL_DATE = new Intl.DateTimeFormat("nl-NL", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
export function appleStatusText(configured: boolean, through: string | null): string {
  if (!configured) return "Apple-omzet is nog niet ingesteld (App Store Connect-secrets in iptv-ios-appletv, workflow Backend).";
  if (!through) return "Apple nog niet bijgewerkt.";
  return `Apple bijgewerkt t/m ${NL_DATE.format(new Date(`${through}T00:00:00Z`))}`;
}

// ---- invoer van het beheer ----
/** revenue_apple_set: vaste koersen (EUR per 1 eenheid; max. 60 valuta, 0 < koers < 100000, max. 6 decimalen). */
export function cleanFxInput(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const e = Object.entries(v as Record<string, unknown>);
  if (e.length > 60) return null;
  const out: Record<string, number> = {};
  for (const [k0, x] of e) {
    const k = k0.trim().toUpperCase();
    const n = typeof x === "number" ? x : Number(String(x ?? "").replace(",", ".").trim());
    if (!/^[A-Z]{3}$/.test(k) || k === "EUR" || !Number.isFinite(n) || n <= 0 || n >= 100000) return null;
    if (Math.abs(Math.round(n * 1e6) - n * 1e6) > 1e-3) return null;
    out[k] = Math.round(n * 1e6) / 1e6;
  }
  return out;
}
/** Commissie 0–50 (meestal 15 of 30), hoogstens 2 decimalen. */
export function cleanCommission(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) && n >= 0 && n <= 50 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? Math.round(n * 100) / 100 : null;
}
const YMD_OK = (v: unknown): v is string => typeof v === "string" && YMD.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
/** apple_sales_refresh: from..to (YYYY-MM-DD, inclusief), niet in de toekomst, hoogstens 365 dagen. */
export function cleanSalesRange(from: unknown, to: unknown, now = Date.now()): { from: string; to: string; days: number } | { error: string } {
  if (!YMD_OK(from) || !YMD_OK(to) || from > to || to > new Date(now).toISOString().slice(0, 10)) return { error: "bad_range" };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
  return days > 365 ? { error: "range_too_long" } : { from, to, days };
}
/** Antwoord van apple-sales voor het beheer: alleen aantallen en de datum. */
export function refreshView(out: unknown): { configured: boolean; days: number; ok: number; empty: number; not_ready: number; failed: number; rows: number; through: string | null; error: string | null } {
  const o = obj(out);
  const err = typeof o.error === "string" && /^[a-z_]{1,40}$/.test(o.error) ? o.error : null;
  return {
    configured: o.configured !== false, days: pos(o.days), ok: pos(o.ok), empty: pos(o.empty), not_ready: pos(o.not_ready), failed: pos(o.failed),
    rows: pos(o.rows), through: ymdOr(o.through), error: err,
  };
}

// ---- CSV: website en Apple samen ----
export type AppleCsvRow = {
  day: string; kind: "sale" | "refund"; country: string; units: number; customer_currency: string; proceeds_currency: string;
  customer_price: number; developer_proceeds: number; gross: number | null; proceeds: number | null;
};
export function cleanAppleRows(raw: unknown): AppleCsvRow[] {
  if (!Array.isArray(raw)) return [];
  const out: AppleCsvRow[] = [];
  for (const r of raw.slice(0, 5000)) {
    const o = obj(r), day = ymdOr(o.day);
    if (!day) continue;
    const cc = String(o.customer_currency ?? ""), pc = String(o.proceeds_currency ?? ""), country = String(o.country ?? "");
    if (!/^[A-Z]{3}$/.test(cc) || !/^[A-Z]{3}$/.test(pc) || !/^[A-Z]{2}$/.test(country)) continue;
    out.push({
      day, kind: o.kind === "refund" ? "refund" : "sale", country, units: pos(o.units), customer_currency: cc, proceeds_currency: pc,
      customer_price: Number(o.customer_price) || 0, developer_proceeds: Number(o.developer_proceeds) || 0,
      gross: o.gross === null || o.gross === undefined ? null : pos(o.gross), proceeds: o.proceeds === null || o.proceeds === undefined ? null : pos(o.proceeds),
    });
  }
  return out;
}
const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const dec = (n: number) => String(Math.round(n * 10000) / 10000).replace(".", ",");
/** Extra regels voor de CSV van revenue_export (zelfde kolommen als revenueCsv in revenue.ts, plus aanbieder en aantal). */
export function appleCsvLines(rows: AppleCsvRow[], commission: number): string[] {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => {
    const sign = r.kind === "refund" ? -1 : 1;
    const ok = r.gross !== null && r.proceeds !== null;
    const net = ok ? exVat(r.proceeds!, r.gross!, commission) : 0;
    const cells = ok
      ? [eur(sign * r.gross!), eur(sign * (r.gross! - net)), eur(sign * net), eur(sign * (net - r.proceeds!)), eur(sign * r.proceeds!)]
      : ["", "", "", "", ""];
    return [
      q(r.day), q(r.kind === "refund" ? "Apple-terugbetaling" : "Apple-verkoop"), ...cells, q("App Store"), q(r.country),
      q(ok ? `afgeleid (commissie ${String(commission).replace(".", ",")}%)` : `niet omgerekend: ${r.units} × ${dec(r.customer_price)} ${r.customer_currency}, opbrengst ${dec(r.developer_proceeds)} ${r.proceeds_currency}`),
      q("Apple (App Store)"), String(sign * r.units),
    ].join(";");
  });
}
/** CSV van de website (revenueCsv-kolommen) plus Apple; kolommen aanbieder en aantal erachter. */
export function combinedCsv(webCsv: string, webRows: RevenueRow[], apple: AppleCsvRow[], commission: number): string {
  const lines = webCsv.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");
  if (!lines.length) return webCsv;
  const head = lines[0].replace('"stripe-kosten"', '"kosten (Stripe / Apple-commissie)"') + ';"aanbieder";"aantal"';
  const body = lines.slice(1).map((l, i) => `${l};"Website (Stripe)";${webRows[i]?.kind === "purchase" ? 1 : -1}`);
  return "﻿" + [head, ...body, ...appleCsvLines(apple, commission)].join("\r\n") + "\r\n";
}
