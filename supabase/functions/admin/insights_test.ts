// deno test supabase/functions/admin/insights_test.ts
// Alleen verzonnen tellingen; geen gegevens per persoon.
import { build, cleanEvents, fromLocal, HISTORY_DAYS, local, METRICS, parseQuery, periodRange, plan, summarize } from "./insights.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const H = 3600_000;
const iso = (t: number) => new Date(t).toISOString();
// zondag 18 oktober 2026, 14:37 Nederlandse tijd (zomertijd, UTC+2)
const NOW = Date.parse("2026-10-18T12:37:00Z");

Deno.test("lokale tijd en terugrekenen (zomer- en wintertijd)", () => {
  const l = local(NOW);
  eq([l.y, l.m, l.d, l.h, l.mi, l.wd], [2026, 10, 18, 14, 37, 6], "lokale tijd");
  eq(iso(fromLocal(2026, 10, 18)), "2026-10-17T22:00:00.000Z", "middernacht zomertijd");
  eq(iso(fromLocal(2026, 12, 1)), "2026-11-30T23:00:00.000Z", "middernacht wintertijd");
  eq(iso(fromLocal(2026, 13, 1)), "2026-12-31T23:00:00.000Z", "maand loopt over naar volgend jaar");
});

Deno.test("periodes: aantal tijdvakken en grenzen", () => {
  const r = (p: Parameters<typeof periodRange>[0], o = 0) => periodRange(p, o, NOW);
  eq([r("hour").edges.length - 1, r("hour").step, iso(r("hour").edges[0])], [12, "5min", "2026-10-18T12:00:00.000Z"], "uur");
  eq([r("24h").edges.length - 1, iso(r("24h").edges[24])], [24, "2026-10-18T13:00:00.000Z"], "24 uur tot het volgende hele uur");
  eq([r("day").edges.length - 1, iso(r("day").edges[0])], [24, "2026-10-17T22:00:00.000Z"], "vandaag");
  eq([r("week").edges.length - 1, iso(r("week").edges[0]), r("week").step], [7, "2026-10-11T22:00:00.000Z", "day"], "week vanaf maandag");
  eq([r("7d").edges.length - 1, iso(r("7d").edges[0])], [7, "2026-10-11T22:00:00.000Z"], "7 dagen incl. vandaag");
  eq(r("30d").edges.length - 1, 30, "30 dagen");
  eq([r("month").edges.length - 1, iso(r("month").edges[0])], [31, "2026-09-30T22:00:00.000Z"], "oktober");
  eq(r("month", -1).edges.length - 1, 30, "september");
  eq(r("month", -8).edges.length - 1, 28, "februari 2026");
  // 2026: 1 januari is een donderdag; weken vanaf maandag 5 januari, laatste week 28–31 december
  eq([r("year").edges.length - 1, r("year").step, iso(r("year").edges[0]), iso(r("year").edges[1])], [53, "week", "2025-12-31T23:00:00.000Z", "2026-01-04T23:00:00.000Z"], "jaar per week");
  eq(iso(r("year").edges[53]), "2026-12-31T23:00:00.000Z", "jaar eindigt op 1 januari");
  eq([periodRange("week", 0, NOW, true).edges.length - 1, periodRange("week", 0, NOW, true).step], [168, "hour"], "week per uur");
  // 25 oktober 2026: wintertijd begint, de dag heeft 25 uur
  eq(periodRange("day", 0, Date.parse("2026-10-25T10:00:00Z")).edges.length - 1, 25, "dag met 25 uur");
  eq(periodRange("day", 0, Date.parse("2026-03-29T10:00:00Z")).edges.length - 1, 23, "dag met 23 uur");
  // grenzen oplopend en aaneengesloten met de vorige periode
  for (const p of ["hour", "day", "week", "month", "year", "24h", "7d", "30d"] as const) {
    for (const o of [0, -1, -5]) {
      const cur = r(p, o), prev = r(p, o - 1);
      ok(cur.edges.every((t, i) => i === 0 || t > cur.edges[i - 1]), `${p} ${o} oplopend`);
      eq(prev.edges[prev.edges.length - 1], cur.edges[0], `${p} ${o} sluit aan`);
    }
  }
});

Deno.test("aanvraag controleren", () => {
  eq(parseQuery({ metric: "accounts", period: "30d" }, NOW), { metric: "accounts", period: "30d", offset: 0 }, "standaard offset 0");
  eq(parseQuery({ metric: "x", period: "30d" }, NOW), { error: "bad_metric" }, "onbekende metric");
  eq(parseQuery({ metric: "push", period: "eeuw" }, NOW), { error: "bad_period" }, "onbekende periode");
  eq(parseQuery({ metric: "push", period: "day", offset: 1 }, NOW), { error: "bad_offset" }, "geen toekomst");
  eq(parseQuery({ metric: "push", period: "day", offset: -1.5 }, NOW), { error: "bad_offset" }, "geen breuk");
  eq(parseQuery({ metric: "push", period: "day", offset: "-1" }, NOW), { error: "bad_offset" }, "geen tekst");
  eq(parseQuery({ metric: "push", period: "year", offset: -4 }, NOW), { error: "bad_offset" }, "te ver terug");
  eq(parseQuery({ metric: "push", period: "year", offset: -2 }, NOW), { metric: "push", period: "year", offset: -2 }, "2024 mag");
  ok(!plan({ metric: "push", period: "year", offset: -2 }, NOW).hasPrev, "voor 2024 niet verder terug");
  ok(plan({ metric: "push", period: "year", offset: -1 }, NOW).hasPrev, "2025 heeft een vorige");
  ok(HISTORY_DAYS > 365 * 2, "minstens twee jaar terug");
});

Deno.test("plan: grenzen voor de database zijn vorige ++ huidige", () => {
  const p = plan({ metric: "accounts", period: "week", offset: 0 }, NOW);
  eq([p.edges.length, p.daily, p.step], [15, true, "day"], "14 dagen in één reeks");
  eq(p.edges[7], p.cur[0], "huidige begint waar vorige eindigt");
  ok(!plan({ metric: "accounts", period: "day", offset: 0 }, NOW).daily, "per uur is niet per dag");
});

Deno.test("resolutie past zich aan de metric en de bewaartermijn aan", () => {
  eq(plan({ metric: "push", period: "week", offset: 0 }, NOW).step, "hour", "pushmeldingen: week per uur");
  eq(plan({ metric: "accounts", period: "7d", offset: 0 }, NOW).step, "day", "actieve accounts bestaan alleen per dag");
  eq(plan({ metric: "streams", period: "7d", offset: 0 }, NOW).step, "hour", "streams van deze week per uur");
  eq(plan({ metric: "streams", period: "week", offset: -2 }, NOW).step, "day", "streams van 2 weken terug per dag");
  const p = plan({ metric: "streams", period: "7d", offset: 0 }, NOW);
  const out = build(p, { live: Array(p.edges.length - 1).fill(1), movie: Array(p.edges.length - 1).fill(1), episode: Array(p.edges.length - 1).fill(1) }, NOW);
  eq(out.series[0].summary!.prev, null, "vorige 7 dagen deels niet bewaard: geen vergelijking");
  const y = plan({ metric: "accounts", period: "year", offset: -1 }, NOW);
  const oy = build(y, { new_users: Array(y.edges.length - 1).fill(7), active_users: Array(y.edges.length - 1).fill(70) }, NOW);
  eq(oy.series[1].values[1], 10, "actieve accounts per week = gemiddelde per dag");
});

Deno.test("storingen en onderhoud op de tijdas: alleen naam en tijden", () => {
  const from = Date.parse("2026-10-01T00:00:00Z"), to = Date.parse("2026-10-08T00:00:00Z");
  const ev = cleanEvents([
    { kind: "incident", name: "API <b>", from: "2026-10-02T10:00:00Z", to: "2026-10-02T11:00:00Z", cause: "geheim" },
    { kind: "maintenance", name: "Database", from: "2026-10-07T23:00:00Z", to: null },
    { kind: "incident", name: "oud", from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" },
    { kind: "x", name: 5, from: "nee" },
  ], from, to);
  eq(ev.length, 2, "buiten de periode en ongeldig vallen weg");
  eq(ev[0], { kind: "incident", name: "API b", from: "2026-10-02T10:00:00.000Z", to: "2026-10-02T11:00:00.000Z" }, "geen oorzaak, geen tekens als <>");
  eq(ev[1].to, null, "lopend");
  eq(cleanEvents("x", from, to), [], "geen lijst");
});

Deno.test("samenvatting: totaal, min, max, nu en verandering", () => {
  const s = summarize([2, 4, 0, null], [1, 1, 2, 10], "sum")!;
  eq([s.total, s.min, s.max, s.last, s.avg], [6, 0, 4, 0, 2], "waarden");
  // vergelijking met dezelfde 3 tijdvakken van de vorige periode (1+1+2 = 4): +50%
  eq([s.prev, s.change_pct], [4, 50], "verandering");
  eq(summarize([1, 2], [null, 3], "sum")!.prev, null, "deels onbekende vorige periode");
  const a = summarize([10, 20], [15, 15], "avg")!;
  eq([a.avg, a.prev, a.change_pct], [15, 15, 0], "gemiddelde");
  eq(summarize([null, null], [1, 2], "sum"), null, "leeg");
  eq(summarize([3], [0], "sum")!.change_pct, null, "vorige 0: geen percentage");
});

Deno.test("antwoord: toekomst leeg, alleen-per-dag-series en bewaartermijn", () => {
  const p = plan({ metric: "accounts", period: "day", offset: 0 }, NOW);
  const n = p.edges.length - 1;
  const out = build(p, { new_users: Array(n).fill(1), active_users: Array(n).fill(5) }, NOW);
  eq(out.series.map((s) => s.key), ["new_users", "active_users"], "series in vaste volgorde");
  eq(out.now_index, 14, "nu = 14:00-15:00");
  eq(out.series[0].values.filter((v) => v === null).length, 9, "15:00-24:00 is toekomst");
  eq(out.series[0].summary!.total, 15, "totaal tot nu");
  ok(!out.series[1].available, "actieve accounts niet per uur");
  ok(out.has_prev && !out.has_next, "bladeren");
  eq(out.edges.length, 25, "grenzen van de huidige periode");

  const old = plan({ metric: "streams", period: "day", offset: -10 }, NOW);
  const o2 = build(old, { live: Array(old.edges.length - 1).fill(2), movie: null, episode: Array(3).fill(1) }, NOW);
  ok(o2.series[0].available && o2.series[0].values.every((v) => v === null), "per uur ouder dan 8 dagen: niet meer bewaard");
  ok(!o2.series[1].available && !o2.series[2].available, "ontbrekende of verkeerde reeks = niet beschikbaar");
  eq(o2.series[0].summary, null, "geen samenvatting zonder gegevens");

  const w = plan({ metric: "streams", period: "30d", offset: -1 }, NOW);
  const o3 = build(w, { live: Array(w.edges.length - 1).fill(1), movie: Array(60).fill(0), episode: Array(60).fill(0) }, NOW);
  eq(o3.series[0].summary!.total, 30, "per dag: hele periode");
  ok(o3.now_index === null && o3.has_next, "vorige periode: geen nu, wel volgende");
});

Deno.test("antwoord bevat alleen aantallen (geen persoonsgegevens)", () => {
  const p = plan({ metric: "support", period: "7d", offset: 0 }, NOW);
  const out = build(p, { new: Array(14).fill(1), closed: Array(14).fill(0), email: ["x@example.com"] }, NOW);
  const text = JSON.stringify(out);
  ok(!text.includes("@"), "geen extra velden uit de database");
  ok(out.series.every((s) => s.values.every((v) => v === null || typeof v === "number")), "alleen getallen");
  ok(Object.values(METRICS).every((m) => m.series.length <= 3), "hoogstens 3 series (kleurenpalet)");
});

// build 133 voegde de metric purchases toe zonder label in web/admin.js (OPT_LABEL.insight): de tab Insights brak
// (TypeError bij het opbouwen van de bronnen). Elke metric moet in het dashboard een naam, series en label hebben.
Deno.test("web-dashboard kent alle metrics (INS_METRICS en OPT_LABEL.insight)", async () => {
  const js = await Deno.readTextFile(new URL("../../../web/admin.js", import.meta.url));
  const ins = js.split("const INS_METRICS = {")[1]?.split("\n  };")[0] ?? "";
  const lab = /insight: \["Gegevens", \{([^\n]*)\}\]/.exec(js)?.[1] ?? "";
  for (const [k, m] of Object.entries(METRICS)) {
    const row = new RegExp(`\\n\\s*${k}: \\{ name: "[^"]+", series: \\[([^\\]]*)\\] \\}`).exec(ins);
    ok(row, `INS_METRICS in web/admin.js mist ${k}`);
    eq(row![1].replace(/[" ]/g, "").split(","), m.series.map((s) => s.key), `series van ${k} in web/admin.js`);
    ok(new RegExp(`(^|[ ,])${k}: "[^"]+"`).test(lab), `OPT_LABEL.insight in web/admin.js mist ${k}`);
  }
});
