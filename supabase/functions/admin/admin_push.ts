// Pushmeldingen voor de app BingrBeheer zelf (niet voor de Bingr-apps): registratie van apparaten in de tabel
// admin_push_devices (schema in LRvdLinden/iptv-ios-appletv; de cron van de functie `push` stuurt de meldingen over nieuwe
// tickets, antwoorden, builds en statuswijzigingen) en een testmelding rechtstreeks via APNs vanuit `admin`. Daarnaast de
// tellingen van de pushabonnees van de Bingr-apps (push_devices). Pure hulpjes zonder netwerk of database, getest in
// admin_push_test.ts. Nooit tokens, sleutels of apparaat-id's in een log of in admin_audit (alleen soort actie en platform).

/** Platforms van de Beheer-app (Mac = Mac Catalyst). */
export const BEHEER_PLATFORMS = ["ios", "ipados", "macos"] as const;
export type BeheerPlatform = typeof BEHEER_PLATFORMS[number];
/** Soorten meldingen die je per apparaat aan of uit zet. */
export const PREF_KEYS = ["tickets", "replies", "builds", "status"] as const;
export type Prefs = Record<typeof PREF_KEYS[number], boolean>;
/** Standaard-topic (bundle-id van de Beheer-app); function-secret BEHEER_APNS_TOPIC mag het vervangen. */
export const DEFAULT_TOPIC = "nl.lrvdlinden.bingr.beheer";

export type RegisterInput = {
  device_id: string; apns_token: string; platform: BeheerPlatform; sandbox: boolean; app_build: number | null; prefs: Prefs;
};
export type RegisterError = "bad_device_id" | "bad_apns_token" | "bad_platform" | "bad_sandbox" | "bad_app_build" | "bad_prefs";

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? v as J : {});
const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

/** Willekeurige id van het apparaat (de app maakt hem één keer): 8–80 tekens [A-Za-z0-9_-]. */
export function cleanDeviceId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v) ? v : null;
}
/** APNs-devicetoken als hex (64–200 tekens, even lengte), in kleine letters. */
export function cleanApnsToken(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[0-9a-fA-F]{64,200}$/.test(s) && s.length % 2 === 0 ? s.toLowerCase() : null;
}
/** Precies de vier schakelaars als booleans; ontbreekt er een of is er een andere sleutel, dan null. */
export function cleanPrefs(v: unknown): Prefs | null {
  if (!isObj(v)) return null;
  const o = v as J;
  if (Object.keys(o).some((k) => !(PREF_KEYS as readonly string[]).includes(k))) return null;
  if (!PREF_KEYS.every((k) => typeof o[k] === "boolean")) return null;
  return Object.fromEntries(PREF_KEYS.map((k) => [k, o[k]])) as Prefs;
}

/** Invoer van admin_push_register controleren. */
export function cleanRegister(body: unknown): { ok: true; value: RegisterInput } | { ok: false; error: RegisterError } {
  const b = obj(body);
  const device_id = cleanDeviceId(b.device_id);
  if (!device_id) return { ok: false, error: "bad_device_id" };
  const apns_token = cleanApnsToken(b.apns_token);
  if (!apns_token) return { ok: false, error: "bad_apns_token" };
  if (!(BEHEER_PLATFORMS as readonly unknown[]).includes(b.platform)) return { ok: false, error: "bad_platform" };
  if (b.sandbox !== undefined && typeof b.sandbox !== "boolean") return { ok: false, error: "bad_sandbox" };
  let app_build: number | null = null;
  if (b.app_build !== undefined && b.app_build !== null) {
    if (typeof b.app_build !== "number" || !Number.isInteger(b.app_build) || b.app_build < 0 || b.app_build > 1_000_000) {
      return { ok: false, error: "bad_app_build" };
    }
    app_build = b.app_build;
  }
  const prefs = cleanPrefs(b.prefs);
  if (!prefs) return { ok: false, error: "bad_prefs" };
  return { ok: true, value: { device_id, apns_token, platform: b.platform as BeheerPlatform, sandbox: b.sandbox === true, app_build, prefs } };
}

// ---- APNs (testmelding) ----

const te = new TextEncoder();
export function b64u(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** PEM (PKCS#8, "-----BEGIN PRIVATE KEY-----") naar DER; ook met letterlijke "\n" (uit een secret). */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = String(pem ?? "").replace(/\\n/g, "\n").replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  if (!body) throw new Error("empty_key");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}
export function importApnsKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemToDer(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
/**
 * APNs provider token (JWT ES256): header {alg:"ES256", kid: key-id}, claims {iss: team-id, iat}. WebCrypto geeft de
 * ECDSA-handtekening al als r||s (64 bytes), precies wat JWS (RFC 7518) vraagt. Apple accepteert hem 60 minuten.
 */
export async function apnsJwt(key: CryptoKey, keyId: string, teamId: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const input = `${b64u(te.encode(JSON.stringify({ alg: "ES256", kid: keyId })))}.${b64u(te.encode(JSON.stringify({ iss: teamId, iat: nowS })))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(input));
  return `${input}.${b64u(sig)}`;
}

/** Host per omgeving van het apparaat (sandbox = ontwikkelprofiel, anders TestFlight/App Store). */
export const apnsHost = (sandbox: boolean) => sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";

/** Payload van de testmelding (zelfde vorm als de meldingen van de cron: {aps, kind, url}). */
export function testPayload() {
  return {
    aps: {
      alert: { title: "Testmelding", body: "Pushmeldingen van BingrBeheer werken op dit apparaat." },
      sound: "default", "thread-id": "test",
    },
    kind: "test",
    url: "bingrbeheer://overview",
  };
}

/** Uitkomst van APNs: verstuurd, token ongeldig (apparaat opruimen) of een andere fout (korte code). */
export function apnsResult(status: number, reason: string): { ok: true } | { ok: false; invalid: boolean; error: string } {
  if (status === 200) return { ok: true };
  const r = /^[A-Za-z]{1,40}$/.test(reason) ? reason : "";
  const invalid = status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"].includes(r);
  return { ok: false, invalid, error: `apns_${r || status}` };
}

// ---- pushabonnees van de Bingr-apps (push_devices): alleen tellingen ----

/** Platforms met systeem-push in push_devices (zelfde als PUSH_PLATFORMS in push.ts). */
export const SUB_PLATFORMS = ["ios", "ipados", "macos", "android", "web"] as const;
export type Subscribers = {
  accounts: number; devices: number; by_platform: Record<string, number>;
  new_7d: { devices: number; accounts: number };
};
/**
 * Tellingen uit rijen {user_id, platform, created_at}: apparaten per platform, unieke accounts, en nieuw in de laatste 7
 * dagen (apparaten die toen zijn aangemeld; accounts waarvan het eerste apparaat toen is aangemeld). Andere platforms
 * tellen niet mee. Nooit account-id's in het antwoord.
 */
export function summarizeSubscribers(rows: unknown[], now = Date.now()): Subscribers {
  const cut = now - 7 * 864e5;
  const by: Record<string, number> = Object.fromEntries(SUB_PLATFORMS.map((p) => [p, 0]));
  const first = new Map<string, number>();
  let devices = 0, newDevices = 0;
  for (const r of rows) {
    const o = obj(r);
    const p = typeof o.platform === "string" ? o.platform : "";
    const u = typeof o.user_id === "string" ? o.user_id : "";
    if (!(SUB_PLATFORMS as readonly string[]).includes(p) || !u) continue;
    by[p]++;
    devices++;
    const t = typeof o.created_at === "string" ? Date.parse(o.created_at) : NaN;
    const at = Number.isFinite(t) ? t : 0;
    if (at >= cut) newDevices++;
    const f = first.get(u);
    if (f === undefined || at < f) first.set(u, at);
  }
  let newAccounts = 0;
  for (const t of first.values()) if (t >= cut) newAccounts++;
  return { accounts: first.size, devices, by_platform: by, new_7d: { devices: newDevices, accounts: newAccounts } };
}
