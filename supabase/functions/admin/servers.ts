// Servers van een account voor het beheer (user_detail.servers): ALLEEN het adres van Xtream-bronnen (schema + host + poort),
// de naam die de klant zelf gaf en of het de actieve bron (mainSourceID) is. Nooit gebruikersnaam, wachtwoord, token, pad,
// query of andere velden; M3U-, Stalker-, Plex-, Jellyfin-, Emby- en Stremio-bronnen en tombstones vallen weg.
// Bron: tabel account_sources (iptv-ios-appletv, supabase/schema.sql): één rij per account met `data` =
// base64(nonce(12) || AES-256-GCM(JSON {sources, mainSourceID})) met BINGR_SOURCES_KEY, zoals seal()/open_() in device-auth en
// _shared/sealed.ts daar. De versleuteling is per rij, dus de functie ontsleutelt de rij in het geheugen en houdt er alleen het
// adres en de naam van over. Niets hiervan wordt gelogd of in admin_audit gezet.

export type ServerView = { host: string; name?: string; active: boolean; deleted: false };

/** Maximaal aantal bronnen per account (gelijk aan put_sources in device-auth). */
export const MAX_SERVERS = 100;

const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

/**
 * Serveradres zonder inloggegevens: `http://user:pass@Line.Example.com:8080/get.php?username=…&password=…` →
 * `http://line.example.com:8080`. Zonder schema = http:// (zoals XtreamClient in de apps). Alleen http en https; host in kleine
 * letters (IDN als punycode), standaardpoort (80 bij http, 443 bij https) weg. Ongeldig of leeg → null.
 */
export function serverOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(CTRL, "").trim();
  if (!s || s.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s.replace(/^\/+/, "");
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const port = u.port && !((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) ? `:${u.port}` : "";
  return `${u.protocol}//${host}${port}`;
}

/** Is dit een Xtream-bron? (`kind` = "Xtream Codes" in het gedeelde formaat; hoofdletters/spaties maken niet uit) */
export function isXtream(kind: unknown): boolean {
  return typeof kind === "string" && /^xtream/i.test(kind.trim());
}

/** Naam die de klant zelf gaf: opgeschoond, max. 80 tekens, leeg = geen naam. */
function cleanSourceName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(CTRL, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  const c = [...s];
  return c.length > 80 ? c.slice(0, 80).join("").trim() : s;
}

/**
 * Uit het ontsleutelde {sources, mainSourceID}: alleen niet-verwijderde Xtream-bronnen met een geldig adres
 * (`serverURL`, of anders het adres uit `m3uURL`). Geeft per bron alleen {host, name?, active, deleted: false}.
 */
// deno-lint-ignore no-explicit-any
export function xtreamServers(payload: any): ServerView[] {
  const list = Array.isArray(payload?.sources) ? payload.sources : [];
  const main = payload?.mainSourceID == null ? "" : String(payload.mainSourceID).trim().toLowerCase();
  const out: ServerView[] = [];
  for (const s of list.slice(0, MAX_SERVERS)) {
    if (!s || typeof s !== "object" || s.deleted === true || s.deletedAt) continue;
    if (!isXtream(s.kind)) continue;
    const host = serverOrigin(s.serverURL) ?? serverOrigin(s.m3uURL);
    if (!host) continue;
    const name = cleanSourceName(s.name);
    const id = s.id == null ? "" : String(s.id).trim().toLowerCase();
    out.push({ host, ...(name ? { name } : {}), active: !!main && id === main, deleted: false });
  }
  // actieve bron bovenaan, verder de volgorde van de klant
  return out.sort((a, b) => Number(b.active) - Number(a.active));
}

let keyPromise: Promise<CryptoKey> | null = null;
let keyFor = "";
function sourcesKey(raw64: string): Promise<CryptoKey> {
  if (!keyPromise || keyFor !== raw64) {
    keyFor = raw64;
    keyPromise = (async () => {
      const raw = Uint8Array.from(atob(raw64), (c) => c.charCodeAt(0));
      if (raw.length !== 32) throw new Error("sources_key_missing");
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    })();
    keyPromise.catch(() => { keyPromise = null; });
  }
  return keyPromise;
}

/** Ontsleutelt een rij van account_sources (zelfde formaat als device-auth); fout → exception zonder inhoud. */
// deno-lint-ignore no-explicit-any
export async function unsealSources(data: string, key64: string): Promise<any> {
  const all = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  if (all.length < 13) throw new Error("bad_data");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(0, 12) }, await sourcesKey(key64), all.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

/**
 * Servers van een versleutelde rij (of null als er geen rij is = []). Mislukt het ontsleutelen (geen of andere sleutel,
 * beschadigde rij), dan null = onbekend; geen foutmelding met inhoud en niets in het log.
 */
export async function serversFromRow(data: string | null | undefined, key64: string): Promise<ServerView[] | null> {
  if (data == null || data === "") return [];
  if (!key64) return null;
  try { return xtreamServers(await unsealSources(data, key64)); } catch { return null; }
}
