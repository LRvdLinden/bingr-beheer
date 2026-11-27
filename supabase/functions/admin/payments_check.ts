// Tab Betalingen (actie payments_check): alleen-lezen controle op misgelopen betalingen. Vergelijkt wat Apple (verkopen uit App Store
// Connect) en Stripe (betaalde sessies en facturen, als de sleutel er is) melden met wat Bingr heeft vastgelegd. Nooit e-mailadressen,
// namen, account-id's of volledige betaal-id's in het antwoord: alleen aantallen, bedragen, tijden en de laatste 6 tekens van een id.
// Pure logica (dagen, afwijkingen, verdict), getest in payments_check_test.ts; de databasevragen en Stripe-aanroepen staan in index.ts.

export type DayRow = { date: string; apple_sold: number; apple_new: number; apple_lifetime: number };
export type Issue = { level: "warn" | "error"; key: string; nl: string; en: string };
export type Missing = { kind: "checkout" | "invoice"; short_id: string; amount_cents: number; paid_at: string };
export type StripePaid = { kind: "checkout" | "invoice"; id: string; amount_cents: number; paid_at: string };

export type PaymentsInput = {
  now: number;
  sales: { date: string; kind: string; units: number }[];
  lastSalesDate: string | null;
  appleSubs: { created_at: string; user_id: string | null; claim_notified_at: string | null }[];
  applePurchases: { created_at: string }[];
  notifications: { result: string | null }[];
  pendingOverHour: number;
  incompleteOverDay: number;
  pastDue: number;
  recorded7d: number;
  knownIds: Set<string>;                  // billing_purchases.stripe_session_id en premium_payments.id van de laatste dagen
  stripe: { paid: StripePaid[]; truncated: boolean } | null;   // null = niet bevraagd
  stripeWhy?: "no_key" | "test_key" | "unreachable" | "failed" | null;
};

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayOf = (iso: string) => String(iso ?? "").slice(0, 10);
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const shortId = (id: string) => String(id ?? "").slice(-6);

/** De laatste 8 dagen (oudste eerst) met Apple-verkopen tegenover nieuwe Apple-abonnementen en -Lifetime-aankopen. */
export function buildDays(i: Pick<PaymentsInput, "now" | "sales" | "appleSubs" | "applePurchases">): DayRow[] {
  const out: DayRow[] = [];
  for (let k = 7; k >= 0; k--) {
    const date = ymd(i.now - k * DAY);
    out.push({
      date,
      apple_sold: i.sales.filter((s) => s.kind === "sale" && s.date === date).reduce((a, s) => a + n(s.units), 0),
      apple_new: i.appleSubs.filter((s) => dayOf(s.created_at) === date).length,
      apple_lifetime: i.applePurchases.filter((s) => dayOf(s.created_at) === date).length,
    });
  }
  return out;
}

export function notificationCounts(rows: { result: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) { const k = String(r.result ?? "onbekend").slice(0, 60); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** In Stripe betaald, maar bij ons niet vastgelegd (max. 20, nieuwste eerst). */
export function findMissing(paid: StripePaid[], known: Set<string>): Missing[] {
  return paid.filter((p) => p.id && !known.has(p.id)).sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1)).slice(0, 20)
    .map((p) => ({ kind: p.kind, short_id: shortId(p.id), amount_cents: p.amount_cents, paid_at: p.paid_at }));
}

const pl = (x: number, one: string, many: string) => (x === 1 ? one : many);

export function buildIssues(i: PaymentsInput, days: DayRow[], missing: Missing[], appleUnlinked: number, appleUnlinkedNoMail: number, notif: Record<string, number>): Issue[] {
  const out: Issue[] = [];
  if (missing.length) out.push({ level: "error", key: "stripe_missing",
    nl: `${missing.length} ${pl(missing.length, "betaling", "betalingen")} in Stripe (7 dagen) ${pl(missing.length, "staat", "staan")} niet bij ons vastgelegd.`,
    en: `${missing.length} ${pl(missing.length, "payment", "payments")} in Stripe (7 days) ${pl(missing.length, "is", "are")} not recorded on our side.` });
  if (!i.stripe) {
    const why = i.stripeWhy;
    out.push({ level: "warn", key: "stripe_unqueried",
      nl: why === "no_key" ? "Stripe is niet bevraagd: de functie heeft geen Stripe-sleutel." : why === "test_key" ? "Stripe is niet bevraagd: de sleutel is een testsleutel." : "Stripe kon niet worden bevraagd; de vergelijking met Stripe is overgeslagen.",
      en: why === "no_key" ? "Stripe was not queried: the function has no Stripe key." : why === "test_key" ? "Stripe was not queried: the key is a test key." : "Stripe could not be queried; the comparison with Stripe was skipped." });
  } else if (i.stripe.truncated) out.push({ level: "warn", key: "stripe_truncated",
    nl: "Stripe gaf meer dan 100 betalingen; alleen de nieuwste 100 zijn vergeleken.", en: "Stripe returned more than 100 payments; only the newest 100 were compared." });
  if (appleUnlinkedNoMail > 0) out.push({ level: "warn", key: "apple_unlinked",
    nl: `${appleUnlinkedNoMail} Apple-${pl(appleUnlinkedNoMail, "abonnement", "abonnementen")} (7 dagen) nog niet aan een account gekoppeld en zonder claim-mail. De koper koppelt zichzelf bij het inloggen.`,
    en: `${appleUnlinkedNoMail} Apple ${pl(appleUnlinkedNoMail, "subscription", "subscriptions")} (7 days) not linked to an account yet and without a claim mail. The buyer links it when signing in.` });
  const last = i.lastSalesDate;
  if (!last || Date.parse(last + "T00:00:00Z") < i.now - 3 * DAY) out.push({ level: "warn", key: "apple_sales_stale",
    nl: last ? `De Apple-verkoopcijfers lopen achter (laatste dag ${last}).` : "Er zijn nog geen Apple-verkoopcijfers opgehaald.",
    en: last ? `The Apple sales figures are behind (last day ${last}).` : "No Apple sales figures have been fetched yet." });
  // verkopen tegenover nieuwe koppelingen: de laatste 2 dagen tellen niet mee (Apple rapporteert met vertraging); verlengingen tellen wel als verkoop
  const gap = days.slice(0, -2).reduce((a, d) => a + Math.max(0, d.apple_sold - d.apple_new - d.apple_lifetime), 0);
  if (gap > 0) out.push({ level: "warn", key: "apple_sales_gap",
    nl: `Apple meldt ${gap} ${pl(gap, "verkoop", "verkopen")} meer dan wij als nieuw abonnement of Lifetime kennen (kan een verlenging zijn).`,
    en: `Apple reports ${gap} more ${pl(gap, "sale", "sales")} than we know as a new subscription or Lifetime (could be a renewal).` });
  const nf = Object.entries(notif).filter(([k]) => /^(bad_transaction|unknown_purchase)/.test(k)).reduce((a, [, v]) => a + v, 0);
  if (nf > 0) out.push({ level: "warn", key: "apple_notify",
    nl: `${nf} Apple-${pl(nf, "melding", "meldingen")} (3 dagen) kon niet aan een aankoop worden gekoppeld.`,
    en: `${nf} Apple ${pl(nf, "notification", "notifications")} (3 days) could not be matched to a purchase.` });
  if (i.pendingOverHour > 0) out.push({ level: "warn", key: "stripe_pending",
    nl: `${i.pendingOverHour} Stripe-${pl(i.pendingOverHour, "aankoop staat", "aankopen staan")} langer dan een uur op pending.`,
    en: `${i.pendingOverHour} Stripe ${pl(i.pendingOverHour, "purchase has", "purchases have")} been pending for over an hour.` });
  if (i.incompleteOverDay > 0) out.push({ level: "warn", key: "stripe_incomplete",
    nl: `${i.incompleteOverDay} Stripe-${pl(i.incompleteOverDay, "abonnement is", "abonnementen zijn")} na een dag nog onvolledig.`,
    en: `${i.incompleteOverDay} Stripe ${pl(i.incompleteOverDay, "subscription is", "subscriptions are")} still incomplete after a day.` });
  if (i.pastDue > 0) out.push({ level: "warn", key: "stripe_past_due",
    nl: `${i.pastDue} Stripe-${pl(i.pastDue, "abonnement loopt", "abonnementen lopen")} achter met betalen.`,
    en: `${i.pastDue} Stripe ${pl(i.pastDue, "subscription is", "subscriptions are")} past due.` });
  return out;
}

/** Antwoord in een vaste vorm (contract: zie docs in index.ts bij payments_check). */
export function buildPaymentsCheck(i: PaymentsInput) {
  const days = buildDays(i);
  const unlinked = i.appleSubs.filter((s) => !s.user_id);
  const notif = notificationCounts(i.notifications);
  const missing = i.stripe ? findMissing(i.stripe.paid, i.knownIds) : [];
  const issues = buildIssues(i, days, missing, unlinked.length, unlinked.filter((s) => !s.claim_notified_at).length, notif);
  return {
    ok: true as const,
    checked_at: new Date(i.now).toISOString(),
    verdict: (issues.length ? "attention" : "ok") as "ok" | "attention",
    issues, days,
    apple: { last_sales_date: i.lastSalesDate, unlinked_7d: unlinked.length, unlinked_no_mail: unlinked.filter((s) => !s.claim_notified_at).length, notifications_3d: notif },
    stripe: {
      queried: !!i.stripe, paid_in_stripe_7d: i.stripe ? i.stripe.paid.length : null, recorded_7d: i.recorded7d,
      missing, pending_over_1h: i.pendingOverHour, incomplete_over_1d: i.incompleteOverDay, past_due: i.pastDue,
    },
  };
}

/** Betaalde Stripe-sessies (alleen mode=payment) en facturen (live) uit de lijstantwoorden; paid_at als ISO. */
// deno-lint-ignore no-explicit-any
export function stripePaidFrom(sessions: any, invoices: any): { paid: StripePaid[]; truncated: boolean } {
  const out: StripePaid[] = [];
  for (const s of Array.isArray(sessions?.data) ? sessions.data : []) {
    if (s?.livemode === false || s?.mode !== "payment" || s?.payment_status !== "paid") continue;
    out.push({ kind: "checkout", id: String(s.id ?? ""), amount_cents: n(s.amount_total), paid_at: new Date(n(s.created) * 1000).toISOString() });
  }
  for (const v of Array.isArray(invoices?.data) ? invoices.data : []) {
    if (v?.livemode === false || v?.status !== "paid" || n(v.amount_paid) <= 0) continue;
    const t = n(v?.status_transitions?.paid_at) || n(v?.created);
    out.push({ kind: "invoice", id: String(v.id ?? ""), amount_cents: n(v.amount_paid), paid_at: new Date(t * 1000).toISOString() });
  }
  return { paid: out, truncated: sessions?.has_more === true || invoices?.has_more === true };
}
