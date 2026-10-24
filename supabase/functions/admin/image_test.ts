// deno test supabase/functions/admin/image_test.ts
// Afbeelding van een eigen mailing: controle van de URL (content-type, inhoud, grootte, doorverwijzingen, SSRF) en het
// uploaden (base64, soort, grootte, objectnaam). Alles met een neppe fetch en DNS: er gaat niets over het netwerk.
import {
  checkImageUrl, cleanUpload, fetchableUrl, IMAGE_MAX, isOwnAsset, isPrivateIp, mediaType, objectName, publicUrl, shareService, sniff,
} from "./image.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m}: verwacht ${y}, kreeg ${x}`);
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
const WEBP = new TextEncoder().encode("RIFF\x10\x00\x00\x00WEBPVP8 ");
const SVG = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const HTML = new TextEncoder().encode("\n  <!DOCTYPE html><html><head><title>Delen</title></head></html>");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

type Route = { status?: number; type?: string; body?: Uint8Array; location?: string; length?: string; throws?: string };
function deps(routes: Record<string, Route>, dns: Record<string, string[]> = {}) {
  const seen: string[] = [];
  return {
    seen,
    d: {
      resolve: async (h: string) => dns[h] ?? ["93.184.216.34"],
      fetch: async (url: string, init: RequestInit) => {
        seen.push(url);
        eq(init.redirect, "manual", "doorverwijzingen zelf volgen");
        const r = routes[url];
        if (!r) throw new TypeError("connect failed");
        if (r.throws) throw Object.assign(new Error("x"), { name: r.throws });
        const h = new Headers();
        if (r.type) h.set("content-type", r.type);
        if (r.location) h.set("location", r.location);
        if (r.length) h.set("content-length", r.length);
        return new Response((r.body ?? null) as BodyInit | null, { status: r.status ?? 200, headers: h });
      },
    },
  };
}

Deno.test("afbeelding: soort op de inhoud en content-type", () => {
  eq([sniff(PNG), sniff(JPG), sniff(GIF), sniff(WEBP), sniff(SVG), sniff(HTML), sniff(new Uint8Array([1, 2, 3]))],
    ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "text/html", null], "sniff");
  eq(sniff(new TextEncoder().encode("<svg viewBox='0 0 1 1'/>")), "image/svg+xml", "svg zonder xml-kop");
  eq([mediaType("image/PNG; charset=binary"), mediaType("image/jpg"), mediaType(null)], ["image/png", "image/jpeg", ""], "mediaType");
});

Deno.test("afbeelding: SSRF, interne en private adressen geblokkeerd", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1", "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "2002:a00:1::1", "2001::1", "niet-een-ip"]) {
    ok(isPrivateIp(ip), `${ip} moet geblokkeerd zijn`);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "2a00:1450:4001::200e", "::ffff:8.8.8.8"]) {
    ok(!isPrivateIp(ip), `${ip} is openbaar`);
  }
  for (const u of ["http://example.com/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://localhost/a.png",
    "https://intranet/a.png", "https://nas.local/a.png", "https://db.internal/a.png", "https://example.com:8443/a.png",
    "https://user:pw@example.com/a.png", "https://2130706433/a.png", "https://router.home.arpa/x.png", "geen url"]) {
    eq(fetchableUrl(u), null, `${u} niet ophalen`);
  }
  ok(fetchableUrl("https://example.com:443/a.png"), "poort 443 mag");
});

Deno.test("afbeelding: geldige PNG, JPEG en GIF", async () => {
  for (const [body, type] of [[PNG, "image/png"], [JPG, "image/jpeg"], [GIF, "image/gif"], [JPG, "image/jpg"]] as const) {
    const { d } = deps({ "https://cdn.example.com/x": { type, body } });
    const r = await checkImageUrl("https://cdn.example.com/x", d);
    ok(r.ok, `${type} geldig`);
    if (r.ok) eq(r.size, body.length, "grootte");
  }
});

Deno.test("afbeelding: SVG, WebP, webpagina en verkeerd type geweigerd", async () => {
  const cases: [Route, string][] = [
    [{ type: "image/svg+xml", body: SVG }, "image_svg"],
    [{ type: "image/webp", body: WEBP }, "image_webp"],
    [{ type: "image/png", body: SVG }, "image_svg"], // header liegt: inhoud telt
    [{ type: "image/png", body: WEBP }, "image_webp"],
    [{ type: "text/html; charset=utf-8", body: HTML }, "image_page"],
    [{ type: "image/jpeg", body: HTML }, "image_page"],
    [{ type: "application/octet-stream", body: PNG }, "image_type"],
    [{ body: PNG }, "image_type"],
    [{ type: "image/png", body: new Uint8Array([1, 2, 3, 4]) }, "image_type"],
    [{ type: "image/png", body: new Uint8Array() }, "image_empty"],
  ];
  for (const [route, error] of cases) {
    const { d } = deps({ "https://cdn.example.com/x": route });
    eq(await checkImageUrl("https://cdn.example.com/x", d), { ok: false, error }, `${route.type ?? "geen type"} -> ${error}`);
  }
});

Deno.test("afbeelding: deellink (Drive, iCloud, Dropbox) en inlog herkend", async () => {
  const { d } = deps({ "https://drive.google.com/file/d/abc/view": { type: "text/html", body: HTML } });
  eq(await checkImageUrl("https://drive.google.com/file/d/abc/view", d), { ok: false, error: "image_share_link", service: "Google" }, "drive");
  const { d: d2 } = deps({ "https://www.icloud.com/photos/#abc": { status: 200, type: "text/html", body: HTML } });
  eq(await checkImageUrl("https://www.icloud.com/photos/#abc", d2), { ok: false, error: "image_share_link", service: "iCloud" }, "icloud");
  const { d: d3 } = deps({ "https://cdn.example.com/p.png": { status: 403, type: "text/html" } });
  eq(await checkImageUrl("https://cdn.example.com/p.png", d3), { ok: false, error: "image_login" }, "403 = achter een inlog");
  const { d: d4 } = deps({ "https://cdn.example.com/p.png": { status: 404, type: "text/html" } });
  eq(await checkImageUrl("https://cdn.example.com/p.png", d4), { ok: false, error: "image_http" }, "404");
  eq([shareService("www.dropbox.com"), shareService("1drv.ms"), shareService("example.com")], ["Dropbox", "OneDrive", null], "diensten");
});

Deno.test("afbeelding: grootte begrensd (header en werkelijke inhoud)", async () => {
  const big = new Uint8Array(IMAGE_MAX + 1); big.set(PNG);
  const { d } = deps({ "https://cdn.example.com/a": { type: "image/png", body: big } });
  eq(await checkImageUrl("https://cdn.example.com/a", d), { ok: false, error: "image_too_large" }, "inhoud te groot");
  const { d: d2 } = deps({ "https://cdn.example.com/b": { type: "image/png", body: PNG, length: String(IMAGE_MAX + 10) } });
  eq(await checkImageUrl("https://cdn.example.com/b", d2), { ok: false, error: "image_too_large" }, "content-length te groot");
  const exact = new Uint8Array(IMAGE_MAX); exact.set(PNG);
  const { d: d3 } = deps({ "https://cdn.example.com/c": { type: "image/png", body: exact } });
  ok((await checkImageUrl("https://cdn.example.com/c", d3)).ok, "precies 2 MB mag");
});

Deno.test("afbeelding: DNS naar een privé-adres en doorverwijzingen", async () => {
  const { d, seen } = deps({ "https://evil.example.com/a.png": { type: "image/png", body: PNG } }, { "evil.example.com": ["93.184.216.34", "10.0.0.5"] });
  eq(await checkImageUrl("https://evil.example.com/a.png", d), { ok: false, error: "image_blocked_host" }, "één privé-adres is genoeg");
  eq(seen.length, 0, "niets opgehaald");
  const { d: d1 } = deps({}, { "meta.example.com": ["169.254.169.254"] });
  eq(await checkImageUrl("https://meta.example.com/latest", d1), { ok: false, error: "image_blocked_host" }, "metadata-adres");
  const { d: d0 } = deps({}, { "nx.example.com": [] });
  eq(await checkImageUrl("https://nx.example.com/a.png", d0), { ok: false, error: "image_unreachable" }, "host bestaat niet");

  // doorverwijzing naar een interne host of http: geblokkeerd
  for (const loc of ["http://cdn.example.com/a.png", "https://127.0.0.1/a.png", "https://localhost/a.png"]) {
    const { d: dr } = deps({ "https://short.example.com/x": { status: 302, location: loc } });
    eq(await checkImageUrl("https://short.example.com/x", dr), { ok: false, error: "image_blocked_host" }, `redirect ${loc}`);
  }
  // doorverwijzing naar een host die naar een privé-adres wijst
  const { d: dp } = deps({ "https://short.example.com/x": { status: 301, location: "https://inside.example.com/a.png" } }, { "inside.example.com": ["192.168.0.10"] });
  eq(await checkImageUrl("https://short.example.com/x", dp), { ok: false, error: "image_blocked_host" }, "redirect naar privé-DNS");
  // relatieve doorverwijzing werkt, en hoogstens 3
  const { d: dok } = deps({
    "https://cdn.example.com/a": { status: 302, location: "/b" },
    "https://cdn.example.com/b": { status: 307, location: "https://img.example.com/c.gif" },
    "https://img.example.com/c.gif": { type: "image/gif", body: GIF },
  });
  ok((await checkImageUrl("https://cdn.example.com/a", dok)).ok, "twee doorverwijzingen");
  const loop: Record<string, Route> = {};
  for (let i = 0; i < 6; i++) loop[`https://cdn.example.com/${i}`] = { status: 302, location: `/${i + 1}` };
  const { d: dl, seen: sl } = deps(loop);
  eq(await checkImageUrl("https://cdn.example.com/0", dl), { ok: false, error: "image_redirects" }, "te veel doorverwijzingen");
  eq(sl.length, 4, "1 + 3 doorverwijzingen opgehaald");
});

Deno.test("afbeelding: netwerkfout en time-out", async () => {
  const { d } = deps({});
  eq(await checkImageUrl("https://cdn.example.com/a.png", d), { ok: false, error: "image_unreachable" }, "geen verbinding");
  const { d: d2 } = deps({ "https://cdn.example.com/a.png": { throws: "TimeoutError" } });
  eq(await checkImageUrl("https://cdn.example.com/a.png", d2), { ok: false, error: "image_timeout" }, "time-out");
  eq(await checkImageUrl("http://cdn.example.com/a.png", d), { ok: false, error: "bad_image_url" }, "geen https");
});

Deno.test("afbeelding: eigen opslag zonder DNS-controle", async () => {
  const SB = "https://abcd.supabase.co", name = "m/2026/10/" + "a".repeat(32) + ".png", url = publicUrl(SB, name);
  eq(url, "https://abcd.supabase.co/storage/v1/object/public/mail-assets/m/2026/10/" + "a".repeat(32) + ".png", "publieke URL");
  ok(isOwnAsset(SB, new URL(url)), "eigen bucket");
  ok(!isOwnAsset(SB, new URL("https://abcd.supabase.co/storage/v1/object/public/avatars/x.png")), "andere bucket");
  ok(!isOwnAsset(SB, new URL("https://evil.supabase.co/storage/v1/object/public/mail-assets/" + name)), "ander project");
  const { d } = deps({ [url]: { type: "image/png", body: PNG } }, { "abcd.supabase.co": [] });
  ok((await checkImageUrl(url, { ...d, trusted: (u) => isOwnAsset(SB, u) })).ok, "eigen opslag: geen DNS nodig");
});

Deno.test("afbeelding: uploaden (base64, soort en grootte)", () => {
  const r = cleanUpload(b64(PNG));
  ok(r.ok && r.type === "image/png" && r.ext === "png" && r.bytes.length === PNG.length, "png");
  const j = cleanUpload("data:image/jpeg;base64," + b64(JPG));
  ok(j.ok && j.ext === "jpg", "jpeg met data:-voorvoegsel");
  ok((cleanUpload(b64(GIF)) as { ext?: string }).ext === "gif", "gif");
  eq(cleanUpload(b64(SVG)), { ok: false, error: "image_svg" }, "svg geweigerd");
  eq(cleanUpload(b64(WEBP)), { ok: false, error: "image_webp" }, "webp geweigerd");
  eq(cleanUpload(b64(HTML)), { ok: false, error: "image_type" }, "html geweigerd");
  eq(cleanUpload("niet base64!"), { ok: false, error: "bad_image_data" }, "geen base64");
  eq(cleanUpload(""), { ok: false, error: "bad_image_data" }, "leeg");
  eq(cleanUpload(42), { ok: false, error: "bad_image_data" }, "geen tekst");
  const big = new Uint8Array(IMAGE_MAX + 3); big.set(PNG);
  let s = ""; for (let i = 0; i < big.length; i += 30000) s += String.fromCharCode(...big.slice(i, i + 30000));
  eq(cleanUpload(btoa(s)), { ok: false, error: "image_too_large" }, "te groot");
  const n = objectName("png", new Date(Date.UTC(2026, 9, 24)), (k) => new Uint8Array(k).fill(171));
  eq(n, "m/2026/10/" + "ab".repeat(16) + ".png", "objectnaam");
  ok(/^m\/\d{4}\/\d{2}\/[0-9a-f]{32}\.jpg$/.test(objectName("jpg")), "willekeurige naam");
});
