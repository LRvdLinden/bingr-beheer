// Versies bij de downloadknoppen op bingr.online (kaart Versies in de tab Downloads; acties releases_get / releases_set).
// Opslag: app_settings.release_channels (schema in iptv-ios-appletv, docs/ACCOUNT.md "Versies bij de downloadknoppen").
// Openbaar lezen gaat via de functie status (?action=releases, status/releases.ts daar); houd de regels hier gelijk.
//   {apple:   {live: {version, build, date?} | null, beta: {version, build, date?, label: "TestFlight"|"Beta"} | null},
//    android: {live: …, beta: …},   (android = ook Android TV, Google TV en Fire TV)
//    updatedAt}

export const RELEASE_PLATFORMS = ["apple", "android"] as const;
export type ReleasePlatform = typeof RELEASE_PLATFORMS[number];
export const BETA_LABELS = ["TestFlight", "Beta"] as const;
export interface Channel { version: string; build: number; date?: string }
export interface BetaChannel extends Channel { label: typeof BETA_LABELS[number] }
export interface PlatformReleases { live: Channel | null; beta: BetaChannel | null }
export type Releases = Record<ReleasePlatform, PlatformReleases> & { updatedAt: string | null };

const VERSION_RE = /^\d{1,3}(\.\d{1,3}){1,3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const defaultLabel = (p: ReleasePlatform) => (p === "apple" ? "TestFlight" : "Beta");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

export function cleanVersion(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return VERSION_RE.test(s) ? s : null;
}
export function cleanBuild(v: unknown): number | null {
  const n = typeof v === "string" && /^\d{1,7}$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 9_999_999 ? n : null;
}
export function cleanDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

function channel(v: unknown): Channel | null {
  const o = obj(v);
  if (!o) return null;
  const version = cleanVersion(o.version), build = cleanBuild(o.build);
  if (!version || !build) return null;
  const date = cleanDate(o.date);
  return date ? { version, build, date } : { version, build };
}

/** Weergave van de opgeslagen waarde (zelfde als de openbare in status/releases.ts). */
export function releasesView(v: unknown): Releases {
  const o = obj(v) ?? {};
  const out: Partial<Releases> = {};
  for (const p of RELEASE_PLATFORMS) {
    const po = obj(o[p]) ?? {};
    const b = channel(po.beta);
    const lbl = obj(po.beta)?.label;
    const label = (BETA_LABELS as readonly unknown[]).includes(lbl) ? lbl as BetaChannel["label"] : defaultLabel(p);
    out[p] = { live: channel(po.live), beta: b ? { ...b, label } : null };
  }
  const u = typeof o.updatedAt === "string" ? new Date(o.updatedAt) : null;
  out.updatedAt = u && !isNaN(u.getTime()) ? u.toISOString() : null;
  return out as Releases;
}

/** Eén kanaal uit het formulier: leeg (versie én build leeg) = null; half of ongeldig = fout (undefined). */
function channelInput(v: unknown, beta: boolean, p: ReleasePlatform): Channel | BetaChannel | null | undefined {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  if (!o) return undefined;
  if (blank(o.version) && blank(o.build)) return null;
  const version = cleanVersion(o.version), build = cleanBuild(o.build);
  if (!version || !build) return undefined;
  let date: string | null = null;
  if (!blank(o.date)) { date = cleanDate(o.date); if (!date) return undefined; }
  const base: Channel = date ? { version, build, date } : { version, build };
  if (!beta) return base;
  if (!blank(o.label) && !(BETA_LABELS as readonly unknown[]).includes(o.label)) return undefined;
  const label = blank(o.label) ? defaultLabel(p) : o.label as BetaChannel["label"];
  return { ...base, label };
}

/** Invoer van releases_set: {apple:{live, beta}, android:{live, beta}}. Fout = {error, field}. */
export function releasesInput(body: unknown, now = new Date()): { value: Releases } | { error: "bad_releases"; field: string } {
  const o = obj(body);
  if (!o) return { error: "bad_releases", field: "releases" };
  const out: Partial<Releases> = {};
  for (const p of RELEASE_PLATFORMS) {
    const po = o[p] === undefined || o[p] === null ? {} : obj(o[p]);
    if (!po) return { error: "bad_releases", field: p };
    const live = channelInput(po.live, false, p);
    if (live === undefined) return { error: "bad_releases", field: `${p}.live` };
    const beta = channelInput(po.beta, true, p) as BetaChannel | null | undefined;
    if (beta === undefined) return { error: "bad_releases", field: `${p}.beta` };
    out[p] = { live, beta };
  }
  out.updatedAt = now.toISOString();
  return { value: out as Releases };
}
