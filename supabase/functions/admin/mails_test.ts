// deno test supabase/functions/admin/mails_test.ts
import { announcementMail } from "./mails.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const U = "https://bingr.online/unsubscribe/?t=abc.def";

Deno.test("bericht: escapen, links, taal", () => {
  const m = announcementMail("nl", "Nieuw <b>in</b> Bingr", "Hallo <script>x</script>\n\nZie https://bingr.online/changelog/.", U, 2026);
  ok(!m.html.includes("<script>") && m.html.includes("&lt;script&gt;"), "tekst ge-escaped");
  ok(!m.html.includes("<b>in</b>") && m.html.includes("Nieuw &lt;b&gt;in&lt;/b&gt; Bingr"), "titel ge-escaped");
  ok(m.html.includes('<a href="https://bingr.online/changelog/"'), "https-link klikbaar, zonder punt");
  ok(m.html.includes('lang="nl"') && m.html.includes("Bericht van Bingr") && m.html.includes("#E50914"), "huisstijl NL");
  const en = announcementMail("en", "News", "Body", U, 2026);
  ok(en.html.includes('lang="en"') && en.html.includes("Message from Bingr") && en.html.includes("Unsubscribe"), "Engels");
  ok(m.subject === "Nieuw <b>in</b> Bingr", "onderwerp is platte tekst");
  ok(announcementMail("nl", "a\r\nb", "x", U).subject === "a b", "geen regeleinde in onderwerp");
});

Deno.test("bericht: voettekst met reden en afmeldlink", () => {
  const m = announcementMail("nl", "T", "B", U, 2026);
  ok(m.html.includes("berichten per e-mail aan hebt staan"), "reden");
  ok(m.html.includes(`href="${U.replace(/&/g, "&amp;")}"`) && m.html.includes(">Afmelden</a>"), "afmeldlink");
  ok(m.html.includes("© 2026 Bingr") && m.html.includes("https://bingr.online/privacy.html"), "© en privacy");
  ok(m.text.includes(`Afmelden: ${U}`) && m.text.includes("© 2026 Bingr"), "platte tekst met afmeldlink");
  ok(!/<[a-z]/i.test(m.text), "geen html in platte tekst");
  ok(!/supabase/i.test(m.html + m.text), "geen namen van derden");
});

// ---- accountmails ----
import { blockMail, deletedMail, NEW_TICKET_URL, unblockMail } from "./mails.ts";

Deno.test("blokkade: onderwerp, reden ge-escaped, datum, contact, geen afmeldlink", () => {
  const m = blockMail("nl", { email: "jan@example.com", reason: "Misbruik <b>van</b> de dienst", until: "2026-10-21T10:00:00Z" });
  ok(m.subject === "Je Bingr-account is geblokkeerd", "onderwerp NL");
  ok(m.html.includes("Misbruik &lt;b&gt;van&lt;/b&gt; de dienst") && !m.html.includes("<b>van</b>"), "reden ge-escaped");
  ok(m.html.includes("woensdag 21 oktober 2026 om 12:00 (Nederlandse tijd)"), "einddatum in Nederlandse tijd");
  ok(m.html.includes(`href="${NEW_TICKET_URL}"`) && NEW_TICKET_URL === "https://support.bingr.online/nieuw/", "knop naar nieuw ticket");
  ok(m.html.includes("zonder in te loggen") && m.html.includes("servicebericht"), "contact zonder inloggen en reden in de voettekst");
  ok(!m.html.includes(">Afmelden</a>") && !/unsubscribe/i.test(m.html + m.text), "geen afmeldlink");
  ok(m.text.includes("Reden:\nMisbruik <b>van</b> de dienst") && m.text.includes("Geblokkeerd tot: woensdag 21 oktober 2026"), "platte tekst");
  ok(!/supabase/i.test(m.html + m.text), "geen namen van derden");
  const f = blockMail("nl", { email: "jan@example.com", reason: "x", until: null });
  ok(f.html.includes("Onbepaalde tijd") && f.html.includes("tot we hem opheffen"), "onbepaald");
  const en = blockMail("en", { email: "jan@example.com", reason: "Abuse", until: "2026-12-01T10:00:00Z" });
  ok(en.subject === "Your Bingr account has been blocked" && en.html.includes('lang="en"') && en.html.includes("Tuesday, 1 December 2026 at 11:00 (Amsterdam time)"), "Engels");
});

Deno.test("opheffen en verwijderen", () => {
  const u = unblockMail("nl", { email: "jan@example.com" });
  ok(u.subject === "Je Bingr-account is weer actief" && u.html.includes("https://bingr.online/account/"), "opheffen");
  const d = deletedMail("nl", { email: "jan@example.com", ticketsDeleted: false });
  ok(d.subject === "Je Bingr-account is verwijderd", "onderwerp verwijderd");
  ok(d.html.includes("Kijkgeschiedenis en statistieken") && d.html.includes("supporttickets bewaren we"), "wat er weg is, tickets bewaard");
  ok(d.html.includes("nieuw account maken") && !d.html.includes(">Afmelden</a>"), "nieuw account, geen afmeldlink");
  ok(deletedMail("nl", { email: "a@b.nl", ticketsDeleted: true }).html.includes("Ook je supporttickets zijn verwijderd"), "tickets verwijderd");
  ok(!d.html.includes("bewaarplicht"), "zonder aankopen geen zin over de bewaarplicht");
  const k = deletedMail("nl", { email: "a@b.nl", ticketsDeleted: false, purchasesKept: true });
  ok(k.html.includes("wettelijke bewaarplicht") && k.text.includes("zonder koppeling aan je account nog 7 jaar"), "aankopen bewaard (html en tekst)");
  ok(deletedMail("en", { email: "a@b.nl", ticketsDeleted: false, purchasesKept: true }).text.includes("legal retention requirement"), "aankopen bewaard (Engels)");
  const e = deletedMail("en", { email: "a@b.nl", ticketsDeleted: false });
  ok(e.subject === "Your Bingr account has been deleted" && e.text.includes("- Watch history and statistics"), "Engels");
  ok(!/<[a-z]/i.test(d.text + u.text), "geen html in platte tekst");
});

// ---- aanhef met de voornaam (user_metadata first_name) ----
import { greeting } from "./mails.ts";

Deno.test("aanhef: Hoi <voornaam>, alleen als die bekend is", () => {
  ok(greeting("nl", "Jan") === "Hoi Jan," && greeting("en", " Jan ") === "Hi Jan,", "NL en EN");
  ok(greeting("nl", "") === null && greeting("nl", undefined) === null && greeting("nl", "<b>") === null, "geen aanhef");
  const b = blockMail("nl", { email: "jan@example.com", reason: "x", until: null, firstName: "Jan" });
  ok(b.html.includes(">Hoi Jan,</p>") && b.text.includes("Je Bingr-account is geblokkeerd\n\nHoi Jan,\n\nWe hebben"), "blokkeren");
  const u = unblockMail("en", { email: "jan@example.com", firstName: "Jan" });
  ok(u.html.includes(">Hi Jan,</p>") && u.text.includes("Hi Jan,"), "opheffen EN");
  const d = deletedMail("nl", { email: "jan@example.com", ticketsDeleted: false, firstName: "Zoë" });
  ok(d.html.includes(">Hoi Zoë,</p>"), "verwijderen");
  const a = announcementMail("nl", "T", "Tekst", U, 2026, "Jan");
  ok(a.html.includes(">Hoi Jan,</p>") && a.text.includes("T\n\nHoi Jan,\n\nTekst"), "bericht");
  const none = blockMail("nl", { email: "jan@example.com", reason: "x", until: null });
  ok(!none.html.includes("Hoi ") && !none.text.includes("Hoi "), "zonder voornaam geen aanhef");
  ok(!announcementMail("nl", "T", "B", U, 2026).text.includes("Hoi "), "bericht zonder voornaam");
  const evil = blockMail("nl", { email: "jan@example.com", reason: "x", until: null, firstName: "Jan & \"Co\"" });
  ok(evil.html.includes("Hoi Jan &amp; &quot;Co&quot;,") || evil.html.includes("Hoi Jan &amp; &#39;"), "ge-escaped");
});
