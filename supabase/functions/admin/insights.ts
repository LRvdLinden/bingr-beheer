// Insights (tab Overzicht): tijdreeksen per periode en resolutie, zoals Homey Insights. Pure hulpjes zonder netwerk of
// database, getest in insights_test.ts. De database telt alleen per tijdvak (bingr_admin_insights in iptv-ios-appletv,
// supabase/schema.sql): nooit gegevens per persoon, alleen aantallen.
//
// Periodes (Nederlandse tijd, Europe/Amsterdam); de resolutie past zich aan de periode aan (zoals Homey Insights):
//   hour  = dit uur, per 5 minuten (12)        24h = laatste 24 uur, per uur (24)
//   day   = vandaag 00:00–24:00, per uur        7d  = laatste 7 dagen incl. vandaag, per uur (of per dag*)
//   week  = maandag t/m zondag, per uur (of per dag*)   30d = laatste 30 dagen incl. vandaag, per dag
//   month = kalendermaand, per dag              year = kalenderjaar, per week (maandag t/m zondag; eerste en laatste week korter)
//   * per dag als de metric een serie heeft die alleen per dag bestaat (actieve accounts), of als de gegevens per stream
//     voor die periode niet meer bewaard zijn (streams ouder dan 8 dagen).
// offset 0 = de huidige periode, -1 = de vorige, enz. (bladeren met ‹ ›). De vorige periode komt in dezelfde aanvraag mee
// (één reeks grenzen: vorige ++ huidige), voor de vergelijking in de samenvatting.

export const TZ = "Europe/Amsterdam";
export const PERIODS = ["hour", "day", "week", "month", "year", "24h", "7d", "30d"] as const;
export type Period = typeof PERIODS[number];
export type Step = "5min" | "hour" | "day" | "week";
export type Agg = "sum" | "avg";

/** Hoe ver terug je kunt bladeren: het begin van de periode ligt hoogstens zoveel dagen terug. */
export const HISTORY_DAYS = 3 * 366;
/** Kijkgeschiedenis per stream (account_watch_log) wordt 8 dagen bewaard: per uur / 5 min alleen zo ver terug. */
export const WATCH_LOG_DAYS = 8;

export type SeriesDef = { key: string; label: string; agg: Agg; dailyOnly?: boolean; recentSubDay?: number };
/** Metrics en hun series (volgorde = kleur in de grafiek, vast per metric). */
export const METRICS: Record<string, { label: string; unit: string; series: SeriesDef[] }> = {
  accounts: {
    label: "Accounts", unit: "accounts",
    series: [
      { key: "new_users", label: "Nieuwe accounts", agg: "sum" },
      // account_logins heeft één rij per account per dag: alleen per dag of per maand (gemiddelde per dag)
      { key: "active_users", label: "Actieve accounts", agg: "avg", dailyOnly: true },
    ],
  },
  signins: { label: "Inlogs", unit: "inlogs", series: [{ key: "signins", label: "Inlogs", agg: "sum" }] },
  streams: {
    label: "Streams", unit: "streams",
    series: [
      { key: "live", label: "Live tv", agg: "sum", recentSubDay: WATCH_LOG_DAYS },
      { key: "movie", label: "Films", agg: "sum", recentSubDay: WATCH_LOG_DAYS },
      { key: "episode", label: "Series", agg: "sum", recentSubDay: WATCH_LOG_DAYS },
    ],
  },
  push: {
    label: "Pushmeldingen", unit: "meldingen",
    series: [{ key: "sent", label: "Verstuurd", agg: "sum" }, { key: "failed", label: "Mislukt", agg: "sum" }],
  },
  support: {
    label: "Supporttickets", unit: "tickets",
    series: [{ key: "new", label: "Nieuwe tickets", agg: "sum" }, { key: "closed", label: "Gesloten", agg: "sum" }],
  },
  // build 133: Lifetime-aankopen via Stripe (billing_purchases): betaald en terugbetaald/chargeback, alleen aantallen
  purchases: {
    label: "Aankopen", unit: "aankopen",
    series: [{ key: "paid", label: "Betaald", agg: "sum" }, { key: "refunded", label: "Terugbetaald", agg: "sum" }],
  },
};
export const METRIC_KEYS = Object.keys(METRICS);

// ---- tijdzone (zonder bibliotheek: Intl) ----

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
});
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export type Local = { y: number; m: number; d: number; h: number; mi: number; wd: number };
/** Lokale datum en tijd (Europe/Amsterdam) van een moment; wd: maandag = 0. */
export function local(ms: number): Local {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: WD[p.weekday] ?? 0 };
}
function offsetAt(ms: number) {
  const l = local(ms);
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi) - Math.floor(ms / 60000) * 60000;
}
/** Lokale wandkloktijd -> UTC-moment. Maand/dag mogen overlopen (Date.UTC normaliseert: dag 32 = volgende maand). */
export function fromLocal(y: number, m: number, d: number, h = 0, mi = 0): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess);
  const o2 = offsetAt(t);
  if (guess - o2 !== t) t = guess - o2;
  return t;
}

const H = 3600_000, MIN5 = 300_000;

export type Range = { edges: number[]; step: Step };
/** Grenzen (n+1 momenten in ms) van een periode. */
export function periodRange(period: Period, offset: number, now: number, fine = false): Range {
  const l = local(now);
  const hourStart = Math.floor(now / H) * H; // Amsterdam heeft hele uren als verschil met UTC
  const steps = (from: number, to: number, size: number) => { const e: number[] = []; for (let t = from; t <= to; t += size) e.push(t); return e; };
  const days = (y: number, m: number, d0: number, n: number) => Array.from({ length: n + 1 }, (_, i) => fromLocal(y, m, d0 + i));
  switch (period) {
    case "hour": { const s = hourStart + offset * H; return { edges: steps(s, s + H, MIN5), step: "5min" }; }
    case "24h": { const e = hourStart + H + offset * 24 * H; return { edges: steps(e - 24 * H, e, H), step: "hour" }; }
    case "day": {
      const s = fromLocal(l.y, l.m, l.d + offset), e = fromLocal(l.y, l.m, l.d + offset + 1);
      return { edges: steps(s, e, H), step: "hour" }; // 23 of 25 uur bij de overgang zomer-/wintertijd
    }
    case "week": case "7d": {
      const e = days(l.y, l.m, period === "week" ? l.d - l.wd + 7 * offset : l.d - 6 + 7 * offset, 7);
      return fine ? { edges: steps(e[0], e[7], H), step: "hour" } : { edges: e, step: "day" };
    }
    case "30d": return { edges: days(l.y, l.m, l.d - 29 + 30 * offset, 30), step: "day" };
    case "month": {
      const first = local(fromLocal(l.y, l.m + offset, 1) + 12 * H); // jaar/maand na overlopen
      const end = fromLocal(first.y, first.m + 1, 1);
      const e: number[] = [];
      for (let i = 0; ; i++) { const t = fromLocal(first.y, first.m, 1 + i); e.push(t); if (t >= end) break; }
      return { edges: e, step: "day" };
    }
    case "year": {
      // per week: 1 januari, dan elke maandag, tot 1 januari van het volgende jaar
      const y = l.y + offset, end = fromLocal(y + 1, 1, 1), e = [fromLocal(y, 1, 1)];
      const wd0 = local(e[0] + 12 * H).wd;
      for (let d = 1 + ((7 - wd0) % 7 || 7); ; d += 7) { const t = fromLocal(y, 1, d); if (t >= end) break; e.push(t); }
      e.push(end);
      return { edges: e, step: "week" };
    }
  }
}

export type InsightsQuery = { metric: string; period: Period; offset: number };
/** Controleert de aanvraag `insights {metric, period, offset}`. */
export function parseQuery(body: Record<string, unknown>, now = Date.now()): InsightsQuery | { error: string } {
  const metric = String(body.metric ?? "");
  if (!METRIC_KEYS.includes(metric)) return { error: "bad_metric" };
  const period = String(body.period ?? "") as Period;
  if (!(PERIODS as readonly string[]).includes(period)) return { error: "bad_period" };
  const offset = body.offset === undefined || body.offset === null ? 0 : body.offset;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset > 0 || offset < -2000) return { error: "bad_offset" };
  if (offset < 0 && periodRange(period, offset, now).edges[0] < now - HISTORY_DAYS * 24 * H) return { error: "bad_offset" };
  return { metric, period, offset };
}

export type Plan = InsightsQuery & {
  step: Step; daily: boolean;
  cur: number[]; prev: number[];
  /** Grenzen voor de database: vorige ++ huidige (aaneengesloten). */
  edges: number[];
  hasPrev: boolean;
};
export function plan(q: InsightsQuery, now: number): Plan {
  // fijnere resolutie voor week / 7 dagen als alle series dat kunnen
  const m = METRICS[q.metric];
  const fine = !m.series.some((s) => s.dailyOnly)
    && !m.series.some((s) => s.recentSubDay && periodRange(q.period, q.offset, now).edges[0] < now - s.recentSubDay * 24 * H);
  const cur = periodRange(q.period, q.offset, now, fine), prev = periodRange(q.period, q.offset - 1, now, fine);
  if (prev.edges[prev.edges.length - 1] !== cur.edges[0]) throw new Error("periodes sluiten niet aan");
  return {
    ...q, step: cur.step, daily: cur.step === "day" || cur.step === "week",
    cur: cur.edges, prev: prev.edges, edges: [...prev.edges, ...cur.edges.slice(1)],
    hasPrev: prev.edges[0] >= now - HISTORY_DAYS * 24 * H, // naar offset - 1 bladeren mag
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const round1 = (v: number) => Math.round(v * 10) / 10;

export type Summary = { total: number; avg: number; min: number; max: number; last: number | null; prev: number | null; change_pct: number | null };
export type SeriesOut = { key: string; label: string; agg: Agg; available: boolean; values: (number | null)[]; prev_values: (number | null)[]; summary: Summary | null };
/** Storing (monitor) of gepland onderhoud op de tijdas; alleen naam en tijden, zoals op de openbare statuspagina. */
export type InsightEvent = { kind: "incident" | "maintenance"; name: string; from: string; to: string | null };
const MAX_EVENTS = 40;
/** Gebeurtenissen uit bingr_admin_insights_events, beperkt tot de periode (geen oorzaak, doel of andere velden). */
export function cleanEvents(raw: unknown, from: number, to: number): InsightEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: InsightEvent[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const a = typeof o.from === "string" ? Date.parse(o.from) : NaN, b = typeof o.to === "string" ? Date.parse(o.to) : null;
    if (!Number.isFinite(a) || (b !== null && !Number.isFinite(b)) || a >= to || (b !== null && b <= from)) continue;
    out.push({
      kind: o.kind === "maintenance" ? "maintenance" : "incident",
      name: typeof o.name === "string" ? o.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) : "",
      from: new Date(a).toISOString(), to: b === null ? null : new Date(b).toISOString(),
    });
    if (out.length >= MAX_EVENTS) break;
  }
  return out;
}

export type InsightsOut = {
  metric: string; label: string; unit: string; period: Period; offset: number; step: Step; tz: string;
  from: string; to: string; edges: string[]; prev_from: string; prev_to: string;
  now_index: number | null; has_prev: boolean; has_next: boolean; series: SeriesOut[]; events?: InsightEvent[];
};

/** Samenvatting: totaal (of gemiddelde), min, max en de waarde van nu, met verandering t.o.v. dezelfde stukken van de vorige periode. */
export function summarize(values: (number | null)[], prevValues: (number | null)[], agg: Agg): Summary | null {
  const idx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const vs = idx.map((i) => values[i] as number);
  const total = vs.reduce((a, b) => a + b, 0);
  // vergelijkbaar deel van de vorige periode: evenveel tijdvakken als er in deze periode al voorbij zijn
  // ontbreekt een deel van de vorige periode (niet meer bewaard), dan geen vergelijking
  const slice = prevValues.slice(0, idx.length);
  const pv = slice.length === idx.length && slice.every((v) => v !== null) ? slice as number[] : [];
  const pTotal = pv.reduce((a, b) => a + b, 0);
  const cur = agg === "sum" ? total : total / vs.length;
  const prev = pv.length ? (agg === "sum" ? pTotal : pTotal / pv.length) : null;
  return {
    total, avg: round1(total / vs.length), min: Math.min(...vs), max: Math.max(...vs), last: vs[vs.length - 1],
    prev: prev === null ? null : round1(prev),
    change_pct: prev === null || prev === 0 ? null : round1(((cur - prev) / prev) * 100),
  };
}

/** Antwoord voor de apps uit het plan en de tellingen van bingr_admin_insights ({key: [aantal per tijdvak] | null}). */
export function build(p: Plan, raw: unknown, now: number, events?: unknown): InsightsOut {
  const m = METRICS[p.metric], data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const np = p.prev.length - 1, nc = p.cur.length - 1;
  // tijdvak waarin "nu" valt; latere tijdvakken (toekomst) blijven leeg (null), zodat de lijn bij nu stopt
  let nowIndex: number | null = null;
  for (let i = 0; i < nc; i++) if (p.cur[i] <= now && now < p.cur[i + 1]) nowIndex = i;
  const series = m.series.map((s): SeriesOut => {
    const arr = Array.isArray(data[s.key]) ? data[s.key] as unknown[] : null;
    const available = !!arr && arr.length === np + nc && !(s.dailyOnly && !p.daily);
    const at = (edges: number[], i: number, v: unknown): number | null => {
      if (edges[i] > now) return null; // toekomst
      if (s.recentSubDay && !p.daily && edges[i] < now - s.recentSubDay * 24 * H) return null; // niet meer bewaard
      // gemiddelde per dag (actieve accounts) in een week: totaal van de dagen / aantal dagen
      if (s.agg === "avg" && p.step === "week") return round1(num(v) / Math.max(1, Math.round((edges[i + 1] - edges[i]) / (24 * H))));
      return num(v);
    };
    const prevValues = available ? Array.from({ length: np }, (_, i) => at(p.prev, i, arr![i])) : [];
    const values = available ? Array.from({ length: nc }, (_, i) => at(p.cur, i, arr![np + i])) : [];
    return { key: s.key, label: s.label, agg: s.agg, available, values, prev_values: prevValues, summary: available ? summarize(values, prevValues, s.agg) : null };
  });
  const iso = (t: number) => new Date(t).toISOString();
  return {
    metric: p.metric, label: m.label, unit: m.unit, period: p.period, offset: p.offset, step: p.step, tz: TZ,
    from: iso(p.cur[0]), to: iso(p.cur[nc]), edges: p.cur.map(iso), prev_from: iso(p.prev[0]), prev_to: iso(p.prev[np]),
    now_index: nowIndex, has_prev: p.hasPrev, has_next: p.offset < 0, series,
    ...(events !== undefined ? { events: cleanEvents(events, p.cur[0], p.cur[nc]) } : {}),
  };
}
