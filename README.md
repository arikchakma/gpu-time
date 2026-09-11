# gpu-time

`gpu-time` is an experimental neural parser for English time expressions. One small learned model reads natural language and returns actual dates, time ranges, and RFC 5545 recurrence rules. Inference runs locally on CPU or WebGPU; nothing is sent anywhere.

```js
import { parse } from "gpu-time";

const result = await parse("Sat Sun 1pm-8pm Mon 10pm-12am", {
  reference: "2026-09-09T12:00:00+06:00",
  timeZone: "Asia/Dhaka",
  limit: 12,
});

console.log(result.occurrences); // ISO start/end strings and an allDay flag
console.log(result.rrules); // RFC 5545 properties for repeating expressions
console.log(result.diagnostics); // why an expression was rejected
```

The package exports `parse(text, context)`, `parseMany(texts, context)`, and `defineParser(options)` for a reusable instance with explicit backend selection. The caller always supplies the reference instant and timezone — they are calendar inputs, never model inputs. There is no public AST or token-label output.

## How it works

A mechanical CPU pass splits the input into tokens and packs each one into a sparse feature row: character shape, casing, digit and punctuation class, lexicon membership, and neighbor hashes. No grammar, regex table, or date library runs on the CPU.

The model embeds those rows into learned channels and runs a bidirectional affine scan so every token sees its whole sentence. A classifier assigns each token one of 35 semantic roles — clock hour, weekday, ordinal, recurrence marker, range separator, and so on — plus a boundary score that cuts the sequence into independent expressions. The WebGPU path evaluates the scan in parallel blocks with exact block prefixes, so block boundaries do not reset context.

Everything after that is ordinary TypeScript. Predicted roles compile to a typed schedule, and a calendar resolver turns the schedule into concrete instants using the caller's timezone, DST rules, reference date, and expansion limit. Keeping calendar arithmetic out of the model is deliberate: timezone handling has exact answers, and a model should not be guessing them.

`backend: "auto"` runs on WebGPU once a batch reaches 32 expressions or 512 tokens, and on CPU below that, where dispatch overhead dominates. Asking for `"webgpu"` explicitly disables the built-in CPU fallback, so the caller owns that failure path.

## Accuracy

The model is trained on generated supervision. On the 1,000-case unseen-carrier evaluation — the words surrounding the time expression are drawn from a reserved set the model never saw, scored on strict whole-expression equality — it reaches **993/1000**. The earlier figure was 511/1000, before the surrounding prose was made combinatorial and real English sentences were mixed in.

Held-in numbers are much higher and much less meaningful: 4,996/5,000 on the original generated interpretations and 997/1,000 on the newer phrasings. Both share rendering families with training and are development metrics, not language accuracy.

Against the independent Microsoft Recognizers date/time specifications, development agreement is **156/563**. Its reserved test split is not used for model selection.

Warm medians over 10,000 inputs: WebGPU 80.3 ms, CPU 726.8 ms, Chrono 91.6 ms. Different parsers return different structures, so speed does not imply equivalent capability. See [MODEL_CARD.md](MODEL_CARD.md) for the evaluation contract and limitations, and the [benchmark report](packages/benchmark/results/REPORT.md) for measured timings, bundle sizes, and full output for all 25 adversarial inputs.

The package is not published yet. The current build is 34,650 bytes Brotli against a 30,000-byte release gate, which remains unmet.

## Development

Install with Node.js 24+, pnpm 11, uv, Python 3.13, and Chrome with WebGPU:

```sh
pnpm install
pnpm test
pnpm build:core
```

Generated training data, downloaded corpora, training runs, and local virtual environments are intentionally ignored. To prepare data and train:

```sh
pnpm gen
pnpm train -- --run experiment --storage f32 --batch 1024
```

Runs are written under `packages/training/runs/`. Export a checkpoint to regenerate the shipped weights, then rebuild and evaluate:

```sh
pnpm --filter @gpu-time/training export -- --checkpoint runs/experiment/best.pt
pnpm build:core
pnpm evaluate
```

The tracked `packages/training/active/` directory holds the promoted model report, provenance, and the CPU/GPU parity fixtures needed to verify a clean clone. `pnpm test:browser` checks the model and packaged runtime on real WebGPU. `pnpm benchmark` reuses existing evaluation corpora unless `--refresh-corpus` is passed explicitly; compare source hashes before comparing accuracy.

## Repository

- `packages/core`: publishable browser package, WGSL kernel, and calendar resolver
- `packages/training`: corpus generation, PyTorch training, evaluation, export, and provenance
- `packages/benchmark`: size, browser performance, and cross-library comparisons
- `apps/website`: project site and interactive demo
- `video`: explainer source and storyboard

Architecture details live in [architecture.md](architecture.md). Model provenance and limitations are in [MODEL_CARD.md](MODEL_CARD.md). Third-party attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT © Arik Chakma. Comparison libraries and evaluation corpora retain their own licenses.
