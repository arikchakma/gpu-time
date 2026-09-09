import { tokenize } from "./tokenizer.js";
import { LABELS } from "./labels.js";
import { inferCPU, type Predictions } from "./model/cpu.js";
import { GPUModel } from "./model/gpu.js";
import type { ParserOptions, RawToken, Token } from "./types.js";

export interface TagResult {
  tokens: Token[];
  unknownLabels: boolean;
  backend: "cpu" | "webgpu";
  timings: { tokenizeMs: number; inferMs: number };
  fallbackReason?: string;
}

interface Job {
  text: string;
  tokens: RawToken[];
  tokenizeMs: number;
  resolve: (result: TagResult) => void;
  reject: (reason: unknown) => void;
}

interface Window {
  job: number;
  start: number;
  keepStart: number;
  keepEnd: number;
  tokens: RawToken[];
}

function windowsFor(job: Job, jobIndex: number): Window[] {
  // Whitespace width has no temporal meaning. Use canonical model features
  // while retaining the original tokens and offsets in the public result.
  const started = performance.now();
  const canonical = tokenize(job.text.trim().replace(/\s+/g, " "));
  job.tokenizeMs += performance.now() - started;
  const sourceStart = job.tokens[0]?.kind === 3 ? 1 : 0;
  const windows: Window[] = [];
  for (let start = 0; start < canonical.length; start += 96) {
    const contextStart = Math.max(0, start - 16);
    const contextEnd = Math.min(canonical.length, start + 112);
    const tokens = canonical.slice(contextStart, contextEnd);
    for (const index of new Set([0, tokens.length - 1])) {
      const token = tokens[index];
      let flags = token.features[1] & ~((1 << 10) | (1 << 11));
      if (index === 0) flags |= 1 << 10;
      if (index === tokens.length - 1) flags |= 1 << 11;
      tokens[index] = { ...token, features: [token.features[0], flags] };
    }
    windows.push({
      job: jobIndex,
      start: sourceStart + contextStart,
      keepStart: start - contextStart,
      keepEnd: Math.min(canonical.length, start + 96) - contextStart,
      tokens,
    });
  }
  return windows;
}

export async function createTagger(
  options: Pick<ParserOptions, "backend"> = {},
) {
  const requested = options.backend ?? "auto";
  const pending: Job[] = [];
  let active: Job[] = [];
  let gpu: GPUModel | undefined;
  let gpuUnavailable: string | undefined;
  let scheduled = false;
  let running = false;
  let disposed = false;
  if (requested === "webgpu") gpu = await GPUModel.create();

  async function predict(
    windows: Window[],
    backend: "cpu" | "webgpu",
  ): Promise<Predictions[]> {
    if (windows.length === 0) return [];
    if (backend === "cpu")
      return windows.map((window) => inferCPU(window.tokens));
    if (!gpu) {
      const initialized = await GPUModel.create();
      if (disposed) {
        initialized.dispose();
        throw new Error("The parser is disposed.");
      }
      gpu = initialized;
    }
    const predictions: Predictions[] = [];
    for (let start = 0; start < windows.length;) {
      let end = start;
      let tokens = 0;
      while (
        end < windows.length &&
        tokens + windows[end].tokens.length <= 16_384
      )
        tokens += windows[end++].tokens.length;
      predictions.push(
        ...(await gpu.inferMany(
          windows.slice(start, end).map((window) => window.tokens),
        )),
      );
      start = end;
    }
    return predictions;
  }

  async function process(jobs: Job[]): Promise<void> {
    const windows = jobs.flatMap(windowsFor);
    const tokenCount = windows.reduce(
      (count, window) => count + window.tokens.length,
      0,
    );
    let backend: "cpu" | "webgpu" =
      requested === "webgpu" ||
      (requested === "auto" &&
        !gpuUnavailable &&
        (jobs.length >= 32 || tokenCount >= 512))
        ? "webgpu"
        : "cpu";
    const started = performance.now();
    let predictions: Predictions[];
    try {
      predictions = await predict(windows, backend);
    } catch (error) {
      if (disposed) throw new Error("The parser is disposed.");
      if (backend === "cpu" || requested === "webgpu") throw error;
      gpuUnavailable = error instanceof Error ? error.message : String(error);
      gpu?.dispose();
      gpu = undefined;
      backend = "cpu";
      predictions = await predict(windows, "cpu");
    }
    if (disposed) throw new Error("The parser is disposed.");
    if (
      predictions.length !== windows.length ||
      predictions.some(
        (prediction, index) =>
          prediction.labels.length !== windows[index].tokens.length ||
          prediction.clauseStarts.length !== windows[index].tokens.length ||
          prediction.scores.length !== windows[index].tokens.length,
      )
    ) {
      throw new Error("The model returned incomplete predictions.");
    }
    const inferMs = performance.now() - started;
    const labeled = jobs.map((job) =>
      job.tokens.map((token): Token => ({
        ...token,
        label: "O",
        clauseStart: false,
        score: 0,
      })),
    );
    const invalid = new Set<number>();
    windows.forEach((window, index) => {
      const prediction = predictions[index];
      for (let token = window.keepStart; token < window.keepEnd; token++) {
        const label = LABELS[prediction.labels[token]];
        if (!label) invalid.add(window.job);
        const original = jobs[window.job].tokens[window.start + token];
        labeled[window.job][window.start + token] = {
          ...original,
          label: label ?? "O",
          clauseStart: Boolean(prediction.clauseStarts[token]),
          score: prediction.scores[token],
        };
      }
    });
    jobs.forEach((job, index) => {
      job.resolve({
        tokens: labeled[index],
        unknownLabels: invalid.has(index),
        backend: job.text.trim().length ? backend : "cpu",
        timings: { tokenizeMs: job.tokenizeMs, inferMs },
        ...(gpuUnavailable ? { fallbackReason: gpuUnavailable } : {}),
      });
    });
  }

  async function flush(): Promise<void> {
    scheduled = false;
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        active = pending.splice(0);
        try {
          if (disposed) throw new Error("The parser is disposed.");
          await process(active);
        } catch (error) {
          active.forEach((job) => job.reject(error));
        } finally {
          active = [];
        }
      }
    } finally {
      running = false;
      if (pending.length) schedule();
    }
  }

  function schedule(): void {
    if (scheduled || running) return;
    scheduled = true;
    queueMicrotask(() => void flush());
  }

  function tag(text: string): Promise<TagResult> {
    if (disposed) return Promise.reject(new Error("The parser is disposed."));
    if (text.length > 1_000_000)
      return Promise.reject(
        new RangeError("An input supports at most one million characters."),
      );
    const started = performance.now();
    const tokens = tokenize(text);
    return new Promise((resolve, reject) => {
      pending.push({
        text,
        tokens,
        tokenizeMs: performance.now() - started,
        resolve,
        reject,
      });
      schedule();
    });
  }

  return {
    tag,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      gpu?.dispose();
      gpu = undefined;
      for (const job of [...pending.splice(0), ...active])
        job.reject(new Error("The parser is disposed."));
    },
  };
}
