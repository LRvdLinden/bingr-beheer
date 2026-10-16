// deno test supabase/functions/admin/push_test.ts
import {
  ACCOUNTS_MAX, auditDetail, BODY_MAX, cleanBody, cleanLink, cleanPushInput, cleanTarget, cleanTitle, counts, historyView,
  pageInput, progressView, summarizeTarget, TITLE_MAX,
} from "./push.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const A = "11111111-2222-4333-8444-555555555555", B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const base = { title_nl: "Nieuw in Bingr", body_nl: "Kijk wat er nieuw is.", target: { all: true } };
const err = (b: unknown) => { const r = cleanPushInput(b); return r.ok ? null : r.error; };

Deno.test("push: geldige invoer, EN optioneel", () => {
  const r = cleanPushInput(base);
  ok(r.ok && r.value.title_en === null && r.value.body_en === null && r.value.url === null, "alleen NL");
  ok(r.ok && "all" in r.value.target, "alle gebruikers");
  const e = cleanPushInput({ ...base, title_en: " New ", body_en: "Look.", url: "https://bingr.online/changelog/" });
  ok(e.ok && e.value.title_en === "New" && e.value.body_en === "Look." && e.value.url === "https://bingr.online/changelog/", "met EN en link");
});

Deno.test("push: teksten verplicht en begrensd", () => {
  ok(err({ ...base, title_nl: " " }) === "text_missing", "titel leeg");
  ok(err({ ...base, body_nl: "" }) === "text_missing", "tekst leeg");
  ok(err({ ...base, title_nl: 5 }) === "text_missing", "geen tekst");
  ok(err({ ...base, title_en: "Only title" }) === "en_incomplete", "EN half");
  ok(err({ ...base, body_en: "Only body" }) === "en_incomplete", "EN half (tekst)");
  ok(err({ ...base, title_nl: "x".repeat(TITLE_MAX + 1) }) === "title_too_long", "titel te lang");
  ok(err({ ...base, body_nl: "x".repeat(BODY_MAX + 1) }) === "body_too_long", "tekst te lang");
  ok(cleanPushInput({ ...base, title_nl: "x".repeat(TITLE_MAX) }).ok, "precies max mag");
  ok(err({ ...base, body_nl: "😀".repeat(BODY_MAX) }) === "text_too_large", "te veel bytes voor de payload");
});

Deno.test("push: tekst opschonen", () => {
  ok(cleanTitle(" Een\ntitel​  hier ") === "Een titel hier", "titel één regel");
  ok(cleanBody("a\r\n\r\n\r\n\r\nb  c\u0000") === "a\n\nb c", "tekst: regels en stuurtekens");
  ok(cleanBody(undefined) === "" && cleanTitle(null) === "", "geen tekst");
});

Deno.test("push: link alleen https met echte hostnaam", () => {
  ok(cleanLink(undefined) === null && cleanLink("") === null && cleanLink("  ") === null, "leeg = geen link");
  ok(cleanLink("https://bingr.online/x?y=1#z") === "https://bingr.online/x?y=1#z", "https");
  for (const bad of ["http://bingr.online/", "javascript:alert(1)", "bingr://live", "https://user:pw@bingr.online/", "https://localhost/",
    "https://127.0.0.1/", "https://[::1]/", "https://intranet/", "https://bingr.online:8443/", "https://a b.nl/", 42, "https://x.local/",
    "https://bingr.online/" + "a".repeat(500)]) {
    ok(cleanLink(bad) === undefined, `geweigerd: ${String(bad).slice(0, 40)}`);
  }
  ok(err({ ...base, url: "http://bingr.online" }) === "bad_link", "push_send weigert http");
});

Deno.test("push: doelgroep", () => {
  ok(err({ ...base, target: undefined }) === "bad_target", "geen doelgroep");
  ok(err({ ...base, target: { all: false } }) === "bad_target", "all moet true zijn");
  ok(err({ ...base, target: { all: true, platforms: ["ios"] } }) === "bad_target", "twee soorten tegelijk");
  ok(err({ ...base, target: [] }) === "bad_target", "lijst");
  ok(err({ ...base, target: { accounts: [] } }) === "no_accounts", "lege accountlijst");
  ok(err({ ...base, target: { accounts: ["x"] } }) === "bad_account", "geen uuid");
  const big = Array.from({ length: ACCOUNTS_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  ok(err({ ...base, target: { accounts: big } }) === "too_many_accounts", "te veel accounts");
  const acc = cleanTarget({ accounts: [A, A.toUpperCase(), B] });
  ok(acc.ok && "accounts" in acc.value && acc.value.accounts.length === 2 && acc.value.accounts[0] === A, "ontdubbeld, kleine letters");
  ok(err({ ...base, target: { platforms: [] } }) === "no_platforms", "geen platforms");
  ok(err({ ...base, target: { platforms: ["tvos"] } }) === "no_push_platform", "tvOS heeft geen systeem-push");
  ok(err({ ...base, target: { platforms: ["ios", "androidtv"] } }) === "no_push_platform", "Android TV heeft geen systeem-push");
  ok(err({ ...base, target: { platforms: ["tizen"] } }) === "no_push_platform", "Samsung TV heeft geen systeem-push");
  ok(err({ ...base, target: { platforms: ["windows"] } }) === "bad_platform", "onbekend platform");
  const pl = cleanTarget({ platforms: ["web", "ipados", "ios", "web"] });
  ok(pl.ok && "platforms" in pl.value && pl.value.platforms.join() === "ios,ipados,web", "vaste volgorde, ontdubbeld");
});

Deno.test("push: logboek zonder inhoud of ontvangers", () => {
  const r = cleanPushInput({ ...base, title_en: "T", body_en: "B", url: "https://bingr.online/", target: { accounts: [A, B] } });
  if (!r.ok) throw new Error("invoer");
  const d = auditDetail(r.value, { message_id: "m1", devices: 7 });
  const s = JSON.stringify(d);
  ok(!s.includes(A) && !s.includes(B), "geen account-id's");
  ok(!s.includes("Nieuw in Bingr") && !s.includes("Kijk") && !s.includes("bingr.online"), "geen tekst of link");
  ok(d.devices === 7 && d.url === true && d.en === true && d.target.type === "accounts" && (d.target as { count: number }).count === 2, "wel soort en aantallen");
});

Deno.test("push: antwoorden van push normaliseren", () => {
  const c = counts({ counts: { queued: 3, sent: 10, failed: 1, invalid: 2 } });
  ok(c.queued === 3 && c.sent === 10 && c.failed === 1 && c.invalid === 2, "geneste tellers");
  const f = counts({ queued: -1, sent: "5" });
  ok(f.queued === 0 && f.sent === 0, "ongeldige tellers = 0");
  const p = progressView({ message_id: "m1", devices: 16, queued: 0, sent: 14, failed: 1, invalid: 1 });
  ok(p.done && p.devices === 16 && p.message_id === "m1", "klaar zonder wachtrij");
  ok(!progressView({ queued: 4, sent: 1 }).done, "nog in de wachtrij");
  ok(progressView({ queued: 0, done: false }).done === false, "done van de server wint");
  ok(progressView({ notes: ["apns_not_configured", "<script>"] }).notes.join() === "apns_not_configured", "alleen korte codes");
  const h = historyView({ items: [
    { id: "m1", kind: "admin", created_at: "2026-10-16T10:00:00Z", title_nl: "Hoi", target: { accounts: [A, B] }, counts: { sent: 2 } },
    { id: "m2", kind: "release", platform_group: "apple", version: "1.0.0", build: 105, sent: 40, queued: 0 },
    { id: "m3", kind: "iets", target: { platforms: ["ios", "<x>"] } },
  ], has_more: true }, 0);
  ok(h.items.length === 3 && h.has_more && h.page === 0, "lijst");
  ok(!JSON.stringify(h).includes(A), "geen account-id's in de geschiedenis");
  ok(h.items[0].target.type === "accounts" && (h.items[0].target as { count: number }).count === 2, "aantal accounts");
  ok(h.items[1].kind === "release" && h.items[1].build === 105 && h.items[1].platform_group === "apple", "releasemelding");
  ok(h.items[2].kind === "admin" && (h.items[2].target as { platforms: string[] }).platforms.join() === "ios", "onbekende soort en platform weg");
  ok(historyView(null, 2).items.length === 0 && historyView({ items: [], total: 30, page_size: 20 }, 0).has_more, "leeg / has_more uit totaal");
  ok(summarizeTarget({ all: true }).type === "all" && summarizeTarget("x").type === "unknown", "doelgroep");
  ok(pageInput(3) === 3 && pageInput(-1) === 0 && pageInput("2") === 2 && pageInput(1.5) === 0 && pageInput(5000) === 0, "pagina");
});
