// deno test supabase/functions/admin/mailing_test.ts
// Eigen mailing (tab Nieuwsbrief): invoer en de weergave van het antwoord van `newsletter`. Geen persoonsgegevens
// (alleen example.com-adressen, die nergens heen gaan).
import {
  cleanAudience, cleanContent, cleanMailingId, cleanRequestId, cleanTestLang, cleanUrl, MAX, mailingStatusView, mailingView, sendAudit,
} from "./mailing.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m}: verwacht ${y}, kreeg ${x}`);
};
const good = () => ({
  nl: { subject: " Nieuw\nin Bingr ", body: "# Kop\r\n\r\nTekst", button: "Lees" },
  en: { subject: "New", body: "Text", button: "Read" }, image: "", button_url: "https://bingr.online/",
});

Deno.test("mailing: doelgroep, taal, request_id en id", () => {
  eq(cleanAudience(undefined), "newsletter", "standaard nieuwsbrief");
  eq(cleanAudience("service"), "service", "service");
  eq(cleanAudience("iedereen"), null, "onbekend");
  eq([cleanTestLang(undefined), cleanTestLang("en"), cleanTestLang("both"), cleanTestLang("de")], ["nl", "en", "both", null], "testtaal");
  eq(cleanRequestId("0F8FAD5B-D9CB-469F-A165-70867728950E"), "0f8fad5b-d9cb-469f-a165-70867728950e", "uuid klein");
  eq(cleanRequestId("x"), null, "geen uuid");
  eq([cleanMailingId(7), cleanMailingId("12"), cleanMailingId(0), cleanMailingId(-1), cleanMailingId(1.5), cleanMailingId("1e3")], [7, 12, null, null, null, null], "id");
});

Deno.test("mailing: inhoud opschonen en controleren", () => {
  const r = cleanContent(good());
  ok(r.ok, "geldig");
  if (r.ok) {
    eq(r.content.nl.subject, "Nieuw in Bingr", "onderwerp op één regel");
    eq(r.content.nl.body, "# Kop\n\nTekst", "regeleinden");
  }
  eq(cleanContent({ ...good(), en: { subject: "", body: "x", button: "y" } }), { ok: false, error: "bad_subject_en" }, "EN onderwerp");
  ok(cleanContent({ ...good(), en: { subject: "", body: "", button: "" } }, ["nl"]).ok, "voorbeeld alleen NL");
  eq(cleanContent({ ...good(), nl: { subject: "a", body: "x".repeat(MAX.body + 1), button: "b" } }), { ok: false, error: "bad_body_nl" }, "te lang");
  eq(cleanContent({ ...good(), nl: { subject: "a", body: "b", button: "" } }), { ok: false, error: "bad_button_text_nl" }, "knop zonder tekst");
  eq(cleanContent({ ...good(), button_url: "" }), { ok: false, error: "bad_button_url" }, "knoptekst zonder url");
  eq(cleanContent({ ...good(), image: "http://bingr.online/a.png" }), { ok: false, error: "bad_image_url" }, "http-afbeelding");
  eq(cleanContent("tekst"), { ok: false, error: "bad_content" }, "geen object");
});

Deno.test("mailing: alleen https-URL's", () => {
  eq(cleanUrl("https://bingr.online/a?b=1"), "https://bingr.online/a?b=1", "goed");
  for (const u of ["javascript:alert(1)", "http://bingr.online", "https://a:b@bingr.online", "https://10.0.0.1/", "https://intra.local/", "https://bingr.online/\"x"]) {
    eq(cleanUrl(u), null, u);
  }
});

Deno.test("mailing: weergave zonder adressen, begrensd", () => {
  const v = mailingStatusView({
    active: { id: 3, status: "sending", audience: "service", subject: { nl: "Storing", en: "Outage" }, recipients: { nl: 2, en: 1, total: 3 }, sent: 1, left: 2, email: "a@example.com" },
    mailings: [{ id: 3, status: "sending", audience: "service", subject: { nl: "Storing", en: "Outage" }, recipients: { nl: 2, en: 1 }, sent: 1, left: 2 },
      { id: 2, status: "weird", audience: "x", subject: { nl: "a".repeat(400) }, sent: -4, left: 9, to: "b@example.com" }, { id: "nope" }],
    audiences: { newsletter: { nl: 5, en: 4, total: 9 }, service: { nl: 6, en: 5, total: 11 } }, per_hour: 200, batch: 50, sent_last_hour: 12,
  });
  eq(v.active?.id, 3, "actief");
  eq(v.mailings.length, 2, "ongeldige id weg");
  eq(v.mailings[1].status, "done", "onbekende status");
  eq(v.mailings[1].audience, "newsletter", "onbekende doelgroep");
  eq(v.mailings[1].sent, 0, "negatief -> 0");
  eq(v.mailings[1].left, 0, "klaar: niets te gaan");
  eq(v.mailings[1].subject.nl.length, MAX.subject, "onderwerp begrensd");
  eq(v.mailings[0].recipients, { nl: 2, en: 1, total: 3 }, "totaal berekend");
  eq([v.per_hour, v.batch, v.sent_last_hour], [200, 50, 12], "limieten");
  ok(!JSON.stringify(v).includes("@"), "geen adressen");
  eq(mailingStatusView({ active: { id: 4, status: "done" } }).active, null, "actief alleen als hij verstuurt");
  eq(mailingView({}).id, 0, "leeg");
});

Deno.test("mailing: logboek bij versturen zonder inhoud", () => {
  eq(sendAudit({ id: 9, recipients: { nl: 3, en: 2, total: 5 }, duplicate: false, subject: "x" }, "newsletter"),
    { id: 9, audience: "newsletter", recipients: { nl: 3, en: 2, total: 5 }, duplicate: false }, "audit");
});
