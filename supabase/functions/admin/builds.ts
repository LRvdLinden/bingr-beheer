// Downloads van Bingr-builds (functie admin): pure hulpjes zonder netwerk of database, getest in builds_test.ts.
// De buildpakketten (APK, Samsung .wgt, Windows-installer .exe, Xcode-zips) staan niet op GitHub maar op de server van beheer.bingr.online in de
// afgesloten map builds/ (workflow Builds). Ophalen kan alleen via https://beheer.bingr.online/dl.php?t=<token> (web/dl.php).
// Token = "<payload>.<sig>": payload = base64url (zonder =) van JSON {"f": "<pad>", "e": <unix-seconden verloop>},
// sig = base64url(HMAC-SHA256(sleutel, payload)), sleutel = de UTF-8-string uit het function-secret BINGR_BUILDS_KEY
// (dl.php gebruikt dezelfde string uit builds/key.php). dl.php weigert e > nu + 900.

/** Adres van het downloadscript (same-origin met het dashboard). */
export const DL_URL = "https://beheer.bingr.online/dl.php";
/** Platforms in builds/manifest.json, tevens de mappen in builds/. `presskit` = Bingr-PressKit (workflow PressKit). */
/** `android-aab` = Android App Bundle voor Google Play (alleen via een kortgeldige link, niet openbaar zoals de APK). */
/** `windows` = installer (.exe) van Bingr voor Windows (repo bingr-windows), ook alleen via een kortgeldige link. */
export const BUILD_PLATFORMS = ["android", "android-aab", "tizen", "windows", "apple", "beheer", "presskit"] as const;
export type BuildPlatform = typeof BUILD_PLATFORMS[number];
/** dl.php accepteert hoogstens 15 minuten. */
export const MAX_TTL = 900;
/** Minimale sleutellengte (dl.php weigert korter dan 32 tekens). */
export const MIN_KEY = 32;

const enc = new TextEncoder();
export const b64url = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Zelfde regels als dl.php: een bestandsnaam binnen een platformmap. */
export function isValidBuildFile(name: unknown): name is string {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(name) && !name.includes("..");
}
export const isBuildPlatform = (p: unknown): p is BuildPlatform =>
  typeof p === "string" && (BUILD_PLATFORMS as readonly string[]).includes(p);

/** Downloadteller van de presskit op de server (dl.php ?app=presskit schrijft hem; alleen aantallen). */
export const PRESSKIT_STATS = "presskit-stats.json";
/** Openbare link naar de nieuwste presskit (302 naar dl.php?app=presskit, workflow Website van bingr-website). */
export const PRESSKIT_PUBLIC_URL = "https://bingr.online/presskit";

/** Zelfde regels als dl.php: "manifest.json", "presskit-stats.json" of "<apple|android|android-aab|tizen|windows|beheer|presskit>/<bestandsnaam>". */
export function isValidBuildPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path === "manifest.json" || path === PRESSKIT_STATS) return true;
  const i = path.indexOf("/");
  return i > 0 && isBuildPlatform(path.slice(0, i)) && isValidBuildFile(path.slice(i + 1));
}

/**
 * Maakt een downloadtoken voor dl.php. `key` = BINGR_BUILDS_KEY (als string, niet gehasht), `ttlSeconds` 1..900,
 * `now` in milliseconden (standaard nu). Geeft het token en het verloop (unix-seconden).
 */
export async function signBuildToken(key: string, path: string, ttlSeconds: number, now = Date.now()): Promise<{ token: string; exp: number }> {
  if (typeof key !== "string" || key.length < MIN_KEY) throw new Error("builds_key_missing");
  if (!isValidBuildPath(path)) throw new Error("bad_build_path");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL) throw new Error("bad_ttl");
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const payload = b64url(enc.encode(JSON.stringify({ f: path, e: exp })));
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(payload))));
  return { token: `${payload}.${sig}`, exp };
}

/** Downloadadres voor een token. */
export const buildUrl = (token: string) => `${DL_URL}?t=${encodeURIComponent(token)}`;

// ---- manifest (builds/manifest.json, gemaakt door de workflow Builds) ----
export type BuildEntry = Record<string, unknown> & { file: string };
type PlatformEntry = BuildEntry & { history: BuildEntry[] };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const HISTORY_MAX = 10;

/** Eén build uit het manifest: alle velden blijven, maar alleen met een geldige bestandsnaam (anders null). */
function entry(v: unknown): BuildEntry | null {
  if (!isObj(v) || !isValidBuildFile(v.file)) return null;
  const { history: _h, uploaded_at, ...rest } = v;
  // uploaded_at (workflow Builds, UTC ISO 8601): alleen een geldige tijd; oudere builds hebben het niet (dan alleen date)
  const up = typeof uploaded_at === "string" && uploaded_at.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(uploaded_at)
    && !Number.isNaN(Date.parse(uploaded_at)) ? uploaded_at : undefined;
  return (up ? { ...rest, uploaded_at: up } : rest) as BuildEntry;
}

/**
 * Het manifest zoals de functie het teruggeeft: alleen bekende platforms, elk met de nieuwste build en history (oudere
 * builds, nieuwste eerst). Onbekende platforms en builds zonder geldige bestandsnaam vallen weg. null als het geen
 * manifest is.
 */
export function cleanManifest(raw: unknown): { updated: string | null; platforms: Record<string, PlatformEntry> } | null {
  if (!isObj(raw) || !isObj(raw.platforms)) return null;
  const platforms: Record<string, PlatformEntry> = {};
  for (const p of BUILD_PLATFORMS) {
    const v = raw.platforms[p];
    const e = entry(v);
    if (!e) continue;
    const hist = isObj(v) && Array.isArray(v.history) ? v.history : [];
    platforms[p] = { ...e, history: hist.map(entry).filter((x): x is BuildEntry => !!x).slice(0, HISTORY_MAX) };
  }
  return { updated: typeof raw.updated === "string" ? raw.updated : null, platforms };
}

/** Zoekt een build van een platform: zonder `file` de nieuwste, anders alleen een bestand dat in het manifest staat. */
export function findBuild(manifest: ReturnType<typeof cleanManifest>, platform: string, file?: unknown): BuildEntry | null {
  if (!manifest || !isBuildPlatform(platform)) return null;
  const p = manifest.platforms[platform];
  if (!p) return null;
  if (file === undefined || file === null || file === "") return p;
  if (!isValidBuildFile(file)) return null;
  if (p.file === file) return p;
  return p.history.find((h) => h.file === file) ?? null;
}

// ---- releasemelding per build (tab Downloads, knop "Pushmelding versturen") ----
// Niet meer automatisch na het plaatsen: Apple en Google keuren een build soms pas na dagen goed. De beheerder stuurt
// hem per build zelf vanuit Downloads; de functie `push` stuurt één melding per (platform_group, build).

/** Platforms in Downloads met een releasemelding (Samsung TV en de Beheer-app hebben geen push). */
export const RELEASE_PUSH_PLATFORMS = ["apple", "android"] as const;
export const isReleasePushPlatform = (p: unknown): p is typeof RELEASE_PUSH_PLATFORMS[number] =>
  typeof p === "string" && (RELEASE_PUSH_PLATFORMS as readonly string[]).includes(p);

/** Versie en build van een build uit het manifest, of null als die niet geldig zijn (zelfde regels als `push`). */
export function releaseOf(b: BuildEntry | null): { version: string; build: number } | null {
  if (!b) return null;
  const version = typeof b.version === "string" ? b.version.trim() : "";
  const build = typeof b.build === "number" ? b.build : typeof b.build === "string" && /^\d+$/.test(b.build) ? Number(b.build) : NaN;
  if (!/^[0-9][0-9A-Za-z.\-]{0,19}$/.test(version) || !Number.isInteger(build) || build <= 0 || build > 1e7) return null;
  return { version, build };
}

/** dedup_key van de releasemelding in push_messages (gelijk aan releaseKey in de functie push). */
export const releaseKey = (platform: string, build: number) => `release:${platform}:${build}`;

/** Alle releasesleutels voor de builds van apple en android in het manifest (nieuwste en history). */
export function releaseKeys(manifest: ReturnType<typeof cleanManifest>): string[] {
  const out = new Set<string>();
  for (const p of RELEASE_PUSH_PLATFORMS) {
    const e = manifest?.platforms[p];
    if (!e) continue;
    for (const b of [e, ...e.history]) {
      const r = releaseOf(b);
      if (r) out.add(releaseKey(p, r.build));
    }
  }
  return [...out];
}

const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
/**
 * Stand van verstuurde releasemeldingen per "platform:build" (bv. "apple:114"): wanneer, hoeveel apparaten en de
 * aantallen. Alleen tellingen, geen account-id's of tokens.
 */
export function releasePushView(rows: unknown): Record<string, {
  sent_at: string | null; devices: number; queued: number; sent: number; failed: number; invalid: number; done: boolean;
}> {
  const out: ReturnType<typeof releasePushView> = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isObj(r) || typeof r.dedup_key !== "string") continue;
    const m = /^release:(apple|android):(\d{1,7})$/.exec(r.dedup_key);
    if (!m) continue;
    const c = isObj(r.counts) ? r.counts : {};
    const queued = n0(c.queued);
    out[`${m[1]}:${m[2]}`] = {
      sent_at: typeof r.created_at === "string" ? r.created_at : null, devices: n0(r.devices),
      queued, sent: n0(c.sent), failed: n0(c.failed), invalid: n0(c.invalid),
      done: typeof r.finished_at === "string" || queued === 0,
    };
  }
  return out;
}

// ---- presskit: downloadteller (builds/presskit-stats.json, bijgehouden door dl.php ?app=presskit) ----
// {"total": N, "by_version": {"1.3": N}, "by_day": {"2026-10-18": N}} (dagen in NL-tijd, max. 400). Geen persoonsgegevens.

/** Datum (YYYY-MM-DD) in Nederlandse tijd. */
export function nlDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
const dayAdd = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export type PresskitStats = { total: number; version: string | null; version_total: number; last_7d: number; last_30d: number; days: { date: string; n: number }[] };

/**
 * Samenvatting voor de kaart PressKit in Downloads: totaal, deze versie, laatste 7 en 30 dagen (t/m vandaag, NL-tijd) en
 * de 30 dagen per dag (oud → nieuw, ook dagen met 0). Rommel telt als 0; null als het geen teller is.
 */
export function presskitStatsView(raw: unknown, version: unknown, now = Date.now()): PresskitStats | null {
  if (!isObj(raw)) return null;
  const v = typeof version === "string" && /^[0-9][0-9A-Za-z.\-]{0,19}$/.test(version) ? version : null;
  const byV = isObj(raw.by_version) ? raw.by_version : {};
  const byD = isObj(raw.by_day) ? raw.by_day : {};
  const today = nlDay(now);
  const days: { date: string; n: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = dayAdd(today, -i);
    days.push({ date: d, n: n0(byD[d]) });
  }
  const sum = (xs: { n: number }[]) => xs.reduce((a, x) => a + x.n, 0);
  return {
    total: n0(raw.total), version: v, version_total: v ? n0(byV[v]) : 0,
    last_7d: sum(days.slice(-7)), last_30d: sum(days), days,
  };
}
