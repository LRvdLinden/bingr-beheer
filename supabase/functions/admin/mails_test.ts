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
