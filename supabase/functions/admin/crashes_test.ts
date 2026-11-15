// deno test supabase/functions/admin/crashes_test.ts — tab Crashes (build 171), zonder netwerk of database. Verzonnen gegevens.
import { detailView, listView, parseCrashes, statusText } from "./crashes.ts";

const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

Deno.test("invoer: lijst met filters en standaarden", () => {
  eq(parseCrashes({}), { op: "list", platform: null, build: null, status: "all", limit: 200 }, "standaard");
  eq(parseCrashes({ platform: "ANDROID", build: "171", status: "regressed", limit: 9999 }), { op: "list", platform: "android", build: 171, status: "regressed", limit: 500 }, "filters");
  eq(parseCrashes({ platform: "all" }), { op: "list", platform: null, build: null, status: "all", limit: 200 }, "platform all");
  eq(parseCrashes({ platform: "tizen" }), { error: "bad_platform" }, "tizen");
  eq(parseCrashes({ build: "abc" }), { error: "bad_build" }, "build");
  eq(parseCrashes({ status: "kapot" }), { error: "bad_status" }, "status");
  eq(parseCrashes({ op: "x" }), { error: "bad_op" }, "op");
});

Deno.test("invoer: details en opgelost markeren", () => {
  eq(parseCrashes({ op: "detail", signature: "SIG", build: 171 }), { op: "detail", signature: "SIG", platform: null, build: 171, limit: 20 }, "detail");
  eq(parseCrashes({ op: "detail" }), { error: "bad_signature" }, "detail zonder signature");
  eq(parseCrashes({ op: "detail", signature: "x".repeat(201) }), { error: "bad_signature" }, "te lang");
  eq(parseCrashes({ op: "resolve", signature: "SIG", resolved_build: 172 }), { op: "resolve", signature: "SIG", build: 172 }, "resolve");
  eq(parseCrashes({ op: "resolve", signature: "SIG", resolved_build: null }), { op: "resolve", signature: "SIG", build: null }, "weer open");
  eq(parseCrashes({ op: "resolve", signature: "SIG", resolved_build: 0 }), { error: "bad_build" }, "build 0");
});

Deno.test("lijst: vaste vorm, onbekende platforms weg, builds aflopend", () => {
  const v = listView({
    groups: [
      { signature: "SIG-A", kind: "crash", reports: 3, occurrences: 5, platforms: ["ios", "tizen"], builds: [170, 171, "x"], devices: 2, accounts: 1,
        first_seen: "2026-11-14T10:00:00Z", last_seen: "2026-11-15T10:00:00Z", message: "m", app_version: "1.0.7 (171)", status: "regressed",
        resolved_build: 171, resolved_at: "2026-11-14T12:00:00Z", regressed_at: "2026-11-15T10:00:00Z", account_hash: "geheim" },
      { kind: "anr" },
    ],
    platforms: ["web", "ios", "webos"], builds: [170, 171], totals: { groups: 1, open: 0, regressed: 1, reports_24h: 3 },
  });
  eq(v.groups.length, 1, "groep zonder signature weg");
  eq(v.groups[0].platforms, ["ios"], "tizen weg");
  eq(v.groups[0].builds, [170, 171], "builds");
  eq("account_hash" in v.groups[0], false, "geen hashes");
  eq(v.platforms, ["ios", "web"], "platformlijst");
  eq(v.builds, [171, 170], "buildlijst aflopend");
  eq(v.totals, { groups: 1, open: 0, regressed: 1, reports_24h: 3 }, "totalen");
  eq(listView(null), { groups: [], platforms: [], builds: [], totals: { groups: 0, open: 0, regressed: 0, reports_24h: 0 } }, "leeg");
});

Deno.test("details: stack mee, geen hashes, onbekend = null", () => {
  const d = detailView({
    group: { signature: "SIG-A", kind: "anr", status: "open" },
    reports: [{ id: 7, platform: "android", kind: "anr", build: 171, stack: "at nl.lrvdlinden.bingr.Main(Main.kt:42)", message: "m", count: 2, signed_in: true, account_hash: "x", device_hash: "y" }],
  });
  eq(d?.reports[0].stack, "at nl.lrvdlinden.bingr.Main(Main.kt:42)", "stack");
  eq(d?.reports[0].signed_in, true, "ingelogd");
  eq("device_hash" in (d?.reports[0] ?? {}), false, "geen hash");
  eq(d?.group.kind, "anr", "soort");
  eq(detailView(null), null, "onbekend");
});

Deno.test("statustekst", () => {
  eq(statusText({ status: "open", resolved_build: null }), "Open", "open");
  eq(statusText({ status: "resolved", resolved_build: 172 }), "Opgelost in build 172", "opgelost");
  eq(statusText({ status: "regressed", resolved_build: 172 }), "Teruggekomen (opgelost in 172)", "terug");
});
