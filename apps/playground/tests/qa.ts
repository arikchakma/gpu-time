import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "gpu-time/schedule";

const gold = new URL("../../../packages/training/data/gold/", import.meta.url);

const cases = (await readFile(new URL("adversarial.jsonl", gold), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const naturalCases = (
  await readFile(new URL("natural-browser.jsonl", gold), "utf8")
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    process.env.GPU_TIME_PLAYGROUND_URL ?? "http://127.0.0.1:5173/",
  );
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.includes("resolved"),
  );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
    "dark",
  );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
    "rgb(15, 15, 15)",
  );
  await page.getByRole("tab", { name: "Result", exact: true }).click();
  assert.equal(
    await page.locator('.brand svg[data-icon="clock"] mask').count(),
    1,
  );
  const send = page.getByRole("button", {
    name: "Parse expression",
    exact: true,
  });
  assert.equal(await send.locator('svg[data-icon="arrowUp"]').count(), 1);
  const sendBox = await send.boundingBox();
  assert.equal(sendBox?.width, 32);
  assert.equal(sendBox?.height, 32);
  for (const example of [...cases, ...naturalCases]) {
    await page
      .getByLabel("Time expression", { exact: true })
      .fill(example.text);
    await page.getByRole("button", { name: "Parse expression" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("resolved"),
    );
    const actual = JSON.parse(await page.locator("#output pre").innerText());
    const expected = resolve(example.schedule, {
      reference: "2026-09-09T12:00:00+06:00",
      timeZone: "Asia/Dhaka",
      limit: 12,
    });
    assert.deepEqual(
      actual.occurrences,
      expected.occurrences.map(({ clause, ...range }) => range),
      example.id,
    );
    assert.equal("expressions" in actual, false);
  }
  const ready = () =>
    page.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("resolved"),
    );
  const input = async (text: string) => {
    await page.getByLabel("Time expression", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Parse expression" }).click();
    await ready();
  };
  await page.getByText("Interpretation rules", { exact: true }).click();
  await input("03/04/2026");
  assert.equal(
    JSON.parse(
      await page.locator("#output pre").innerText(),
    ).occurrences[0].start.slice(0, 10),
    "2026-03-04",
  );
  await page
    .getByLabel("Numeric date order", { exact: true })
    .selectOption("DMY");
  await ready();
  assert.equal(
    JSON.parse(
      await page.locator("#output pre").innerText(),
    ).occurrences[0].start.slice(0, 10),
    "2026-04-03",
  );
  await page
    .getByLabel("Numeric date order", { exact: true })
    .selectOption("MDY");
  await ready();
  await input("Monday at 9am");
  await page
    .getByLabel("Bare weekdays", { exact: true })
    .selectOption("weekly");
  await ready();
  await page.getByRole("tab", { name: "Dates & rules", exact: true }).click();
  assert.equal(await page.locator(".dates li").count(), 12);
  await page.getByText("Recurrence rules", { exact: true }).click();
  assert.match(await page.locator("#output pre").innerText(), /FREQ=WEEKLY/);
  await page.getByLabel("Bare weekdays", { exact: true }).selectOption("once");
  await ready();
  assert.equal(await page.locator(".dates li").count(), 1);
  await page
    .getByLabel("Bare weekday date", { exact: true })
    .selectOption("thisWeek");
  await ready();
  assert.match(
    (await page.locator(".dates li time").first().getAttribute("datetime")) ??
      "",
    /^2026-09-07/,
  );
  await page
    .getByLabel("Bare weekday date", { exact: true })
    .selectOption("future");
  await ready();
  await input("next Friday at 9am");
  assert.match(
    (await page.locator(".dates li time").first().getAttribute("datetime")) ??
      "",
    /^2026-09-18/,
  );
  await page
    .getByLabel("Next weekday", { exact: true })
    .selectOption("immediate");
  await ready();
  assert.match(
    (await page.locator(".dates li time").first().getAttribute("datetime")) ??
      "",
    /^2026-09-11/,
  );
  await page
    .getByLabel("Next weekday", { exact: true })
    .selectOption("nextWeek");
  await ready();
  await input("this Sunday");
  await page.getByLabel("Week starts on", { exact: true }).selectOption("SU");
  await ready();
  assert.match(
    (await page.locator(".dates li time").first().getAttribute("datetime")) ??
      "",
    /^2026-09-06/,
  );
  await page.getByLabel("Week starts on", { exact: true }).selectOption("MO");
  await ready();
  assert.match(
    (await page.locator(".dates li time").first().getAttribute("datetime")) ??
      "",
    /^2026-09-13/,
  );
  await page.getByText("Interpretation rules", { exact: true }).click();
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  await page.locator("#output h3").filter({ hasText: "Chrono" }).waitFor();
  assert.equal(await page.locator("#output h3").count(), 3);
  await page.getByRole("tab", { name: "Compare", exact: true }).press("Home");
  assert.equal(
    await page
      .getByRole("tab", { name: "Dates & rules", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page
    .getByRole("button", { name: "Sat Sun 1pm-8pm Mon 10pm-12am" })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.includes("resolved"),
  );
  assert.equal(await page.locator(".benchmark-chart").count(), 2);
  assert.equal(
    await page
      .locator("#benchmarks")
      .evaluate((element) => (element as HTMLDetailsElement).open),
    false,
  );
  assert.match(
    await page.locator(".event-time").first().innerText(),
    /1:00 PM/,
  );
  assert.match(
    await page.locator(".overnight").innerText(),
    /Ends Tue, Sep 15/,
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/benchmarks-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/benchmarks-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Benchmarks", exact: true }).click();
  assert.equal(
    await page
      .locator("#benchmarks")
      .evaluate((element) => (element as HTMLDetailsElement).open),
    true,
  );
  assert.equal(
    await page.locator(".benchmark-chart").first().isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/benchmarks-expanded-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const result = {
    theme: "dark",
    liveAdversarialSchedules: cases.length,
    liveNaturalSchedules: naturalCases.length,
    backend: await page.locator("#engine").innerText(),
    compare: "gpu-time, Chrono, rrule",
    keyboardTabs: true,
    policyControls: true,
    mobileOverflow: false,
    pageErrors: errors,
  };
  await writeFile(
    "test-results/playground.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(result);
} finally {
  await browser.close();
}
