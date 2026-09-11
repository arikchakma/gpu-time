import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("artwork/thumbnail.html", root), "utf8");
const report = JSON.parse(
  await readFile(
    new URL("../../packages/training/active/export-report.json", root),
    "utf8",
  ),
);
const logo = await readFile(new URL("src/components/Logo.astro", root), "utf8");
await mkdir(new URL("public/media/", root), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html.replace("<!-- LOGO -->", logo), {
    waitUntil: "load",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#model-size").evaluate((element, count) => {
    element.textContent = `${count.toLocaleString("en-US")} parameters`;
  }, report.parameters);
  await page.screenshot({
    path: fileURLToPath(new URL("public/media/poster.png", root)),
  });
  await page.screenshot({
    path: fileURLToPath(new URL("public/media/poster.jpg", root)),
    type: "jpeg",
    quality: 95,
  });
} finally {
  await browser.close();
}
