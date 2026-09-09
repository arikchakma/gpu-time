import { chromium } from "playwright";
import { createServer } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { reference, timeZone } from "./types.js";

const libraries = [
  "gpu-time-cpu",
  "gpu-time-webgpu",
  "chrono",
  "compromise",
  "rrule",
  "recognizers",
  "later",
];
const model = JSON.parse(
  await readFile("training/export-report.json", "utf8"),
).artifactSha256;
const cases = (await readFile("data/gold/adversarial.jsonl", "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const server = await createServer({
  configFile: false,
  server: {
    host: "127.0.0.1",
    port: 0,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  logLevel: "error",
  plugins: [
    {
      name: "benchmark-page",
      configureServer(server) {
        server.middlewares.use("/bench.html", (_request, response) => {
          response.setHeader("Content-Type", "text/html");
          response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          response.end("<!doctype html><title>gpu-time benchmark</title>");
        });
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ timezoneId: timeZone });
const page = await context.newPage();
const results = [];
try {
  await page.goto(server.resolvedUrls!.local[0] + "bench.html");
  for (const library of libraries) {
    console.log(`Benchmarking ${library} in a dedicated Chrome worker…`);
    const result = await page.evaluate(
      ({ library, cases }) =>
        new Promise<any>((resolve, reject) => {
          const worker = new Worker("/bench/worker.ts", { type: "module" });
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error(`${library} exceeded 120 seconds`));
          }, 120_000);
          worker.onmessage = ({ data }) => {
            clearTimeout(timeout);
            worker.terminate();
            resolve(data);
          };
          worker.onerror = (error) => {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(error.message));
          };
          worker.postMessage({ library, cases });
        }),
      { library, cases },
    );
    results.push({ library, ...result });
    console.log(result.error ?? JSON.stringify(result.result.single));
  }
  await mkdir("bench/results", { recursive: true });
  await writeFile(
    "bench/results/browser.json",
    JSON.stringify(
      {
        model,
        environment: {
          browser: browser.version(),
          cpu: cpus()[0].model,
          platform: platform(),
          osRelease: release(),
          reference,
          timeZone,
        },
        method:
          "Dedicated worker per library; ten warmups; 100 single-input samples; fixed repeated four-input batches. Timings cover public parse calls, including gpu-time date resolution and recurrence previews, excluding worker messaging and DOM. No complete parse-result cache is used. Initialization includes local development module loading. Different output contracts make this an experimental workload comparison, not an interchangeable-feature ranking.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  await server.close();
}
