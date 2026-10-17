// deno test supabase/functions/admin/newsletter_test.ts
// Alleen voorbeeldadressen op example.com/example.org (gereserveerd, geen persoonsgegevens).
import {
  cleanEmail, cleanEnabled, cleanLang, EMAIL_MAX, editionView, errCode, HTML_MAX, newsletterCall, renderView, statusView,
} from "./newsletter.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const resp = (status: number, body: unknown) => async () =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.test("nieuwsbrief: e-mailadres voor de voorbeeldmail", () => {
  ok(cleanEmail("test@example.com") === "test@example.com", "gewoon adres");
  ok(cleanEmail("  Test.Naam+nb@Example.ORG ") === "Test.Naam+nb@example.org", "spaties weg, domein klein");
  ok(cleanEmail("a@example.com\n") === "a@example.com", "regeleinde aan het eind weg");
  ok(cleanEmail("a@sub.example.co.uk") === "a@sub.example.co.uk", "subdomein");
  for (const bad of [
    "", " ", "test", "test@", "@example.com", "a@b", "a@@example.com", "a@b@example.com", "a b@example.com",
    "a@example", "a@example.c", "a@127.0.0.1", "a@[127.0.0.1]", "a@localhost", "a@host.local", "a@x.internal",
    ".a@example.com", "a.@example.com", "a..b@example.com", "a@-example.com", "a@example-.com", "a@exa_mple.com",
    "a\r\nBcc: b@example.com", "a@exam\nple.com", "a\u200b@example.com", "<a@example.com>", "a,b@example.com",
    `${"a".repeat(65)}@example.com`, `a@${"b".repeat(EMAIL_MAX)}.com`,
  ]) ok(cleanEmail(bad) === null, `ongeldig: ${JSON.stringify(bad)}`);
  ok(cleanEmail(5) === null && cleanEmail(null) === null && cleanEmail({}) === null, "geen tekst");
});

Deno.test("nieuwsbrief: taal en aan/uit", () => {
  ok(cleanLang(undefined) === "nl" && cleanLang("") === "nl" && cleanLang(null) === "nl", "standaard nl");
  ok(cleanLang("en") === "en" && cleanLang("nl") === "nl", "nl/en");
  ok(cleanLang("de") === null && cleanLang("EN") === null && cleanLang(1) === null, "andere talen ongeldig");
  ok(cleanEnabled(true) === true && cleanEnabled(false) === false, "boolean");
  ok(cleanEnabled("true") === null && cleanEnabled(1) === null && cleanEnabled(undefined) === null, "geen boolean");
});

Deno.test("nieuwsbrief: status zonder adressen", () => {
  const v = statusView({
    enabled: true, next: { key: "2026-10-18-sun", at: "2026-10-18T07:00:00.000Z" }, recipients: { nl: 120, en: 30, total: 150 },
    editions: [
      { key: "2026-10-15-wed", created_at: "2026-10-15T16:00:00Z", recipients: 140, sent: 138, failed: 2, done: true, emails: ["x@example.com"] },
      { key: "2026-10-18-sun", created_at: "2026-10-18T07:00:00Z", recipients: 150, sent: 10, failed: 0 },
    ],
    secret: "zou nooit mee mogen",
  });
  ok(v.enabled === true && v.next?.at === "2026-10-18T07:00:00.000Z" && v.next?.key === "2026-10-18-sun", "volgende verzending");
  ok(v.recipients.nl === 120 && v.recipients.en === 30 && v.recipients.total === 150, "ontvangers");
  ok(v.editions.length === 2 && v.editions[0].done === true && v.editions[1].done === false, "edities, done afgeleid");
  ok(!JSON.stringify(v).includes("@") && !JSON.stringify(v).includes("secret"), "geen adressen of andere velden");
  const empty = statusView(null);
  ok(empty.enabled === false && empty.next === null && empty.recipients.total === 0 && empty.editions.length === 0, "leeg antwoord");
  ok(statusView({ recipients: { nl: 2, en: 3 } }).recipients.total === 5, "totaal opgeteld");
  ok(statusView({ enabled: "true" }).enabled === false, "alleen true is aan");
  ok(statusView({ editions: Array.from({ length: 80 }, () => ({})) }).editions.length === 50, "max. 50 edities");
});

Deno.test("nieuwsbrief: editie", () => {
  const e = editionView({ key: "bad key <x>", recipients: -3, sent: 2.7, failed: "1" });
  ok(e.key === null && e.recipients === 0 && e.sent === 2 && e.failed === 0, "opgeschoond");
  ok(editionView({ recipients: 3, sent: 2, failed: 1 }).done === true, "klaar als alles verwerkt is");
  ok(editionView({}).done === false, "zonder ontvangers niet klaar");
});

Deno.test("nieuwsbrief: render", () => {
  const r = renderView({ subject: "Nieuw deze week", html: "<html><body>Hoi</body></html>", extra: 1 });
  ok(r?.subject === "Nieuw deze week" && r.html.includes("Hoi") && !("extra" in r), "subject en html");
  ok(renderView({ subject: "x" }) === null && renderView({ html: "" }) === null && renderView(null) === null, "geen html");
  ok(renderView({ html: "x".repeat(HTML_MAX + 1) }) === null, "te groot");
  ok(renderView({ html: "<p>x</p>", subject: 5 })?.subject === "", "onderwerp leeg als geen tekst");
});

Deno.test("nieuwsbrief: foutcodes", () => {
  ok(errCode("bad_email") === "bad_email" && errCode("tmdb_unavailable") === "tmdb_unavailable", "korte codes");
  ok(errCode("Error: connect ECONNREFUSED 10.0.0.1") === "server_error" && errCode(undefined) === "server_error", "geen serverteksten");
});

Deno.test("nieuwsbrief: doorgeven aan de functie newsletter", async () => {
  ok((await newsletterCall("https://x.example.com", "", "status", {})).out.error === "newsletter_not_configured", "geen geheim");
  let seen: { url: string; init: RequestInit } | null = null;
  const capture = async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ enabled: false }), { status: 200 });
  };
  const r = await newsletterCall("https://x.example.com/", "geheim", "status", { action: "iets_anders", lang: "nl" }, capture);
  ok(r.status === 200 && r.out.enabled === false, "antwoord doorgegeven");
  const s = seen as unknown as { url: string; init: RequestInit };
  ok(s.url === "https://x.example.com/functions/v1/newsletter", "URL");
  ok((s.init.headers as Record<string, string>)["x-newsletter-secret"] === "geheim", "header met het geheim");
  ok(JSON.parse(String(s.init.body)).action === "status", "actie kan niet overschreven worden");

  const nd = await newsletterCall("https://x.example.com", "g", "status", {}, resp(404, undefined));
  ok(nd.status === 503 && nd.out.error === "newsletter_not_deployed", "404 = niet online");
  const nf = await newsletterCall("https://x.example.com", "g", "status", {}, resp(404, { error: "not_found" }));
  ok(nf.status === 404 && nf.out.error === "not_found", "404 met eigen foutcode blijft");
  const fb = await newsletterCall("https://x.example.com", "g", "status", {}, resp(403, { error: "forbidden" }));
  ok(fb.status === 502 && fb.out.error === "newsletter_forbidden", "geheim klopt niet");
  const be = await newsletterCall("https://x.example.com", "g", "preview", {}, resp(400, { error: "bad_email", detail: "x@example.com" }));
  ok(be.status === 400 && be.out.error === "bad_email" && !("detail" in be.out), "foutcode zonder details");
  const rl = await newsletterCall("https://x.example.com", "g", "preview", {}, resp(429, { error: "rate_limited", retry_after: 600 }));
  ok(rl.status === 429 && rl.out.error === "rate_limited" && rl.out.retry_after === 600, "limiet met retry_after");
  const ue = await newsletterCall("https://x.example.com", "g", "status", {}, async () => { throw new TypeError("down"); });
  ok(ue.status === 502 && ue.out.error === "newsletter_unreachable", "niet bereikbaar");
  const bj = await newsletterCall("https://x.example.com", "g", "status", {}, async () => new Response("geen json", { status: 200 }));
  ok(bj.status === 502 && bj.out.error === "server_error", "geen json");
});

Deno.test("nieuwsbrief per account: voorkeur", async () => {
  const { prefView, prefMap, missingColumn, planPrefChange } = await import("./newsletter.ts");
  ok(prefView(null).subscribed === true, "geen rij = geabonneerd");
  ok(prefView({ email_opt_out: false, newsletter_opt_out: false }).subscribed === true, "niets uit = geabonneerd");
  ok(prefView({ email_opt_out: true }).subscribed === false && prefView({ email_opt_out: true }).email_opt_out === true, "alle mail uit");
  ok(prefView({ newsletter_opt_out: true }).subscribed === false, "nieuwsbrief uit");
  const A = "11111111-2222-4333-8444-555555555555", B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const m = prefMap([A, B], [{ user_id: B, newsletter_opt_out: true }, { user_id: "x", email_opt_out: true }]);
  ok(m[A] === true && m[B] === false && !("x" in m), "per account, alleen gevraagde id's");
  ok(missingColumn({ code: "42703", message: "column account_email_prefs.newsletter_opt_out does not exist" }), "kolom ontbreekt (Postgres)");
  ok(missingColumn({ code: "PGRST204", message: "Could not find the 'newsletter_opt_out' column" }), "kolom ontbreekt (PostgREST)");
  ok(!missingColumn({ code: "23503", message: "foreign key" }), "andere fout");
  const sub = prefView(null), off = prefView({ newsletter_opt_out: true }), none = prefView({ email_opt_out: true });
  const a = planPrefChange(sub, false);
  ok(a.ok && a.newsletter_opt_out === true && a.changed, "afmelden");
  const b = planPrefChange(off, true);
  ok(b.ok && b.newsletter_opt_out === false && b.changed, "weer aanmelden");
  const c = planPrefChange(sub, true);
  ok(c.ok && !c.changed, "al aan");
  const d = planPrefChange(none, true);
  ok(!d.ok && d.error === "email_opted_out", "alle mail uit: niet overschrijven");
  const e = planPrefChange(none, false);
  ok(e.ok && e.newsletter_opt_out === true, "uitzetten mag altijd");
});
