// Nieuwsbrief vanuit het beheer: de functie `admin` controleert de invoer hier en geeft hem door aan de functie
// `newsletter` (iptv-ios-appletv; header x-newsletter-secret = function-secret NEWSLETTER_ADMIN_SECRET), zoals push met
// PUSH_ADMIN_SECRET. Antwoorden worden teruggebracht tot wat het dashboard nodig heeft (alleen aantallen, geen adressen).
// Het adres van een voorbeeldmail wordt nooit gelogd en komt niet in admin_audit (daar alleen "preview" en de taal).

export const EMAIL_MAX = 254;
export const LANGS = ["nl", "en"] as const;
export type Lang = typeof LANGS[number];
export type NewsletterError =
  | "newsletter_not_configured" | "newsletter_not_deployed" | "newsletter_forbidden" | "newsletter_unreachable";

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? v as J : {});
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

// stuurtekens, zero-width en richtingtekens: nooit in een adres
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;
// eenvoudige, strikte controle: lokaal deel zonder spaties of speciale tekens die headers kunnen breken, en een
// domein met minstens één punt en een TLD van letters (geen IP-adres, geen localhost)
const LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** E-mailadres voor de voorbeeldmail: opgeschoond (spaties eromheen weg, domein in kleine letters), of null als ongeldig. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > EMAIL_MAX || CTRL.test(s) || /\s/.test(s)) return null;
  const at = s.lastIndexOf("@");
  if (at < 1 || s.indexOf("@") !== at) return null;
  const local = s.slice(0, at), domain = s.slice(at + 1).toLowerCase();
  if (!LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || domain.length > 253 || !labels.every((l) => LABEL.test(l))) return null;
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return null;
  if (domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".local") || domain.endsWith(".internal")) return null;
  return `${local}@${domain}`;
}

/** Taal: "nl" of "en"; leeg = standaard (nl); iets anders = null (ongeldig). */
export function cleanLang(v: unknown, fallback: Lang = "nl"): Lang | null {
  if (v === undefined || v === null || v === "") return fallback;
  return (LANGS as readonly unknown[]).includes(v) ? v as Lang : null;
}

/** Aan/uit voor set_enabled: alleen een echte boolean. */
export function cleanEnabled(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Secties aan/uit voor set_sections: top10, popular en monthly (maandoverzicht), elk een echte boolean of weggelaten; minstens één. */
export function cleanSections(b: unknown): { top10?: boolean; popular?: boolean; monthly?: boolean } | null {
  const o = obj(b), out: { top10?: boolean; popular?: boolean; monthly?: boolean } = {};
  for (const k of ["top10", "popular", "monthly"] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "boolean") return null;
    out[k] = o[k] as boolean;
  }
  return Object.keys(out).length ? out : null;
}
/** Schakelaars per sectie uit een antwoord; ontbreekt het (oudere functie), dan aan. */
export function sectionsView(v: unknown): { top10: boolean; popular: boolean; monthly: boolean } {
  const o = obj(v);
  return { top10: o.top10 !== false, popular: o.popular !== false, monthly: o.monthly !== false };
}

const KEY = /^[A-Za-z0-9_.:-]{1,60}$/;
const keyOf = (v: unknown) => (typeof v === "string" && KEY.test(v) ? v : null);

/** Eén editie uit de geschiedenis: alleen sleutel, datum en aantallen. */
export function editionView(v: unknown) {
  const o = obj(v);
  const recipients = nat(o.recipients), sent = nat(o.sent), failed = nat(o.failed);
  return {
    key: keyOf(o.key), created_at: str(o.created_at, 40), recipients, sent, failed,
    done: typeof o.done === "boolean" ? o.done : recipients > 0 && sent + failed >= recipients,
  };
}

/** Welkomstmail: alleen aantallen (verstuurd in 7 dagen, wachtend); null als de functie ze (nog) niet meegeeft. */
export function welcomeView(v: unknown): { sent_7d: number; pending: number } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = obj(v);
  return { sent_7d: nat(o.sent_7d), pending: nat(o.pending) };
}

/** Maandoverzicht "Volgende maand op Bingr": aan/uit, volgende verzending en de geschiedenis (alleen aantallen); null als de
 *  functie het (nog) niet meegeeft. */
export function monthlyView(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = obj(v), next = obj(o.next);
  return {
    enabled: o.enabled !== false,
    next: str(next.at, 40) ? { key: keyOf(next.key), at: str(next.at, 40) } : null,
    editions: (Array.isArray(o.editions) ? o.editions : []).slice(0, 24).map(editionView),
  };
}

/** Stand van de nieuwsbrief (actie status van `newsletter`) voor het dashboard. */
export function statusView(v: unknown) {
  const o = obj(v), next = obj(o.next), r = obj(o.recipients);
  const nl = nat(r.nl), en = nat(r.en);
  const editions = (Array.isArray(o.editions) ? o.editions : []).slice(0, 50).map(editionView);
  return {
    enabled: o.enabled === true,
    sections: sectionsView(o.sections),
    next: str(next.at, 40) ? { key: keyOf(next.key), at: str(next.at, 40) } : null,
    recipients: { nl, en, total: typeof r.total === "number" ? nat(r.total) : nl + en },
    editions,
    monthly: monthlyView(o.monthly),
    welcome: welcomeView(o.welcome),
  };
}

/** Voorbeeld-HTML (actie render): alleen onderwerp en html, begrensd. null = geen bruikbaar antwoord. */
export const HTML_MAX = 1_000_000;
export function renderView(v: unknown): { subject: string; html: string; key?: string } | null {
  const o = obj(v);
  if (typeof o.html !== "string" || !o.html || o.html.length > HTML_MAX) return null;
  const key = keyOf(o.key);
  return { subject: typeof o.subject === "string" ? o.subject.slice(0, 300) : "", html: o.html, ...(key ? { key } : {}) };
}

/** Foutcode uit een antwoord: alleen korte codes (geen serverteksten naar de browser of het logboek). */
export const errCode = (v: unknown) => (typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v) ? v : "server_error");

export type CallResult = { status: number; out: Record<string, unknown> };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * POST {action, …} naar /functions/v1/newsletter met x-newsletter-secret. Zonder geheim: 503 newsletter_not_configured;
 * 404 zonder foutcode (functie nog niet online): 503 newsletter_not_deployed; 401/403: 502 newsletter_forbidden;
 * geen verbinding: 502 newsletter_unreachable. Logt nooit het geheim, de invoer of het antwoord (alleen actie en status).
 */
export async function newsletterCall(
  base: string, secret: string, action: string, payload: Record<string, unknown>, fetchFn: Fetch = fetch,
): Promise<CallResult> {
  if (!secret) return { status: 503, out: { error: "newsletter_not_configured" } };
  let res: Response;
  try {
    res = await fetchFn(`${base.replace(/\/+$/, "")}/functions/v1/newsletter`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-newsletter-secret": secret },
      body: JSON.stringify({ ...payload, action }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    console.error("admin", "newsletter", action, e instanceof Error ? e.name : "fetch");
    return { status: 502, out: { error: "newsletter_unreachable" } };
  }
  const out = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (res.status === 401 || res.status === 403) return { status: 502, out: { error: "newsletter_forbidden" } };
  if (res.status === 404 && !out?.error) return { status: 503, out: { error: "newsletter_not_deployed" } };
  if (!res.ok || !out || typeof out !== "object" || Array.isArray(out)) {
    console.error("admin", "newsletter", action, `HTTP ${res.status}`);
    const retry = typeof out?.retry_after === "number" ? { retry_after: nat(out.retry_after) } : {};
    return { status: res.ok ? 502 : res.status, out: { error: errCode(out?.error), ...retry } };
  }
  return { status: 200, out };
}

// ---- nieuwsbrief per account (tabel account_email_prefs, schema in iptv-ios-appletv) ----
// Geabonneerd = geen email_opt_out én geen newsletter_opt_out; geen rij = geabonneerd. Heeft de klant alle mail uitgezet
// (email_opt_out), dan zet het beheer de nieuwsbrief daar niet overheen aan: alleen de klant kan dat weer aanzetten
// (via de app of de site); het beheer toont dan "Geen e-mail (alles uitgezet)".
export type NewsletterPref = { subscribed: boolean; email_opt_out: boolean; newsletter_opt_out: boolean };

/** Voorkeur uit een rij (of null = geen rij = geabonneerd). */
export function prefView(row: unknown): NewsletterPref {
  const o = obj(row);
  const email_opt_out = o.email_opt_out === true, newsletter_opt_out = o.newsletter_opt_out === true;
  return { subscribed: !email_opt_out && !newsletter_opt_out, email_opt_out, newsletter_opt_out };
}

/** Per account-id of het geabonneerd is (accounts zonder rij: true). */
export function prefMap(ids: string[], rows: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = Object.fromEntries(ids.map((id) => [id, true]));
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = obj(r);
    if (typeof o.user_id === "string" && o.user_id in out) out[o.user_id] = prefView(o).subscribed;
  }
  return out;
}

/** Fout van PostgREST/Postgres omdat de kolom newsletter_opt_out (nog) niet bestaat. */
export function missingColumn(err: unknown): boolean {
  const e = obj(err);
  return e.code === "42703" || e.code === "PGRST204" || /newsletter_opt_out/.test(String(e.message ?? ""));
}

/** Wat user_newsletter_set moet doen: de nieuwe waarde voor newsletter_opt_out, of een fout. */
export function planPrefChange(current: NewsletterPref, subscribed: boolean):
  { ok: true; newsletter_opt_out: boolean; changed: boolean } | { ok: false; error: "email_opted_out" } {
  if (subscribed && current.email_opt_out) return { ok: false, error: "email_opted_out" };
  return { ok: true, newsletter_opt_out: !subscribed, changed: current.newsletter_opt_out !== !subscribed };
}
