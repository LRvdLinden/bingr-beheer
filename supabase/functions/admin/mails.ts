// Berichten uit het beheer per e-mail, in de gedeelde huisstijl (../_shared/layout.ts, dezelfde opbouw als de supportmails en
// de accountmails). Dit zijn nieuwsberichten: de voettekst zegt waarom je ze krijgt en heeft altijd een werkende afmeldlink
// (bingr.online/unsubscribe/ met het ondertekende token); de headers List-Unsubscribe en List-Unsubscribe-Post (RFC 8058)
// zet index.ts. Titel en tekst komen uit het beheer en gaan door esc(); alleen https-links worden klikbaar.
import {
  bodyHtml, esc, eyebrow, footerHtml, footerText, type Lang, layout, redBar, title,
} from "../_shared/layout.ts";

const TXT: Record<Lang, { label: string; eyebrow: string; reason: string; open: string }> = {
  nl: {
    label: "Nieuws", eyebrow: "Bericht van Bingr",
    reason: "Je ontvangt dit bericht omdat je een Bingr-account hebt en berichten per e-mail aan hebt staan.",
    open: "Ook te lezen in de Bingr-app.",
  },
  en: {
    label: "News", eyebrow: "Message from Bingr",
    reason: "You're receiving this message because you have a Bingr account and email announcements are turned on.",
    open: "You can also read this in the Bingr app.",
  },
};

/** E-mail voor een bericht uit het beheer: {subject, html, text}. */
export function announcementMail(lang: Lang, subject: string, body: string, unsubscribeUrl: string, year?: number) {
  const t = TXT[lang];
  const s = String(subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const content = `
${eyebrow(t.eyebrow)}
${redBar("12px 0 20px")}
${title(s, "0 0 16px")}
${bodyHtml(body, "#d6d6d6", 16)}
<p style="margin:8px 0 0;padding-top:16px;border-top:1px solid #2a2a2a;font-size:13px;line-height:19px;color:#8c8c8c">${esc(t.open)}</p>`;
  const html = layout({
    lang, docTitle: s, preheader: firstLine(body), label: t.label, contentHtml: content,
    footerHtml: footerHtml({ lang, reasonHtml: esc(t.reason), unsubscribeUrl, year }),
  });
  const text = [`BINGR · ${t.label}`, "", s, "", String(body ?? ""), "", t.open, "", footerText({ lang, reason: t.reason, unsubscribeUrl, year })]
    .join("\n");
  return { subject: s, html, text };
}

/** Voorbeeldregel in de inbox: het begin van de tekst. */
function firstLine(body: string) {
  const one = String(body ?? "").replace(/\s+/g, " ").trim();
  return one.length > 110 ? `${one.slice(0, 107)}…` : one;
}
