import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("artwork/og.html", root), "utf8");
const logo = await readFile(new URL("src/components/Logo.astro", root), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html.replace("<!-- LOGO -->", logo), {
    waitUntil: "load",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: fileURLToPath(new URL("public/og.png", root)),
  });
} finally {
  await browser.close();
}
