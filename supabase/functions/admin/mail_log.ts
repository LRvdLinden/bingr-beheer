// Tab Verzonden (actie mail_log): het verzendlogboek van de e-mails die de functies via _shared/mail.ts versturen (tabel mail_log
// in iptv-ios-appletv, schema.sql). Per mail: tijd, bron, ontvanger, onderwerp en of de mailserver de mail aannam (nooit de inhoud).
// Aangenomen is niet hetzelfde als afgeleverd: de ontvangende mailserver meldt dat niet terug. Nieuwsbrief en mailings staan er niet
// in. Pure logica (invoer controleren, antwoord in een vaste vorm), getest in mail_log_test.ts.

export const MAIL_STATUS = ["all", "ok", "failed"] as const;
export type MailLogQuery = { limit: number; status: typeof MAIL_STATUS[number]; source: string | null; q: string | null };

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Invoer: {limit?: 1..500 (200), status?: all|ok|failed, source?: bron, q?: zoektekst voor ontvanger of onderwerp}. */
export function parseMailLog(body: unknown): MailLogQuery | { error: string } {
  const b = isObj(body) ? body : {};
  const status = (b.status ?? "all") as MailLogQuery["status"];
  if (!(MAIL_STATUS as readonly string[]).includes(status)) return { error: "bad_status" };
  let source: string | null = null;
  if (b.source != null && b.source !== "") {
    if (typeof b.source !== "string" || !/^[a-z0-9_-]{1,40}$/.test(b.source)) return { error: "bad_source" };
    source = b.source;
  }
  let q: string | null = null;
  if (b.q != null && b.q !== "") {
    if (typeof b.q !== "string") return { error: "bad_q" };
    // alleen tekens die veilig in een PostgREST-filter staan (geen komma, haakjes, procent of sterretje)
    q = b.q.trim().replace(/[^A-Za-z0-9@._+\- ]/g, "").slice(0, 100) || null;
  }
  const n = Number(b.limit ?? 200);
  const limit = Number.isInteger(n) && n >= 1 && n <= 500 ? n : 200;
  return { limit, status, source, q };
}

export type MailRow = { id: number; at: string; source: string; to_addr: string; subject: string; ok: boolean; error: string };
/** Antwoord in een vaste vorm. `totals` = aantallen van de laatste 7 dagen. */
export function mailLogView(rows: unknown, totals: { total?: number | null; failed?: number | null }, sources: string[] = []) {
  const list = (Array.isArray(rows) ? rows : []).filter(isObj).map((r) => ({
    id: Number(r.id), at: String(r.at ?? ""), source: String(r.source ?? ""), to: String(r.to_addr ?? ""),
    subject: String(r.subject ?? ""), ok: r.ok === true, error: String(r.error ?? ""),
  }));
  return { items: list, totals: { total_7d: Number(totals.total ?? 0), failed_7d: Number(totals.failed ?? 0) }, sources };
}
