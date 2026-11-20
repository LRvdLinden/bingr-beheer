// Build 181: Bingr Premium in het beheer (docs/ACCOUNT.md in iptv-ios-appletv, "Build 181: Bingr Premium" §2 en §8).
// Pure logica (getest in premium_test.ts): de invoer van de kaart Premium controleren, welke wijzigingen een bevestiging
// vragen, waarschuwingen, en de antwoorden van de database en billing terugbrengen tot instellingen en aantallen.
// Nooit persoonsgegevens: test_users zijn alleen account-id's (die ziet het beheer toch al); statistieken zijn totalen.

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? v as J : {});
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLANS = ["month", "half", "year", "lifetime"] as const;
type Plan = typeof PLANS[number];
const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);

export type PremiumSettings = {
  enabled: boolean; new_from_web: string | null; new_from_apple: string | null; existing_from: string | null; trial_days: number;
  show_prices_web: boolean; grace_days: number; prices: Record<Plan, number>;
  stripe_prices: { test: Partial<Record<Plan, string>>; live: Partial<Record<Plan, string>> };
  stripe_portal: { test: string | null; live: string | null }; test_users: string[];
};
export const DEFAULT_PRICES: Record<Plan, number> = { month: 499, half: 1999, year: 2999, lifetime: 4999 };
export const PREMIUM_CALLS = {
  rpc: { settings: "bingr_admin_premium_settings", stats: "bingr_admin_premium_stats", test: "bingr_admin_premium_test" },
  setup: { fn: "billing", action: "admin_premium_setup" },
} as const;

/** Wat de database teruggeeft, netjes (ontbrekende sleutels = standaard). */
export function settingsView(raw: unknown): PremiumSettings {
  const o = obj(raw), p = obj(o.prices), sp = obj(o.stripe_prices), portal = obj(o.stripe_portal);
  const prices = {} as Record<Plan, number>;
  for (const k of PLANS) prices[k] = Number.isInteger(p[k]) ? p[k] as number : DEFAULT_PRICES[k];
  const ids = (m: unknown) => {
    const r: Partial<Record<Plan, string>> = {};
    for (const k of PLANS) { const x = obj(m)[k]; if (typeof x === "string" && /^price_[A-Za-z0-9]+$/.test(x)) r[k] = x; }
    return r;
  };
  const bpc = (x: unknown) => (typeof x === "string" && /^bpc_[A-Za-z0-9]+$/.test(x) ? x : null);
  return {
    enabled: o.enabled === true, new_from_web: iso(o.new_from_web), new_from_apple: iso(o.new_from_apple),
    existing_from: iso(o.existing_from), trial_days: Number.isInteger(o.trial_days) ? o.trial_days as number : 3,
    show_prices_web: o.show_prices_web === true, grace_days: Number.isInteger(o.grace_days) ? o.grace_days as number : 3, prices,
    stripe_prices: { test: ids(sp.test), live: ids(sp.live) }, stripe_portal: { test: bpc(portal.test), live: bpc(portal.live) },
    test_users: Array.isArray(o.test_users) ? o.test_users.filter((x): x is string => typeof x === "string" && UUID.test(x)) : [],
  };
}

const EDITABLE = ["enabled", "new_from_web", "new_from_apple", "existing_from", "trial_days", "show_prices_web", "grace_days", "prices"] as const;
/**
 * Invoer van premium_settings `set` (alleen wat de kaart wijzigt; price-id's en test_users hebben eigen acties).
 * Dezelfde grenzen als bingr_admin_premium_settings; die controleert alles nog een keer.
 */
export function cleanSet(body: unknown, cur: PremiumSettings): { ok: true; patch: J; value: PremiumSettings; changed: boolean } | { ok: false; error: string } {
  const b = obj(body), patch: J = {}, v: PremiumSettings = { ...cur, prices: { ...cur.prices } };
  for (const k of Object.keys(b)) if (!(EDITABLE as readonly string[]).includes(k)) return { ok: false, error: "bad_key" };
  for (const k of ["enabled", "show_prices_web"] as const) {
    if (!(k in b)) continue;
    if (typeof b[k] !== "boolean") return { ok: false, error: `bad_${k}` };
    v[k] = b[k] as boolean;
  }
  for (const k of ["new_from_web", "new_from_apple", "existing_from"] as const) {
    if (!(k in b)) continue;
    if (b[k] === null || b[k] === "") { v[k] = null; continue; }
    const t = iso(b[k]);
    if (!t) return { ok: false, error: `bad_${k}` };
    v[k] = t;
  }
  if ("trial_days" in b) {
    if (!Number.isInteger(b.trial_days) || (b.trial_days as number) < 0 || (b.trial_days as number) > 14) return { ok: false, error: "bad_trial_days" };
    v.trial_days = b.trial_days as number;
  }
  if ("grace_days" in b) {
    if (!Number.isInteger(b.grace_days) || (b.grace_days as number) < 0 || (b.grace_days as number) > 16) return { ok: false, error: "bad_grace_days" };
    v.grace_days = b.grace_days as number;
  }
  if ("prices" in b) {
    const p = obj(b.prices);
    for (const k of Object.keys(p)) {
      if (!(PLANS as readonly string[]).includes(k)) return { ok: false, error: "bad_prices" };
      const n = p[k];
      if (!Number.isInteger(n) || (n as number) < 99 || (n as number) > 99999) return { ok: false, error: "bad_prices" };
      v.prices[k as Plan] = n as number;
    }
    if (v.prices.lifetime <= v.prices.year) return { ok: false, error: "lifetime_not_above_year" };
  }
  if (v.enabled && !v.existing_from) return { ok: false, error: "existing_from_required" };
  for (const k of EDITABLE) if (JSON.stringify(v[k]) !== JSON.stringify(cur[k])) patch[k] = v[k];
  return { ok: true, patch, value: v, changed: Object.keys(patch).length > 0 };
}

/**
 * Wijzigingen met directe gevolgen voor klanten; die vragen `confirm: true` (anders 409 confirm_required):
 *   enable, new_from_web / new_from_apple (gezet of verzet), existing_from (verzet terwijl aan), show_prices (prijzen op de
 *   site aan), prices (andere prijs: daarna opnieuw "Stripe-producten aanmaken"), trial (proef veranderd terwijl aan).
 */
export function confirmNeeded(b: PremiumSettings, a: PremiumSettings): string[] {
  const out: string[] = [];
  if (!b.enabled && a.enabled) out.push("enable");
  if (a.new_from_web && a.new_from_web !== b.new_from_web) out.push("new_from_web");
  if (a.new_from_apple && a.new_from_apple !== b.new_from_apple) out.push("new_from_apple");
  if (a.enabled && a.existing_from !== b.existing_from) out.push("existing_from");
  if (!b.show_prices_web && a.show_prices_web) out.push("show_prices");
  if (JSON.stringify(a.prices) !== JSON.stringify(b.prices)) out.push("prices");
  if (a.enabled && a.trial_days !== b.trial_days) out.push("trial");
  return out;
}

/**
 * Waarschuwingen (ook in het antwoord van premium_settings):
 *   stripe_not_ready: web/Android doet (straks) mee of de prijzen staan op de site, maar de price-id's van de huidige
 *     Stripe-modus ontbreken (eerst "Stripe-producten aanmaken"); dan kan niemand afrekenen.
 *   apple_before_web: Apple doet eerder mee dan web en Android.
 *   existing_before_new: existing_from ligt vóór een new_from-datum (bestaande accounts eerder dan nieuwe).
 *   dates_without_enabled: er staan datums, maar de hoofdschakelaar staat uit (de datums doen dan niets).
 *   prices_changed: de prijzen wijken af van de Stripe-prijzen (na het opslaan opnieuw aanmaken).
 *   test_users: er staan testaccounts aan (die zien Premium al, ook met de hoofdschakelaar uit).
 */
export function warnings(v: PremiumSettings, mode: "test" | "live" | null): string[] {
  const out: string[] = [];
  const ready = !!mode && PLANS.every((k) => !!v.stripe_prices[mode][k]);
  if ((v.new_from_web || v.show_prices_web) && !ready) out.push("stripe_not_ready");
  if (v.new_from_apple && (!v.new_from_web || Date.parse(v.new_from_apple) < Date.parse(v.new_from_web))) out.push("apple_before_web");
  const ex = v.existing_from ? Date.parse(v.existing_from) : NaN;
  if (Number.isFinite(ex) && [v.new_from_web, v.new_from_apple].some((d) => d && Date.parse(d) > ex)) out.push("existing_before_new");
  if (!v.enabled && (v.new_from_web || v.new_from_apple)) out.push("dates_without_enabled");
  if (v.test_users.length) out.push("test_users");
  return out;
}

/** Stand voor de kaart: wat er nu voor wie geldt (op `now`). */
export function phase(v: PremiumSettings, now = Date.now()) {
  const on = (d: string | null) => v.enabled && !!d && Date.parse(d) <= now;
  const web = on(v.new_from_web), apple = on(v.new_from_apple);
  const existing = (web || apple) && !!v.existing_from && Date.parse(v.existing_from) <= now;
  return { web, apple, existing, test: v.test_users.length };
}

/** Statistieken (bingr_admin_premium_stats): alleen totalen. */
export function statsView(raw: unknown) {
  const o = obj(raw), rev = obj(o.stripe_revenue);
  const money = (x: unknown) => { const m = obj(x); return { count: nat(m.count), gross: nat(m.gross), refunded: nat(m.refunded), fee: nat(m.fee), tax: nat(m.tax) }; };
  const by = Array.isArray(o.by) ? o.by.map(obj).map((r) => ({
    provider: r.provider === "apple" ? "apple" : "stripe", plan: ["month", "half", "year"].includes(String(r.plan)) ? String(r.plan) : "?",
    active: nat(r.active), trialing: nat(r.trialing), canceled: nat(r.canceled), mrr_cents: nat(r.mrr_cents),
  })) : [];
  const monthly = Array.isArray(o.monthly) ? o.monthly.map(obj).filter((m) => /^\d{4}-\d{2}$/.test(String(m.month))).map((m) => ({
    month: String(m.month), mode: m.mode === "live" ? "live" : "test", count: nat(m.count), gross: nat(m.gross), refunded: nat(m.refunded),
  })) : [];
  const lt = obj(o.lifetime49);
  return {
    active: nat(o.active), trialing: nat(o.trialing), canceled: nat(o.canceled), past_due: nat(o.past_due), expired_30d: nat(o.expired_30d),
    trials_started: nat(o.trials_started), trials_converted: nat(o.trials_converted), unclaimed: nat(o.unclaimed), mrr_cents: nat(o.mrr_cents),
    lifetime49: { count: nat(lt.count), gross: nat(lt.gross) }, stripe_revenue: { live: money(rev.live), test: money(rev.test) },
    by, monthly, test_users: nat(o.test_users),
  };
}

/** Antwoord van billing admin_premium_setup: alleen Stripe-id's van producten, prijzen en de portal-configuratie. */
export function setupView(raw: unknown) {
  const o = obj(raw), p = obj(o.prices), pr = obj(o.products);
  const id = (x: unknown, re: RegExp) => (typeof x === "string" && re.test(x) ? x : null);
  return {
    ok: o.ok === true, dry_run: o.dry_run === true, mode: o.mode === "live" ? "live" : o.mode === "test" ? "test" : null,
    products: { sub: id(pr.sub, /^bingr_premium$/), lifetime: id(pr.lifetime, /^bingr_premium_lifetime$/) },
    prices: Object.fromEntries(PLANS.map((k) => [k, id(p[k], /^price_[A-Za-z0-9]+$/)])) as Record<Plan, string | null>,
    portal: id(o.portal, /^bpc_[A-Za-z0-9]+$/),
    created: Array.isArray(o.created) ? o.created.filter((x): x is string => typeof x === "string" && /^[a-z_]{1,40}$/.test(x)) : [],
  };
}
export const cleanUserId = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

/** Concept-mailing voor bestaande gratis accounts (niet versturen; het beheer zet het klaar in Eigen mailing). */
export const MAILING_DRAFT = {
  nl: {
    subject: "Bingr wordt Bingr Premium",
    body: "Hoi,\n\nBingr is gemaakt door één ontwikkelaar, zonder reclame en zonder je gegevens te verkopen. Om Bingr goed te houden (servers, ontwikkeling en support), gaat Bingr over op Bingr Premium.\n\nWat verandert er?\nVanaf 1 december 2026 kies je een plan om Bingr te blijven gebruiken:\n- Maandelijks: € 4,99 per maand\n- Halfjaarlijks: € 19,99 per 6 maanden (33% voordeliger)\n- Jaarlijks: € 29,99 per jaar (50% voordeliger)\n- Lifetime: eenmalig € 49,99\n\nTot en met 30 november 2026 kun je nog Lifetime kopen met je persoonlijke korting van 30% (€ 3,49). Je code staat in Mijn Bingr en op bingr.online/upgrade.\n\nJe gegevens blijven bewaard: je servers, profielen, Mijn lijst en instellingen. Kies je geen plan, dan kun je niet meer afspelen, maar verdwijnt er niets. Je account verwijderen kan altijd.\n\nHeb je al Lifetime? Dan verandert er voor jou niets.\n\nVragen? Mail ons via support.bingr.online.\n\nGroet,\nHet Bingr-team",
    button: "Kies je plan",
  },
  en: {
    subject: "Bingr is becoming Bingr Premium",
    body: "Hi,\n\nBingr is made by a single developer, with no ads and without selling your data. To keep Bingr going (servers, development and support), Bingr is moving to Bingr Premium.\n\nWhat changes?\nFrom 1 December 2026 you choose a plan to keep using Bingr:\n- Monthly: €4.99 per month\n- Every 6 months: €19.99 (save 33%)\n- Yearly: €29.99 per year (save 50%)\n- Lifetime: a one-time €49.99\n\nUntil 30 November 2026 you can still buy Lifetime with your personal 30% discount (€3.49). Your code is in My Bingr and at bingr.online/upgrade.\n\nYour data is kept: your servers, profiles, My List and settings. If you don't choose a plan, you can no longer play, but nothing is deleted. You can always delete your account.\n\nAlready have Lifetime? Nothing changes for you.\n\nQuestions? Contact us at support.bingr.online.\n\nBest,\nThe Bingr team",
    button: "Choose your plan",
  },
  url: "https://bingr.online/upgrade/",
} as const;
