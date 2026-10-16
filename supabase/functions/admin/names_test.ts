// deno test supabase/functions/admin/names_test.ts
import { cleanName, greetingName, NAME_MAX } from "./names.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };

Deno.test("naam: opschonen, leeg = verwijderen", () => {
  const a = cleanName("  Jan   Willem ");
  ok(a.ok && a.value === "Jan Willem", "spaties");
  const b = cleanName("");
  ok(b.ok && b.value === null, "leeg = null");
  const c = cleanName(null);
  ok(c.ok && c.value === null, "null = null");
  const d = cleanName("   ");
  ok(d.ok && d.value === null, "alleen spaties = null");
  const e = cleanName("D'Angelo-van der Berg");
  ok(e.ok && e.value === "D'Angelo-van der Berg", "apostrof en streepje");
  const f = cleanName("Zoë");
  ok(f.ok && f.value === "Zoë", "accenten");
});

Deno.test("naam: fouten", () => {
  const no = (v: unknown, code: string) => { const r = cleanName(v); ok(!r.ok && r.error === code, `${JSON.stringify(v)} -> ${code}`); };
  no(42, "bad_name");
  no({}, "bad_name");
  no("Jan\nJansen", "bad_name");
  no("Jan\u0000", "bad_name");
  no("<b>Jan</b>", "bad_name");
  no("Jan\u202eJansen", "bad_name");
  no("x".repeat(NAME_MAX + 1), "name_too_long");
  const max = cleanName("x".repeat(NAME_MAX));
  ok(max.ok && max.value?.length === NAME_MAX, "precies de maximale lengte mag");
});

Deno.test("aanhef: alleen bruikbare voornaam", () => {
  ok(greetingName(" Jan ") === "Jan", "trim");
  ok(greetingName("") === null && greetingName(undefined) === null && greetingName(3) === null, "leeg of geen tekst");
  ok(greetingName("<script>") === null, "ongeldige tekens: geen aanhef");
  ok(greetingName("Jan\nPiet") === "Jan Piet", "regeleinde wordt spatie");
  ok([...greetingName("y".repeat(80))!].length === NAME_MAX, "afgekapt");
});

Deno.test("naam: geen links of e-mailadressen (zoals de databasetrigger)", () => {
  for (const x of ["https://x.nl", "www.voorbeeld.nl", "a@b"]) {
    if (cleanName(x).ok) throw new Error("niet geweigerd: " + x);
  }
  if (!cleanName("Jan de Vries").ok) throw new Error("gewone naam geweigerd");
});
