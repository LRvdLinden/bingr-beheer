// deno test supabase/functions/admin/mail_log_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { mailLogView, parseMailLog } from "./mail_log.ts";

Deno.test("parseMailLog: standaardwaarden", () => {
  assertEquals(parseMailLog({}), { limit: 200, status: "all", source: null, q: null });
  assertEquals(parseMailLog(undefined), { limit: 200, status: "all", source: null, q: null });
});
Deno.test("parseMailLog: filters en grenzen", () => {
  assertEquals(parseMailLog({ status: "failed", source: "support", limit: 50, q: " klant@example.com " }),
    { limit: 50, status: "failed", source: "support", q: "klant@example.com" });
  assertEquals(parseMailLog({ limit: 9999 }), { limit: 200, status: "all", source: null, q: null });
  assertEquals(parseMailLog({ status: "kapot" }), { error: "bad_status" });
  assertEquals(parseMailLog({ source: "a b;" }), { error: "bad_source" });
});
Deno.test("parseMailLog: de zoektekst kan geen filter breken", () => {
  const r = parseMailLog({ q: "a,b)%*(or=1" }) as { q: string };
  assertEquals(r.q, "abor1");
  assertEquals((parseMailLog({ q: ",,,%%%" }) as { q: string | null }).q, null);
});
Deno.test("mailLogView: vaste vorm en aantallen", () => {
  const v = mailLogView([{ id: 1, at: "2026-11-27T09:00:00Z", source: "support", to_addr: "a@b.nl", subject: "Hoi", ok: true, error: "" },
    { id: 2, at: "2026-11-27T09:01:00Z", source: "status", to_addr: "c@d.nl", subject: "x", ok: false, error: "smtp_550" }], { total: 2, failed: 1 }, ["support", "status"]);
  assertEquals(v.items.length, 2);
  assertEquals(v.items[1], { id: 2, at: "2026-11-27T09:01:00Z", source: "status", to: "c@d.nl", subject: "x", ok: false, error: "smtp_550" });
  assertEquals(v.totals, { total_7d: 2, failed_7d: 1 });
  assert(mailLogView(null, {}).items.length === 0);
});
