// Kijkt nu (tegel op het overzicht, actie streams_now): wie kijkt er nu. Rijen uit bingr_admin_streams_now
// (iptv-ios-appletv, supabase/schema.sql). Persoonsgegevens alleen in het antwoord aan het beheer: e-mailadres gemaskeerd,
// nooit gelogd en niet in admin_audit (alleen het aantal). Titels, serietitels en profielnamen kunnen sinds build 146
// per veld versleuteld zijn (`enc1:` + base64(nonce(12) || AES-256-GCM) met BINGR_SOURCES_KEY, zoals openField in
// _shared/sealed.ts daar): hier in het geheugen ontsleuteld. Lukt dat niet, dan null (nooit de versleutelde tekst tonen).
// Pure hulpjes, getest in streams_test.ts.

export const FIELD_PREFIX = "enc1:";
const keys = new Map<string, Promise<CryptoKey>>();
function aesKey(key64: string): Promise<CryptoKey> {
  let p = keys.get(key64);
  if (!p) {
    p = (async () => {
      const raw = Uint8Array.from(atob(key64), (c) => c.charCodeAt(0));
      if (raw.length !== 32) throw new Error("sources_key_missing");
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    })();
    p.catch(() => keys.delete(key64));
    keys.set(key64, p);
  }
  return p;
}
/** Kolom lezen: `enc1:…` ontsleutelen; een oude, leesbare waarde ongewijzigd; mislukt = null. */
export async function openField(v: unknown, key64: string): Promise<string | null> {
  if (v == null) return null;
  const s = String(v);
  if (!s.startsWith(FIELD_PREFIX)) return s;
  if (!key64) return null;
  try {
    const all = Uint8Array.from(atob(s.slice(FIELD_PREFIX.length)), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(0, 12) }, await aesKey(key64), all.subarray(12));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const clean = (v: string | null, max: number) => {
  if (v == null) return null;
  const s = v.replace(CTRL, " ").replace(/\s+/g, " ").trim();
  return s ? [...s].slice(0, max).join("") : null;
};
const KINDS = new Set(["live", "movie", "episode"]);

export type StreamRow = Record<string, unknown>;
export type StreamView = {
  user_id: string; email: string; name: string | null; plan: "free" | "lifetime"; country: string | null;
  device_name: string | null; platform: string | null; platform_group: string; app_version: string | null;
  profile_name: string | null; title: string | null; series_title: string | null; kind: string | null;
  started_at: string | null; last_ping: string | null;
};

/** Rijen -> lijst voor het beheer (e-mail gemaskeerd met `mask`, velden ontsleuteld en opgeschoond) + tellingen. */
export async function streamsView(raw: unknown, mask: (e: unknown) => string, key64: string) {
  const rows = (Array.isArray(raw) ? raw : []).filter((r) => r && typeof r === "object").slice(0, 500) as StreamRow[];
  const items: StreamView[] = [];
  for (const r of rows) {
    const [title, series, profile, device] = await Promise.all([
      openField(r.title, key64), openField(r.series_title, key64), openField(r.profile_name, key64), openField(r.device_name, key64),
    ]);
    const name = [r.first_name, r.last_name].map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join(" ");
    const cc = typeof r.country === "string" && /^[A-Z]{2}$/.test(r.country) ? r.country
      : typeof r.device_country === "string" && /^[A-Z]{2}$/.test(r.device_country) ? r.device_country : null;
    items.push({
      user_id: String(r.user_id ?? ""), email: mask(r.email), name: clean(name, 80), plan: r.plan === "lifetime" ? "lifetime" : "free", country: cc,
      device_name: clean(device, 80), platform: clean(typeof r.platform === "string" ? r.platform : null, 40),
      platform_group: typeof r.platform_group === "string" && /^[a-z]{2,12}$/.test(r.platform_group) ? r.platform_group : "other",
      app_version: clean(typeof r.app_version === "string" ? r.app_version : null, 40),
      profile_name: clean(profile, 60), title: clean(title, 200), series_title: clean(series, 200),
      kind: typeof r.kind === "string" && KINDS.has(r.kind) ? r.kind : null,
      started_at: typeof r.started_at === "string" ? r.started_at : null, last_ping: typeof r.last_ping === "string" ? r.last_ping : null,
    });
  }
  const count = (f: (x: StreamView) => string) => items.reduce((o, x) => { const k = f(x); o[k] = (o[k] ?? 0) + 1; return o; }, {} as Record<string, number>);
  return {
    total: items.length, accounts: new Set(items.map((x) => x.user_id)).size,
    by_kind: count((x) => x.kind ?? "other"), by_platform: count((x) => x.platform_group), items,
  };
}
