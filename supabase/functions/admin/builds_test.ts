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
      sha256: "ab", date: "2026-10-16", notes: "**nieuw**", uploaded_at: "2026-10-17T06:02:11+00:00",
      history: [{ version: "1.0.0", build: 104, file: "Bingr-1.0.0-build104.apk", size: 120, uploaded_at: "gisteren", history: [{ file: "diep.apk" }] },
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
  ok(a.uploaded_at === "2026-10-17T06:02:11+00:00", "uploaded_at doorgegeven");
  ok(!("uploaded_at" in a.history[0]), "ongeldige uploaded_at valt weg (oude build: alleen date)");
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

Deno.test("releasemelding: versie/build, sleutels en stand per build", async () => {
  const { releaseOf, releaseKeys, releasePushView, isReleasePushPlatform } = await import("./builds.ts");
  ok(isReleasePushPlatform("apple") && isReleasePushPlatform("android"), "apple/android");
  ok(!isReleasePushPlatform("tizen") && !isReleasePushPlatform("beheer") && !isReleasePushPlatform(1), "geen tizen/beheer");
  const r = releaseOf({ file: "Bingr-1.0.0-build114.zip", version: "1.0.0", build: 114 });
  ok(r?.version === "1.0.0" && r.build === 114, "geldig");
  ok(releaseOf({ file: "a.zip", version: "1.0.0", build: "114" })?.build === 114, "build als tekst");
  ok(releaseOf({ file: "a.zip", version: "x", build: 114 }) === null, "versie ongeldig");
  ok(releaseOf({ file: "a.zip", version: "1.0.0", build: 0 }) === null, "build 0");
  ok(releaseOf({ file: "a.zip", version: "1.0.0" }) === null, "zonder build");
  ok(releaseOf(null) === null, "null");
  const m = cleanManifest({ platforms: {
    apple: { file: "Bingr-1.0.0-build114.zip", version: "1.0.0", build: 114, history: [{ file: "Bingr-1.0.0-build113.zip", version: "1.0.0", build: 113 }] },
    android: { file: "Bingr-1.0.0-build114.apk", version: "1.0.0", build: 114 },
    tizen: { file: "Bingr-1.0.0-build114.wgt", version: "1.0.0", build: 114 },
  } });
  const k = releaseKeys(m).sort();
  ok(JSON.stringify(k) === JSON.stringify(["release:android:114", "release:apple:113", "release:apple:114"]), `sleutels ${k}`);
  const v = releasePushView([
    { dedup_key: "release:apple:114", created_at: "2026-10-17T08:00:00Z", devices: 12, counts: { queued: 0, sent: 11, failed: 1, invalid: 0 }, finished_at: "2026-10-17T08:01:00Z" },
    { dedup_key: "release:android:114", created_at: "2026-10-17T08:00:00Z", devices: 5, counts: { queued: 3, sent: 2 }, finished_at: null },
    { dedup_key: "reminder:x:1", devices: 1 }, { dedup_key: "release:tizen:114" }, "rommel", null,
  ]);
  ok(Object.keys(v).sort().join(",") === "android:114,apple:114", `stand ${Object.keys(v)}`);
  ok(v["apple:114"].sent === 11 && v["apple:114"].failed === 1 && v["apple:114"].done, "apple klaar");
  ok(v["android:114"].queued === 3 && !v["android:114"].done && v["android:114"].invalid === 0, "android bezig");
  ok(Object.keys(releasePushView("x")).length === 0, "geen lijst");
});

Deno.test("presskit: platform en teller in de toegestane paden, manifest houdt presskit", async () => {
  const { PRESSKIT_STATS, isBuildPlatform } = await import("./builds.ts");
  ok(isBuildPlatform("presskit"), "platform presskit");
  ok(isValidBuildPath("presskit/Bingr-PressKit-1.3.zip") && isValidBuildPath(PRESSKIT_STATS), "paden");
  for (const p of ["presskit-stats.json/x", "presskit/../key.php", "presskit/", "stats.json", "PressKit/x.zip"]) ok(!isValidBuildPath(p), `ongeldig: ${p}`);
  const t = await signBuildToken(KEY, PRESSKIT_STATS, 60, NOW);
  ok(JSON.parse(atob(t.token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).f === "presskit-stats.json", "token voor de teller");
  const m = cleanManifest({ platforms: {
    presskit: { version: "1.3", file: "Bingr-PressKit-1.3.zip", size: 5, sha256: "ab", uploaded_at: "2026-10-18T08:00:00+00:00", history: [{ version: "1.2", file: "Bingr-PressKit-1.2.zip" }] },
    android: { file: "Bingr-1.0.0-build105.apk", build: 105 },
  } })!;
  ok(Object.keys(m.platforms).sort().join() === "android,presskit", `platforms ${Object.keys(m.platforms)}`);
  ok(m.platforms.presskit.version === "1.3" && m.platforms.presskit.history[0].file === "Bingr-PressKit-1.2.zip", "presskit-velden");
  ok(findBuild(m, "presskit")?.file === "Bingr-PressKit-1.3.zip" && findBuild(m, "presskit", "Bingr-PressKit-1.2.zip")?.version === "1.2", "zoeken");
  const { releaseKeys, isReleasePushPlatform } = await import("./builds.ts");
  ok(!isReleasePushPlatform("presskit") && releaseKeys(m).length === 0, "geen releasemelding voor de presskit");
});

Deno.test("presskit: tellerweergave (totaal, deze versie, 7/30 dagen in NL-tijd, 30 dagen per dag)", async () => {
  const { presskitStatsView, nlDay } = await import("./builds.ts");
  // 2026-10-17 22:30 UTC = 18 okt 00:30 in Amsterdam (zomertijd)
  const now = Date.parse("2026-10-17T22:30:00Z");
  ok(nlDay(now) === "2026-10-18", `NL-dag ${nlDay(now)}`);
  const v = presskitStatsView({
    total: 50, by_version: { "1.3": 12, "1.2": 38 },
    by_day: { "2026-10-18": 2, "2026-10-12": 3, "2026-10-11": 4, "2026-09-19": 5, "2026-09-18": 100, "x": 9, "2026-10-17": -1, "2026-10-16": "7" },
  }, "1.3", now)!;
  ok(v.total === 50 && v.version === "1.3" && v.version_total === 12, "totaal en versie");
  ok(v.last_7d === 5, `7 dagen ${v.last_7d}`); // 12 t/m 18 okt
  ok(v.last_30d === 14, `30 dagen ${v.last_30d}`); // 19 sep t/m 18 okt
  ok(v.days.length === 30 && v.days[0].date === "2026-09-19" && v.days[29].date === "2026-10-18" && v.days[29].n === 2, "dagen");
  const e = presskitStatsView({}, "x/../", now)!;
  ok(e.total === 0 && e.version === null && e.version_total === 0 && e.last_30d === 0 && e.days.every((d) => d.n === 0), "leeg/ongeldig");
  ok(presskitStatsView(null, "1.3", now) === null && presskitStatsView([1], "1.3", now) === null, "geen teller");
});
