// Build 194 (beheer): wat een account precies heeft (kolom Abonnement bij Gebruikers). De database rekent het uit
// (bingr_admin_access in iptv-ios-appletv, supabase/schema.sql); hier alleen controleren en nette waarden doorgeven.
// Een oudere server kent het veld niet: dan "unknown" (de lijst werkt gewoon, het filter geeft een lege lijst).
export const ACCESS_CODES = ["free", "legacy_lifetime", "lifetime", "gifted_lifetime", "monthly", "half_year", "yearly", "subscription"] as const;
export type AccessCode = typeof ACCESS_CODES[number] | "unknown";

const isCode = (v: unknown): v is typeof ACCESS_CODES[number] => typeof v === "string" && (ACCESS_CODES as readonly string[]).includes(v);

/** Filter van de lijst: "access:<code>" met een bekende code, anders null (dan wordt hij niet doorgegeven). */
export function accessFilter(v: unknown): string | null {
  const m = /^access:([a-z_]+)$/.exec(String(v ?? ""));
  return m && isCode(m[1]) ? `access:${m[1]}` : null;
}

/** Eén account (rij uit bingr_admin_users of bingr_admin_user): alleen de vaste velden, onbekende waarden worden "unknown"/null. */
export function accessView(row: Record<string, unknown> | null | undefined) {
  const r = row ?? {};
  const provider = r.access_provider === "stripe" || r.access_provider === "apple" ? r.access_provider : null;
  const until = typeof r.access_until === "string" && Number.isFinite(Date.parse(r.access_until)) ? r.access_until : null;
  return {
    access: (isCode(r.access) ? r.access : "unknown") as AccessCode,
    access_trial: r.access_trial === true,
    access_provider: provider,
    access_until: until,
    access_test: r.access_test === true,
    access_extra: isCode(r.access_extra) && r.access_extra !== "free" ? r.access_extra : null,
  };
}

/** Aantallen per soort; null als de server ze nog niet geeft. */
export function accessTotals(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (isCode(k) && typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
  }
  return out;
}
