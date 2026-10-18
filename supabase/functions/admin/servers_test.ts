// deno test supabase/functions/admin/servers_test.ts
import { isXtream, serverOrigin, serversFromRow, unsealSources, xtreamServers } from "./servers.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

Deno.test("adres: inloggegevens, pad en query gaan eruit", () => {
  eq(serverOrigin("http://user:pass@host.example:8080/get.php?username=u&password=p&type=m3u_plus"), "http://host.example:8080", "volledige m3u-link");
  eq(serverOrigin("http://Line.Example.COM:8080/"), "http://line.example.com:8080", "kleine letters");
  eq(serverOrigin("https://line.example.com/player_api.php?username=a&password=b#x"), "https://line.example.com", "https zonder poort");
  eq(serverOrigin("line.example.com:25461"), "http://line.example.com:25461", "zonder schema = http");
  eq(serverOrigin("  user:geheim@line.example.com:2095/live/u/p/1.ts "), "http://line.example.com:2095", "zonder schema met userinfo");
  eq(serverOrigin("http://203.0.113.7:8000"), "http://203.0.113.7:8000", "IPv4");
  eq(serverOrigin("http://[2001:db8::1]:8080/x"), "http://[2001:db8::1]:8080", "IPv6");
  eq(serverOrigin("http://line.example.com.:8080"), "http://line.example.com:8080", "punt aan het eind");
});

Deno.test("adres: standaardpoorten weg", () => {
  eq(serverOrigin("http://line.example.com:80/get.php"), "http://line.example.com", "80 bij http");
  eq(serverOrigin("https://line.example.com:443"), "https://line.example.com", "443 bij https");
  eq(serverOrigin("https://line.example.com:80"), "https://line.example.com:80", "80 bij https blijft");
  eq(serverOrigin("http://line.example.com:443"), "http://line.example.com:443", "443 bij http blijft");
});

Deno.test("adres: ongeldig = null", () => {
  for (const v of ["", "   ", null, undefined, 42, {}, "ftp://line.example.com", "javascript:alert(1)", "data:text/html,x", "http://", "http://:8080"]) {
    eq(serverOrigin(v), null, `ongeldig: ${String(v)}`);
  }
});

Deno.test("adres: geen gebruikersnaam of wachtwoord in de uitkomst", () => {
  const r = serverOrigin("http://klant123:Wachtw00rd@line.example.com:8080/get.php?username=klant123&password=Wachtw00rd&token=abc") ?? "";
  for (const bad of ["klant123", "Wachtw00rd", "token", "abc", "get.php", "?", "@"]) ok(!r.includes(bad), `lekt ${bad}`);
});

Deno.test("soort: alleen Xtream", () => {
  ok(isXtream("Xtream Codes") && isXtream(" xtream codes"), "xtream");
  for (const k of ["M3U / M3U8", "Stalker / MAC-portal", "Plex", "Jellyfin", "Emby", "Stremio", "", null]) ok(!isXtream(k), `geen xtream: ${k}`);
});

const payload = {
  mainSourceID: "BBBBBBBB-0000-0000-0000-000000000002",
  sources: [
    { id: "AAAAAAAA-0000-0000-0000-000000000001", name: "  Thuis \n server ", kind: "Xtream Codes", serverURL: "http://Line.Example.com:8080/",
      username: "klant", secrets: { password: "geheim" }, m3uURL: "", epgURL: "http://epg.example.com/xmltv.php?username=klant&password=geheim" },
    { id: "bbbbbbbb-0000-0000-0000-000000000002", name: "Reserve", kind: "Xtream Codes", serverURL: "",
      m3uURL: "https://user:pass@backup.example.net:443/get.php?username=user&password=pass" },
    { id: "C3", name: "Afspeellijst", kind: "M3U / M3U8", m3uURL: "http://m3u.example.org/list.m3u" },
    { id: "D4", name: "Weg", kind: "Xtream Codes", serverURL: "http://old.example.com", deleted: true, deletedAt: "2026-10-01T00:00:00Z" },
    { id: "E5", name: "", kind: "Xtream Codes", serverURL: "geen adres hier" },
    { id: "F6", kind: "Xtream Codes", serverURL: "http://noname.example.com:2082" },
    { id: "G7", name: "Plex", kind: "Plex", serverURL: "http://plex.example.com:32400", secrets: { token: "t" } },
  ],
};

Deno.test("servers: alleen niet-verwijderde Xtream-bronnen, actieve bovenaan, alleen toegestane velden", () => {
  const r = xtreamServers(payload);
  eq(r, [
    { host: "https://backup.example.net", name: "Reserve", active: true, deleted: false },
    { host: "http://line.example.com:8080", name: "Thuis server", active: false, deleted: false },
    { host: "http://noname.example.com:2082", active: false, deleted: false },
  ], "lijst");
  for (const s of r) for (const k of Object.keys(s)) ok(["host", "name", "active", "deleted"].includes(k), `extra veld ${k}`);
  const txt = JSON.stringify(r);
  for (const bad of ["klant", "geheim", "pass", "epg", "m3u.example", "old.example", "plex"]) ok(!txt.includes(bad), `lekt ${bad}`);
});

Deno.test("servers: lege of rare invoer", () => {
  eq(xtreamServers(null), [], "null");
  eq(xtreamServers({}), [], "leeg");
  eq(xtreamServers({ sources: "x" }), [], "geen lijst");
  eq(xtreamServers({ sources: [null, 1, "x"] }), [], "rommel");
  eq(xtreamServers({ sources: [{ id: "a", kind: "Xtream Codes", serverURL: "http://a.example" }] }),
    [{ host: "http://a.example", active: false, deleted: false }], "geen mainSourceID");
});

async function sealFor(obj: unknown, key64: string): Promise<string> {
  const raw = Uint8Array.from(atob(key64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return btoa(String.fromCharCode(...out));
}
const randKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

Deno.test("ontsleutelen: zelfde formaat als device-auth (nonce || AES-GCM)", async () => {
  const key = randKey();
  const row = await sealFor(payload, key);
  const o = await unsealSources(row, key);
  eq(o.mainSourceID, payload.mainSourceID, "rondgang");
  eq((await serversFromRow(row, key))?.length, 3, "drie servers");
});

Deno.test("ontsleutelen: geen rij = [], geen of verkeerde sleutel of rommel = null", async () => {
  const key = randKey();
  const row = await sealFor(payload, key);
  eq(await serversFromRow(null, key), [], "geen rij");
  eq(await serversFromRow(row, ""), null, "geen sleutel");
  eq(await serversFromRow(row, randKey()), null, "andere sleutel");
  eq(await serversFromRow("bm9wZQ==", key), null, "te kort");
  eq(await serversFromRow("!!!", key), null, "geen base64");
  eq(await serversFromRow(row, btoa("kort")), null, "sleutel niet 32 bytes");
  eq((await serversFromRow(row, key))?.length, 3, "daarna weer goed");
});
