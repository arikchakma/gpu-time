# gpu-time

`gpu-time` is an experimental neural parser for English time expressions. A small trained model helps turn text into dates, time ranges, and RFC 5545 recurrence rules. The parser runs locally on CPU or WebGPU and does not send your input to a server.

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
console.log(result.spans); // where in the text each answer came from
```

The package exports `parse(text, context)`, `parseMany(texts, context)`, and `defineParser(options)` for a reusable instance with explicit backend selection. The caller supplies the reference instant and timezone. The calendar resolver uses these inputs after the model runs. `spans` gives the character offsets each answer was read from, so a caller can subtract the time from the text without parsing it again. There is no public AST or token-label output.

## How it works

The CPU splits the input into tokens (words, numbers, and punctuation). It records features such as character shape, case, length, and hashes of the token's own spelling. The model has no word list: it never sees that a token is a month name.

The model reads these features in both directions. A classifier assigns each token one of 35 roles, such as hour, weekday, or range separator. A separate score marks expression boundaries. WebGPU processes the model in parallel blocks and carries context across block boundaries. Long inputs use overlapping windows.

TypeScript then builds a schedule from the predicted roles. The calendar resolver applies the timezone, daylight saving time rules, reference date, and occurrence limit to produce dates and recurrence rules.

`backend: "auto"` tries WebGPU at 32 inputs or 512 tokens per batch. Smaller batches use the CPU. Explicit `"webgpu"` requests disable CPU fallback, so the caller must handle failures.

## Development

Install with Node.js 24+, pnpm 11, uv, Python 3.13, and Chrome with WebGPU:

```sh
pnpm install
pnpm test
pnpm build:core
```

Generated training data, downloaded corpora, training runs, and local virtual environments are intentionally ignored. The starting checkpoint must exist locally because Git does not store `.pt` files. To prepare data and train:

```sh
pnpm gen
pnpm train --run experiment --storage f32 --feature-rows 580 --layers 2 --init runs/risk-w0.005/best.pt --batch 1024 --transitions \
  --distill runs/risk-w0.005/best.pt --distill-alpha 0 --distill-beta 5 --distill-lambda 0.05 \
  --risk-lambda 0.005 --risk-margin 4
```

Runs are written under `packages/training/runs/`. Export a checkpoint to regenerate the shipped weights, then rebuild and evaluate:

```sh
pnpm --filter @gpu-time/training export --checkpoint runs/experiment/best.pt
pnpm build:core
pnpm evaluate
```

To inspect a candidate without changing the shipped model:

```sh
pnpm --filter @gpu-time/training export --checkpoint runs/experiment/best.pt --out ../../test-results/candidate.ts --skip-gate
```

The report, parity fixtures, and source snapshots stay beside that candidate. Candidate exports cannot write active metadata or canonical export history; `--skip-gate` cannot publish shipped weights.

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
