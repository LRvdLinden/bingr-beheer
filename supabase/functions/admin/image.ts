// Afbeelding bovenaan een eigen mailing (tab Nieuwsbrief, blok Eigen mailing): uploaden naar de openbare bucket
// `mail-assets` (schema in iptv-ios-appletv; lezen voor iedereen, schrijven alleen via deze functie met de service role) en
// een ingevulde afbeelding-URL server-side controleren vóór voorbeeld, testmail en versturen.
// Pure logica met ingespoten fetch en DNS (image_test.ts). Nooit de URL, de host of een serverantwoord loggen.
//
// Controle (checkImageUrl): https zonder poort of inloggegevens, host die naar openbare IP-adressen wijst (geen interne,
// private, link-local of gereserveerde adressen: SSRF), hoogstens 3 doorverwijzingen (elke stap opnieuw gecontroleerd),
// een GET binnen de time-out, content-type image/png|jpeg|gif én bestandsinhoud die daarbij past (SVG en WebP geweigerd:
// veel mailprogramma's tonen die niet), en niet groter dan IMAGE_MAX.

export const IMAGE_MAX = 2 * 1024 * 1024;
export const MAIL_BUCKET = "mail-assets";
export const MAX_REDIRECTS = 3;
export const CHECK_TIMEOUT_MS = 8000;
export type ImageType = "image/png" | "image/jpeg" | "image/gif";
export const IMAGE_EXT: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };
const ALLOWED = new Set<string>(Object.keys(IMAGE_EXT));

export type ImageError =
  | "bad_image_url" | "image_blocked_host" | "image_unreachable" | "image_timeout" | "image_login" | "image_http"
  | "image_redirects" | "image_page" | "image_share_link" | "image_svg" | "image_webp" | "image_type" | "image_too_large"
  | "image_empty";

// ---------- bestandsinhoud ----------

/** Soort bestand op grond van de eerste bytes (niet van de header). */
export function sniff(b: Uint8Array): ImageType | "image/webp" | "image/svg+xml" | "text/html" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  const head = new TextDecoder().decode(b.slice(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(head)) return "image/svg+xml";
  if (/^<(!doctype html|html|head|body|meta|script|title|div|!--)/.test(head)) return "text/html";
  return null;
}

/** Content-type zonder parameters, in kleine letters (image/jpg telt als image/jpeg). */
export function mediaType(v: string | null | undefined): string {
  const t = String(v ?? "").split(";")[0].trim().toLowerCase();
  return t === "image/jpg" || t === "image/pjpeg" ? "image/jpeg" : t;
}

// ---------- hosts en IP-adressen (SSRF) ----------

function v4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}
function privateV4([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}
/** IPv6 naar 8 groepen van 16 bits (met een IPv4-staart); null = ongeldig. */
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const tail = s.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const p = v4(tail[1]);
    if (!p) return null;
    s = s.slice(0, -tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [], right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (parts.length === 1 && left.length !== 8)) return null;
  const all = [...left, ...Array(fill).fill("0"), ...right];
  if (all.length !== 8 || !all.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}
/**
 * Is dit IP-adres niet openbaar bereikbaar (intern, privé, loopback, link-local, multicast, gereserveerd of documentatie)?
 * Onleesbaar = ook geblokkeerd. IPv6 alleen globaal unicast (2000::/3), zonder documentatie, Teredo, 6to4 en ORCHID;
 * IPv4-mapped en NAT64 naar een privé IPv4-adres zijn geblokkeerd.
 */
export function isPrivateIp(ip: string): boolean {
  const a = v4(ip);
  if (a) return privateV4(a);
  const g = v6(ip);
  if (!g) return true;
  const embedded = [(g[6] >> 8), g[6] & 255, g[7] >> 8, g[7] & 255];
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return privateV4(embedded); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateV4(embedded); // 64:ff9b::/96
  if ((g[0] & 0xe000) !== 0x2000) return true; // alles buiten 2000::/3 (::, ::1, fc00::/7, fe80::/10, ff00::/8, …)
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0 || (g[1] & 0xfff0) === 0x0010 || (g[1] & 0xfff0) === 0x0020)) return true;
  if (g[0] === 0x2002 || (g[0] === 0x3fff && g[1] < 0x1000)) return true; // 6to4, documentatie (3fff::/20)
  return false;
}

/** Host van een bekende deeldienst (de link is dan meestal een pagina, geen afbeelding); null = onbekend. */
export function shareService(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  const is = (d: string) => h === d || h.endsWith("." + d);
  if (is("drive.google.com") || is("docs.google.com") || is("photos.google.com") || is("photos.app.goo.gl")) return "Google";
  if (is("icloud.com") || is("icloud-content.com")) return "iCloud";
  if (is("dropbox.com") || is("db.tt")) return "Dropbox";
  if (is("onedrive.live.com") || is("1drv.ms") || is("sharepoint.com")) return "OneDrive";
  if (is("wetransfer.com") || is("we.tl")) return "WeTransfer";
  return null;
}

/**
 * Een URL die de controle mag ophalen: https, geen poort (of 443), geen inloggegevens, een hostnaam met een punt en geen
 * IP-adres of interne naam. Geeft de URL terug of null.
 */
export function fetchableUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || h.includes(":") || v4(h) || /^[\d.]+$/.test(h)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(h.replace(/\.$/, ""))) return null;
  return u;
}

// ---------- controle ----------

export type CheckDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** A- en AAAA-records van een host ([] of een fout = niet te vinden). */
  resolve: (host: string) => Promise<string[]>;
  now?: () => number;
  /** Eigen opslag (Supabase Storage van dit project): geen DNS-controle nodig. */
  trusted?: (u: URL) => boolean;
};
export type CheckResult = { ok: true; type: ImageType; size: number } | { ok: false; error: ImageError; service?: string };

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock?.(); }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Controleer een afbeelding-URL voor een mailing (zie bovenaan). Nooit gooit hij: altijd een resultaat. */
export async function checkImageUrl(raw: string, d: CheckDeps, o: { timeoutMs?: number; max?: number } = {}): Promise<CheckResult> {
  const now = d.now ?? Date.now, until = now() + (o.timeoutMs ?? CHECK_TIMEOUT_MS), max = o.max ?? IMAGE_MAX;
  let u = fetchableUrl(raw);
  if (!u) return { ok: false, error: "bad_image_url" };
  const service = shareService(u.hostname) ?? undefined;
  for (let hop = 0; ; hop++) {
    if (!(d.trusted?.(u))) {
      let ips: string[] = [];
      try { ips = await d.resolve(u.hostname); } catch { ips = []; }
      if (!ips.length) return { ok: false, error: "image_unreachable" };
      if (ips.some(isPrivateIp)) return { ok: false, error: "image_blocked_host" };
    }
    const left = until - now();
    if (left <= 0) return { ok: false, error: "image_timeout" };
    let res: Response;
    try {
      res = await d.fetch(u.href, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(left),
        headers: { Accept: "image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1", "User-Agent": "BingrMailCheck/1.0 (+https://bingr.online)" },
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "image_timeout" : "image_unreachable" };
    }
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      await res.body?.cancel().catch(() => {});
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: "image_http" };
      if (hop >= MAX_REDIRECTS) return { ok: false, error: "image_redirects" };
      let next: URL | null = null;
      try { next = fetchableUrl(new URL(loc, u).href); } catch { next = null; }
      if (!next) return { ok: false, error: "image_blocked_host" };
      u = next;
      continue;
    }
    const fail = async (error: ImageError): Promise<CheckResult> => {
      await res.body?.cancel().catch(() => {});
      const s = service ?? shareService(u!.hostname) ?? undefined;
      return s ? { ok: false, error, service: s } : { ok: false, error };
    };
    if (res.status === 401 || res.status === 403 || res.status === 407) return fail("image_login");
    if (!res.ok) return fail("image_http");
    const len = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(len) && len > max) return fail("image_too_large");
    const type = mediaType(res.headers.get("content-type"));
    if (type === "image/svg+xml") return fail("image_svg");
    if (type === "image/webp") return fail("image_webp");
    if (type === "text/html" || type === "application/xhtml+xml") return fail(service || shareService(u.hostname) ? "image_share_link" : "image_page");
    let bytes: Uint8Array | null;
    try { bytes = await readCapped(res, max); } catch (e) {
      return { ok: false, error: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "image_timeout" : "image_unreachable" };
    }
    if (!bytes) return { ok: false, error: "image_too_large" };
    if (!bytes.length) return { ok: false, error: "image_empty" };
    const real = sniff(bytes);
    if (real === "image/svg+xml") return { ok: false, error: "image_svg" };
    if (real === "image/webp") return { ok: false, error: "image_webp" };
    if (real === "text/html") {
      const s = service ?? shareService(u.hostname) ?? undefined;
      return s ? { ok: false, error: "image_share_link", service: s } : { ok: false, error: "image_page" };
    }
    // header én inhoud moeten een toegestaan type zijn (png/jpeg/gif door elkaar is voor mailprogramma's geen probleem)
    if (!ALLOWED.has(type) || !real || !ALLOWED.has(real)) return { ok: false, error: "image_type" };
    return { ok: true, type: real as ImageType, size: bytes.length };
  }
}

// ---------- uploaden ----------

export type UploadResult = { ok: true; bytes: Uint8Array; type: ImageType; ext: string } | { ok: false; error: string };
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Base64 (zonder of met data:-voorvoegsel) naar bytes; controleert grootte en soort (op de inhoud, niet op de naam). */
export function cleanUpload(data: unknown, max = IMAGE_MAX): UploadResult {
  if (typeof data !== "string" || !data) return { ok: false, error: "bad_image_data" };
  const s = data.replace(/^data:image\/[a-z+.-]+;base64,/i, "").replace(/\s+/g, "");
  if (s.length > Math.ceil(max / 3) * 4 + 4) return { ok: false, error: "image_too_large" };
  if (!B64.test(s) || s.length % 4 !== 0) return { ok: false, error: "bad_image_data" };
  let bytes: Uint8Array;
  try {
    const bin = atob(s);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return { ok: false, error: "bad_image_data" }; }
  if (!bytes.length) return { ok: false, error: "image_empty" };
  if (bytes.length > max) return { ok: false, error: "image_too_large" };
  const t = sniff(bytes);
  if (t === "image/svg+xml") return { ok: false, error: "image_svg" };
  if (t === "image/webp") return { ok: false, error: "image_webp" };
  if (!t || !ALLOWED.has(t)) return { ok: false, error: "image_type" };
  return { ok: true, bytes, type: t as ImageType, ext: IMAGE_EXT[t as ImageType] };
}

/** Willekeurige objectnaam zonder persoonsgegevens: m/<jjjj>/<mm>/<32 hex>.<ext>. */
export function objectName(ext: string, now = new Date(), rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const hex = [...rand(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `m/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${hex}.${ext}`;
}
/** Openbare URL van een object in de bucket mail-assets. */
export const publicUrl = (supabaseUrl: string, name: string) =>
  `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${MAIL_BUCKET}/${name}`;
/** Ligt deze URL in de eigen bucket mail-assets (zelfde Supabase-project)? */
export function isOwnAsset(supabaseUrl: string, u: URL): boolean {
  let base: URL;
  try { base = new URL(supabaseUrl); } catch { return false; }
  return u.protocol === "https:" && u.host === base.host && u.pathname.startsWith(`/storage/v1/object/public/${MAIL_BUCKET}/`) &&
    /^\/storage\/v1\/object\/public\/mail-assets\/m\/\d{4}\/\d{2}\/[0-9a-f]{32}\.(png|jpg|gif)$/.test(u.pathname);
}
