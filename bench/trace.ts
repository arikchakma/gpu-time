import { chromium } from "playwright";
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
const server = await createServer({
  configFile: false,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "trace-page",
      configureServer(server) {
        server.middlewares.use("/trace.html", (_request, response) =>
          response.end("<!doctype html><title>Trace</title>"),
        );
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls!.local[0] + "trace.html");
  await page.evaluate(async () => {
    const path = "/src/index.ts";
    const { createParser } = await import(path);
    const parser = await createParser({ backend: "webgpu" });
    const phrases = [
      "tomorrow at noon",
      "next Monday at 2pm",
      "every Friday",
      "Sat Sun 1pm-8pm Mon 10pm-12am",
    ];
    const texts = Array.from({ length: 10000 }, (_, i) => phrases[i % 4]);
    const context = {
      reference: "2026-09-09T12:00:00+06:00",
      timeZone: "Asia/Dhaka",
      limit: 12,
    };
    const run = () => parser.parseMany(texts, context);
    (window as any).runProfile = run;
    await run();
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");
  await page.evaluate(async () => {
    for (let i = 0; i < 8; i++) await (window as any).runProfile();
  });
  const { profile } = await session.send("Profiler.stop");
  if (!profile.samples || !profile.timeDeltas)
    throw new Error("The profiler returned no samples.");
  await writeFile("test-results/runtime.cpuprofile", JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map((node: any) => [node.id, node]));
  const times = new Map<string, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const node: any = nodes.get(profile.samples[i]);
    const name = `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url?.replace(/^.*\/src\//, "src/").slice(0, 90)}`;
    times.set(name, (times.get(name) ?? 0) + profile.timeDeltas[i] / 1000);
  }
  console.table(
    [...times]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, ms]) => ({ name, ms })),
  );
} finally {
  await browser.close();
  await server.close();
}
