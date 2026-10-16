// Downloads van Bingr-builds (functie admin): pure hulpjes zonder netwerk of database, getest in builds_test.ts.
// De buildpakketten (APK, Samsung .wgt, Xcode-zips) staan niet op GitHub maar op de server van beheer.bingr.online in de
// afgesloten map builds/ (workflow Builds). Ophalen kan alleen via https://beheer.bingr.online/dl.php?t=<token> (web/dl.php).
// Token = "<payload>.<sig>": payload = base64url (zonder =) van JSON {"f": "<pad>", "e": <unix-seconden verloop>},
// sig = base64url(HMAC-SHA256(sleutel, payload)), sleutel = de UTF-8-string uit het function-secret BINGR_BUILDS_KEY
// (dl.php gebruikt dezelfde string uit builds/key.php). dl.php weigert e > nu + 900.

/** Adres van het downloadscript (same-origin met het dashboard). */
export const DL_URL = "https://beheer.bingr.online/dl.php";
/** Platforms in builds/manifest.json, tevens de mappen in builds/. */
export const BUILD_PLATFORMS = ["android", "tizen", "apple", "beheer"] as const;
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

/** Zelfde regels als dl.php: "manifest.json" of "<apple|android|tizen|beheer>/<bestandsnaam>". */
export function isValidBuildPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path === "manifest.json") return true;
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
  const { history: _h, ...rest } = v;
  return rest as BuildEntry;
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
