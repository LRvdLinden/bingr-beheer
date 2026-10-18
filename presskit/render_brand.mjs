// PNG's van het Bingr-logo uit de SVG's van presskit/make_brand.py (Chromium via Playwright; eenmalig lokaal, niet in CI).
//   node presskit/render_brand.mjs [chromium-pad]
// Maakt in presskit/brand/logo/: Bingr-logo-white.png en Bingr-logo-black.png (transparant, logo 2000 px breed met een
// marge van 1/4 van de logohoogte) en Bingr-logo-on-black.png (wit op zwart, 3000 x 1500).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// via require, zodat ook een globaal geïnstalleerde playwright (NODE_PATH) werkt
const { chromium } = createRequire(import.meta.url)("playwright");

const dir = join(dirname(fileURLToPath(import.meta.url)), "brand", "logo");
const exe = process.argv[2] || process.env.CHROMIUM || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shot(svgFile, out, { w, h, bg, logoW }) {
  const svg = readFileSync(join(dir, svgFile), "utf8").replace(/^<\?xml[^>]*>\s*/, "");
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:${w}px;height:${h}px;background:${bg};display:grid;place-items:center;overflow:hidden}
    svg{width:${logoW}px;height:auto;display:block}</style></head><body>${svg}</body></html>`);
  await page.screenshot({ path: join(dir, out), omitBackground: bg === "transparent", clip: { x: 0, y: 0, width: w, height: h } });
}

// verhouding van het logo uit de viewBox
const vb = readFileSync(join(dir, "Bingr-logo-white.svg"), "utf8").match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const ratio = vb[3] / vb[2];
const logoW = 2000, logoH = Math.round(logoW * ratio), m = Math.round(logoH / 4) * 2;
const tw = logoW + 2 * m, th = logoH + 2 * m;
await shot("Bingr-logo-white.svg", "Bingr-logo-white.png", { w: tw, h: th, bg: "transparent", logoW });
await shot("Bingr-logo-black.svg", "Bingr-logo-black.png", { w: tw, h: th, bg: "transparent", logoW });
await shot("Bingr-logo-white.svg", "Bingr-logo-on-black.png", { w: 3000, h: 1500, bg: "#000000", logoW: 1700 });
await browser.close();
console.log(`logo-png ${tw}x${th}, op zwart 3000x1500`);
