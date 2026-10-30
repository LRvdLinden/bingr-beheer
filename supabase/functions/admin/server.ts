// Tab Server (en de app BingrBeheer): Supabase- en servergegevens als grafieken in de vorm van Insights (zelfde
// tekenfunctie in web/admin.js). Pure hulpjes zonder netwerk of database, getest in server_test.ts.
// Bron: admin_server_daily (één rij per UTC-dag, gevuld door pg_cron in de database: bingr_admin_server_snapshot elk uur,
// bingr_admin_server_sample elke 5 minuten) en bingr_admin_server_now (actuele stand); schema in iptv-ios-appletv.
// Alleen aantallen en groottes, nooit gegevens per persoon.
//
// Periodes: 7d / 30d / 90d per dag (laatste N dagen incl. vandaag), 1y per week (52 weken, maandag t/m zondag, UTC).
// offset 0 = nu, -1 = de periode ervoor (bladeren). De vorige periode komt mee voor de vergelijking (change_pct).

export const SERVER_PERIODS = ["7d", "30d", "90d", "1y"] as const;
export type ServerPeriod = typeof SERVER_PERIODS[number];
export type SAgg = "sum" | "avg" | "last" | "max";
export type SSeries = { key: string; label: string; agg: SAgg; path: string[]; bytes?: boolean; ms?: boolean };
export type Source = { label: string; desc: string; series: SSeries[]; fn?: "calls" | "errors" | "avg_ms" };

const PLATFORM_SERIES: [string, string][] = [
  ["ios", "iPhone"], ["ipados", "iPad"], ["macos", "Mac"], ["tvos", "Apple TV"], ["android", "Android"],
  ["androidtv", "Android TV"], ["web", "Webspeler"], ["windows", "Windows"],
];

/** Bronnen (volgorde = volgorde in de tab; serievolgorde = kleur). */
export const SOURCES: Record<string, Source> = {
  database: { label: "Database", desc: "Grootte van de Postgres-database", series: [{ key: "db_bytes", label: "Database", agg: "last", path: ["db_bytes"], bytes: true }] },
  storage: { label: "Opslag", desc: "Bestanden in Storage (profielfoto's)", series: [{ key: "storage_bytes", label: "Opslag", agg: "last", path: ["storage_bytes"], bytes: true }] },
  rows: {
    label: "Rijen", desc: "Grootste tabellen (schatting van Postgres)", series: [
      { key: "account_watch_log", label: "Kijkgeschiedenis", agg: "last", path: ["rows", "account_watch_log"] },
      { key: "account_watch_stats", label: "Kijkstatistieken", agg: "last", path: ["rows", "account_watch_stats"] },
      { key: "status_checks", label: "Statuscontroles", agg: "last", path: ["rows", "status_checks"] },
      { key: "push_deliveries", label: "Push-afleveringen", agg: "last", path: ["rows", "push_deliveries"] },
      { key: "admin_audit", label: "Beheerlogboek", agg: "last", path: ["rows", "admin_audit"] },
      { key: "support_messages", label: "Supportberichten", agg: "last", path: ["rows", "support_messages"] },
    ],
  },
  accounts_total: { label: "Accounts", desc: "Totaal aantal accounts", series: [{ key: "accounts", label: "Accounts", agg: "last", path: ["accounts"] }] },
  accounts: {
    label: "Nieuw en actief", desc: "Nieuwe accounts en actieve accounts per dag", series: [
      { key: "new_users", label: "Nieuwe accounts", agg: "sum", path: ["new_users"] },
      { key: "active_users", label: "Actieve accounts", agg: "avg", path: ["active_users"] },
    ],
  },
  devices: {
    label: "Apparaten per platform", desc: "Apparaten gezien in de 30 dagen ervoor",
    series: PLATFORM_SERIES.map(([k, l]) => ({ key: k, label: l, agg: "last" as const, path: ["devices_active", k] })),
  },
  streams: {
    label: "Streams", desc: "Gestarte streams en de piek van gelijktijdige streams", series: [
      { key: "streams_started", label: "Gestart", agg: "sum", path: ["streams_started"] },
      { key: "streams_peak", label: "Piek tegelijk", agg: "max", path: ["streams_peak"] },
    ],
  },
  auth: {
    label: "Inloggen", desc: "Logins, mislukte wachtwoorden en blokkades", series: [
      { key: "signins", label: "Logins", agg: "sum", path: ["signins"] },
      { key: "login_failures", label: "Fout wachtwoord", agg: "sum", path: ["login_failures"] },
      { key: "login_locks", label: "Tijdelijk dicht", agg: "sum", path: ["login_locks"] },
      { key: "blocked", label: "Geblokkeerd (beheer)", agg: "last", path: ["blocked"] },
    ],
  },
  proxy: { label: "Webproxy: verzoeken", desc: "Verzoeken via de doorgifte van de webspeler", series: [{ key: "proxy_requests", label: "Verzoeken", agg: "sum", path: ["proxy_requests"] }] },
  proxy_bytes: { label: "Webproxy: verkeer", desc: "Data via de doorgifte van de webspeler", series: [{ key: "proxy_bytes", label: "Verkeer", agg: "sum", path: ["proxy_bytes"], bytes: true }] },
  push: {
    label: "Push-afleveringen", desc: "Afgeleverde en mislukte pushmeldingen", series: [
      { key: "push_sent", label: "Afgeleverd", agg: "sum", path: ["push_sent"] },
      { key: "push_failed", label: "Mislukt", agg: "sum", path: ["push_failed"] },
    ],
  },
  mail: {
    label: "Mail", desc: "Nieuwsbrief en eigen mailings: verstuurd en mislukt", series: [
      { key: "mail_sent", label: "Verstuurd", agg: "sum", path: ["mail_sent"] },
      { key: "mail_failed", label: "Mislukt", agg: "sum", path: ["mail_failed"] },
    ],
  },
  // Edge Functions: alleen als de workflow Serverstatistieken (iptv-ios-appletv) data.fn vult; series per functie
  fn_calls: { label: "Functies: aanroepen", desc: "Aanroepen per Edge Function", series: [], fn: "calls" },
  fn_errors: { label: "Functies: fouten", desc: "Antwoorden met status 5xx per Edge Function", series: [], fn: "errors" },
  fn_ms: { label: "Functies: duur", desc: "Gemiddelde duur per aanroep (ms)", series: [], fn: "avg_ms" },
};
export const SOURCE_KEYS = Object.keys(SOURCES);
const FN_MAX = 8;
const DOWN_GOOD = new Set(["login_failures", "login_locks", "push_failed", "mail_failed"]);

export type ServerQuery = { period: ServerPeriod; offset: number };
export function parseServer(body: Record<string, unknown>): ServerQuery | { error: string } {
  const period = String(body.period ?? "30d");
  if (!(SERVER_PERIODS as readonly string[]).includes(period)) return { error: "bad_period" };
  const offset = Number(body.offset ?? 0);
  if (!Number.isInteger(offset) || offset > 0 || offset < -20) return { error: "bad_offset" };
  return { period: period as ServerPeriod, offset };
}

const DAY = 864e5;
const utcDay = (ms: number) => Math.floor(ms / DAY) * DAY;
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Grenzen van de huidige en de vorige periode (UTC, middernacht). n tijdvakken; edges heeft n + 1 grenzen. */
export function serverPlan(q: ServerQuery, now: number) {
  const today = utcDay(now);
  if (q.period === "1y") {
    // weken van maandag t/m zondag; de laatste week bevat vandaag
    const wd = (new Date(today).getUTCDay() + 6) % 7, monday = today - wd * DAY;
    const n = 52, end = monday + 7 * DAY + q.offset * n * 7 * DAY, start = end - n * 7 * DAY;
    const edges = Array.from({ length: n + 1 }, (_, i) => start + i * 7 * DAY);
    const prev = Array.from({ length: n + 1 }, (_, i) => start - n * 7 * DAY + i * 7 * DAY);
    return { period: q.period, offset: q.offset, step: "week" as const, n, edges, prev, today };
  }
  const n = q.period === "7d" ? 7 : q.period === "30d" ? 30 : 90;
  const end = today + DAY + q.offset * n * DAY, start = end - n * DAY;
  const edges = Array.from({ length: n + 1 }, (_, i) => start + i * DAY);
  const prev = Array.from({ length: n + 1 }, (_, i) => start - n * DAY + i * DAY);
  return { period: q.period, offset: q.offset, step: "day" as const, n, edges, prev, today };
}
export type ServerPlanT = ReturnType<typeof serverPlan>;
/** Welke dagen de database moet geven (vorige + huidige periode). */
export const planRange = (p: ServerPlanT) => ({ from: isoDay(p.prev[0]), to: isoDay(p.edges[p.n] - DAY) });

type DayRow = { day: string; data: Record<string, unknown> };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
function pick(data: Record<string, unknown>, path: string[]): number | null {
  let v: unknown = data;
  for (const k of path) { if (!v || typeof v !== "object") return null; v = (v as Record<string, unknown>)[k]; }
  return num(v);
}
function bucketValues(rows: Map<number, Record<string, unknown>>, edges: number[], s: SSeries, cutoff: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const vals: number[] = [];
    for (let t = edges[i]; t < edges[i + 1] && t <= cutoff; t += DAY) {
      const d = rows.get(t); if (!d) continue;
      const v = pick(d, s.path); if (v != null) vals.push(v);
    }
    if (!vals.length) { out.push(null); continue; }
    switch (s.agg) {
      case "sum": out.push(vals.reduce((a, b) => a + b, 0)); break;
      case "avg": out.push(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10); break;
      case "max": out.push(Math.max(...vals)); break;
      default: out.push(vals[vals.length - 1]);
    }
  }
  return out;
}
function summary(vals: (number | null)[], prev: (number | null)[], agg: SAgg) {
  const v = vals.filter((x): x is number => x != null);
  if (!v.length) return null;
  const sum = v.reduce((a, b) => a + b, 0), last = v[v.length - 1];
  const total = agg === "sum" ? sum : agg === "max" ? Math.max(...v) : agg === "last" ? last : Math.round((sum / v.length) * 10) / 10;
  const p = prev.filter((x): x is number => x != null);
  let base: number | null = null;
  if (p.length) base = agg === "sum" ? p.reduce((a, b) => a + b, 0) : agg === "max" ? Math.max(...p) : agg === "last" ? p[p.length - 1] : p.reduce((a, b) => a + b, 0) / p.length;
  const change_pct = base == null || base === 0 ? null : Math.round(((total - base) / base) * 1000) / 10;
  return { total, avg: Math.round((sum / v.length) * 10) / 10, min: Math.min(...v), max: Math.max(...v), last, change_pct };
}

/** Functienamen met gegevens in deze rijen (meeste aanroepen eerst, hoogstens FN_MAX). */
function fnNames(rows: DayRow[]): string[] {
  const tot = new Map<string, number>();
  for (const r of rows) {
    const fn = r.data?.fn;
    if (!fn || typeof fn !== "object") continue;
    for (const [name, v] of Object.entries(fn as Record<string, unknown>)) {
      if (!/^[a-z0-9_-]{1,40}$/.test(name)) continue;
      tot.set(name, (tot.get(name) ?? 0) + (num((v as Record<string, unknown>)?.calls) ?? 0));
    }
  }
  return [...tot.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, FN_MAX).map(([k]) => k);
}

/** Antwoord voor de tab: per bron {label, desc, series} in de vorm van Insights (edges, now_index, has_prev, …). */
export function buildServer(p: ServerPlanT, raw: unknown, now: number, sources: string[] = SOURCE_KEYS) {
  const list: DayRow[] = Array.isArray(raw) ? raw.filter((r) => r && typeof r === "object" && typeof r.day === "string") as DayRow[] : [];
  const rows = new Map<number, Record<string, unknown>>();
  for (const r of list) { const t = Date.parse(`${r.day}T00:00:00Z`); if (Number.isFinite(t)) rows.set(t, (r.data && typeof r.data === "object") ? r.data : {}); }
  const fns = fnNames(list);
  const first = rows.size ? Math.min(...rows.keys()) : null;
  const cutoff = p.today;
  const nowIndex = p.edges.findIndex((t, i) => i < p.n && now >= t && now < p.edges[i + 1]);
  const out: Record<string, unknown> = {};
  for (const key of sources) {
    const src = SOURCES[key]; if (!src) continue;
    const defs: SSeries[] = src.fn
      ? fns.map((f) => ({ key: `fn:${f}`, label: f, agg: src.fn === "avg_ms" ? "avg" as const : "sum" as const, path: ["fn", f, src.fn!], ms: src.fn === "avg_ms" }))
      : src.series;
    const series = defs.map((s) => {
      const values = bucketValues(rows, p.edges, s, cutoff), prev_values = bucketValues(rows, p.prev, s, cutoff);
      return {
        key: s.key, label: s.label, agg: s.agg, available: values.some((v) => v != null), values, prev_values,
        summary: summary(values, prev_values, s.agg), ...(s.bytes ? { bytes: true } : {}), ...(s.ms ? { ms: true } : {}),
        ...(DOWN_GOOD.has(s.key) ? { down: true } : {}),
      };
    });
    out[key] = { label: src.label, desc: src.desc, series };
  }
  return {
    period: p.period, offset: p.offset, step: p.step,
    edges: p.edges.map((t) => new Date(t).toISOString()), from: new Date(p.edges[0]).toISOString(), to: new Date(p.edges[p.n]).toISOString(),
    now_index: nowIndex < 0 ? null : nowIndex, has_next: p.offset < 0,
    has_prev: first != null && first < p.edges[0], first_day: first == null ? null : isoDay(first),
    functions: fns, sources: out,
  };
}

// ---- actuele stand: alleen bekende velden doorgeven (geen onverwachte gegevens uit de database naar de browser) ----
const n0 = (v: unknown) => num(v) ?? 0;
const str = (v: unknown, max = 80) => (typeof v === "string" ? v.slice(0, max) : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
// deno-lint-ignore no-explicit-any
export function nowView(d: any) {
  if (!d || typeof d !== "object") return null;
  const t = d.today ?? {};
  const hours: Record<string, number> = {};
  if (t.peak_h && typeof t.peak_h === "object") for (const [h, v] of Object.entries(t.peak_h)) if (/^\d{1,2}$/.test(h) && +h < 24) hours[h] = n0(v);
  return {
    at: str(d.at, 40), day: str(d.day, 10), first_day: str(d.first_day, 10),
    db: { bytes: n0(d.db?.bytes), version: n0(d.db?.version), connections: n0(d.db?.connections) },
    today: {
      new_users: n0(t.new_users), active_users: n0(t.active_users), streams_started: n0(t.streams_started), streams_peak: n0(t.streams_peak),
      peak_h: hours, signins: n0(t.signins), login_failures: n0(t.login_failures), login_locks: n0(t.login_locks),
      proxy_requests: n0(t.proxy_requests), proxy_bytes: n0(t.proxy_bytes), push_sent: n0(t.push_sent), push_failed: n0(t.push_failed),
      mail_sent: n0(t.mail_sent), mail_failed: n0(t.mail_failed), storage_bytes: n0(t.storage_bytes), storage_objects: n0(t.storage_objects),
    },
    counts: Object.fromEntries(["accounts", "confirmed", "active_7d", "active_30d", "devices", "streams_now", "support_tickets", "push_devices", "blocked", "locked_now"]
      .map((k) => [k, n0(d.counts?.[k])])),
    tables: arr(d.tables).slice(0, 20).map((x) => ({ name: str(x?.name) ?? "?", bytes: n0(x?.bytes), rows: num(x?.rows) })),
    devices: arr(d.devices).slice(0, 20).map((x) => ({ platform: str(x?.platform, 20) ?? "other", devices: n0(x?.devices), active_30d: n0(x?.active_30d), live: n0(x?.live) })),
    storage: arr(d.storage).slice(0, 20).map((x) => ({ bucket: str(x?.bucket, 60) ?? "?", public: x?.public === true, objects: n0(x?.objects), bytes: n0(x?.bytes) })),
    cron: arr(d.cron).slice(0, 40).map((x) => ({
      name: str(x?.name) ?? "?", schedule: str(x?.schedule, 40), active: x?.active === true, last_start: str(x?.last_start, 40),
      last_end: str(x?.last_end, 40), last_status: str(x?.last_status, 20), runs_24h: n0(x?.runs_24h), failed_24h: n0(x?.failed_24h),
    })),
    queues: { push: n0(d.queues?.push), newsletter: n0(d.queues?.newsletter), mailing: n0(d.queues?.mailing), status_mail: n0(d.queues?.status_mail) },
    proxy_30d: { requests: n0(d.proxy_30d?.requests), bytes: n0(d.proxy_30d?.bytes), accounts: n0(d.proxy_30d?.accounts) },
  };
}
