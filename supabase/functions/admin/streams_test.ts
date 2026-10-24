// deno test supabase/functions/admin/streams_test.ts — Kijkt nu (zonder netwerk of database)
import { openField, streamsView } from "./streams.ts";
function eq(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} verwacht ${y}, kreeg ${x}`);
}
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
async function seal(s: string) {
  const k = await crypto.subtle.importKey("raw", Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(s)));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  return "enc1:" + btoa(String.fromCharCode(...all));
}
const mask = (e: unknown) => `m(${String(e).length})`;

Deno.test("velden: versleuteld (enc1:) ontsleutelen, leesbaar ongewijzigd, kapot = null", async () => {
  eq(await openField(await seal("NPO 1 · Journaal"), KEY), "NPO 1 · Journaal");
  eq(await openField("Oude titel", KEY), "Oude titel");
  eq(await openField("enc1:kapot", KEY), null);
  eq(await openField(await seal("x"), ""), null, "zonder sleutel nooit de versleutelde tekst");
  eq(await openField(null, KEY), null);
});

Deno.test("lijst: e-mail gemaskeerd, naam, land, soort en tellingen", async () => {
  const rows = [
    { user_id: "u1", email: "jan@example.com", first_name: "Jan", last_name: " de Vries ", plan: "lifetime", country: "NL", device_name: "Edge op Windows",
      platform: "windows", platform_group: "windows", profile_name: await seal("Jan"), title: await seal("Dune"), kind: "movie", started_at: "2026-10-24T09:00:00Z" },
    { user_id: "u1", email: "jan@example.com", platform: "Apple TV", platform_group: "tvos", title: "NPO 1\u0007", kind: "live", device_country: "BE" },
    { user_id: "u2", email: "x@y.z", kind: "iets", platform_group: "<b>" },
    "geen object",
  ];
  const r = await streamsView(rows, mask, KEY);
  eq([r.total, r.accounts], [3, 2]);
  eq(r.items[0].email, "m(15)");
  eq([r.items[0].name, r.items[0].plan, r.items[0].country, r.items[0].title, r.items[0].profile_name], ["Jan de Vries", "lifetime", "NL", "Dune", "Jan"]);
  eq([r.items[1].title, r.items[1].country, r.items[1].plan], ["NPO 1", "BE", "free"]);
  eq([r.items[2].kind, r.items[2].platform_group], [null, "other"]);
  eq(r.by_kind, { movie: 1, live: 1, other: 1 });
  eq(r.by_platform, { windows: 1, tvos: 1, other: 1 });
});
