// Widgets van de app BingrBeheer (functie admin): tokens met een scope en de samenvatting voor de widget.
// Pure hulpjes zonder netwerk of database, getest in widget_test.ts.
//
// Tokens = "<payload>.<sig>": payload = base64url (zonder =) van JSON, sig = base64url(HMAC-SHA256(sha256(materiaal), payload)).
// - Beheer-token (login):   {v, exp, j}            met het beheer-materiaal, 12 uur geldig. Heeft GEEN veld s.
// - Widget-token (widget_token, alleen na inloggen): {s:"widget", v, exp, j} met een APART materiaal (andere sleutel),
//   30 dagen geldig, alleen goed voor widget_summary. v = tokenversie (admin_token_state): "overal uitloggen" of een ander
//   wachtwoord trekt ook widget-tokens in. Een beheer-token is dus nooit een geldig widget-token (andere sleutel en geen s),
//   en een widget-token nooit een geldig beheer-token (andere sleutel en wel een s).

/** Scope van een widget-token. */
export const WIDGET_SCOPE = "widget";
/** Een widget-token is 30 dagen geldig (de app vraagt eerder een nieuw aan zolang je ingelogd bent). */
export const WIDGET_TTL_MS = 30 * 24 * 3600 * 1000;
/** Acties die met een widget-token mogen (verder niets). */
export const WIDGET_ACTIONS: ReadonlySet<string> = new Set(["widget_summary"]);
/** Maximale lengte van een token. */
export const MAX_TOKEN = 500;

const enc = new TextEncoder();
export const b64u = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function hmac(material: string, data: string) {
  const raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(material)));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export type TokenClaims = { v: number; exp: number; j: string; s?: string };

/** Maakt een ondertekend token. `scope` undefined = beheer-token (zonder s), anders bv. "widget". */
export async function signToken(material: string, v: number, ttlMs: number, scope?: string, now = Date.now()) {
  const exp = now + ttlMs;
  const claims: TokenClaims = { ...(scope ? { s: scope } : {}), v, exp, j: b64u(crypto.getRandomValues(new Uint8Array(9))) };
  const payload = b64u(enc.encode(JSON.stringify(claims)));
  return { token: `${payload}.${b64u(await hmac(material, payload))}`, exp };
}

/**
 * Controleert handtekening, verloop en scope (zonder database). `scope` null = beheer-token: het token mag GEEN s hebben;
 * anders moet s precies gelijk zijn. Geeft de claims terug (de aanroeper vergelijkt v met de tokenversie), of null.
 */
export async function readToken(material: string, token: unknown, scope: string | null, now = Date.now()): Promise<TokenClaims | null> {
  if (!material || typeof token !== "string" || token.length > MAX_TOKEN) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  let p: Record<string, unknown>;
  try {
    if (!sameBytes(unb64u(sig), await hmac(material, payload))) return null;
    p = JSON.parse(new TextDecoder().decode(unb64u(payload)));
  } catch { return null; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  if (typeof p.exp !== "number" || p.exp <= now || typeof p.v !== "number") return null;
  if (scope === null ? p.s !== undefined : p.s !== scope) return null;
  return { v: p.v, exp: p.exp, j: String(p.j ?? ""), ...(p.s !== undefined ? { s: String(p.s) } : {}) };
}

/** Mag deze actie met een token van deze scope? Beheer-tokens (scope null) mogen alles behalve de widget-acties. */
export function actionAllowed(scope: string | null, action: string): boolean {
  if (scope === WIDGET_SCOPE) return WIDGET_ACTIONS.has(action);
  if (scope === null) return !WIDGET_ACTIONS.has(action);
  return false;
}

// ---- samenvatting voor de widget: alleen statusnamen en aantallen, geen persoonsgegevens, geen adressen ----

export type WidgetLevel = "operational" | "maintenance" | "degraded" | "partial" | "major" | "unknown";
const LEVELS: readonly WidgetLevel[] = ["operational", "maintenance", "degraded", "partial", "major"];
const MAX_COMPONENTS = 24;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? v as J : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nat = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const short = (v: unknown, n = 60) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const level = (v: unknown): WidgetLevel => (LEVELS as readonly unknown[]).includes(v) ? v as WidgetLevel : "unknown";
/** Oude toestand (up/degraded/down) als er geen niveau is. */
const fromState = (s: unknown): WidgetLevel => s === "up" ? "operational" : s === "degraded" ? "degraded" : s === "down" ? "major" : "unknown";

export type WidgetStatus = {
  level: WidgetLevel;
  components: { id: string; name: string; group: string; level: WidgetLevel }[];
  counts: Record<WidgetLevel, number>;
  active_notices: number;
  open_incidents: number;
  checked_at: string | null;
};

/**
 * Samenvatting van het antwoord van de functie `status` (actie admin, zoals de tab Status): totaalniveau en per onderdeel
 * id, naam (NL), groep en niveau. Informatie-monitors (apparaattellingen) en uitgezette monitors vallen weg; nooit target,
 * keyword, foutmeldingen, abonnees of e-mailadressen.
 */
export function summarizeStatus(raw: unknown): WidgetStatus | null {
  const r = obj(raw);
  if (!Array.isArray(r.groups) && !r.overall) return null;
  const overall = obj(r.overall);
  const components: WidgetStatus["components"] = [];
  let checked: number | null = null;
  for (const g of arr(r.groups)) {
    const go = obj(g);
    const group = short(obj(go.name).nl) || short(go.id, 30);
    for (const m of arr(go.monitors)) {
      const mo = obj(m);
      if (mo.kind === "devices" || mo.enabled === false) continue;
      const id = short(mo.id, 40);
      if (!id) continue;
      const lv = mo.status !== undefined && mo.status !== null ? level(mo.status) : fromState(mo.state);
      components.push({ id, name: short(obj(mo.name).nl) || id, group, level: lv });
      const t = typeof mo.checked_at === "string" ? Date.parse(mo.checked_at) : NaN;
      if (Number.isFinite(t) && (checked === null || t > checked)) checked = t;
    }
  }
  const counts = Object.fromEntries([...LEVELS, "unknown"].map((k) => [k, 0])) as Record<WidgetLevel, number>;
  for (const c of components) counts[c.level]++;
  // ernstigste eerst, daarna de volgorde van de statuspagina
  const rank = (l: WidgetLevel) => ({ major: 0, partial: 1, degraded: 2, maintenance: 3, unknown: 4, operational: 5 })[l];
  const sorted = components.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.level) - rank(b.c.level) || a.i - b.i).map((x) => x.c);
  const notices = obj(r.notices);
  return {
    level: overall.level !== undefined ? level(overall.level) : fromState(overall.state),
    components: sorted.slice(0, MAX_COMPONENTS),
    counts,
    active_notices: arr(notices.active).length,
    open_incidents: arr(r.incidents).filter((i) => !obj(i).ended_at).length,
    checked_at: checked === null ? null : new Date(checked).toISOString(),
  };
}

export type WidgetSupport = {
  new: number; open: number; pending: number; resolved: number; closed: number;
  active: number; unread: number; total: number; last_7d: number;
};

/** Alleen de aantallen uit support_counts (functie support, admin_counts). */
export function summarizeSupport(raw: unknown): WidgetSupport | null {
  const r = obj(raw);
  if (typeof r.total !== "number" && typeof r.new !== "number") return null;
  return {
    new: nat(r.new), open: nat(r.open), pending: nat(r.pending), resolved: nat(r.resolved), closed: nat(r.closed),
    active: nat(r.active), unread: nat(r.unread), total: nat(r.total), last_7d: nat(r.last_7d),
  };
}
