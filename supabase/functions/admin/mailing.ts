// Eigen mailing vanuit het beheer (tab Nieuwsbrief, blok Eigen mailing): de functie `admin` controleert de invoer hier en
// geeft hem door aan de functie `newsletter` (iptv-ios-appletv, docs/NEWSLETTER.md "Eigen mailing vanuit het beheer";
// header x-newsletter-secret = NEWSLETTER_ADMIN_SECRET, via newsletterCall in newsletter.ts). Daar wordt alles nog een keer
// (strenger) gecontroleerd, gerenderd en verstuurd. Antwoorden worden teruggebracht tot onderwerpen en aantallen: nooit
// adressen. Het adres van een testmail wordt nooit gelogd en komt niet in admin_audit.

export type Audience = "newsletter" | "service";
export type Lang = "nl" | "en";
/** Grenzen (tekens), gelijk aan supabase/functions/newsletter/mailing.ts in iptv-ios-appletv. */
export const MAX = { subject: 150, body: 8000, button: 40, url: 500 } as const;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? v as J : {});
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const len = (s: string) => Array.from(s).length;

export const cleanAudience = (v: unknown): Audience | null =>
  v === undefined || v === null || v === "" ? "newsletter" : v === "newsletter" || v === "service" ? v : null;
/** Taal van een testmail: nl, en of both (beide). */
export const cleanTestLang = (v: unknown): Lang | "both" | null =>
  v === undefined || v === null || v === "" ? "nl" : v === "nl" || v === "en" || v === "both" ? v : null;
export const cleanRequestId = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
export const cleanMailingId = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// stuurtekens (behalve tab en regeleinde in de tekst), zero-width en richtingtekens
const CTRL_LINE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const CTRL_BODY = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const line = (v: unknown) => (typeof v === "string" ? v.replace(CTRL_LINE, " ").replace(/\s+/g, " ").trim() : "");
const body = (v: unknown) =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(CTRL_BODY, "").replace(/\t/g, " ").trim() : "";

/** https-URL zonder inloggegevens of vreemde tekens; "" = leeg; null = ongeldig. */
export function cleanUrl(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return "";
  if (s.length > MAX.url || !/^https:\/\/[^\s"'<>\\`]+$/i.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password || !u.hostname.includes(".") || /^[\d.]+$/.test(u.hostname)) return null;
  if (/(^|\.)(localhost|local|internal)$/.test(u.hostname)) return null;
  return s;
}

export type LangContent = { subject: string; body: string; button: string };
export type MailingContent = { nl: LangContent; en: LangContent; image: string; button_url: string };
/**
 * Inhoud controleren en opschonen. `need` = talen waarvoor onderwerp en tekst verplicht zijn (versturen: beide; voorbeeld:
 * de getoonde taal; testmail: de gekozen talen). Foutcodes zoals de functie newsletter ze geeft.
 */
export function cleanContent(v: unknown, need: readonly Lang[] = ["nl", "en"]): { ok: true; content: MailingContent } | { ok: false; error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "bad_content" };
  const o = v as J;
  const image = cleanUrl(o.image), button_url = cleanUrl(o.button_url);
  if (image === null) return { ok: false, error: "bad_image_url" };
  if (button_url === null) return { ok: false, error: "bad_button_url" };
  const out = { image, button_url } as MailingContent;
  for (const l of ["nl", "en"] as const) {
    const x = obj(o[l]);
    const subject = line(x.subject), text = body(x.body), btn = line(x.button);
    if (len(subject) > MAX.subject || (need.includes(l) && !subject)) return { ok: false, error: `bad_subject_${l}` };
    if (len(text) > MAX.body || (need.includes(l) && !text)) return { ok: false, error: `bad_body_${l}` };
    if (len(btn) > MAX.button || (button_url && need.includes(l) && !btn)) return { ok: false, error: `bad_button_text_${l}` };
    out[l] = { subject, body: text, button: btn };
  }
  if (!button_url && (out.nl.button || out.en.button)) return { ok: false, error: "bad_button_url" };
  return { ok: true, content: out };
}

const counts = (v: unknown) => {
  const o = obj(v), nl = nat(o.nl), en = nat(o.en);
  return { nl, en, total: typeof o.total === "number" ? nat(o.total) : nl + en };
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v: unknown) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

/** Eén mailing voor het dashboard: id, data, doelgroep, status, onderwerpen en aantallen (nooit adressen). */
export function mailingView(v: unknown) {
  const o = obj(v), s = obj(o.subject);
  const status = ["sending", "done", "cancelled"].includes(o.status as string) ? o.status as string : "done";
  return {
    id: cleanMailingId(o.id) ?? 0, created_at: iso(o.created_at), finished_at: iso(o.finished_at),
    audience: o.audience === "service" ? "service" : "newsletter", status,
    subject: { nl: str(s.nl, MAX.subject), en: str(s.en, MAX.subject) },
    recipients: counts(o.recipients), sent: nat(o.sent), failed: nat(o.failed), skipped: nat(o.skipped), cancelled: nat(o.cancelled),
    left: status === "sending" ? nat(o.left) : 0,
  };
}

/** Stand van de eigen mailings (actie mailing_status van `newsletter`). */
export function mailingStatusView(v: unknown) {
  const o = obj(v), a = obj(o.audiences);
  const mailings = (Array.isArray(o.mailings) ? o.mailings : []).slice(0, 50).map(mailingView).filter((m) => m.id > 0);
  const active = o.active && typeof o.active === "object" ? mailingView(o.active) : null;
  return {
    active: active && active.id > 0 && active.status === "sending" ? active : null,
    mailings,
    audiences: { newsletter: counts(a.newsletter), service: counts(a.service) },
    per_hour: nat(o.per_hour), batch: nat(o.batch), sent_last_hour: nat(o.sent_last_hour),
  };
}

/** Wat er in admin_audit komt bij versturen: id, doelgroep en aantallen; geen inhoud of adressen. */
export function sendAudit(out: unknown, audience: Audience) {
  const o = obj(out);
  return { id: cleanMailingId(o.id), audience, recipients: counts(o.recipients), duplicate: o.duplicate === true };
}
