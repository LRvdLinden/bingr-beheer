// deno test supabase/functions/admin/widget_test.ts
// De sleutels hieronder zijn testwaarden (geen echte secrets); de status- en supportgegevens zijn verzonnen.
import {
  actionAllowed, b64u, readToken, signToken, summarizeStatus, summarizeSupport, WIDGET_SCOPE, WIDGET_TTL_MS,
} from "./widget.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const ADMIN = "bingr-admin-v2|test-user|test-wachtwoord-123|test-service-role";
const WIDGET = "bingr-admin-widget-v1|test-user|test-wachtwoord-123|test-service-role";
const NOW = Date.parse("2026-10-16T12:00:00Z");
const H12 = 12 * 3600 * 1000;
const claims = (t: string) => {
  const p = t.split(".")[0];
  return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4)));
};
// eigen payload ondertekenen met een sleutel (om vervalsingen na te bootsen)
async function forge(material: string, body: unknown) {
  const raw = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material)));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = b64u(new TextEncoder().encode(JSON.stringify(body)));
  return `${payload}.${b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))}`;
}

Deno.test("beheer-token: zelfde vorm als vroeger ({v, exp, j}, geen s) en geldig als beheer-token", async () => {
  const { token, exp } = await signToken(ADMIN, 3, H12, undefined, NOW);
  const c = claims(token);
  ok(Object.keys(c).join(",") === "v,exp,j" && c.v === 3 && c.exp === NOW + H12 && exp === NOW + H12, `claims ${JSON.stringify(c)}`);
  const p = await readToken(ADMIN, token, null, NOW);
  ok(p && p.v === 3 && p.s === undefined, "beheer-token geldig");
});

Deno.test("beheer-token: handgemaakt oud token (makeToken van build 97) blijft geldig", async () => {
  const t = await forge(ADMIN, { v: 7, exp: NOW + 1000, j: "abc" });
  ok((await readToken(ADMIN, t, null, NOW))?.v === 7, "oud token geldig");
});

Deno.test("widget-token: scope widget, 30 dagen, alleen geldig als widget-token", async () => {
  const { token, exp } = await signToken(WIDGET, 4, WIDGET_TTL_MS, WIDGET_SCOPE, NOW);
  const c = claims(token);
  ok(c.s === "widget" && c.v === 4 && exp === NOW + 30 * 864e5, `claims ${JSON.stringify(c)}`);
  ok((await readToken(WIDGET, token, WIDGET_SCOPE, NOW))?.s === "widget", "widget-token geldig");
  ok((await readToken(WIDGET, token, WIDGET_SCOPE, NOW + 29 * 864e5))?.v === 4, "na 29 dagen nog geldig");
  ok(await readToken(WIDGET, token, WIDGET_SCOPE, NOW + 30 * 864e5) === null, "na 30 dagen verlopen");
});

Deno.test("scope: widget-token geldt nooit als beheer-token", async () => {
  const { token } = await signToken(WIDGET, 1, WIDGET_TTL_MS, WIDGET_SCOPE, NOW);
  ok(await readToken(ADMIN, token, null, NOW) === null, "andere sleutel");
  ok(await readToken(WIDGET, token, null, NOW) === null, "zelfs met de widget-sleutel: s aanwezig");
  // een token met s, maar ondertekend met de beheer-sleutel: ook niet als beheer-token
  const t2 = await forge(ADMIN, { s: "widget", v: 1, exp: NOW + 1000, j: "x" });
  ok(await readToken(ADMIN, t2, null, NOW) === null, "s met beheer-sleutel");
  ok(await readToken(ADMIN, await forge(ADMIN, { s: "", v: 1, exp: NOW + 1000 }), null, NOW) === null, "lege s");
  ok(await readToken(ADMIN, await forge(ADMIN, { s: null, v: 1, exp: NOW + 1000 }), null, NOW) === null, "s = null");
});

Deno.test("scope: beheer-token geldt nooit als widget-token", async () => {
  const { token } = await signToken(ADMIN, 1, H12, undefined, NOW);
  ok(await readToken(WIDGET, token, WIDGET_SCOPE, NOW) === null, "andere sleutel");
  ok(await readToken(ADMIN, token, WIDGET_SCOPE, NOW) === null, "geen s");
  // met de widget-sleutel maar zonder of met een andere scope
  ok(await readToken(WIDGET, await forge(WIDGET, { v: 1, exp: NOW + 1000, j: "x" }), WIDGET_SCOPE, NOW) === null, "zonder s");
  ok(await readToken(WIDGET, await forge(WIDGET, { s: "admin", v: 1, exp: NOW + 1000 }), WIDGET_SCOPE, NOW) === null, "s = admin");
  ok(await readToken(WIDGET, await forge(WIDGET, { s: "Widget", v: 1, exp: NOW + 1000 }), WIDGET_SCOPE, NOW) === null, "hoofdletter");
});

Deno.test("tokens: vervalst, gewijzigd, verlopen of onzin wordt geweigerd", async () => {
  const { token } = await signToken(WIDGET, 2, WIDGET_TTL_MS, WIDGET_SCOPE, NOW);
  const [p, s] = token.split(".");
  // payload aangepast (langere geldigheid), handtekening van het origineel
  const c = claims(token);
  const p2 = b64u(new TextEncoder().encode(JSON.stringify({ ...c, exp: c.exp + 365 * 864e5 })));
  ok(await readToken(WIDGET, `${p2}.${s}`, WIDGET_SCOPE, NOW) === null, "andere payload");
  ok(await readToken(WIDGET, `${p}.${s.slice(0, -2)}AA`, WIDGET_SCOPE, NOW) === null, "andere handtekening");
  ok(await readToken(WIDGET + "x", token, WIDGET_SCOPE, NOW) === null, "ander wachtwoord = andere sleutel");
  ok(await readToken("", token, WIDGET_SCOPE, NOW) === null, "geen sleutel");
  for (const bad of [undefined, null, 1, {}, "", ".", "a.b", `${p}.${s}.x`, `${p}`, "x".repeat(501), "!!!.???"]) {
    ok(await readToken(WIDGET, bad, WIDGET_SCOPE, NOW) === null, `onzin ${String(bad).slice(0, 20)}`);
  }
  ok(await readToken(WIDGET, await forge(WIDGET, { s: "widget", v: "1", exp: NOW + 1000 }), WIDGET_SCOPE, NOW) === null, "v geen getal");
  ok(await readToken(WIDGET, await forge(WIDGET, { s: "widget", v: 1, exp: String(NOW + 1000) }), WIDGET_SCOPE, NOW) === null, "exp geen getal");
  ok(await readToken(WIDGET, await forge(WIDGET, { s: "widget", v: 1, exp: NOW }), WIDGET_SCOPE, NOW) === null, "exp = nu");
  ok(await readToken(WIDGET, await forge(WIDGET, ["widget"]), WIDGET_SCOPE, NOW) === null, "array");
});

Deno.test("acties: widget-token alleen widget_summary, beheer-token alles behalve widget_summary", () => {
  ok(actionAllowed(WIDGET_SCOPE, "widget_summary"), "widget -> widget_summary");
  for (const a of ["stats", "users", "user_detail", "user_block", "user_delete", "support_list", "support_get", "support_counts",
    "status", "widget_token", "logout_all", "builds", "build_link", "app_settings_set", "announce", ""]) {
    ok(!actionAllowed(WIDGET_SCOPE, a), `widget mag geen ${a}`);
    ok(actionAllowed(null, a), `beheer mag ${a}`);
  }
  ok(!actionAllowed(null, "widget_summary"), "beheer -> widget_summary niet");
  ok(!actionAllowed("admin", "stats") && !actionAllowed("", "widget_summary"), "onbekende scope: niets");
});

Deno.test("status: niveaus, informatie- en uitgezette monitors weg, geen target/fouten", () => {
  const raw = {
    generated_at: "2026-10-16T12:00:00Z",
    overall: { state: "degraded", level: "degraded", down: [], degraded: ["api"] },
    groups: [
      { id: "web", name: { nl: "Website", en: "Website" }, monitors: [
        { id: "site", name: { nl: "bingr.online", en: "bingr.online" }, state: "up", status: "operational", checked_at: "2026-10-16T11:58:00Z",
          kind: "http", target: "https://intern.voorbeeld/health", last_error: "geheim detail", enabled: true },
        { id: "api", name: { nl: "API", en: "API" }, state: "degraded", status: "degraded", checked_at: "2026-10-16T11:59:00Z", kind: "http", enabled: true },
        { id: "uit", name: { nl: "Uit", en: "Off" }, state: "down", status: "major", kind: "http", enabled: false },
      ] },
      { id: "apps", name: { nl: "Apps", en: "Apps" }, monitors: [
        { id: "devices", name: { nl: "Apparaten", en: "Devices" }, state: null, kind: "devices", enabled: true },
        { id: "oud", name: { nl: "Oud" }, state: "down" },
      ] },
    ],
    notices: { active: [{ id: 1 }], upcoming: [], recent: [] },
    incidents: [{ id: 1, ended_at: null }, { id: 2, ended_at: "2026-10-15T10:00:00Z" }],
    alerts: { email: "iemand@voorbeeld.nl" },
    subscribers: { confirmed: 12 },
  };
  const s = summarizeStatus(raw)!;
  ok(s.level === "degraded", `level ${s.level}`);
  ok(s.components.map((c) => c.id).join(",") === "oud,api,site", `volgorde ${s.components.map((c) => c.id)}`);
  ok(s.components[0].level === "major" && s.components[0].group === "Apps", "oud zonder status: state down -> major");
  ok(s.counts.operational === 1 && s.counts.degraded === 1 && s.counts.major === 1, `counts ${JSON.stringify(s.counts)}`);
  ok(s.active_notices === 1 && s.open_incidents === 1, "meldingen en storingen");
  ok(s.checked_at === "2026-10-16T11:59:00.000Z", `checked_at ${s.checked_at}`);
  const text = JSON.stringify(s);
  for (const leak of ["intern.voorbeeld", "geheim", "@", "target", "subscribers", "Apparaten"]) ok(!text.includes(leak), `lekt ${leak}`);
});

Deno.test("status: zonder level de oude state; onbekende waarden; leeg/fout antwoord = null", () => {
  const s = summarizeStatus({ overall: { state: "down" }, groups: [{ id: "g", monitors: [{ id: "m", state: "weird", status: "boom" }] }] })!;
  ok(s.level === "major" && s.components[0].level === "unknown" && s.components[0].name === "m" && s.components[0].group === "g", JSON.stringify(s));
  ok(summarizeStatus(null) === null && summarizeStatus({ error: "forbidden" }) === null && summarizeStatus([]) === null, "null");
  const many = { overall: { level: "operational" }, groups: [{ id: "g", monitors: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, status: "operational" })) }] };
  ok(summarizeStatus(many)!.components.length === 24 && summarizeStatus(many)!.counts.operational === 40, "max 24 onderdelen, tellers volledig");
});

Deno.test("support: alleen aantallen", () => {
  const s = summarizeSupport({ new: 2, open: 3, pending: 1, resolved: 10, closed: 40, active: 6, unread: 2, total: 56, last_7d: 5, smtp: true,
    items: [{ email: "klant@voorbeeld.nl" }] })!;
  ok(s.new === 2 && s.open === 3 && s.pending === 1 && s.resolved === 10 && s.closed === 40 && s.active === 6 && s.total === 56, JSON.stringify(s));
  ok(Object.keys(s).sort().join(",") === "active,closed,last_7d,new,open,pending,resolved,total,unread", `velden ${Object.keys(s)}`);
  ok(summarizeSupport({ new: -1, open: "3", pending: 1.7, total: 0 })!.new === 0, "negatief -> 0");
  ok(summarizeSupport({ new: -1, open: "3", pending: 1.7, total: 0 })!.open === 0, "tekst -> 0");
  ok(summarizeSupport({ new: -1, open: "3", pending: 1.7, total: 0 })!.pending === 1, "afgerond naar beneden");
  ok(summarizeSupport({ error: "forbidden" }) === null && summarizeSupport(null) === null, "fout = null");
});
