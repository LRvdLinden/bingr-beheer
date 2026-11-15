// Tab Crashes (build 171 van Bingr, actie crashes): eigen crashrapporten van de apps en de webspeler, gegroepeerd op
// signature. Contract en RPC's: docs/ACCOUNT.md "Build 171" in iptv-ios-appletv (bingr_admin_crashes, bingr_admin_crash_detail,
// bingr_admin_crash_resolve). De rapporten zijn al door de app én door device-auth opgeschoond (geen URL's, IP's, e-mailadressen
// of tokens) en hebben geen e-mail of account-id (alleen hashes, die hier niet naar buiten gaan). Hier alleen de invoer controleren
// en de antwoorden in een vaste vorm zetten. Pure logica, getest in crashes_test.ts.

export const CRASH_PLATFORMS = ["ios", "ipados", "tvos", "macos", "android", "androidtv", "web", "windows"] as const;
export const CRASH_STATUS = ["all", "open", "resolved", "regressed"] as const;
export const CRASH_OPS = ["list", "detail", "resolve"] as const;
export type CrashOp = typeof CRASH_OPS[number];
export type CrashQuery =
  | { op: "list"; platform: string | null; build: number | null; status: string; limit: number }
  | { op: "detail"; signature: string; platform: string | null; build: number | null; limit: number }
  | { op: "resolve"; signature: string; build: number | null };

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function buildOf(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : undefined;
}
function sig(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.length >= 1 && v.length <= 200 ? v : null;
}

/** Invoer van de actie crashes: {op?: list|detail|resolve, platform?, build?, status?, signature?, resolved_build?, limit?}. */
export function parseCrashes(body: unknown): CrashQuery | { error: string } {
  const b = isObj(body) ? body : {};
  const op = (b.op ?? "list") as CrashOp;
  if (!(CRASH_OPS as readonly string[]).includes(op)) return { error: "bad_op" };
  let platform: string | null = null;
  if (b.platform != null && b.platform !== "" && b.platform !== "all") {
    platform = String(b.platform).toLowerCase();
    if (!(CRASH_PLATFORMS as readonly string[]).includes(platform)) return { error: "bad_platform" };
  }
  if (op === "resolve") {
    const s = sig(b.signature);
    if (!s) return { error: "bad_signature" };
    const rb = buildOf(b.resolved_build);
    if (rb === undefined) return { error: "bad_build" };
    return { op, signature: s, build: rb };
  }
  const build = buildOf(b.build);
  if (build === undefined) return { error: "bad_build" };
  if (op === "detail") {
    const s = sig(b.signature);
    if (!s) return { error: "bad_signature" };
    return { op, signature: s, platform, build, limit: clampInt(b.limit, 20, 1, 100) };
  }
  const status = b.status == null || b.status === "" ? "all" : String(b.status);
  if (!(CRASH_STATUS as readonly string[]).includes(status)) return { error: "bad_status" };
  return { op, platform, build, status, limit: clampInt(b.limit, 200, 1, 500) };
}
function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
const status = (v: unknown) => ((CRASH_STATUS as readonly string[]).includes(String(v)) && v !== "all" ? String(v) : "open");
const plats = (v: unknown) => (Array.isArray(v) ? v.filter((x) => (CRASH_PLATFORMS as readonly string[]).includes(String(x))).map(String) : []);
const builds = (v: unknown) => (Array.isArray(v) ? v.map((x) => buildOf(x)).filter((x): x is number => typeof x === "number") : []);

export type CrashGroup = {
  signature: string; kind: string; reports: number; occurrences: number; platforms: string[]; builds: number[];
  devices: number; accounts: number; first_seen: string | null; last_seen: string | null; message: string | null;
  app_version: string | null; status: string; resolved_build: number | null; resolved_at: string | null; regressed_at: string | null;
};
function group(g: Obj): CrashGroup | null {
  const s = sig(g.signature);
  if (!s) return null;
  return {
    signature: s, kind: ["crash", "anr", "error"].includes(g.kind) ? g.kind : "crash",
    reports: num(g.reports), occurrences: num(g.occurrences) || num(g.reports), platforms: plats(g.platforms), builds: builds(g.builds),
    devices: num(g.devices), accounts: num(g.accounts), first_seen: iso(g.first_seen), last_seen: iso(g.last_seen),
    message: str(g.message, 500), app_version: str(g.app_version, 40), status: status(g.status),
    resolved_build: buildOf(g.resolved_build) ?? null, resolved_at: iso(g.resolved_at), regressed_at: iso(g.regressed_at),
  };
}

/** Antwoord van bingr_admin_crashes in een vaste vorm, met per groep de status-tekst voor de lijst. */
export function listView(data: unknown) {
  const d = isObj(data) ? data : {};
  const groups = (Array.isArray(d.groups) ? d.groups : []).map((g: unknown) => (isObj(g) ? group(g) : null)).filter((g): g is CrashGroup => !!g);
  const t = isObj(d.totals) ? d.totals : {};
  return {
    groups,
    platforms: plats(d.platforms).sort(),
    builds: builds(d.builds).sort((a, b) => b - a),
    totals: { groups: num(t.groups), open: num(t.open), regressed: num(t.regressed), reports_24h: num(t.reports_24h) },
  };
}

/** Antwoord van bingr_admin_crash_detail (null = onbekende groep). Nooit hashes naar buiten. */
export function detailView(data: unknown) {
  if (!isObj(data) || !isObj(data.group)) return null;
  const g = data.group;
  const reports = (Array.isArray(data.reports) ? data.reports : []).filter(isObj).map((r: Obj) => ({
    id: num(r.id), created_at: iso(r.created_at), occurred_at: iso(r.occurred_at),
    platform: (CRASH_PLATFORMS as readonly string[]).includes(r.platform) ? r.platform : null,
    kind: ["crash", "anr", "error"].includes(r.kind) ? r.kind : "crash",
    app_version: str(r.app_version, 40), build: buildOf(r.build) ?? null, os_version: str(r.os_version, 40), device_model: str(r.device_model, 60),
    message: str(r.message, 500), stack: str(r.stack, 16384), count: num(r.count) || 1, signed_in: r.signed_in === true,
  }));
  return {
    group: {
      signature: sig(g.signature) ?? "", kind: ["crash", "anr", "error"].includes(g.kind) ? g.kind : "crash",
      first_seen: iso(g.first_seen), last_seen: iso(g.last_seen), status: status(g.status),
      resolved_build: buildOf(g.resolved_build) ?? null, resolved_at: iso(g.resolved_at), regressed_at: iso(g.regressed_at),
    },
    reports,
  };
}

/** Tekst voor de status in de lijst: "Open", "Opgelost in build 172", "Teruggekomen (opgelost in 172)". */
export function statusText(g: { status: string; resolved_build: number | null }): string {
  if (g.status === "resolved") return `Opgelost in build ${g.resolved_build ?? "?"}`;
  if (g.status === "regressed") return `Teruggekomen (opgelost in ${g.resolved_build ?? "?"})`;
  return "Open";
}
