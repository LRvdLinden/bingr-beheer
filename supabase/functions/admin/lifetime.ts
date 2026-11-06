// Build 167 (server): Bingr wordt alleen Lifetime. Beheerkant (tab Lifetime van het dashboard, de Beheer-app en LRbeheer).
// Contract: docs/ACCOUNT.md in iptv-ios-appletv, sectie "Build 167: alleen Lifetime". Hier alleen pure logica (lifetime_test.ts):
// invoer controleren, wat bevestiging nodig heeft, en antwoorden terugbrengen tot instellingen en aantallen. Nooit
// e-mailadressen, account-id's of Stripe-id's in een antwoord of log; een code alleen bij de accountdetails (user_detail).
//
// Instellingen (app_settings):
//   lifetime_only        {enabled, announce_at, cutover_at, discount_pct, code_valid_until, trial_days}
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
};
export const DEFAULT_SETTINGS: LifetimeSettings = {
  enabled: false, announce_at: null, cutover_at: null, discount_pct: 30, code_valid_until: null, trial_days: 0,
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
  };
}

/** Standaard overgang: D + 30 dagen, 00:00 Europe/Amsterdam (D = de dag van `now` in Amsterdam). */
export function defaultCutover(now: number): string {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date(now));
  const [y, m, d] = day.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d + 30);
  // offset van Amsterdam op die dag (CET +01:00 of CEST +02:00)
  const probe = new Date(target + 12 * 3600000);
  const hh = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }).format(probe));
  const off = hh - 12;
  const t = new Date(target);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T00:00:00+${p(off)}:00`;
}

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
 */
export function cleanSettings(input: unknown, current: LifetimeSettings, now: number): { ok: true; value: LifetimeSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "bad_settings" };
  const o = input as J, v: LifetimeSettings = { ...current };
  if ("enabled" in o) { if (typeof o.enabled !== "boolean") return { ok: false, error: "bad_enabled" }; v.enabled = o.enabled; }
  for (const k of ["announce_at", "cutover_at", "code_valid_until"] as const) {
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
 * aan staat), iap_apple (koopknop Apple aan), apple_eu (EU-link aan).
 */
export function confirmNeeded(before: LifetimeAll, after: LifetimeAll): string[] {
  const out: string[] = [];
  const b = before.lifetime_only, a = after.lifetime_only;
  if (!b.enabled && a.enabled) out.push("enable");
  if (b.enabled && a.enabled && b.cutover_at !== a.cutover_at) out.push("cutover");
  if (b.enabled && a.enabled && b.trial_days !== a.trial_days) out.push("trial");
  if (!before.iap.apple && after.iap.apple) out.push("iap_apple");
  if (!before.upgrade_link.apple_eu && after.upgrade_link.apple_eu) out.push("apple_eu");
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

/** Wat er in admin_audit komt: de nieuwe instellingen (geen persoonsgegevens), en wat bevestigd is. */
export const settingsAudit = (v: LifetimeAll, confirmed: string[]) => ({ ...v, confirmed: confirmed.length ? confirmed : undefined });

// ---- codes ----

/** Totalen van lifetime_codes (RPC bingr_admin_lifetime_codes_stats of de functie): alleen aantallen. */
export type CodeStats = {
  created: number; mailed: number; mail_error: number; reminded: number; redeemed: number; expired: number; open: number;
  eligible: number | null; missing: number | null; valid_until: string | null; stripe_coupon: boolean | null;
};
export function statsView(raw: unknown): CodeStats {
  const o = obj(raw);
  const created = nat(o.created ?? o.total), redeemed = nat(o.redeemed), expired = nat(o.expired);
  const eligible = typeof o.eligible === "number" ? nat(o.eligible) : null;
  return {
    created, mailed: nat(o.mailed), mail_error: nat(o.mail_error), reminded: nat(o.reminded), redeemed, expired,
    open: typeof o.open === "number" ? nat(o.open) : Math.max(0, created - redeemed - expired),
    eligible, missing: typeof o.missing === "number" ? nat(o.missing) : eligible === null ? null : Math.max(0, eligible - created + redeemed),
    valid_until: isoOrNull(o.valid_until ?? o.expires_at), stripe_coupon: typeof o.stripe_coupon === "boolean" ? o.stripe_coupon : null,
  };
}

/** Invoer van lifetime_codes_generate: standaard droog (veilig); echt alleen met dry_run: false én confirm: true. */
export function cleanGenerate(body: J): { dry_run: boolean; confirm: boolean } {
  return { dry_run: body.dry_run !== false, confirm: body.confirm === true };
}

/** Antwoord van het aanmaken: alleen aantallen. */
export function generateView(raw: unknown, dry_run: boolean) {
  const o = obj(raw);
  return {
    dry_run, eligible: nat(o.eligible), existing: nat(o.existing), to_create: nat(o.to_create ?? o.would_create),
    created: dry_run ? 0 : nat(o.created), failed: nat(o.failed), remaining: nat(o.remaining), done: dry_run ? true : o.done !== false,
    coupon_created: o.coupon_created === true,
  };
}

// ---- mail "Bingr wordt Lifetime" en de herinnering ----

export type MailMode = "dry_run" | "test" | "send" | "remind";
export const MAIL_MODES: readonly MailMode[] = ["dry_run", "test", "send", "remind"];
export const cleanMailMode = (v: unknown): MailMode | null =>
  v === undefined || v === null || v === "" ? "dry_run" : (MAIL_MODES as readonly unknown[]).includes(v) ? v as MailMode : null;
/** Taal van de testmail: nl, en of both. */
export const cleanMailLang = (v: unknown): "nl" | "en" | "both" | null =>
  v === undefined || v === null || v === "" ? "both" : v === "nl" || v === "en" || v === "both" ? v : null;
/** Echt versturen (send, remind) vraagt confirm: true; dry_run en test niet. */
export const mailNeedsConfirm = (m: MailMode) => m === "send" || m === "remind";

/** Antwoord van de mailfunctie: alleen aantallen (nooit adressen). */
export function mailView(raw: unknown, mode: MailMode) {
  const o = obj(raw), r = obj(o.recipients);
  const nl = nat(r.nl), en = nat(r.en);
  return {
    mode, recipients: { nl, en, total: typeof r.total === "number" ? nat(r.total) : nl + en },
    sent: mode === "dry_run" ? 0 : nat(o.sent), failed: nat(o.failed), skipped: nat(o.skipped), remaining: nat(o.remaining),
    done: mode === "dry_run" || mode === "test" ? true : o.done !== false,
    without_code: nat(o.without_code),
  };
}

// ---- code bij de accountdetails (user_detail.lifetime_code) ----

export type CodeStatus = "open" | "mailed" | "mail_error" | "redeemed" | "expired";
/** Rij uit lifetime_codes voor één account, zonder Stripe-id's en purchase_id. null = geen code. */
export function codeView(row: unknown, now: number) {
  const o = obj(row);
  if (typeof o.code !== "string" || !/^BINGR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(o.code)) return null;
  const expires = isoOrNull(o.expires_at), redeemed = isoOrNull(o.redeemed_at), mailed = isoOrNull(o.mailed_at);
  const err = typeof o.mail_error === "string" && o.mail_error ? o.mail_error.replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "error" : null;
  const status: CodeStatus = redeemed ? "redeemed" : expires && Date.parse(expires) <= now ? "expired"
    : err && !mailed ? "mail_error" : mailed ? "mailed" : "open";
  return {
    code: o.code, status, created_at: isoOrNull(o.created_at), expires_at: expires, mailed_at: mailed,
    reminded_at: isoOrNull(o.reminded_at), redeemed_at: redeemed, mail_error: err,
  };
}

// ---- doorgeven aan de server ----
// Aanname tot de server-agent het vastlegt in docs/ACCOUNT.md (build 167): één geheim voor beide functies, in de header
// x-lifetime-secret. Pas het alleen hier aan als de server iets anders kiest.
export const LIFETIME_CALLS = {
  secretEnv: "LIFETIME_ADMIN_SECRET",
  header: "x-lifetime-secret",
  generate: { fn: "billing", action: "admin_codes_generate" },
  stats: { fn: "billing", action: "admin_codes_stats" },
  mail: { fn: "lifetime-notice", action: "admin_send" },
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
/** Eén niet-geclaimde aankoop voor het beheer. null = onbruikbare rij. */
export function unclaimedView(row: unknown) {
  const o = obj(row);
  const id = typeof o.id === "number" && Number.isSafeInteger(o.id) && o.id > 0 ? o.id : null;
  if (id === null) return null;
  const provider = o.provider === "apple" ? "apple" : "stripe";
  const status = (PURCHASE_STATUS as readonly unknown[]).includes(o.status) ? o.status as string : "paid";
  const sid = typeof o.stripe_session_id === "string" ? o.stripe_session_id : "";
  const env = typeof o.environment === "string" ? o.environment.toLowerCase() : typeof o.mode === "string" ? o.mode.toLowerCase() : "";
  const mode = sid.startsWith("cs_test_") || env === "test" || env === "sandbox" ? "test" : sid.startsWith("cs_live_") || env === "live" || env === "production" ? "live" : null;
  return {
    id, provider, status, amount: nat(o.amount), currency: typeof o.currency === "string" && /^[a-z]{3}$/.test(o.currency) ? o.currency : "eur",
    paid_at: isoOrNull(o.paid_at), created_at: isoOrNull(o.created_at), mode,
    // de server kent het e-mailadres van de koper (alleen als hash): automatisch claimen kan dan bij bevestigen/inloggen
    email_known: typeof o.claim_email_hash === "string" && o.claim_email_hash.length > 0,
  };
}
export function unclaimedList(rows: unknown, total: number | null) {
  const items = (Array.isArray(rows) ? rows : []).slice(0, 100).map(unclaimedView).filter((x) => x !== null);
  return { total: total ?? items.length, paid: items.filter((x) => x!.status === "paid").length, items };
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
/** Uitkomst van de RPC bingr_admin_purchase_assign: {ok, plan} of een foutcode (already_claimed, not_paid, not_found). */
export function assignView(raw: unknown): { ok: true; plan: string } | { ok: false; error: string } {
  const o = obj(raw);
  if (o.ok === true) return { ok: true, plan: "lifetime" };
  const e = typeof o.error === "string" && /^[a-z_]{1,40}$/.test(o.error) ? o.error : "assign_failed";
  return { ok: false, error: e };
}
