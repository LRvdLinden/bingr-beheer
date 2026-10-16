// deno test supabase/functions/admin/builds_test.ts
// De sleutel hieronder is een testwaarde (geen echte BINGR_BUILDS_KEY).
import { b64url, buildUrl, cleanManifest, findBuild, isValidBuildFile, isValidBuildPath, MAX_TTL, signBuildToken } from "./builds.ts";

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const KEY = "0123456789abcdef".repeat(4);
const NOW = Date.parse("2026-10-16T12:00:00Z"); // 1792152000 s
const rejects = async (f: () => Promise<unknown>, m: string) => {
  try { await f(); } catch { return; }
  throw new Error(m);
};

Deno.test("token: HMAC-SHA256 gelijk aan een met de hand berekende waarde (python hmac)", async () => {
  // python3: payload = urlsafe_b64encode(json.dumps({"f":…,"e":…}, separators=(",",":"))).rstrip("=")
  //          sig = urlsafe_b64encode(hmac.new(KEY.encode(), payload.encode(), sha256).digest()).rstrip("=")
  const a = await signBuildToken(KEY, "android/Bingr-1.0.0-build105.apk", 60, NOW);
  ok(a.exp === 1792152060, `exp ${a.exp}`);
  ok(a.token === "eyJmIjoiYW5kcm9pZC9CaW5nci0xLjAuMC1idWlsZDEwNS5hcGsiLCJlIjoxNzkyMTUyMDYwfQ.MQPtUJCyn0_AvnLTWoudUSXbzXUtSwnE0pFdMxQ3rgk", `token ${a.token}`);
  const m = await signBuildToken(KEY, "manifest.json", 60, NOW);
  ok(m.token === "eyJmIjoibWFuaWZlc3QuanNvbiIsImUiOjE3OTIxNTIwNjB9.mS69WWgMEdU-Cwcn0y9c0LM_q5XQVSgKIoAPAiwdSKM", `manifest ${m.token}`);
});

Deno.test("token: base64url zonder =, payload leesbaar met f en een geheel getal e", async () => {
  for (const ttl of [1, 60, 600, MAX_TTL]) {
    const { token, exp } = await signBuildToken(KEY, "tizen/Bingr-1.0.0-build1.wgt", ttl, NOW + 123);
    ok(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token), `vorm ${token}`);
    ok(!token.includes("="), "geen =");
    const [p] = token.split(".");
    const j = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4)));
    ok(j.f === "tizen/Bingr-1.0.0-build1.wgt" && j.e === exp && Number.isInteger(j.e) && exp === 1792152000 + ttl, `payload ${JSON.stringify(j)}`);
  }
  ok(b64url(new Uint8Array([251, 255])) === "-_8", "base64url-tekens");
  ok(b64url(new Uint8Array([1])) === "AQ", "zonder opvulling");
});

Deno.test("token: weigert korte sleutel, ongeldig pad en een te lange of rare geldigheid", async () => {
  await rejects(() => signBuildToken("", "manifest.json", 60, NOW), "lege sleutel");
  await rejects(() => signBuildToken("kort", "manifest.json", 60, NOW), "korte sleutel");
  await rejects(() => signBuildToken(KEY, "../key.php", 60, NOW), "pad buiten builds");
  await rejects(() => signBuildToken(KEY, "manifest.json", MAX_TTL + 1, NOW), "langer dan 15 min");
  await rejects(() => signBuildToken(KEY, "manifest.json", 0, NOW), "0 s");
  await rejects(() => signBuildToken(KEY, "manifest.json", 1.5, NOW), "geen geheel getal");
});

Deno.test("pad: zelfde regels als dl.php", () => {
  for (const p of ["manifest.json", "android/Bingr-1.0.0-build105.apk", "tizen/Bingr-1.0.0-build105.wgt",
    "apple/Bingr-1.0.0-build105-Xcode.zip", "beheer/Bingr-Beheer-1.0.0-build7-Xcode.zip"]) ok(isValidBuildPath(p), `geldig: ${p}`);
  for (const p of ["", "key.php", "builds/manifest.json", "android/", "android/../key.php", "android/a..b", "ios/x.zip",
    "android/.htaccess", "android/a/b.apk", "/android/x.apk", "android/x y.apk", "Android/x.apk", "manifest.json/x",
    `android/${"a".repeat(152)}`, null, 5, undefined]) ok(!isValidBuildPath(p), `ongeldig: ${String(p)}`);
  ok(isValidBuildFile("Bingr-1.0.0-build105.apk") && !isValidBuildFile("-x") && !isValidBuildFile("a/b"), "bestandsnaam");
});

const RAW = {
  updated: "2026-10-16T10:00:00Z",
  platforms: {
    android: {
      version: "1.0.0", build: 105, file: "Bingr-1.0.0-build105.apk", path: "android/Bingr-1.0.0-build105.apk", size: 123,
      sha256: "ab", date: "2026-10-16", notes: "**nieuw**",
      history: [{ version: "1.0.0", build: 104, file: "Bingr-1.0.0-build104.apk", size: 120, history: [{ file: "diep.apk" }] },
        { file: "../key.php" }, "onzin"],
    },
    tizen: { file: "../../etc/passwd" },
    windows: { file: "Bingr.exe" },
  },
};

Deno.test("manifest: alleen bekende platforms en geldige bestanden, alle velden blijven", () => {
  const m = cleanManifest(RAW)!;
  ok(m.updated === "2026-10-16T10:00:00Z", "updated");
  ok(Object.keys(m.platforms).join() === "android", `platforms ${Object.keys(m.platforms)}`);
  const a = m.platforms.android;
  ok(a.build === 105 && a.sha256 === "ab" && a.notes === "**nieuw**" && a.size === 123 && a.path === "android/Bingr-1.0.0-build105.apk", "velden");
  ok(a.history.length === 1 && a.history[0].build === 104 && !("history" in a.history[0]), "history");
  ok(cleanManifest(null) === null && cleanManifest({}) === null && cleanManifest({ platforms: [] }) === null, "geen manifest");
});

Deno.test("manifest: build zoeken (nieuwste, uit history, of weigeren)", () => {
  const m = cleanManifest(RAW);
  ok(findBuild(m, "android")?.build === 105, "nieuwste");
  ok(findBuild(m, "android", "")?.build === 105, "leeg = nieuwste");
  ok(findBuild(m, "android", "Bingr-1.0.0-build104.apk")?.build === 104, "history");
  ok(findBuild(m, "android", "Bingr-1.0.0-build1.apk") === null, "staat niet in het manifest");
  ok(findBuild(m, "android", "../key.php") === null, "ongeldige naam");
  ok(findBuild(m, "tizen") === null && findBuild(m, "windows") === null && findBuild(m, "apple") === null, "geen build");
  ok(findBuild(null, "android") === null, "geen manifest");
});

Deno.test("downloadadres", () => {
  ok(buildUrl("a.b") === "https://beheer.bingr.online/dl.php?t=a.b", "url");
});
