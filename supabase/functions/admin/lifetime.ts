// Build 167 (server): Bingr wordt alleen Lifetime. Beheerkant (tab Lifetime van het dashboard, de Beheer-app en LRbeheer).
// Contract: docs/ACCOUNT.md in iptv-ios-appletv, sectie "Build 167: alleen Lifetime". Hier alleen pure logica (lifetime_test.ts):
// invoer controleren, wat bevestiging nodig heeft, en antwoorden terugbrengen tot instellingen en aantallen. Nooit
// e-mailadressen, account-id's of Stripe-id's in een antwoord of log; een code alleen bij de accountdetails (user_detail).
//
// Instellingen (app_settings):
//   lifetime_only        {enabled, announce_at, cutover_at, discount_pct, code_valid_until, trial_days,
//                         new_paid_from, new_paid_from_apple}   (build 168: nieuwe accounts eerst kopen, per platformgroep)
//   iap                  {apple}            (koopknop in de Apple-apps; pas aan als de server Apple-aankopen verwerkt)
//   upgrade_link         {…, apple_eu}      (EU External Purchase Link in de Apple-apps; de andere sleutels blijven staan)
// Codes en mail: de server (functie `billing` voor codes, `lifetime-notice` voor de mail; iptv-ios-appletv) doet het werk,
// met het admin-geheim in een header. Zie LIFETIME_CALLS.

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? v as J : {});
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const isoOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null;

export type LifetimeSettings = {
  enabled: boolean; announce_at: string | null; cutover_at: string | null; discount_pct: number;
  code_valid_until: string | null; trial_days: number;
  /** build 168: nieuwe accounts eerst kopen op web en Android (android, androidtv, web/Windows); null = uit */
  new_paid_from: string | null;
  /** build 168: hetzelfde voor de Apple-apps (ios, ipados, tvos, macos), pas na de goedkeuring van Apple; null = uit */
  new_paid_from_apple: string | null;
};
export const DEFAULT_SETTINGS: LifetimeSettings = {
  enabled: false, announce_at: null, cutover_at: null, discount_pct: 30, code_valid_until: null, trial_days: 0,
  new_paid_from: null, new_paid_from_apple: null,
};
export const LIMITS = { discount_min: 1, discount_max: 90, trial_max: 90 } as const;
const DAY = 86400000;

/** Opgeslagen waarde (of niets) als volledige instelling met standaardwaarden. */
export function settingsView(raw: unknown): LifetimeSettings {
  const o = obj(raw);
  const pct = typeof o.discount_pct === "number" && Number.isInteger(o.discount_pct) &&
      o.discount_pct >= LIMITS.discount_min && o.discount_pct <= LIMITS.discount_max ? o.discount_pct : DEFAULT_SETTINGS.discount_pct;
  const trial = typeof o.trial_days === "number" && Number.isInteger(o.trial_days) && o.trial_days >= 0 && o.trial_days <= LIMITS.trial_max
    ? o.trial_days : 0;
  return {
    enabled: o.enabled === true, announce_at: isoOrNull(o.announce_at), cutover_at: isoOrNull(o.cutover_at),
    discount_pct: pct, code_valid_until: isoOrNull(o.code_valid_until), trial_days: trial,
    new_paid_from: isoOrNull(o.new_paid_from), new_paid_from_apple: isoOrNull(o.new_paid_from_apple),
  };
}

/**
 * Aanvulling 2: vaste overgang op 1 december 2026, 00:00 Europe/Amsterdam; de code werkt tot en met 30 november 23:59
 * (code_valid_until = dezelfde datum). Standaardwaarde en voorstel in het beheer (web, BingrBeheer en LRbeheer).
 */
export const FIXED_CUTOVER = "2026-12-01T00:00:00+01:00";
export const suggestion = () => ({ suggested_cutover_at: FIXED_CUTOVER, suggested_code_valid_until: FIXED_CUTOVER });

function dateIn(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 40) return undefined;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(s) || Number.isNaN(Date.parse(s))) return undefined;
  return s;
}

/**
 * Nieuwe instellingen uit het beheer controleren (`input` = alleen de velden die veranderen). Foutcodes:
 * bad_enabled, bad_announce_at, bad_cutover_at, bad_discount_pct, bad_code_valid_until, bad_trial_days,
 * cutover_required (aanzetten zonder overgangsdatum), cutover_past (aanzetten met een datum in het verleden),
 * announce_after_cutover, code_after_cutover.
 * Build 168: bad_new_paid_from, bad_new_paid_from_apple, new_paid_requires_enabled (een datum zetten kan alleen als
 * Lifetime-only aan staat of tegelijk aan gaat), new_paid_after_cutover (de datum moet vóór de overgang liggen).
 */
export function cleanSettings(input: unknown, current: LifetimeSettings, now: number): { ok: true; value: LifetimeSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "bad_settings" };
  const o = input as J, v: LifetimeSettings = { ...current };
  if ("enabled" in o) { if (typeof o.enabled !== "boolean") return { ok: false, error: "bad_enabled" }; v.enabled = o.enabled; }
  for (const k of ["announce_at", "cutover_at", "code_valid_until", "new_paid_from", "new_paid_from_apple"] as const) {
    if (!(k in o)) continue;
    const d = dateIn(o[k]);
    if (d === undefined) return { ok: false, error: `bad_${k}` };
    v[k] = d;
  }
  if ("discount_pct" in o) {
    const n = o.discount_pct;
    if (typeof n !== "number" || !Number.isInteger(n) || n < LIMITS.discount_min || n > LIMITS.discount_max) return { ok: false, error: "bad_discount_pct" };
    v.discount_pct = n;
  }
  if ("trial_days" in o) {
    const n = o.trial_days;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > LIMITS.trial_max) return { ok: false, error: "bad_trial_days" };
    v.trial_days = n;
  }
  const cut = v.cutover_at ? Date.parse(v.cutover_at) : null;
  if (v.enabled) {
    if (cut === null) return { ok: false, error: "cutover_required" };
    // alleen bij aanzetten of verzetten: een lopende overgang in het verleden mag blijven staan
    if ((!current.enabled || v.cutover_at !== current.cutover_at) && cut <= now) return { ok: false, error: "cutover_past" };
  }
  if (cut !== null && v.announce_at && Date.parse(v.announce_at) > cut) return { ok: false, error: "announce_after_cutover" };
  if (cut !== null && v.code_valid_until && Date.parse(v.code_valid_until) > cut + DAY) return { ok: false, error: "code_after_cutover" };
  for (const k of ["new_paid_from", "new_paid_from_apple"] as const) {
    if (!v[k] || v[k] === current[k]) continue; // alleen bij een nieuwe datum; uitzetten (null) kan altijd
    if (!v.enabled) return { ok: false, error: "new_paid_requires_enabled" };
    if (cut !== null && Date.parse(v[k]!) >= cut) return { ok: false, error: "new_paid_after_cutover" };
  }
  return { ok: true, value: v };
}

/** Alles wat het beheer in één keer leest en schrijft (actie lifetime_settings). */
export type LifetimeAll = { lifetime_only: LifetimeSettings; iap: { apple: boolean }; upgrade_link: { apple_eu: boolean } };
export function allView(lifetime: unknown, iap: unknown, link: unknown): LifetimeAll {
  return {
    lifetime_only: settingsView(lifetime),
    iap: { apple: obj(iap).apple === true },
    upgrade_link: { apple_eu: obj(link).apple_eu === true },
  };
}

/**
 * Wijzigingen die directe gevolgen hebben voor klanten; die vragen `confirm: true` (anders 409 confirm_required met deze lijst):
 * enable (Lifetime-only aan), cutover (overgangsdatum verzet terwijl het aan staat), trial (proefperiode veranderd terwijl het
 * aan staat), iap_apple (koopknop Apple aan), apple_eu (EU-link aan), new_paid / new_paid_apple (build 168: de datum
 * "nieuwe accounts eerst kopen" voor web en Android / de Apple-apps gezet of verzet; uitzetten vraagt niets).
 */
export function confirmNeeded(before: LifetimeAll, after: LifetimeAll): string[] {
  const out: string[] = [];
  const b = before.lifetime_only, a = after.lifetime_only;
  if (!b.enabled && a.enabled) out.push("enable");
  if (b.enabled && a.enabled && b.cutover_at !== a.cutover_at) out.push("cutover");
  if (b.enabled && a.enabled && b.trial_days !== a.trial_days) out.push("trial");
  if (!before.iap.apple && after.iap.apple) out.push("iap_apple");
  if (!before.upgrade_link.apple_eu && after.upgrade_link.apple_eu) out.push("apple_eu");
  if (a.new_paid_from && a.new_paid_from !== b.new_paid_from) out.push("new_paid");
  if (a.new_paid_from_apple && a.new_paid_from_apple !== b.new_paid_from_apple) out.push("new_paid_apple");
  return out;
}

/**
 * Build 168: waarschuwingen bij de instellingen (in het antwoord van lifetime_settings en bij confirm_required):
 *   new_paid_apple_no_iap: de Apple-datum staat (of gaat) aan terwijl de koopknop in de Apple-apps (iap.apple) uit staat.
 *     Een nieuw account kan dan in de Apple-apps niets: geen koopknop en geen gratis toegang.
 *   new_paid_disabled: een datum staat gezet, maar Lifetime-only staat uit (de datum doet dan niets).
 */
export function warnings(v: LifetimeAll): string[] {
  const out: string[] = [], l = v.lifetime_only;
  if (l.new_paid_from_apple && !v.iap.apple) out.push("new_paid_apple_no_iap");
  if (!l.enabled && (l.new_paid_from || l.new_paid_from_apple)) out.push("new_paid_disabled");
  return out;
}

/** Invoer van lifetime_settings: {lifetime_only?: {...}, iap?: {apple}, upgrade_link?: {apple_eu}}. */
export function cleanAll(body: J, current: LifetimeAll, now: number): { ok: true; value: LifetimeAll; changed: boolean } | { ok: false; error: string } {
  const has = (k: string) => k in body && body[k] !== undefined;
  let lifetime = current.lifetime_only;
  if (has("lifetime_only")) {
    const r = cleanSettings(body.lifetime_only, current.lifetime_only, now);
    if (!r.ok) return r;
    lifetime = r.value;
  }
  let iap = current.iap, link = current.upgrade_link;
  if (has("iap")) {
    const x = obj(body.iap);
    if (typeof x.apple !== "boolean") return { ok: false, error: "bad_iap" };
    iap = { apple: x.apple };
  }
  if (has("upgrade_link")) {
    const x = obj(body.upgrade_link);
    if (typeof x.apple_eu !== "boolean") return { ok: false, error: "bad_apple_eu" };
    link = { apple_eu: x.apple_eu };
  }
  const value = { lifetime_only: lifetime, iap, upgrade_link: link };
  return { ok: true, value, changed: JSON.stringify(value) !== JSON.stringify(current) };
}

/**
 * Build 168: wat naar bingr_admin_lifetime_settings gaat. new_paid_from en new_paid_from_apple alleen als ze gezet zijn of
 * veranderen; zo blijft opslaan werken met een database van vóór build 168 (die kent de sleutels nog niet).
 */
export function writeValue(v: LifetimeSettings, current: LifetimeSettings): Partial<LifetimeSettings> {
  const out: Partial<LifetimeSettings> = { ...v };
  for (const k of ["new_paid_from", "new_paid_from_apple"] as const) if (v[k] === null && current[k] === null) delete out[k];
  return out;
}

/** Wat er in admin_audit komt: de nieuwe instellingen (geen persoonsgegevens), en wat bevestigd is. */
export const settingsAudit = (v: LifetimeAll, confirmed: string[]) => ({ ...v, confirmed: confirmed.length ? confirmed : undefined });

// ---- codes ----

/**
 * Totalen van lifetime_codes (RPC bingr_admin_lifetime_stats, docs/ACCOUNT.md "Build 167"): alleen aantallen.
 * created = rijen; ready = met promotion code in Stripe; pending_stripe = nog zonder promotion code; candidates = gratis
 * accounts die nog geen code hebben; mail_pending / remind_pending = nog te mailen; unclaimed = gastaankopen zonder account.
 */
export type CodeStats = {
  created: number; ready: number; pending_stripe: number; mailed: number; mail_error: number; reminded: number; remind_error: number;
  redeemed: number; expired: number; open: number; candidates: number; mail_pending: number; remind_pending: number; unclaimed: number;
};
export function statsView(raw: unknown): CodeStats {
  const o = obj(raw);
  const created = nat(o.created), redeemed = nat(o.redeemed), expired = nat(o.expired);
  return {
    created, ready: nat(o.ready), pending_stripe: nat(o.pending_stripe), mailed: nat(o.mailed), mail_error: nat(o.mail_error),
    reminded: nat(o.reminded), remind_error: nat(o.remind_error), redeemed, expired, open: Math.max(0, created - redeemed - expired),
    candidates: nat(o.candidates), mail_pending: nat(o.mail_pending), remind_pending: nat(o.remind_pending), unclaimed: nat(o.unclaimed),
  };
}

/** Invoer van lifetime_codes_generate: standaard droog (veilig); echt alleen met dry_run: false én confirm: true. */
export function cleanGenerate(body: J): { dry_run: boolean; confirm: boolean } {
  return { dry_run: body.dry_run !== false, confirm: body.confirm === true };
}

const shortCode = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_]{1,60}$/.test(v) ? v : null);
/**
 * Antwoord van billing admin_codes_generate: droog {candidates, pending_stripe, coupon, valid_until, discount_pct, mode};
 * echt één batch {created, stripe_created, stripe_errors, remaining, coupon}. Herhalen tot remaining 0 (done).
 */
export function generateView(raw: unknown, dry_run: boolean) {
  const o = obj(raw);
  const errs = typeof o.stripe_errors === "number" ? nat(o.stripe_errors) : Array.isArray(o.stripe_errors) ? o.stripe_errors.length : 0;
  return {
    dry_run, candidates: nat(o.candidates), pending_stripe: nat(o.pending_stripe),
    created: dry_run ? 0 : nat(o.created), stripe_created: dry_run ? 0 : nat(o.stripe_created), stripe_errors: dry_run ? 0 : errs,
    remaining: dry_run ? 0 : nat(o.remaining), done: dry_run ? true : nat(o.remaining) === 0,
    coupon: shortCode(o.coupon), valid_until: isoOrNull(o.valid_until), discount_pct: typeof o.discount_pct === "number" ? nat(o.discount_pct) : null,
    mode: o.mode === "live" || o.mode === "test" ? o.mode : null,
  };
}

// ---- mail "Bingr wordt Lifetime" en de herinnering (functie lifetime-notice) ----

export type MailMode = "dry_run" | "test" | "send" | "remind" | "preview";
export const MAIL_MODES: readonly MailMode[] = ["dry_run", "test", "send", "remind", "preview"];
export const cleanMailMode = (v: unknown): MailMode | null =>
  v === undefined || v === null || v === "" ? "dry_run" : (MAIL_MODES as readonly unknown[]).includes(v) ? v as MailMode : null;
/** Taal van de testmail: nl, en of both. */
export const cleanMailLang = (v: unknown): "nl" | "en" | "both" | null =>
  v === undefined || v === null || v === "" ? "both" : v === "nl" || v === "en" || v === "both" ? v : null;
/** Welke mail bij test en voorbeeld: notice ("Bingr wordt Lifetime") of remind (herinnering). */
export const cleanMailKind = (v: unknown): "notice" | "remind" | null =>
  v === undefined || v === null || v === "" ? "notice" : v === "notice" || v === "remind" ? v : null;
/** Echt versturen (send, remind) vraagt confirm: true; dry_run, test en preview niet. */
export const mailNeedsConfirm = (m: MailMode) => m === "send" || m === "remind";

/** Fouttellingen per korte code (smtp_…), zonder adressen. */
function errorCounts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v)).slice(0, 20)) if (/^[a-z0-9_]{1,40}$/.test(k)) out[k] = nat(n);
  return out;
}
/**
 * Antwoord van lifetime-notice admin_send: dry_run {notice_pending, remind_pending, remind_window, enabled, smtp};
 * test {sent}; send/remind één batch {sent, failed, retry, errors, remaining}. Alleen aantallen (nooit adressen).
 */
export function mailView(raw: unknown, mode: Exclude<MailMode, "preview">) {
  const o = obj(raw);
  const batch = mode === "send" || mode === "remind";
  return {
    mode, notice_pending: nat(o.notice_pending), remind_pending: nat(o.remind_pending), remind_window: o.remind_window === true,
    enabled: o.enabled === true, smtp: o.smtp !== false,
    sent: mode === "dry_run" ? 0 : nat(o.sent), failed: nat(o.failed), retry: nat(o.retry), errors: errorCounts(o.errors),
    remaining: batch ? nat(o.remaining) : 0, done: batch ? nat(o.remaining) === 0 || (nat(o.sent) === 0 && nat(o.retry) === 0) : true,
  };
}
/** Voorbeeld (admin_preview): alleen onderwerp en HTML doorgeven. */
export function previewView(raw: unknown) {
  const o = obj(raw);
  return { subject: typeof o.subject === "string" ? o.subject.slice(0, 300) : "", html: typeof o.html === "string" ? o.html.slice(0, 300_000) : "" };
}

// ---- code bij de accountdetails (bingr_admin_user.lifetime_code / bingr_lifetime_code_of) ----

export type CodeStatus = "ready" | "pending_stripe" | "mailed" | "mail_error" | "redeemed" | "expired";
const CODE_STATUS: readonly CodeStatus[] = ["ready", "pending_stripe", "mailed", "mail_error", "redeemed", "expired"];
/** Code van één account zonder Stripe-id's en purchase_id. Status van de server; anders afgeleid. null = geen code. */
export function codeView(row: unknown, now: number) {
  const o = obj(row);
  if (typeof o.code !== "string" || !/^BINGR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(o.code)) return null;
  const expires = isoOrNull(o.expires_at), redeemed = isoOrNull(o.redeemed_at), mailed = isoOrNull(o.mailed_at);
  const err = typeof o.mail_error === "string" && o.mail_error ? o.mail_error.replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "error" : null;
  const status: CodeStatus = (CODE_STATUS as readonly unknown[]).includes(o.status) ? o.status as CodeStatus
    : redeemed ? "redeemed" : expires && Date.parse(expires) <= now ? "expired" : err ? "mail_error" : mailed ? "mailed" : "ready";
  return {
    code: o.code, status, created_at: isoOrNull(o.created_at), expires_at: expires, mailed_at: mailed,
    reminded_at: isoOrNull(o.reminded_at), redeemed_at: redeemed, mail_error: err,
  };
}

// ---- doorgeven aan de server ----
// Vastgelegd in docs/ACCOUNT.md van iptv-ios-appletv, sectie "Build 167" (Beheer): het geheim LIFETIME_ADMIN_SECRET in de
// header x-lifetime-secret, voor billing (codes) en lifetime-notice (mail); verder RPC's met de service role.
export const LIFETIME_CALLS = {
  secretEnv: "LIFETIME_ADMIN_SECRET",
  header: "x-lifetime-secret",
  generate: { fn: "billing", action: "admin_codes_generate" },
  stats: { fn: "billing", action: "admin_codes_stats" },
  mail: { fn: "lifetime-notice", action: "admin_send" },
  preview: { fn: "lifetime-notice", action: "admin_preview" },
  mailStats: { fn: "lifetime-notice", action: "admin_stats" },
  rpc: {
    settings: "bingr_admin_lifetime_settings", stats: "bingr_admin_lifetime_stats", codeOf: "bingr_lifetime_code_of",
    unclaimed: "bingr_admin_unclaimed", assign: "bingr_admin_purchase_assign",
  },
} as const;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type CallResult = { status: number; out: J };
const errCode = (v: unknown) => (typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v) ? v : "server_error");

/** POST naar een functie van iptv-ios-appletv met het admin-geheim. Logt alleen functie, actie en HTTP-status. */
export async function lifetimeCall(
  base: string, secret: string, fn: string, action: string, payload: J, fetchFn: Fetch = fetch,
): Promise<CallResult> {
  if (!secret) return { status: 503, out: { error: "lifetime_not_configured" } };
  let res: Response;
  try {
    res = await fetchFn(`${base.replace(/\/+$/, "")}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [LIFETIME_CALLS.header]: secret },
      body: JSON.stringify({ ...payload, action }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    console.error("admin", "lifetime", fn, action, e instanceof Error ? e.name : "fetch");
    return { status: 502, out: { error: "lifetime_unreachable" } };
  }
  const out = await res.json().catch(() => null) as J | null;
  if (res.status === 401 || res.status === 403) return { status: 502, out: { error: "lifetime_forbidden" } };
  if (res.status === 404 && !out?.error) return { status: 503, out: { error: "lifetime_not_deployed" } };
  if (!res.ok || !out || typeof out !== "object" || Array.isArray(out)) {
    console.error("admin", "lifetime", fn, action, `HTTP ${res.status}`);
    return { status: res.ok ? 502 : res.status, out: { error: errCode(out?.error) } };
  }
  return { status: 200, out };
}

// ---- aanvulling 1: eerst betalen, dan het account (gastaankopen) ----
// Een gastaankoop (web/Android via Stripe zonder account, of Apple vóór het account) staat in billing_purchases met user_id
// null en user_deleted_at null tot hij geclaimd is. (user_id null mét user_deleted_at = account verwijderd: niet "niet geclaimd".)
// Het beheer ziet het aantal en per aankoop alleen id, aanbieder, status, bedrag, datum en live/test: nooit een e-mailadres,
// een hash, een claimtoken of een Stripe-/Apple-id.

const PURCHASE_STATUS = ["pending", "paid", "failed", "refunded", "disputed"] as const;
/** Eén niet-geclaimde aankoop uit bingr_admin_unclaimed. null = onbruikbare rij. */
export function unclaimedView(row: unknown) {
  const o = obj(row);
  const id = typeof o.id === "number" && Number.isSafeInteger(o.id) && o.id > 0 ? o.id : null;
  if (id === null) return null;
  return {
    id, provider: o.provider === "apple" ? "apple" : "stripe",
    status: (PURCHASE_STATUS as readonly unknown[]).includes(o.status) ? o.status as string : "paid",
    amount: nat(o.amount), currency: typeof o.currency === "string" && /^[a-z]{3}$/.test(o.currency) ? o.currency : "eur",
    paid_at: isoOrNull(o.paid_at), created_at: isoOrNull(o.created_at), mode: o.mode === "live" || o.mode === "test" ? o.mode : null,
    // de server kent het e-mailadres van de koper (alleen als hash): claimen gaat dan vanzelf bij bevestigen/inloggen
    email_known: o.has_email_hash === true, claim_mailed: o.claim_mailed === true, token_valid: o.token_valid === true,
  };
}
/** Antwoord van bingr_admin_unclaimed: {total, items}. */
export function unclaimedList(raw: unknown) {
  const o = obj(raw);
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 200).map(unclaimedView).filter((x) => x !== null);
  return { total: typeof o.total === "number" ? nat(o.total) : items.length, paid: items.filter((x) => x!.status === "paid").length, items };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Invoer van purchase_assign: {purchase_id, user_id, confirm}. Altijd met bevestiging (geeft Lifetime). */
export function cleanAssign(body: J): { ok: true; purchase_id: number; user_id: string } | { ok: false; error: string; status: number } {
  const pid = typeof body.purchase_id === "number" ? body.purchase_id : typeof body.purchase_id === "string" && /^\d{1,15}$/.test(body.purchase_id) ? Number(body.purchase_id) : NaN;
  if (!Number.isSafeInteger(pid) || pid <= 0) return { ok: false, error: "bad_purchase_id", status: 400 };
  if (typeof body.user_id !== "string" || !UUID.test(body.user_id)) return { ok: false, error: "bad_id", status: 400 };
  if (body.confirm !== true) return { ok: false, error: "confirm_required", status: 409 };
  return { ok: true, purchase_id: pid, user_id: body.user_id.toLowerCase() };
}
/** Uitkomst van bingr_admin_purchase_assign: {ok, result: assigned | not_assignable | no_user}. */
export function assignView(raw: unknown): { ok: true } | { ok: false; error: "not_assignable" | "not_found" | "assign_failed"; status: number } {
  const o = obj(raw);
  if (o.ok === true && o.result === "assigned") return { ok: true };
  if (o.result === "no_user") return { ok: false, error: "not_found", status: 404 };
  if (o.result === "not_assignable") return { ok: false, error: "not_assignable", status: 409 };
  return { ok: false, error: "assign_failed", status: 502 };
}
