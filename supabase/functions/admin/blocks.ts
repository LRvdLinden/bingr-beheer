// Blokkeren en verwijderen van accounts (functie admin): pure hulpjes zonder database, getest in blocks_test.ts.
// De inlogblokkade is de ban van het auth-account (ban_duration, een Go-duur als "86400s"); reden, einddatum en
// geschiedenis staan in public.account_blocks (schema in iptv-ios-appletv).
import type { Lang } from "../_shared/layout.ts";

/** "Onbepaalde tijd": 100 jaar (de auth-server kent geen echte oneindige ban). */
export const INDEFINITE = "876000h";
/** Een blokkade duurt minstens 1 minuut en hoogstens 10 jaar (anders: onbepaald kiezen). */
export const MIN_MS = 60 * 1000;
export const MAX_MS = 10 * 366 * 864e5;
export const REASON_MAX = 1000;
export const TZ = "Europe/Amsterdam";

export type UntilResult = { ok: true; until: Date | null } | { ok: false; error: "bad_until" };

/** Einddatum uit het beheer: leeg, null, "onbepaald" of "indefinite" = onbepaalde tijd; anders een datum in de toekomst. */
export function parseUntil(v: unknown, now = Date.now()): UntilResult {
  if (v === null || v === undefined) return { ok: true, until: null };
  const s = String(v).trim().toLowerCase();
  if (!s || s === "onbepaald" || s === "indefinite") return { ok: true, until: null };
  const ms = typeof v === "number" ? v : Date.parse(String(v));
  if (!Number.isFinite(ms) || ms < now + MIN_MS || ms > now + MAX_MS) return { ok: false, error: "bad_until" };
  return { ok: true, until: new Date(ms) };
}

/** ban_duration voor de auth-server: seconden tot de einddatum (naar boven afgerond), of INDEFINITE. */
export function banDuration(until: Date | null, now = Date.now()): string {
  if (!until) return INDEFINITE;
  return `${Math.max(60, Math.ceil((until.getTime() - now) / 1000))}s`;
}

/** Reden zoals de klant hem ziet: getrimd, regeleinden genormaliseerd, max. 1000 tekens. */
export function cleanReason(v: unknown): string {
  return String(v ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, REASON_MAX);
}

/** Taal van het account (user_metadata.lang): "nl", leeg of onbekend = Nederlands, elke andere taal = Engels. */
export function accountLang(v: unknown): Lang {
  const s = String(v ?? "").trim().toLowerCase();
  return !s || s === "nl" || s.startsWith("nl-") ? "nl" : "en";
}

/** Datum en tijd in Nederlandse tijd, in de taal van de klant ("vrijdag 17 oktober 2026 om 14:00"). */
export function formatUntil(until: Date | string, lang: Lang): string {
  const d = typeof until === "string" ? new Date(until) : until;
  return new Intl.DateTimeFormat(lang === "nl" ? "nl-NL" : "en-GB", { dateStyle: "full", timeStyle: "short", timeZone: TZ }).format(d);
}

/** Bevestiging bij verwijderen: het volledige e-mailadres, of precies het gemaskeerde adres uit het beheer. */
export function confirmMatches(input: unknown, email: string, masked: string): boolean {
  const s = String(input ?? "").trim().toLowerCase();
  return !!s && !!email && (s === email.trim().toLowerCase() || s === masked.trim().toLowerCase());
}
