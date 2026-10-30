// Tests voor de kaart Versies (releases_get / releases_set):
//   deno test supabase/functions/admin/releases_test.ts
import { cleanBuild, cleanDate, cleanVersion, releasesInput, releasesView } from "./releases.ts";

function eq(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} verwacht ${y}, kreeg ${x}`);
}
const NOW = new Date("2026-10-30T12:00:00Z");

Deno.test("velden", () => {
  eq(cleanVersion("1.0.3"), "1.0.3");
  eq(cleanVersion("v1.0"), null);
  eq(cleanBuild("154"), 154);
  eq(cleanBuild(-1), null);
  eq(cleanDate("2026-10-30"), "2026-10-30");
  eq(cleanDate("2026-13-01"), null);
});

Deno.test("invoer: volledig, leeg en standaardlabel", () => {
  const r = releasesInput({
    apple: { live: { version: "1.0.2", build: "152", date: "2026-10-20" }, beta: { version: "1.0.3", build: 154, label: "TestFlight" } },
    android: { live: { version: "", build: "" }, beta: { version: "1.0.3", build: 154 } },
  }, NOW);
  eq(r, { value: {
    apple: { live: { version: "1.0.2", build: 152, date: "2026-10-20" }, beta: { version: "1.0.3", build: 154, label: "TestFlight" } },
    android: { live: null, beta: { version: "1.0.3", build: 154, label: "Beta" } },
    updatedAt: "2026-10-30T12:00:00.000Z",
  } });
  eq(releasesInput({}, NOW), { value: { apple: { live: null, beta: null }, android: { live: null, beta: null }, updatedAt: "2026-10-30T12:00:00.000Z" } });
});

Deno.test("invoer: half of ongeldig geeft een fout met het veld", () => {
  eq(releasesInput({ apple: { live: { version: "1.0.2" } } }, NOW), { error: "bad_releases", field: "apple.live" });
  eq(releasesInput({ android: { beta: { version: "1.0", build: 3, label: "Alpha" } } }, NOW), { error: "bad_releases", field: "android.beta" });
  eq(releasesInput({ apple: { beta: { version: "1.0", build: 3, date: "morgen" } } }, NOW), { error: "bad_releases", field: "apple.beta" });
  eq(releasesInput({ apple: "x" }, NOW), { error: "bad_releases", field: "apple" });
  eq(releasesInput(null, NOW), { error: "bad_releases", field: "releases" });
});

Deno.test("weergave negeert onbekende velden", () => {
  eq(releasesView({ apple: { live: { version: "1.0", build: 1, x: 1 } }, extra: 1 }), {
    apple: { live: { version: "1.0", build: 1 }, beta: null }, android: { live: null, beta: null }, updatedAt: null,
  });
});
