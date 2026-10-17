// deno test supabase/functions/admin/admin_push_test.ts
import {
  apnsHost, apnsJwt, apnsResult, b64u, cleanApnsToken, cleanDeviceId, cleanPrefs, cleanRegister, importApnsKey, pemToDer,
  summarizeSubscribers, testPayload,
} from "./admin_push.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const TOKEN = "a1".repeat(32);
const PREFS = { tickets: true, replies: true, builds: false, status: true };
const base = { device_id: "ABCDEF12-3456-4789-ABCD-0123456789AB", apns_token: TOKEN, platform: "ios", sandbox: true, app_build: 14, prefs: PREFS };
const err = (b: unknown) => { const r = cleanRegister(b); return r.ok ? null : r.error; };

Deno.test("admin_push: device_id 8–80 tekens [A-Za-z0-9_-]", () => {
  ok(cleanDeviceId("abcd1234") === "abcd1234", "8 tekens");
  ok(cleanDeviceId("a".repeat(80)) !== null, "80 tekens");
  ok(cleanDeviceId("a".repeat(81)) === null, "81 tekens");
  ok(cleanDeviceId("abc123") === null, "te kort");
  ok(cleanDeviceId("abcd 1234") === null, "spatie");
  ok(cleanDeviceId("abcd/1234") === null, "slash");
  ok(cleanDeviceId(12345678) === null, "geen tekst");
});

Deno.test("admin_push: APNs-token hex 64–200, kleine letters", () => {
  ok(cleanApnsToken("AB".repeat(32)) === "ab".repeat(32), "hoofdletters naar klein");
  ok(cleanApnsToken("a".repeat(63)) === null, "te kort");
  ok(cleanApnsToken("ab".repeat(100)) !== null, "200 tekens");
  ok(cleanApnsToken("ab".repeat(101)) === null, "te lang");
  ok(cleanApnsToken("g".repeat(64)) === null, "geen hex");
  ok(cleanApnsToken("a".repeat(65)) === null, "oneven lengte");
  ok(cleanApnsToken(null) === null, "leeg");
});

Deno.test("admin_push: prefs precies vier booleans", () => {
  ok(JSON.stringify(cleanPrefs(PREFS)) === JSON.stringify(PREFS), "geldig");
  ok(cleanPrefs({ tickets: true, replies: true, builds: true }) === null, "ontbreekt er een");
  ok(cleanPrefs({ ...PREFS, extra: true }) === null, "extra sleutel");
  ok(cleanPrefs({ ...PREFS, status: "ja" }) === null, "geen boolean");
  ok(cleanPrefs([true, true, true, true]) === null, "lijst");
});

Deno.test("admin_push: register controleert alles", () => {
  const r = cleanRegister(base);
  ok(r.ok && r.value.platform === "ios" && r.value.sandbox === true && r.value.app_build === 14, "geldig");
  ok(cleanRegister({ ...base, platform: "macos", sandbox: undefined, app_build: null }).ok, "sandbox en build optioneel");
  const m = cleanRegister({ ...base, sandbox: undefined });
  ok(m.ok && m.value.sandbox === false, "zonder sandbox = productie");
  ok(err({ ...base, device_id: "x" }) === "bad_device_id", "device_id");
  ok(err({ ...base, apns_token: "zz" }) === "bad_apns_token", "token");
  ok(err({ ...base, platform: "android" }) === "bad_platform", "android is geen Beheer-platform");
  ok(err({ ...base, platform: "tvos" }) === "bad_platform", "tvos");
  ok(err({ ...base, sandbox: "true" }) === "bad_sandbox", "sandbox als tekst");
  ok(err({ ...base, app_build: 1.5 }) === "bad_app_build", "build geen geheel getal");
  ok(err({ ...base, app_build: -1 }) === "bad_app_build", "build negatief");
  ok(err({ ...base, prefs: {} }) === "bad_prefs", "prefs leeg");
  ok(err(null) === "bad_device_id", "geen body");
});

async function pkcs8Pem(key: CryptoKey) {
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

Deno.test("admin_push: APNs-JWT (ES256) met kid, iss en iat, controleerbaar met de publieke sleutel", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pem = await pkcs8Pem(pair.privateKey);
  // ook met letterlijke \n (zoals uit een secret)
  for (const p of [pem, pem.replace(/\n/g, "\\n")]) {
    const key = await importApnsKey(p);
    const jwt = await apnsJwt(key, "KEY123ABCD", "EU3UY476T6", 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    ok(h && c && s && jwt.split(".").length === 3, "drie delen");
    const header = JSON.parse(new TextDecoder().decode(unb64u(h)));
    const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
    ok(header.alg === "ES256" && header.kid === "KEY123ABCD" && Object.keys(header).length === 2, "header");
    ok(claims.iss === "EU3UY476T6" && claims.iat === 1_700_000_000 && Object.keys(claims).length === 2, "claims");
    const sig = unb64u(s);
    ok(sig.length === 64, "handtekening r||s (64 bytes)");
    ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${c}`)), "handtekening klopt");
    ok(!/[=+/]/.test(jwt), "base64url zonder opvulling");
  }
});

Deno.test("admin_push: PEM-fouten", async () => {
  let threw = false;
  try { pemToDer("-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----"); } catch { threw = true; }
  ok(threw, "lege sleutel");
  threw = false;
  try { await importApnsKey("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"); } catch { threw = true; }
  ok(threw, "geen geldige sleutel");
  ok(b64u(new Uint8Array([251, 255])) === "-_8", "base64url");
});

Deno.test("admin_push: host, payload en uitkomst", () => {
  ok(apnsHost(true) === "https://api.sandbox.push.apple.com" && apnsHost(false) === "https://api.push.apple.com", "hosts");
  const p = testPayload();
  ok(p.aps.alert.title && p.aps.alert.body && p.aps["thread-id"] === "test" && p.url.startsWith("bingrbeheer://"), "payload");
  ok(JSON.stringify(p).length < 4096, "past in APNs");
  ok(apnsResult(200, "").ok, "200");
  const gone = apnsResult(410, "Unregistered");
  ok(!gone.ok && gone.invalid && gone.error === "apns_Unregistered", "410 = ongeldig");
  const bad = apnsResult(400, "BadDeviceToken");
  ok(!bad.ok && bad.invalid, "BadDeviceToken = ongeldig");
  const topic = apnsResult(400, "DeviceTokenNotForTopic");
  ok(!topic.ok && topic.invalid, "ander topic = ongeldig");
  const auth = apnsResult(403, "InvalidProviderToken");
  ok(!auth.ok && !auth.invalid && auth.error === "apns_InvalidProviderToken", "403 geen ongeldig token");
  const weird = apnsResult(500, "<script>");
  ok(!weird.ok && weird.error === "apns_500", "rare reden niet doorgeven");
});

Deno.test("admin_push: pushabonnees tellen (alleen aantallen)", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const old = "2026-09-01T00:00:00Z", fresh = "2026-10-15T00:00:00Z";
  const rows = [
    { user_id: "u1", platform: "ios", created_at: old },
    { user_id: "u1", platform: "macos", created_at: fresh },
    { user_id: "u2", platform: "android", created_at: fresh },
    { user_id: "u3", platform: "web", created_at: fresh },
    { user_id: "u3", platform: "ipados", created_at: old },
    { user_id: "u4", platform: "tvos", created_at: fresh },
    { user_id: "", platform: "ios", created_at: fresh },
    null,
  ];
  const s = summarizeSubscribers(rows, now);
  ok(s.devices === 5 && s.accounts === 3, "apparaten en unieke accounts");
  ok(s.by_platform.ios === 1 && s.by_platform.ipados === 1 && s.by_platform.macos === 1 && s.by_platform.android === 1 && s.by_platform.web === 1, "per platform");
  ok(!("tvos" in s.by_platform), "tvos telt niet");
  ok(s.new_7d.devices === 3, "nieuwe apparaten");
  ok(s.new_7d.accounts === 1, "nieuw account: alleen u2 (u1 en u3 hadden al een apparaat)");
  ok(!JSON.stringify(s).includes("u1"), "geen account-id's");
  const empty = summarizeSubscribers([], now);
  ok(empty.devices === 0 && empty.accounts === 0 && empty.by_platform.web === 0, "leeg");
});
