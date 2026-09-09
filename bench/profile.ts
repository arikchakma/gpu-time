import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const name = process.argv[2] ?? "current";
const server = await createServer({
  configFile: false,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "profile-page",
      configureServer(server) {
        server.middlewares.use("/profile.html", (_request, response) =>
          response.end("<!doctype html><title>Profile</title>"),
        );
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ timezoneId: "Asia/Dhaka" });
  await page.goto(server.resolvedUrls!.local[0] + "profile.html");
  const results = await page.evaluate(
    async ({ prefix, diverse }) => {
      const path = `${prefix}/src/index.ts`;
      const schedulePath = `${prefix}/src/schedule.ts`;
      const api = await import(path);
      const internal = await import(schedulePath);
      const context = {
        reference: "2026-09-09T12:00:00+06:00",
        timeZone: "Asia/Dhaka",
        limit: 12,
      };
      const phrases = diverse
        ? Array.from(
            { length: 1000 },
            (_, index) =>
              `2027-10-${String((index % 28) + 1).padStart(2, "0")} at ${String(Math.floor(index / 28) % 24).padStart(2, "0")}:${String(Math.floor(index / 672) * 15).padStart(2, "0")}`,
          )
        : [
            "tomorrow at noon",
            "next Monday at 2pm",
            "every Friday",
            "Sat Sun 1pm-8pm Mon 10pm-12am",
          ];
      const texts = Array.from(
        { length: diverse ? 1000 : 10000 },
        (_, index) => phrases[index % phrases.length],
      );
      const samples: Record<string, number> = {};
      const measure = async (run: () => unknown) => {
        await run();
        const times = [];
        for (let trial = 0; trial < 3; trial++) {
          const start = performance.now();
          await run();
          times.push(performance.now() - start);
        }
        return times.sort((a, b) => a - b)[1];
      };
      for (const backend of ["cpu", "webgpu"] as const) {
        const parser = await api.createParser({ backend });
        samples[backend] = await measure(() =>
          parser.parseMany(texts, context),
        );
        parser.dispose();
      }
      const parser = await internal.createParser({ backend: "cpu" });
      samples.recognition = await measure(() => parser.parseMany(texts));
      const schedules = await parser.parseMany(phrases);
      const publicParser = await api.createParser({ backend: "cpu" });
      const checked = await publicParser.parseMany(texts, context);
      const output = JSON.stringify(
        checked.map(({ occurrences, rrules, diagnostics }: any) => ({
          occurrences,
          rrules,
          diagnostics,
        })),
      );
      publicParser.dispose();
      let conversions = 0;
      const format = Intl.DateTimeFormat.prototype.formatToParts;
      Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
        conversions++;
        return format.apply(this, args);
      };
      const start = performance.now();
      for (let i = 0; i < texts.length; i++)
        for (const expression of schedules[i % phrases.length].expressions)
          if (expression.schedule)
            internal.resolve(expression.schedule, context);
      samples.resolution = performance.now() - start;
      Intl.DateTimeFormat.prototype.formatToParts = format;
      parser.dispose();
      return {
        inputs: texts.length,
        output,
        diversity: new Set(texts).size,
        samplesMs: samples,
        timezoneConversions: conversions,
        workload: phrases.slice(0, 4),
        method:
          "Repeated chart workload or 1,000 distinct date/time phrases (see diversity); warm median of three for parsing, one counted resolution pass. No final-result cache.",
      };
    },
    {
      prefix: process.argv.includes("--baseline")
        ? "/test-results/baseline"
        : "",
      diverse: process.argv.includes("--diverse"),
    },
  );
  const { output, ...measurements } = results;
  const report = {
    ...measurements,
    outputSha256: createHash("sha256").update(output).digest("hex"),
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    `test-results/profile-${name}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
