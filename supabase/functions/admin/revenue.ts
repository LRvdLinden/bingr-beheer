// Omzet (tab Omzet, web en app): Lifetime-aankopen via Stripe per periode, in dezelfde vorm als Insights (insights.ts):
// periodekeuze, bladeren, tijdvakken in Nederlandse tijd en een samenvatting met vergelijking. Pure hulpjes zonder netwerk
// of database, getest in revenue_test.ts. De database telt alleen per tijdvak en per bereik (bingr_admin_revenue en
// bingr_admin_revenue_rows in iptv-ios-appletv, supabase/schema.sql): nooit gegevens per persoon (geen account, e-mail,
// naam of Stripe-id), alleen aantallen en bedragen in centen.
//
// Bedragen: bruto = incl. btw (wat de klant betaalde). Btw: volgens Stripe Tax (tax_amount) als die bekend is, anders
// bruto × tarief / (100 + tarief) (app_settings.revenue_vat, standaard 21% NL). Netto = bruto − btw. Stripe-kosten = fee
// van de balance transaction (+ dispute fee). Terugbetaald = terugbetalingen en chargebacks (incl. btw) op hun eigen moment.
// Opbrengst = netto − Stripe-kosten − terugbetaald excl. btw (de btw over een terugbetaling is geen omzet meer).
import { fromLocal, HISTORY_DAYS, local, periodRange, type Period, type Step, summarize, type Summary, TZ } from "./insights.ts";

const H = 3600_000, DAY = 24 * H;
export const REV_PERIODS = ["day", "week", "month", "year", "7d", "30d"] as const;
export type RevPeriod = typeof REV_PERIODS[number];
export type RevStep = Step | "month";
export type RevBucket = "auto" | "hour" | "day" | "week" | "month";
/** Toegestane resoluties per periode (de eerste = automatisch). */
export const BUCKETS: Record<RevPeriod, RevStep[]> = {
  day: ["hour"], week: ["day", "hour"], "7d": ["day", "hour"], month: ["day"], "30d": ["day"], year: ["month", "week"],
};
export const MODES = ["live", "test", "all"] as const;
export type RevMode = typeof MODES[number];

/** Series in vaste volgorde. money = bedrag in centen; down = minder is beter. */
export const REV_SERIES: { key: string; label: string; money: boolean; down?: boolean }[] = [
  { key: "gross", label: "Bruto (incl. btw)", money: true },
  { key: "net", label: "Netto (excl. btw)", money: true },
  { key: "proceeds", label: "Opbrengst", money: true },
  { key: "vat", label: "Btw", money: true },
  { key: "fees", label: "Stripe-kosten", money: true, down: true },
  { key: "refunds", label: "Terugbetaald", money: true, down: true },
  { key: "count", label: "Aankopen", money: false },
  { key: "refund_count", label: "Terugbetalingen", money: false, down: true },
];

export type RevenueQuery = { period: RevPeriod; offset: number; step: RevStep; mode: RevMode | null };
/** Controleert `revenue {period, offset?, bucket?, mode?}`; mode null = volgens de Stripe-sleutel (live/test, anders alles). */
export function parseRevenue(body: Record<string, unknown>, now = Date.now()): RevenueQuery | { error: string } {
  const period = String(body.period ?? "month") as RevPeriod;
  if (!(REV_PERIODS as readonly string[]).includes(period)) return { error: "bad_period" };
  const offset = body.offset === undefined || body.offset === null ? 0 : body.offset;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset > 0 || offset < -2000) return { error: "bad_offset" };
  const b = String(body.bucket ?? "auto");
  if (b !== "auto" && !(BUCKETS[period] as string[]).includes(b)) return { error: "bad_bucket" };
  const step = b === "auto" ? BUCKETS[period][0] : b as RevStep;
  const mode = body.mode === undefined || body.mode === null || body.mode === "" ? null : String(body.mode);
  if (mode !== null && !(MODES as readonly string[]).includes(mode)) return { error: "bad_mode" };
  const q = { period, offset, step, mode: mode as RevMode | null };
  if (offset < 0 && revenueRange(q, offset, now)[0] < now - HISTORY_DAYS * DAY) return { error: "bad_offset" };
  return q;
}
/** Standaardmodus: aankopen van de modus van STRIPE_SECRET_KEY; zonder sleutel alles. */
export function defaultMode(secretKey: string): RevMode {
  const k = secretKey.trim();
  return /^(sk|rk)_live_/.test(k) ? "live" : /^(sk|rk)_test_/.test(k) ? "test" : "all";
}

/** Grenzen van de periode met de gekozen resolutie (jaar per maand: 1 januari, 1 februari, …, 1 januari). */
export function revenueRange(q: { period: RevPeriod; step: RevStep }, offset: number, now: number): number[] {
  if (q.period === "year" && q.step === "month") {
    const y = local(now).y + offset;
    return Array.from({ length: 13 }, (_, i) => fromLocal(y, 1 + i, 1));
  }
  return periodRange(q.period as Period, offset, now, q.step === "hour").edges;
}

export type RevenuePlan = RevenueQuery & { cur: number[]; prev: number[]; edges: number[]; hasPrev: boolean };
export function revenuePlan(q: RevenueQuery, now: number): RevenuePlan {
  const cur = revenueRange(q, q.offset, now), prev = revenueRange(q, q.offset - 1, now);
  if (prev[prev.length - 1] !== cur[0]) throw new Error("periodes sluiten niet aan");
  return { ...q, cur, prev, edges: [...prev, ...cur.slice(1)], hasPrev: prev[0] >= now - HISTORY_DAYS * DAY };
}

/** Bereiken voor de tegels (deze maand, vorige maand, dit jaar, totaal) en de gekozen periode; voor bingr_admin_revenue. */
export function tileRanges(p: RevenuePlan, now: number): { key: string; from: string; to: string }[] {
  const l = local(now), iso = (t: number) => new Date(t).toISOString();
  return [
    { key: "period", from: iso(p.cur[0]), to: iso(p.cur[p.cur.length - 1]) },
    { key: "prev_period", from: iso(p.prev[0]), to: iso(p.prev[p.prev.length - 1]) },
    { key: "month", from: iso(fromLocal(l.y, l.m, 1)), to: iso(fromLocal(l.y, l.m + 1, 1)) },
    { key: "prev_month", from: iso(fromLocal(l.y, l.m - 1, 1)), to: iso(fromLocal(l.y, l.m, 1)) },
    { key: "year", from: iso(fromLocal(l.y, 1, 1)), to: iso(fromLocal(l.y + 1, 1, 1)) },
    { key: "all", from: "2020-01-01T00:00:00.000Z", to: iso(now + DAY) },
  ];
}

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const pos = (v: unknown) => Math.max(0, int(v));

export type Totals = {
  count: number; gross: number; vat: number; net: number; fees: number; refunds: number; refunds_vat: number;
  refunds_net: number; proceeds: number; refund_count: number; dispute_count: number; missing_fees: number; with_tax: number;
};
export type Breakdown = { key: string; label: string; count: number; gross: number };
/** Totalen uit bingr_revenue_sum, met netto en opbrengst. */
export function totals(raw: unknown): Totals {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const gross = pos(o.gross), vat = Math.min(gross, pos(o.vat)), fees = pos(o.fees), refunds = pos(o.refunds);
  const refundsVat = Math.min(refunds, pos(o.refunds_vat)), net = gross - vat, refundsNet = refunds - refundsVat;
  return {
    count: pos(o.count), gross, vat, net, fees, refunds, refunds_vat: refundsVat, refunds_net: refundsNet,
    proceeds: net - fees - refundsNet, refund_count: pos(o.refund_count), dispute_count: pos(o.dispute_count),
    missing_fees: pos(o.missing_fees), with_tax: pos(o.with_tax),
  };
}

export const METHOD_LABEL: Record<string, string> = {
  card: "Kaart", ideal: "iDEAL", apple_pay: "Apple Pay", google_pay: "Google Pay", bancontact: "Bancontact", link: "Link",
  paypal: "PayPal", klarna: "Klarna", sepa_debit: "SEPA-incasso", eps: "EPS", giropay: "giropay", sofort: "Sofort",
  revolut_pay: "Revolut Pay", amazon_pay: "Amazon Pay", "?": "Onbekend",
};
const COUNTRY = new Intl.DisplayNames(["nl"], { type: "region" });
export function countryLabel(cc: string): string {
  if (cc === "?") return "Onbekend";
  try { return COUNTRY.of(cc) ?? cc; } catch { return cc; }
}
export function breakdown(raw: unknown, kind: "method" | "country"): Breakdown[] {
  if (!Array.isArray(raw)) return [];
  const out: Breakdown[] = [];
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const key = String(o.key ?? "?");
    if (kind === "method" ? !/^([a-z_]{1,32}|\?)$/.test(key) : !/^([A-Z]{2}|\?)$/.test(key)) continue;
    out.push({ key, label: kind === "method" ? METHOD_LABEL[key] ?? key.replace(/_/g, " ") : countryLabel(key), count: pos(o.count), gross: pos(o.gross) });
  }
  return out;
}

export type RevSeriesOut = {
  key: string; label: string; agg: "sum"; money: boolean; down: boolean; available: boolean;
  values: (number | null)[]; prev_values: (number | null)[]; summary: Summary | null;
};
export type VatBasis = { source: "stripe_tax" | "fixed" | "mixed"; rate: number; stripe_tax: boolean; text: string; note: string };
export type RevenueOut = {
  period: RevPeriod; offset: number; step: RevStep; tz: string; mode: RevMode; currency: "eur";
  from: string; to: string; edges: string[]; prev_from: string; prev_to: string;
  now_index: number | null; has_prev: boolean; has_next: boolean;
  series: RevSeriesOut[];
  totals: Record<string, Totals>;
  by_method: Breakdown[]; by_country: Breakdown[];
  vat: VatBasis;
  billing: { enabled: boolean; mode: "live" | "test" | null };
  live_count: number; test_count: number; empty: boolean;
};

/** Btw-uitgangspunt voor de tekst in de tab. */
export function vatBasis(rate: number, stripeTax: boolean, all: Totals): VatBasis {
  const r = Number.isFinite(rate) && rate >= 0 && rate <= 50 ? rate : 21;
  const rs = r.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
  const source = all.count === 0 ? (stripeTax ? "stripe_tax" : "fixed") : all.with_tax === 0 ? "fixed" : all.with_tax >= all.count ? "stripe_tax" : "mixed";
  const text = source === "stripe_tax" ? "Btw volgens Stripe Tax"
    : source === "mixed" ? `Btw volgens Stripe Tax waar bekend, anders berekend als ${rs}% NL`
    : `Btw berekend als ${rs}% NL (bedragen incl. btw: btw = bruto × ${rs}/${(100 + r).toLocaleString("nl-NL", { maximumFractionDigits: 2 })})`;
  return {
    source, rate: r, stripe_tax: stripeTax, text,
    note: "Indicatie op basis van de aankopen in Bingr en de gegevens van Stripe, geen btw-aangifte. Controleer de aangifte met de rapporten in het Stripe-dashboard.",
  };
}

/** Antwoord voor web en app uit het plan en de uitkomst van bingr_admin_revenue. */
export function buildRevenue(p: RevenuePlan, raw: unknown, now: number, opts: { mode: RevMode; stripeTax: boolean; billing: RevenueOut["billing"] }): RevenueOut {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const sr = data.series && typeof data.series === "object" ? data.series as Record<string, unknown> : {};
  const np = p.prev.length - 1, nc = p.cur.length - 1, n = np + nc;
  const arr = (k: string): number[] | null => {
    const a = sr[k];
    return Array.isArray(a) && a.length === n ? a.map(pos) : null;
  };
  const base = { count: arr("count"), gross: arr("gross"), vat: arr("vat"), fees: arr("fees"), refunds: arr("refunds"), refunds_vat: arr("refunds_vat"), refund_count: arr("refund_count") };
  const avail = Object.values(base).every((a) => a !== null);
  const z = () => new Array(n).fill(0) as number[];
  const g = base.gross ?? z(), v = base.vat ?? z(), f = base.fees ?? z(), r = base.refunds ?? z(), rv = base.refunds_vat ?? z();
  const all: Record<string, number[]> = {
    gross: g, vat: v, net: g.map((x, i) => x - Math.min(x, v[i])), fees: f, refunds: r,
    proceeds: g.map((x, i) => x - Math.min(x, v[i]) - f[i] - (r[i] - Math.min(r[i], rv[i]))),
    count: base.count ?? z(), refund_count: base.refund_count ?? z(),
  };
  let nowIndex: number | null = null;
  for (let i = 0; i < nc; i++) if (p.cur[i] <= now && now < p.cur[i + 1]) nowIndex = i;
  const at = (edges: number[], i: number, x: number): number | null => (edges[i] > now ? null : x);
  const series = REV_SERIES.map((s): RevSeriesOut => {
    const a = all[s.key];
    const prevValues = avail ? Array.from({ length: np }, (_, i) => at(p.prev, i, a[i])) : [];
    const values = avail ? Array.from({ length: nc }, (_, i) => at(p.cur, i, a[np + i])) : [];
    return { key: s.key, label: s.label, agg: "sum", money: s.money, down: !!s.down, available: avail, values, prev_values: prevValues,
      summary: avail ? summarize(values, prevValues, "sum") : null };
  });
  const rg = data.ranges && typeof data.ranges === "object" ? data.ranges as Record<string, Record<string, unknown>> : {};
  const t: Record<string, Totals> = {};
  for (const k of ["period", "prev_period", "month", "prev_month", "year", "all"]) t[k] = totals(rg[k]);
  const iso = (x: number) => new Date(x).toISOString();
  const rate = typeof data.rate === "number" ? data.rate : Number(data.rate ?? 21);
  return {
    period: p.period, offset: p.offset, step: p.step, tz: TZ, mode: opts.mode, currency: "eur",
    from: iso(p.cur[0]), to: iso(p.cur[nc]), edges: p.cur.map(iso), prev_from: iso(p.prev[0]), prev_to: iso(p.prev[np]),
    now_index: nowIndex, has_prev: p.hasPrev, has_next: p.offset < 0, series, totals: t,
    by_method: breakdown(rg.period?.by_method, "method"), by_country: breakdown(rg.period?.by_country, "country"),
    vat: vatBasis(rate, opts.stripeTax, t.all), billing: opts.billing,
    live_count: pos(data.live_count), test_count: pos(data.test_count), empty: t.all.count === 0 && t.all.refunds === 0,
  };
}

// ---- CSV-export (alleen datum, soort, bedragen, methode, land) ----
export type RevenueRow = { at: string; kind: "purchase" | "refund" | "dispute"; amount: number; vat: number; fee: number | null; method: string | null; country: string | null; tax: boolean };
export function cleanRows(raw: unknown): RevenueRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RevenueRow[] = [];
  for (const r of raw.slice(0, 5000)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const t = typeof o.at === "string" ? Date.parse(o.at) : NaN;
    if (!Number.isFinite(t)) continue;
    const kind = o.kind === "refund" || o.kind === "dispute" ? o.kind : "purchase";
    const m = typeof o.method === "string" && /^[a-z_]{1,32}$/.test(o.method) ? o.method : null;
    const c = typeof o.country === "string" && /^[A-Z]{2}$/.test(o.country) ? o.country : null;
    out.push({ at: new Date(t).toISOString(), kind, amount: int(o.amount), vat: int(o.vat), fee: o.fee === null || o.fee === undefined ? null : pos(o.fee), method: m, country: c, tax: o.tax === true });
  }
  return out;
}
const KIND_LABEL = { purchase: "Aankoop", refund: "Terugbetaling", dispute: "Chargeback" } as const;
const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const ymdFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** CSV (; als scheidingsteken, komma als decimaalteken: Excel NL). Netto = bedrag − btw − kosten. */
export function revenueCsv(rows: RevenueRow[]): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["datum (NL-tijd)", "soort", "bedrag incl. btw", "btw", "bedrag excl. btw", "stripe-kosten", "netto", "betaalmethode", "land", "btw-bron"].map(q).join(";")];
  for (const r of rows) {
    const fee = r.fee ?? 0;
    lines.push([
      q(ymdFmt.format(new Date(r.at))), q(KIND_LABEL[r.kind]), eur(r.amount), eur(r.vat), eur(r.amount - r.vat), r.fee === null ? "" : eur(fee),
      eur(r.amount - r.vat - fee), q(r.method ? METHOD_LABEL[r.method] ?? r.method : ""), q(r.country ?? ""), q(r.tax ? "Stripe Tax" : "berekend"),
    ].join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---- Stripe-kosten later ophalen (actie revenue_backfill) ----
// Kopie van detailsFromCharge / detailsFromPaymentIntent in iptv-ios-appletv (supabase/functions/_shared/billing.ts);
// houd ze gelijk.
// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;
export type ChargeDetails = { chargeId: string | null; fee: number | null; net: number | null; method: string | null; country: string | null };
const isStripeId = (v: unknown, prefix: string): v is string =>
  typeof v === "string" && v.length <= 255 && v.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(v);
export function detailsFromCharge(ch: Obj | null | undefined): ChargeDetails | null {
  if (!ch || typeof ch !== "object" || ch.object !== "charge") return null;
  const bt = ch.balance_transaction && typeof ch.balance_transaction === "object" ? ch.balance_transaction : null;
  const pm = ch.payment_method_details && typeof ch.payment_method_details === "object" ? ch.payment_method_details : {};
  const wallet = pm.type === "card" ? pm.card?.wallet?.type : null;
  const m = String(wallet || pm.type || "").toLowerCase();
  const cc = String(ch.billing_details?.address?.country || pm.card?.country || pm[String(pm.type)]?.country || "").toUpperCase();
  return {
    chargeId: isStripeId(ch.id, "ch_") || isStripeId(ch.id, "py_") ? ch.id : null,
    fee: bt && Number.isInteger(bt.fee) && bt.fee >= 0 ? bt.fee : null,
    net: bt && Number.isInteger(bt.net) ? bt.net : null,
    method: /^[a-z_]{1,32}$/.test(m) ? m : null,
    country: /^[A-Z]{2}$/.test(cc) ? cc : null,
  };
}
export function detailsFromPaymentIntent(pi: Obj | null | undefined): ChargeDetails | null {
  if (!pi || typeof pi !== "object" || pi.object !== "payment_intent") return null;
  return detailsFromCharge(pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null);
}
export const isPaymentIntent = (v: unknown): v is string => isStripeId(v, "pi_");
/** Kolommen voor billing_purchases (alleen wat bekend is). */
export function detailsPatch(d: ChargeDetails, nowIso: string): Record<string, unknown> {
  const p: Record<string, unknown> = { details_at: nowIso, updated_at: nowIso };
  if (d.chargeId) p.charge_id = d.chargeId;
  if (d.fee !== null) p.fee = d.fee;
  if (d.net !== null) p.net_amount = d.net;
  if (d.method) p.payment_method = d.method;
  if (d.country) p.country = d.country;
  return p;
}
/** Btw-tarief voor revenue_vat_set: 0–50, hoogstens 2 decimalen. */
export function cleanRate(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) && n >= 0 && n <= 50 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? Math.round(n * 100) / 100 : null;
}
