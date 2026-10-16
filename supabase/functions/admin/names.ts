// Voor- en achternaam van een account (Supabase user_metadata first_name / last_name; de apps en bingr.online vragen ze bij
// het aanmelden). Hier: controleren en opschonen voor de actie user_set_name, en de voornaam voor de aanhef van de
// beheermails ("Hoi Jan,"). Geen namen in het logboek: alleen of ze gezet zijn.

/** Maximale lengte van een voor- of achternaam (tekens na het opschonen). */
export const NAME_MAX = 50;

// stuurtekens, regeleinden, tabs, zero-width en richtingtekens; < en > (geen HTML in een naam)
const BAD = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff<>]/;

/** Spaties aan het begin en eind weg, meerdere spaties binnenin één spatie. */
const squeeze = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Naam uit het beheer: leeg (of null/undefined) = verwijderen (value null), anders opgeschoond.
 * Fout: "bad_name" (geen tekst of ongeldige tekens) of "name_too_long".
 */
export function cleanName(v: unknown): { ok: true; value: string | null } | { ok: false; error: "bad_name" | "name_too_long" } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "bad_name" };
  if (/[\r\n\t]/.test(v)) return { ok: false, error: "bad_name" };
  const s = squeeze(v.normalize("NFC"));
  if (!s) return { ok: true, value: null };
  if (BAD.test(s)) return { ok: false, error: "bad_name" };
  // gelijk aan de databasetrigger bingr_user_names (iptv-ios-appletv/supabase/schema.sql): geen links of e-mailadressen
  if (/:\/\/|www\.|@/i.test(s)) return { ok: false, error: "bad_name" };
  if ([...s].length > NAME_MAX) return { ok: false, error: "name_too_long" };
  return { ok: true, value: s };
}

/**
 * Voornaam voor de aanhef van een mail, uit user_metadata (door de klant zelf ingevuld, dus niet vertrouwd): alleen een
 * bruikbare tekst, anders null (dan geen aanhef). De mail zelf escapet hem nog (para / esc).
 */
export function greetingName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = squeeze(v.normalize("NFC").replace(/[\r\n\t]+/g, " "));
  if (!s || BAD.test(s)) return null;
  const chars = [...s];
  return chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join("").trim() : s;
}
