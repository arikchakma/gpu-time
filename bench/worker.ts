import type { Adapter } from "./types.js";
import { reference } from "./types.js";

const factories = {
  chrono: () =>
    import("./baselines/chrono.js").then((module) => module.create()),
  compromise: () =>
    import("./baselines/compromise.js").then((module) => module.create()),
  rrule: () => import("./baselines/rrule.js").then((module) => module.create()),
  recognizers: () =>
    import("./baselines/recognizers.js").then((module) => module.create()),
  later: () => import("./baselines/later.js").then((module) => module.create()),
  "gpu-time-cpu": () =>
    import("./baselines/gpu-time.js").then((module) => module.create("cpu")),
  "gpu-time-webgpu": () =>
    import("./baselines/gpu-time.js").then((module) => module.create("webgpu")),
};

function percentile(values: number[], quantile: number): number {
  return [...values].sort((a, b) => a - b)[
    Math.ceil(values.length * quantile) - 1
  ];
}

async function run(
  library: keyof typeof factories,
  cases: { id: string; text: string }[],
) {
  if (new Date(reference).getHours() !== 12)
    throw new Error(
      "Worker timezone does not match the benchmark's Asia/Dhaka reference.",
    );
  const started = performance.now();
  const adapter: Adapter = await factories[library]();
  const initializationMs = performance.now() - started;
  try {
    const sample = "next Monday at 2pm";
    const first = performance.now();
    await adapter.parse(sample);
    const firstParseMs = performance.now() - first;
    for (let index = 0; index < 10; index++) await adapter.parse(sample);
    const singles = [];
    for (let index = 0; index < 100; index++) {
      const start = performance.now();
      await adapter.parse(sample);
      singles.push(performance.now() - start);
    }
    const batches = [];
    const workload = [
      "tomorrow at noon",
      "next Monday at 2pm",
      "every Friday",
      "Sat Sun 1pm-8pm Mon 10pm-12am",
    ];
    for (const size of [1000, 10000]) {
      const texts = Array.from(
        { length: size },
        (_, index) => workload[index % workload.length],
      );
      let failures = 0;
      const measurements = [];
      for (let trial = 0; trial < 4; trial++) {
        const start = performance.now();
        failures = 0;
        if (adapter.parseMany) await adapter.parseMany(texts);
        else
          for (const text of texts) {
            try {
              await adapter.parse(text);
            } catch {
              failures++;
            }
          }
        if (trial > 0) measurements.push(performance.now() - start);
      }
      const ms = percentile(measurements, 0.5);
      batches.push({
        size,
        ms,
        p95Ms: percentile(measurements, 0.95),
        samples: measurements.length,
        failures,
        inputsPerSecond: (size / ms) * 1000,
      });
    }
    const outputs = [];
    for (const example of cases) {
      try {
        const raw = await adapter.parse(example.text);
        outputs.push({
          id: example.id,
          text: example.text,
          raw,
          ...adapter.normalize(raw),
        });
      } catch (error) {
        outputs.push({
          id: example.id,
          text: example.text,
          abstained: true,
          error: String(error),
        });
      }
    }
    return {
      library,
      crossOriginIsolated: self.crossOriginIsolated,
      initializationMs,
      firstParseMs,
      single: {
        text: sample,
        samples: singles.length,
        p50Ms: percentile(singles, 0.5),
        p95Ms: percentile(singles, 0.95),
      },
      batches,
      outputs,
    };
  } finally {
    adapter.dispose?.();
  }
}

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ result: await run(data.library, data.cases) });
  } catch (error) {
    self.postMessage({
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};
