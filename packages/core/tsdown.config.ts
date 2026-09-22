import { defineConfig } from "tsdown";
import { resolve } from "node:path";
import { inlineModel } from "./scripts/inline-model.ts";
import { weights as bundledWeights } from "./src/model/weights.gen.ts";
import type { EncodedWeights } from "./src/model/decode.js";

// A variant build swaps the weight set: same code, one model per bundle.
const weightsPath = process.env.GPU_TIME_WEIGHTS;
const weights: EncodedWeights = weightsPath
  ? ((await import(resolve(weightsPath))).weights as EncodedWeights)
  : bundledWeights;

const outDir = process.env.GPU_TIME_OUTDIR ?? "dist";
const model = await inlineModel(import.meta.dirname, weights, weightsPath);

// One build per entry, because every entry must stand alone: the release gate
// measures index.js as the whole artifact. Rolldown shares chunks between the
// entries of one build, and `splitting: false` does nothing.
//
// @see https://github.com/rolldown/tsdown/issues/760
const entries: Record<string, string>[] = [
  { index: "src/index.ts" },
  { schedule: "src/schedule.ts" },
  { "languages/en": "src/languages/en.ts" },
  { "languages/es": "src/languages/es.ts" },
];

export default defineConfig(
  entries.map((entry) => ({
    entry,
    outDir,
    format: "esm" as const,
    platform: "browser" as const,
    target: "es2022",
    dts: { sourcemap: false },
    // scripts/build.ts runs terser after this, tuned for inference speed, not size.
    minify: false,
    treeshake: true,
    clean: false,
    define: {
      GPU_TIME_DIAGNOSTICS: "false",
      GPU_TIME_STORAGE: JSON.stringify(weights.storage ?? "f16"),
    },
    plugins: [model],
  })),
);
