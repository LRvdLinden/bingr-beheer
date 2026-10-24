// deno test supabase/functions/admin/server_test.ts — tab Server (zonder netwerk of database)
import { buildServer, nowView, parseServer, planRange, serverPlan, SOURCE_KEYS } from "./server.ts";
function eq(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} verwacht ${y}, kreeg ${x}`);
}
const NOW = Date.parse("2026-10-24T10:00:00Z");
const day = (d: string, data: Record<string, unknown>) => ({ day: d, data });

Deno.test("invoer: periode en offset", () => {
  eq(parseServer({}), { period: "30d", offset: 0 });
  eq(parseServer({ period: "1y", offset: -2 }), { period: "1y", offset: -2 });
  eq(parseServer({ period: "24h" }), { error: "bad_period" });
  eq(parseServer({ period: "7d", offset: 1 }), { error: "bad_offset" });
  eq(parseServer({ period: "7d", offset: 0.5 }), { error: "bad_offset" });
});

Deno.test("plan: laatste 7 dagen incl. vandaag, vorige periode ervoor; jaar per week vanaf maandag", () => {
  const p = serverPlan({ period: "7d", offset: 0 }, NOW);
  eq([p.n, new Date(p.edges[0]).toISOString().slice(0, 10), new Date(p.edges[7]).toISOString().slice(0, 10)], [7, "2026-10-18", "2026-10-25"]);
  eq(planRange(p), { from: "2026-10-11", to: "2026-10-24" });
  const y = serverPlan({ period: "1y", offset: 0 }, NOW);
  eq([y.step, y.n, new Date(y.edges[52]).getUTCDay(), new Date(y.edges[52]).toISOString().slice(0, 10)], ["week", 52, 1, "2026-10-26"]);
  const back = serverPlan({ period: "30d", offset: -1 }, NOW);
  eq(new Date(back.edges[30]).toISOString().slice(0, 10), "2026-09-25");
});

Deno.test("reeksen: som, laatste waarde, piek, gemiddelde en vergelijking", () => {
  const p = serverPlan({ period: "7d", offset: 0 }, NOW);
  const rows = [
    day("2026-10-12", { new_users: 1, db_bytes: 100, streams_peak: 2 }),
    day("2026-10-20", { new_users: 2, db_bytes: 150, streams_peak: 4, active_users: 3, devices_active: { windows: 1, ios: 5 } }),
    day("2026-10-24", { new_users: 3, db_bytes: 200, streams_peak: 3, active_users: 5, devices_active: { windows: 2 } }),
    day("2026-10-30", { new_users: 99 }), // toekomst: telt niet
  ];
  const r = buildServer(p, rows, NOW);
  const s = (src: string, key: string) => (r.sources[src] as { series: { key: string; values: unknown[]; summary: Record<string, unknown> | null; bytes?: boolean }[] }).series.find((x) => x.key === key)!;
  eq(s("accounts", "new_users").values, [null, null, 2, null, null, null, 3]);
  eq(s("accounts", "new_users").summary!.total, 5);
  eq(s("accounts", "new_users").summary!.change_pct, 400);
  eq(s("database", "db_bytes").summary!.total, 200, "laatste waarde");
  eq(s("database", "db_bytes").bytes, true);
  eq(s("streams", "streams_peak").summary!.total, 4, "piek = max");
  eq(s("accounts", "active_users").summary!.total, 4, "gemiddelde");
  eq(s("devices", "windows").values.slice(-1), [2]);
  eq([r.now_index, r.has_prev, r.has_next, r.first_day], [6, true, false, "2026-10-12"]);
});

Deno.test("jaar per week: laatste waarde en som per week", () => {
  const p = serverPlan({ period: "1y", offset: 0 }, NOW);
  const r = buildServer(p, [day("2026-10-19", { db_bytes: 10, proxy_bytes: 5 }), day("2026-10-21", { db_bytes: 12, proxy_bytes: 7 })], NOW);
  const db = (r.sources.database as { series: { values: unknown[] }[] }).series[0].values;
  const px = (r.sources.proxy_bytes as { series: { values: unknown[] }[] }).series[0].values;
  eq([db[51], px[51], db[50]], [12, 12, null], "week van ma 19 okt");
});

Deno.test("Edge Functions: series per functie (meeste aanroepen eerst), alleen geldige namen", () => {
  const p = serverPlan({ period: "7d", offset: 0 }, NOW);
  const r = buildServer(p, [day("2026-10-23", { fn: { "device-auth": { calls: 50, errors: 1, avg_ms: 80 }, status: { calls: 288 }, "<x>": { calls: 9 } } })], NOW);
  eq(r.functions, ["status", "device-auth"]);
  const calls = (r.sources.fn_calls as { series: { key: string; values: unknown[] }[] }).series;
  eq(calls.map((x) => x.key), ["fn:status", "fn:device-auth"]);
  eq(calls[1].values[5], 50);
  eq((r.sources.fn_ms as { series: { ms?: boolean }[] }).series[0].ms, true);
  eq(Object.keys(r.sources), SOURCE_KEYS);
});

Deno.test("actuele stand: alleen bekende velden, getallen", () => {
  const v = nowView({ at: "2026-10-24T10:00:00Z", db: { bytes: "123" }, today: { streams_peak: 4, peak_h: { "9": 4, "x": 1, "30": 2 } },
    counts: { accounts: 3, geheim: "x" }, cron: [{ name: "bingr-status", command: "select geheim", active: true }], extra: "weg" })!;
  eq(v.db.bytes, 123);
  eq(v.today.peak_h, { "9": 4 });
  eq((v.counts as Record<string, unknown>).geheim, undefined);
  eq(JSON.stringify(v).includes("geheim"), false, "geen commando of onbekende velden");
  eq(nowView(null), null);
});
