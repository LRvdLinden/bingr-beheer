import { assertEquals } from "jsr:@std/assert@1";
import { accessFilter, accessTotals, accessView } from "./access.ts";

Deno.test("filter: alleen bekende codes", () => {
  assertEquals(accessFilter("access:monthly"), "access:monthly");
  assertEquals(accessFilter("access:subscription"), "access:subscription");
  assertEquals(accessFilter("access:half_year"), "access:half_year");
  assertEquals(accessFilter("access:weekly"), null);
  assertEquals(accessFilter("access:"), null);
  assertEquals(accessFilter("lifetime"), null);
  assertEquals(accessFilter("access:free'; drop table x"), null);
  assertEquals(accessFilter(undefined), null);
});

Deno.test("view: bekende waarden gaan door", () => {
  assertEquals(accessView({ access: "yearly", access_trial: true, access_provider: "apple", access_until: "2027-01-01T00:00:00Z", access_test: true }),
    { access: "yearly", access_trial: true, access_provider: "apple", access_until: "2027-01-01T00:00:00Z", access_test: true, access_extra: null });
  assertEquals(accessView({ access: "legacy_lifetime", access_extra: "monthly" }).access_extra, "monthly");
});

Deno.test("view: een oudere server of rommel wordt unknown, geen fout", () => {
  assertEquals(accessView({}).access, "unknown");
  assertEquals(accessView(null).access, "unknown");
  assertEquals(accessView(undefined).access_trial, false);
  assertEquals(accessView({ access: "platinum", access_provider: "paypal", access_until: "morgen", access_extra: "free" }),
    { access: "unknown", access_trial: false, access_provider: null, access_until: null, access_test: false, access_extra: null });
  assertEquals(accessView({ access: 5, access_trial: "true" }).access, "unknown");
});

Deno.test("totalen: alleen bekende soorten met geldige aantallen", () => {
  assertEquals(accessTotals({ free: 10, monthly: 2, onzin: 5, yearly: -1, lifetime: "3" }), { free: 10, monthly: 2 });
  assertEquals(accessTotals(undefined), null);
  assertEquals(accessTotals([1]), null);
  assertEquals(accessTotals({}), {});
});
