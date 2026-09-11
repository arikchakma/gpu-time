import { beforeEach, expect, it, vi } from "vitest";
import { defineParser } from "../src/schedule.js";
import { inferCPU, type Predictions } from "../src/model/cpu.js";
import type { RawToken } from "../src/types.js";

const createGPU = vi.hoisted(() => vi.fn());
vi.mock("../src/model/gpu.js", () => ({ GPUModel: { create: createGPU } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function runtime() {
  return {
    inferMany: vi.fn(async (inputs: RawToken[][]) =>
      inputs.map((tokens) => inferCPU(tokens)),
    ),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  createGPU.mockReset();
});

it("keeps mixed single and batch requests separate in one submission", async () => {
  const gpu = runtime();
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "webgpu" });
  try {
    const [first, batch, last] = await Promise.all([
      parser.parse("today"),
      parser.parseMany(["tomorrow", "yesterday"]),
      parser.parse("now"),
    ]);
    const dates = [first, ...batch, last].map(
      (result) => result.expressions[0].schedule?.clauses[0].date,
    );
    expect(dates).toEqual([
      { kind: "relativeDay", offset: 0 },
      { kind: "relativeDay", offset: 1 },
      { kind: "relativeDay", offset: -1 },
      { kind: "now" },
    ]);
    expect(gpu.inferMany).toHaveBeenCalledTimes(1);
  } finally {
    parser.dispose();
  }
});

it("rejects an entire active batch on disposal before GPU work completes", async () => {
  const gpu = runtime();
  const started = deferred<void>();
  const completed = deferred<Predictions[]>();
  gpu.inferMany.mockImplementationOnce(() => {
    started.resolve();
    return completed.promise;
  });
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "webgpu" });
  const batch = parser.parseMany(["today", "tomorrow", "yesterday"]);
  const rejected = expect(batch).rejects.toThrow("disposed");
  await started.promise;
  parser.dispose();
  try {
    await rejected;
  } finally {
    completed.resolve([]);
  }
});

it("coalesces same-turn calls while preserving each input's predictions", async () => {
  const gpu = runtime();
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "webgpu", tokens: true });
  const cpu = await defineParser({ backend: "cpu", tokens: true });
  const texts = [
    "one day after",
    "Sat Sun 1pm-8pm Mon 10pm-12am",
    "every other Tuesday until Dec",
    "May I have your second opinion?",
  ];
  try {
    const [actual, expected] = await Promise.all([
      parser.parseMany(texts),
      cpu.parseMany(texts),
    ]);
    expect(gpu.inferMany).toHaveBeenCalledTimes(1);
    for (let index = 0; index < texts.length; index++) {
      expect(actual[index].expressions).toEqual(expected[index].expressions);
      expect(actual[index].tokens).toEqual(expected[index].tokens);
      expect(actual[index].backend).toBe("webgpu");
    }
  } finally {
    parser.dispose();
    cpu.dispose();
  }
});

it("queues arrivals during inference and settles every caller in order", async () => {
  const gpu = runtime();
  const started = deferred<void>();
  const completed = deferred<Predictions[]>();
  let inputs: RawToken[][] = [];
  gpu.inferMany.mockImplementationOnce((batch) => {
    inputs = batch;
    started.resolve();
    return completed.promise;
  });
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "webgpu" });
  const first = parser.parse("tomorrow");
  await started.promise;
  const second = parser.parse("yesterday");
  completed.resolve(inputs.map((tokens) => inferCPU(tokens)));
  const [a, b] = await Promise.all([first, second]);
  expect(a.expressions[0].schedule).toEqual({
    clauses: [{ date: { kind: "relativeDay", offset: 1 } }],
  });
  expect(b.expressions[0].schedule).toEqual({
    clauses: [{ date: { kind: "relativeDay", offset: -1 } }],
  });
  expect(gpu.inferMany).toHaveBeenCalledTimes(2);
  parser.dispose();
});

it("rejects pending calls immediately and disposes only once", async () => {
  const gpu = runtime();
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "webgpu" });
  const result = parser.parse("tomorrow");
  const rejected = expect(result).rejects.toThrow("disposed");
  parser.dispose();
  parser.dispose();
  await rejected;
  await expect(parser.parse("today")).rejects.toThrow("disposed");
  expect(gpu.inferMany).not.toHaveBeenCalled();
  expect(gpu.dispose).toHaveBeenCalledTimes(1);
});

it("disposes a GPU that finishes initialization after the parser closes", async () => {
  const gpu = runtime();
  const started = deferred<void>();
  const ready = deferred<ReturnType<typeof runtime>>();
  createGPU.mockImplementation(() => {
    started.resolve();
    return ready.promise;
  });
  const parser = await defineParser({ backend: "auto" });
  let settled = false;
  const result = parser.parse("tomorrow ".repeat(300));
  const outcome = result.then(
    () => "resolved",
    (error: Error) => {
      settled = true;
      return error.message;
    },
  );
  await started.promise;
  parser.dispose();
  try {
    await vi.waitFor(() => expect(settled).toBe(true));
  } finally {
    ready.resolve(gpu);
    await outcome;
  }
  await vi.waitFor(() => expect(gpu.dispose).toHaveBeenCalledTimes(1));
  expect(await outcome).toContain("disposed");
  expect(gpu.inferMany).not.toHaveBeenCalled();
});

it("rejects an active inference on disposal without producing a CPU fallback", async () => {
  const gpu = runtime();
  const started = deferred<void>();
  const completed = deferred<Predictions[]>();
  gpu.inferMany.mockImplementationOnce(() => {
    started.resolve();
    return completed.promise;
  });
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "auto" });
  const result = parser.parse("tomorrow ".repeat(300));
  const outcome = result.then(
    () => "resolved",
    (error: Error) => error.message,
  );
  await started.promise;
  parser.dispose();
  completed.reject(new Error("device destroyed"));
  expect(await outcome).toContain("disposed");
  expect(gpu.dispose).toHaveBeenCalledTimes(1);
});

it("rejects a malformed inference batch without stranding callers or poisoning later calls", async () => {
  const gpu = runtime();
  gpu.inferMany.mockResolvedValueOnce([]);
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "webgpu" });
  await expect(parser.parse("tomorrow")).rejects.toThrow("predictions");
  expect((await parser.parse("today")).expressions[0].schedule).not.toBeNull();
  parser.dispose();
});

it("reports automatic fallback and does not retry an unavailable backend on every call", async () => {
  createGPU.mockRejectedValue(new Error("WebGPU unavailable"));
  const parser = await defineParser({ backend: "auto" });
  const result = await parser.parseMany(Array(32).fill("one day after"));
  expect(
    result.every(
      (value) =>
        value.backend === "cpu" &&
        value.fallbackReason === "WebGPU unavailable",
    ),
  ).toBe(true);
  expect(result[0].expressions[0].schedule?.clauses[0].shift?.direction).toBe(
    "after",
  );
  await parser.parseMany(Array(32).fill("tomorrow"));
  expect(createGPU).toHaveBeenCalledTimes(1);
  parser.dispose();
  await expect(defineParser({ backend: "webgpu" })).rejects.toThrow(
    "WebGPU unavailable",
  );
});

it("does not initialize the GPU for a batch of empty strings", async () => {
  const parser = await defineParser();
  expect(await parser.parseMany([])).toEqual([]);
  const results = await parser.parseMany(Array(40).fill(""));
  expect(
    results.every(
      (result) => result.backend === "cpu" && result.expressions.length === 0,
    ),
  ).toBe(true);
  expect(createGPU).not.toHaveBeenCalled();
  parser.dispose();
});

it("preserves every source offset when splitting long inputs into bounded GPU batches", async () => {
  const gpu = runtime();
  createGPU.mockResolvedValue(gpu);
  const parser = await defineParser({ backend: "webgpu", tokens: true });
  const text = "Tomorrow at noon. ".repeat(80);
  const results = await parser.parseMany(Array(32).fill(text));
  expect(gpu.inferMany.mock.calls.length).toBeGreaterThan(1);
  for (const [batch] of gpu.inferMany.mock.calls) {
    expect(batch.every((tokens) => tokens.length <= 128)).toBe(true);
    expect(
      batch.reduce((count, tokens) => count + tokens.length, 0),
    ).toBeLessThanOrEqual(16_384);
  }
  for (const result of results) {
    expect(result.tokens?.map((token) => token.text).join("")).toBe(text);
    expect(
      result.tokens?.every(
        (token) => text.slice(token.start, token.end) === token.text,
      ),
    ).toBe(true);
  }
  parser.dispose();
});
