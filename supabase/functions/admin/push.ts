// Pushmeldingen vanuit het beheer (contract: docs/PUSH.md in LRvdLinden/iptv-ios-appletv). De functie `admin` controleert
// de invoer hier en geeft hem door aan de functie `push` (header x-push-secret = function-secret PUSH_ADMIN_SECRET), net
// als support met SUPPORT_ADMIN_SECRET. Antwoorden van `push` worden hier teruggebracht tot wat het dashboard nodig heeft:
// geen account-id's, tokens of apparaatgegevens terug naar de browser. In admin_audit alleen soort doelgroep, aantallen
// en lengtes, nooit de berichttekst of wie de ontvangers zijn.

/** Platforms met systeem-push (APNs, FCM, Web Push). */
export const PUSH_PLATFORMS = ["ios", "ipados", "macos", "android", "web"] as const;
/** Platforms zonder systeem-push: daar registreert de app niet (tvOS, Android TV). */
export const NO_PUSH_PLATFORMS = ["tvos", "androidtv"] as const;
export type PushPlatform = typeof PUSH_PLATFORMS[number];

export const TITLE_MAX = 100;
export const BODY_MAX = 600;
export const URL_MAX = 500;
export const ACCOUNTS_MAX = 500;
/** Ruim onder de 4 KB van APNs/FCM/Web Push (titel + tekst van één taal, in bytes, plus data). */
export const PAYLOAD_TEXT_MAX_BYTES = 2400;

export type PushTarget = { all: true } | { accounts: string[] } | { platforms: PushPlatform[] };
export type PushInput = {
  title_nl: string; body_nl: string; title_en: string | null; body_en: string | null; url: string | null; target: PushTarget;
};
export type PushError =
  | "text_missing" | "title_too_long" | "body_too_long" | "en_incomplete" | "text_too_large" | "bad_link"
  | "bad_target" | "no_accounts" | "too_many_accounts" | "bad_account" | "no_platforms" | "no_push_platform" | "bad_platform";

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? v as J : {});
const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
const nat = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// stuurtekens (behalve regeleinde in de tekst), zero-width en richtingtekens
const CTRL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Titel: één regel, spaties samengevoegd. */
export function cleanTitle(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.normalize("NFC").replace(/[\r\n\t]+/g, " ").replace(CTRL, "").replace(/\s+/g, " ").trim();
}
/** Tekst: regeleinden blijven (hoogstens één lege regel achter elkaar), verder als de titel. */
export function cleanBody(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(CTRL, "")
    .split("\n").map((l) => l.replace(/ +/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Optionele link bij een beheerbericht: alleen https, met een echte hostnaam (geen IP-adres of localhost), zonder
 * inloggegevens. Leeg = geen link (null). Ongeldig = undefined.
 */
export function cleanLink(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  if (s.length > URL_MAX || /\s/.test(s)) return undefined;
  let u: URL;
  try { u = new URL(s); } catch { return undefined; }
  // een standaardpoort (443) laat URL zelf weg; elke andere poort is niet toegestaan
  if (u.protocol !== "https:" || u.username || u.password || u.port) return undefined;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.endsWith(".") || h.startsWith("[") || /^\d+(\.\d+){3}$/.test(h)) return undefined;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return undefined;
  return u.href.length > URL_MAX ? undefined : u.href;
}

/** Doelgroep: precies één van {all:true}, {accounts:[uuid…]} (1–500) of {platforms:[…]} (alleen platforms met push). */
export function cleanTarget(v: unknown): { ok: true; value: PushTarget } | { ok: false; error: PushError } {
  if (!isObj(v)) return { ok: false, error: "bad_target" };
  const t = v as J;
  const keys = Object.keys(t).filter((k) => t[k] !== undefined && t[k] !== null && t[k] !== false);
  if (keys.length !== 1) return { ok: false, error: "bad_target" };
  if (keys[0] === "all") return t.all === true ? { ok: true, value: { all: true } } : { ok: false, error: "bad_target" };
  if (keys[0] === "accounts") {
    if (!Array.isArray(t.accounts)) return { ok: false, error: "bad_target" };
    if (!t.accounts.length) return { ok: false, error: "no_accounts" };
    if (!t.accounts.every((a) => typeof a === "string" && UUID.test(a))) return { ok: false, error: "bad_account" };
    const ids = [...new Set((t.accounts as string[]).map((a) => a.toLowerCase()))];
    if (ids.length > ACCOUNTS_MAX) return { ok: false, error: "too_many_accounts" };
    return { ok: true, value: { accounts: ids } };
  }
  if (keys[0] === "platforms") {
    if (!Array.isArray(t.platforms)) return { ok: false, error: "bad_target" };
    if (!t.platforms.length) return { ok: false, error: "no_platforms" };
    const out: PushPlatform[] = [];
    for (const p of t.platforms) {
      if ((NO_PUSH_PLATFORMS as readonly unknown[]).includes(p)) return { ok: false, error: "no_push_platform" };
      if (!(PUSH_PLATFORMS as readonly unknown[]).includes(p)) return { ok: false, error: "bad_platform" };
      if (!out.includes(p as PushPlatform)) out.push(p as PushPlatform);
    }
    // vaste volgorde (zelfde verzoek = zelfde doelgroep in het logboek)
    return { ok: true, value: { platforms: PUSH_PLATFORMS.filter((p) => out.includes(p)) } };
  }
  return { ok: false, error: "bad_target" };
}

/** Invoer van push_send controleren en opschonen. EN is optioneel, maar dan titel én tekst (anders krijgt iedereen NL). */
export function cleanPushInput(body: unknown): { ok: true; value: PushInput } | { ok: false; error: PushError; field?: string } {
  const b = obj(body);
  const title_nl = cleanTitle(b.title_nl), body_nl = cleanBody(b.body_nl);
  const title_en = cleanTitle(b.title_en), body_en = cleanBody(b.body_en);
  if (!title_nl || !body_nl) return { ok: false, error: "text_missing", field: !title_nl ? "title_nl" : "body_nl" };
  if (!!title_en !== !!body_en) return { ok: false, error: "en_incomplete", field: title_en ? "body_en" : "title_en" };
  for (const [k, s, max, code] of [["title_nl", title_nl, TITLE_MAX, "title_too_long"], ["title_en", title_en, TITLE_MAX, "title_too_long"],
    ["body_nl", body_nl, BODY_MAX, "body_too_long"], ["body_en", body_en, BODY_MAX, "body_too_long"]] as const) {
    if ([...s].length > max) return { ok: false, error: code, field: k };
  }
  if (bytes(title_nl) + bytes(body_nl) > PAYLOAD_TEXT_MAX_BYTES) return { ok: false, error: "text_too_large", field: "body_nl" };
  if (title_en && bytes(title_en) + bytes(body_en) > PAYLOAD_TEXT_MAX_BYTES) return { ok: false, error: "text_too_large", field: "body_en" };
  const url = cleanLink(b.url);
  if (url === undefined) return { ok: false, error: "bad_link", field: "url" };
  const t = cleanTarget(b.target);
  if (!t.ok) return { ok: false, error: t.error, field: "target" };
  return { ok: true, value: { title_nl, body_nl, title_en: title_en || null, body_en: body_en || null, url, target: t.value } };
}

/** Bladzijde van de geschiedenis: geheel getal 0–1000 (anders 0). */
export function pageInput(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 0;
}

/** Soort doelgroep zonder wie (voor logboek en geschiedenis): nooit account-id's. */
export type TargetSummary = { type: "all" } | { type: "accounts"; count: number } | { type: "platforms"; platforms: string[] } | { type: "unknown" };
export function summarizeTarget(v: unknown): TargetSummary {
  const t = obj(v);
  if (t.all === true || t.type === "all") return { type: "all" };
  if (Array.isArray(t.accounts)) return { type: "accounts", count: t.accounts.length };
  if (t.type === "accounts") return { type: "accounts", count: nat(t.count) ?? nat(t.accounts_count) ?? 0 };
  if (Array.isArray(t.platforms)) {
    return { type: "platforms", platforms: t.platforms.filter((p): p is string => typeof p === "string" && /^[a-z]{2,12}$/.test(p)).slice(0, 10) };
  }
  return { type: "unknown" };
}

/** Logboek (admin_audit) voor push_send: geen tekst, geen link, geen ontvangers. */
export function auditDetail(input: PushInput, out: { message_id?: unknown; devices?: unknown }) {
  return {
    message_id: typeof out.message_id === "string" || typeof out.message_id === "number" ? String(out.message_id).slice(0, 64) : null,
    devices: nat(out.devices), target: summarizeTarget(input.target), url: input.url !== null, en: input.title_en !== null,
    title_length: [...input.title_nl].length, body_length: [...input.body_nl].length,
  };
}

// ---- antwoorden van `push` (admin_send / admin_progress / admin_history) voor het dashboard ----

export type Counts = { queued: number; sent: number; failed: number; invalid: number };
/** Tellers uit het antwoord, plat of onder `counts`; ontbrekend = 0. */
export function counts(v: unknown): Counts {
  const o = obj(v), c = isObj(o.counts) ? obj(o.counts) : o;
  return { queued: nat(c.queued) ?? 0, sent: nat(c.sent) ?? 0, failed: nat(c.failed) ?? 0, invalid: nat(c.invalid) ?? 0 };
}

const KINDS = new Set(["release", "admin", "reminder"]);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const idOf = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 64) : null);
/** Kanaalmeldingen (bv. "apns_not_configured"): alleen korte codes. */
function notes(v: unknown): string[] {
  const a = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return a.filter((x): x is string => typeof x === "string" && /^[a-z0-9_.:-]{1,60}$/i.test(x)).slice(0, 10);
}

/** Redenen van mislukte/ongeldige bezorgingen {code: aantal}: alleen korte codes (apns_…, fcm_…, webpush_…), max. 10. */
export function errorCodes(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const o = obj(isObj(obj(v).errors) ? obj(v).errors : null);
  for (const [k, n] of Object.entries(o)) {
    if (Object.keys(out).length >= 10) break;
    if (/^[A-Za-z0-9_.:-]{1,60}$/.test(k) && nat(n)) out[k] = nat(n)!;
  }
  return out;
}

/** Stand van één bericht: aantallen, redenen en of het klaar is (klaar = `done`, of niets meer in de wachtrij). */
export function progressView(v: unknown) {
  const o = obj(v), c = counts(o);
  const devices = nat(o.devices) ?? nat(o.total) ?? c.queued + c.sent + c.failed + c.invalid;
  const done = typeof o.done === "boolean" ? o.done : c.queued === 0;
  return { message_id: idOf(o.message_id ?? o.id), devices, ...c, done, errors: errorCodes(o), notes: notes(o.notes ?? o.skipped_channels ?? o.warnings) };
}

/** Eén bericht uit de geschiedenis, zonder account-id's of tokens. */
export function historyItem(v: unknown) {
  const o = obj(v);
  const kind = KINDS.has(String(o.kind)) ? String(o.kind) : "admin";
  return {
    id: idOf(o.id ?? o.message_id), kind, created_at: str(o.created_at, 40),
    title: str(o.title_nl ?? o.title, 200), body: str(o.body_nl ?? o.body, 1000), title_en: str(o.title_en, 200), url: str(o.url, URL_MAX),
    target: summarizeTarget(o.target),
    platform_group: str(o.platform_group, 20), version: str(o.version, 20), build: nat(o.build),
    ...progressView(o), message_id: undefined,
  };
}

/** Geschiedenis: {items, page, has_more}. */
export function historyView(v: unknown, page: number) {
  const o = obj(v);
  const raw = Array.isArray(o.items) ? o.items : Array.isArray(o.messages) ? o.messages : [];
  const items = raw.slice(0, 100).map(historyItem);
  const has_more = typeof o.has_more === "boolean" ? o.has_more
    : typeof o.total === "number" && typeof o.page_size === "number" ? (page + 1) * o.page_size < o.total : false;
  return { items, page, has_more };
}
