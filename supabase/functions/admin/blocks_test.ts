// deno test supabase/functions/admin/blocks_test.ts
import { accountLang, banDuration, cleanReason, confirmMatches, formatUntil, INDEFINITE, parseUntil } from "./blocks.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const NOW = Date.parse("2026-10-14T10:00:00Z");

Deno.test("einddatum: onbepaald, geldig, te vroeg, te laat, onzin", () => {
  for (const v of [null, undefined, "", "onbepaald", "Indefinite"]) {
    const r = parseUntil(v, NOW);
    ok(r.ok && r.until === null, `onbepaald voor ${String(v)}`);
  }
  const r = parseUntil("2026-10-21T10:00:00Z", NOW);
  ok(r.ok && r.until?.toISOString() === "2026-10-21T10:00:00.000Z", "7 dagen");
  ok(!parseUntil("2026-10-14T10:00:30Z", NOW).ok, "minder dan een minuut");
  ok(!parseUntil("2026-10-13T10:00:00Z", NOW).ok, "verleden");
  ok(!parseUntil("2040-01-01T00:00:00Z", NOW).ok, "meer dan 10 jaar");
  ok(!parseUntil("morgen", NOW).ok, "geen datum");
});

Deno.test("ban_duration: seconden tot de einddatum, of 100 jaar", () => {
  ok(banDuration(null, NOW) === INDEFINITE && INDEFINITE === "876000h", "onbepaald");
  ok(banDuration(new Date(NOW + 864e5), NOW) === "86400s", "1 dag");
  ok(banDuration(new Date(NOW + 1500), NOW) === "60s", "minimaal 60 s");
  ok(banDuration(new Date(NOW + 86400_500), NOW) === "86401s", "naar boven afgerond");
});

Deno.test("datum in Nederlandse tijd, NL en EN", () => {
  // 14 okt 2026 10:00 UTC = 12:00 zomertijd; 1 dec = wintertijd (+1)
  const nl = formatUntil("2026-10-14T10:00:00Z", "nl");
  ok(nl.includes("woensdag") && nl.includes("14 oktober 2026") && nl.includes("12:00"), `nl: ${nl}`);
  const en = formatUntil(new Date("2026-12-01T10:00:00Z"), "en");
  ok(en.includes("Tuesday") && en.includes("1 December 2026") && en.includes("11:00"), `en: ${en}`);
});

Deno.test("reden, taal en bevestiging", () => {
  ok(cleanReason("  a\r\nb\n\n\n\nc  ") === "a\nb\n\nc", "reden opgeschoond");
  ok(cleanReason("x".repeat(2000)).length === 1000, "max 1000");
  ok(cleanReason(undefined) === "", "leeg");
  ok(accountLang("nl") === "nl" && accountLang(undefined) === "nl" && accountLang("") === "nl", "nl standaard");
  ok(accountLang("en") === "en" && accountLang("de") === "en", "andere talen: Engels");
  ok(confirmMatches(" Jan@Example.com ", "jan@example.com", "j***n@e***.com"), "volledig adres");
  ok(confirmMatches("j***n@e***.com", "jan@example.com", "j***n@e***.com"), "gemaskeerd adres");
  ok(!confirmMatches("jan@example.nl", "jan@example.com", "j***n@e***.com"), "ander adres");
  ok(!confirmMatches("", "", ""), "leeg");
});
