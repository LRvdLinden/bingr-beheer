// Berichten uit het beheer per e-mail, in de gedeelde huisstijl (../_shared/layout.ts, dezelfde opbouw als de supportmails en
// de accountmails). Dit zijn nieuwsberichten: de voettekst zegt waarom je ze krijgt en heeft altijd een werkende afmeldlink
// (bingr.online/unsubscribe/ met het ondertekende token); de headers List-Unsubscribe en List-Unsubscribe-Post (RFC 8058)
// zet index.ts. Titel en tekst komen uit het beheer en gaan door esc(); alleen https-links worden klikbaar.
// Daaronder de accountmails (blokkeren, opheffen, verwijderen): servicemails vanaf support@, zonder afmeldlink.
import {
  bodyHtml, button, copyLink, detailRows, esc, eyebrow, footerHtml, footerText, type Lang, layout, messageBox, note, para, redBar,
  SITE, SUPPORT_SITE, title,
} from "../_shared/layout.ts";
import { formatUntil } from "./blocks.ts";

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

// ---- accountmails: blokkeren, opheffen, verwijderen ----
// Servicemails over het account (geen nieuws): afzender support@bingr.online, geen afmeldlink, de voettekst zegt waarom.
// De reden komt uit het beheer en gaat door esc() (messageBox). Contact loopt via een nieuw ticket, ook zonder inloggen.

export const NEW_TICKET_URL = `${SUPPORT_SITE}/nieuw/`;
export type Mail = { subject: string; html: string; text: string };

const ACC: Record<Lang, Record<string, string>> = {
  nl: {
    label: "Account", eyebrow: "Je Bingr-account", account: "Account",
    foot: "Je ontvangt deze e-mail omdat er iets is gewijzigd aan je Bingr-account. Dit is een servicebericht over je account; daarvoor kun je je niet afmelden.",
    footDel: "Je ontvangt deze e-mail ter bevestiging dat je Bingr-account is verwijderd. Dit is een servicebericht; je krijgt hierna geen e-mails meer over dit account.",
    contact: "Contact opnemen met support", noLogin: "Je kunt een ticket aanmaken zonder in te loggen.",
    // blokkeren
    b_subject: "Je Bingr-account is geblokkeerd", b_title: "Je Bingr-account is geblokkeerd",
    b_intro: "We hebben je Bingr-account geblokkeerd. Zolang de blokkade duurt, kun je niet inloggen in de Bingr-apps en op bingr.online. Je bent op al je apparaten uitgelogd.",
    b_reason: "Reden", b_until: "Geblokkeerd tot", b_forever: "Onbepaalde tijd", tz: "Nederlandse tijd",
    b_after: "Na deze datum kun je vanzelf weer inloggen.", b_afterForever: "De blokkade geldt tot we hem opheffen.",
    b_help: "Denk je dat dit een vergissing is, of heb je een vraag? Neem contact op met Bingr Support.",
    // opheffen
    u_subject: "Je Bingr-account is weer actief", u_title: "Je Bingr-account is weer actief",
    u_intro: "De blokkade van je Bingr-account is opgeheven. Je kunt weer inloggen in de Bingr-apps en op bingr.online.",
    u_button: "Inloggen op bingr.online", u_help: "Vragen? Neem contact op via support.bingr.online.",
    // verwijderen
    d_subject: "Je Bingr-account is verwijderd", d_title: "Je Bingr-account is verwijderd",
    d_intro: "Je Bingr-account is verwijderd. Dit kan niet ongedaan worden gemaakt. Je bent op al je apparaten uitgelogd.",
    d_what: "Wat we hebben verwijderd",
    d_items: "Je account en inloggegevens\nJe profielen en profielfoto's\nGekoppelde apparaten en sessies\nJe instellingen, servers en afspeellijsten\nKijkgeschiedenis en statistieken\nMijn lijst, favorieten en andere verzamelingen",
    d_ticketsKept: "Je supporttickets bewaren we los van je account, zodat we lopende vragen kunnen afronden. Wil je dat we ook die verwijderen? Laat het ons weten via support.bingr.online.",
    d_ticketsDeleted: "Ook je supporttickets zijn verwijderd.",
    d_again: "Wil je Bingr later weer gebruiken? Je kunt altijd een nieuw account maken op bingr.online.",
    d_button: "Naar bingr.online", d_help: "Vragen? Neem contact op via support.bingr.online; daarvoor heb je geen account nodig.",
  },
  en: {
    label: "Account", eyebrow: "Your Bingr account", account: "Account",
    foot: "You're receiving this email because something changed on your Bingr account. This is a service message about your account, so you can't unsubscribe from it.",
    footDel: "You're receiving this email to confirm that your Bingr account has been deleted. This is a service message; you won't receive any more emails about this account.",
    contact: "Contact support", noLogin: "You can create a ticket without signing in.",
    b_subject: "Your Bingr account has been blocked", b_title: "Your Bingr account has been blocked",
    b_intro: "We've blocked your Bingr account. While the block lasts, you can't sign in to the Bingr apps or bingr.online. You've been signed out on all your devices.",
    b_reason: "Reason", b_until: "Blocked until", b_forever: "Until further notice", tz: "Amsterdam time",
    b_after: "After this date you can sign in again automatically.", b_afterForever: "The block stays in place until we lift it.",
    b_help: "Think this is a mistake, or have a question? Contact Bingr Support.",
    u_subject: "Your Bingr account is active again", u_title: "Your Bingr account is active again",
    u_intro: "The block on your Bingr account has been lifted. You can sign in to the Bingr apps and bingr.online again.",
    u_button: "Sign in on bingr.online", u_help: "Questions? Get in touch at support.bingr.online.",
    d_subject: "Your Bingr account has been deleted", d_title: "Your Bingr account has been deleted",
    d_intro: "Your Bingr account has been deleted. This can't be undone. You've been signed out on all your devices.",
    d_what: "What we deleted",
    d_items: "Your account and sign-in details\nYour profiles and profile pictures\nLinked devices and sessions\nYour settings, servers and playlists\nWatch history and statistics\nMy List, favorites and other collections",
    d_ticketsKept: "We keep your support tickets separately from your account so we can finish any open questions. Want us to delete those too? Let us know at support.bingr.online.",
    d_ticketsDeleted: "Your support tickets have been deleted as well.",
    d_again: "Want to use Bingr again later? You can always create a new account at bingr.online.",
    d_button: "Go to bingr.online", d_help: "Questions? Get in touch at support.bingr.online; you don't need an account for that.",
  },
};

const mailto = (email: string) => `<a href="mailto:${esc(email)}" style="color:#ffffff;text-decoration:none">${esc(email)}</a>`;
function bullets(lines: string[]) {
  return `<ul style="margin:12px 0 0;padding:0 0 0 20px;color:#d6d6d6;font-size:15px;line-height:23px">${
    lines.map((l) => `<li style="margin:0 0 4px">${esc(l)}</li>`).join("")}</ul>`;
}
function accountMail(lang: Lang, subject: string, heading: string, contentHtml: string, textLines: string[], footer: string): Mail {
  const t = ACC[lang];
  const html = layout({
    lang, docTitle: subject, preheader: heading, label: t.label,
    contentHtml: `\n${eyebrow(t.eyebrow)}\n${redBar("12px 0 20px")}\n${title(heading, "0 0 12px")}\n${contentHtml}`,
    footerHtml: footerHtml({ lang, reasonHtml: esc(footer) }),
  });
  const text = [`BINGR · ${t.label}`, "", heading, "", ...textLines, "", footerText({ lang, reason: footer })].join("\n");
  return { subject, html, text };
}

/** Blokkade: reden, einddatum (Nederlandse tijd, of onbepaald) en contact via een nieuw ticket. */
export function blockMail(lang: Lang, o: { email: string; reason: string; until: Date | string | null }): Mail {
  const t = ACC[lang];
  const until = o.until ? `${formatUntil(o.until, lang)} (${t.tz})` : t.b_forever;
  const after = o.until ? t.b_after : t.b_afterForever;
  const content = `${para(t.b_intro)}
${messageBox(t.b_reason, o.reason)}
${detailRows([[t.b_until, `<b>${esc(until)}</b>`], [t.account, mailto(o.email)]])}
${note(`${after} ${t.b_help}`)}
${button(NEW_TICKET_URL, t.contact)}
${note(t.noLogin)}
${copyLink(lang, NEW_TICKET_URL)}`;
  return accountMail(lang, t.b_subject, t.b_title, content, [
    t.b_intro, "", `${t.b_reason}:`, o.reason, "", `${t.b_until}: ${until}`, `${t.account}: ${o.email}`, "",
    `${after} ${t.b_help}`, `${t.contact}: ${NEW_TICKET_URL}`, t.noLogin,
  ], t.foot);
}

/** Blokkade opgeheven. */
export function unblockMail(lang: Lang, o: { email: string }): Mail {
  const t = ACC[lang];
  const url = `${SITE}/account/`;
  const content = `${para(t.u_intro)}
${detailRows([[t.account, mailto(o.email)]])}
${button(url, t.u_button)}
${note(t.u_help)}`;
  return accountMail(lang, t.u_subject, t.u_title, content, [t.u_intro, "", `${t.account}: ${o.email}`, "", `${t.u_button}: ${url}`, t.u_help], t.foot);
}

/** Account verwijderd: wat er weg is, wat er met supporttickets gebeurt, en dat een nieuw account altijd kan. */
export function deletedMail(lang: Lang, o: { email: string; ticketsDeleted: boolean }): Mail {
  const t = ACC[lang];
  const items = t.d_items.split("\n");
  const tickets = o.ticketsDeleted ? t.d_ticketsDeleted : t.d_ticketsKept;
  const content = `${para(t.d_intro)}
${detailRows([[t.account, mailto(o.email)]])}
<p style="margin:22px 0 0;font-size:15px;line-height:23px;color:#ffffff;font-weight:700">${esc(t.d_what)}</p>
${bullets(items)}
${note(tickets)}
${note(t.d_again)}
${button(SITE, t.d_button)}
${note(t.d_help)}`;
  return accountMail(lang, t.d_subject, t.d_title, content, [
    t.d_intro, "", `${t.account}: ${o.email}`, "", `${t.d_what}:`, ...items.map((i) => `- ${i}`), "", tickets, "", t.d_again,
    `${t.d_button}: ${SITE}`, t.d_help,
  ], t.footDel);
}
