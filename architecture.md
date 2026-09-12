# Architecture

## Contract

`parse(text, context)` accepts one string and a caller context of `{ reference, timeZone, limit }`, and returns `{ occurrences, rrules, diagnostics, truncated, backend, timings }`. `parseMany(texts, context)` batches several inputs, with multiple dispatches for large batches. `defineParser(options)` returns a reusable instance with an explicit `backend` and a `dispose()` method.

`reference` is an ISO instant, `timeZone` an IANA name, `limit` the maximum number of previewed occurrences. An unknown timezone rejects the call rather than falling back. Diagnostics report known problems, but model errors can still produce incorrect dates.

The caller context never enters the model. Timezone, daylight-saving transitions, the reference date, and expansion limits are resolved by ordinary TypeScript after inference. There is no public AST or token-label output; `packages/core/src/schedule.ts` exposes the intermediate schedule for in-repo evaluation only and is not a published entry point.

The package keeps its WebGPU device, pipelines, weights, and grow-only buffers resident between calls. `parse` and `parseMany` schedule through one internal default instance, so the function API does not imply per-call initialization.

## Source preparation

One CPU scan splits the input into tokens and emits a sparse feature row per token. Each row records character shape, casing, digit and punctuation class, length bucket, lexicon membership for the closed vocabulary of time words, and hashes of neighboring tokens. There are 580 embedding rows in the feature table, including a 128-bucket hash of each token's consonant skeleton.

The tokenizer uses regular expressions and an English lexicon. The compiler and calendar resolver also run on the CPU.

## Learned context

The promoted model has 34,553 parameters, int6 weights, and f32 intermediates. 1,600 of those are the role transition matrix, which the promoted model now uses.

1. Sparse token features are summed into one learned vector per token.
2. Learned affine state updates scan the sequence in both directions, giving every token context within its input window. The browser kernel evaluates these scans in parallel blocks and carries exact block prefixes, so block boundaries do not reset context.
3. A classifier produces 40 output slots: 35 named semantic roles plus 5 reserved. The roles cover clock hours and minutes, meridiem, weekday, month, ordinal, year, quantity and unit, recurrence markers, range separators, bounds, exceptions, and filler. A `CLOCK_OFFSET` role distinguishes half and quarter clock arithmetic.
4. A boundary score per token cuts the sequence into independent expressions at threshold 1.25, so one input can yield several schedules.

Timezone has no role in the model. TypeScript computes timezone arithmetic after the model runs.

Two architecture options are recorded in the weights header and in `active/export-report.json` under `options`. `train.py --layers 2` adds a second scan block over the first one's output, with the same residual; the kernel loops over the layer count spliced in by `shader-source.ts`. It is off in the promoted model. `train.py --transitions` adds a 40x40 role transition matrix, trains the roles as a linear-chain CRF instead of per-token cross-entropy, and decodes them by Viterbi over the non-whitespace tokens. It is **on** in the promoted model: the chain is what keeps `19` a day of month rather than an hour after a range separator in "17 August 2013 2pm - 19 August 2013 2pm", which every per-token candidate for this release got wrong. Viterbi runs on the CPU for both backends: the GPU path reads its emissions back and decodes them with the same function, so the two backends cannot diverge in the decode. Per-token confidence under Viterbi is the softmax of the emission at the chosen label, not the runner-up margin the argmax path reports.

## Compilation and resolution

Predicted roles compile to a typed `Schedule`: date anchors, clock points, ranges, quantities, recurrence rules, and exclusions. The compiler assigns values to roles, resolves spoken numbers, and rejects role sequences that cannot form a valid schedule. It never consults the reference date.

The resolver then turns a schedule into instants. Calendar days and weeks preserve wall-clock time across DST; hours and minutes add elapsed time. Combined quantities apply in spoken order. Date-only ranges include the last named day and return an exclusive midnight endpoint; explicit clock endpoints return the stated instant. Recurrence produces a bounded preview plus RFC 5545 properties, with `truncated` signalling more occurrences beyond the preview. A weekly weekday rule with a monthly ordinal exception exports as the remaining ordinal weekdays; more complex exception combinations still preview correctly but return an `unsupported-export` diagnostic when one rule cannot represent them.

`packages/core/schema/schedule.schema.json` is generated from `src/types.ts` and validates the gold corpora.

## Model representation

The training exporter writes 6-bit symmetric per-tensor weights to `packages/core/src/model/weights.gen.ts`. Its SHA-256 hash must match `packages/training/active/export-report.json`. The active report records 25,915 logical packed bytes and 19,089 Brotli bytes for the weight module. The full package must pass the 50,000-byte Brotli release limit.

The WGSL kernel in `src/model/kernel.wgsl` is specialized at build time: `src/model/shader-source.ts` splices model constants into it, `wgslender` minifies the result, and the build inlines the minified shader and the trimmed weight table directly into the JavaScript bundle. The `.wgsl` file never ships. For f16 storage the build emits two shader variants, with and without native half support.

## Backend selection

`backend: "auto"` dispatches to WebGPU once a batch reaches 32 inputs or 512 tokens, and runs on CPU below that, where device dispatch and readback dominate. `"cpu"` forces the scalar path. `"webgpu"` forces the GPU path and **disables the internal CPU fallback**, so the caller owns both the no-WebGPU case and a mid-session device loss. Browser tests compare GPU output with the CPU reference.

## Training and supervision

Supervision is generated, not scraped. `packages/training/torch/generate.py` renders schedules, and `natural.py` adds natural-phrasing families including negative prose that contains no time expression at all. Labels come from the generator's own structure, never from the runtime parser — the model is never trained on its own output.

Each epoch draws fresh examples. The structural holdout and the unseen-sentence-frame evaluation are kept separate, because a split that only holds out rendered strings leaks the phrase family.

The model learns to distinguish time expressions from surrounding prose. `background.py` combines carrier phrases, and filtered Tatoeba sentences supply additional background. Every borrowed token receives the filler label `O`. The filter removes known time words and number patterns that resemble dates or times.

Every run snapshots its source files and their hashes into `runs/<run>/source/`, so an exported checkpoint can be traced to the exact generator and tokenizer that produced it. Export records that lineage in `active/export-report.json` and `active/provenance.json`; `pnpm --filter @gpu-time/training audit:model` re-verifies the chain. Export is also gated, and the gate is deliberately not generated data: a candidate ships only if its pooled exact-schedule accuracy on the hand-authored gold sets, scored through the built TypeScript package against the shipped weights, is no worse than the baseline's within a two-proportion tolerance. A tie ships. The reserved-carrier and bare-expression scores are still recorded on every export as non-blocking telemetry. See `MODEL_CARD.md` for the decision and the metrics involved.

## Performance boundaries

WebGPU helps for warm, large, or batched inputs. Explicit WebGPU mode initializes the device during parser creation. Automatic mode waits until a batch needs it. Later calls reuse GPU resources. The runtime returns values to JavaScript, so it pays one readback synchronization per dispatch.

Automatic mode keeps small inputs on the CPU to reduce dispatch overhead. The recorded warm medians over 10,000 inputs are 82.7 ms on WebGPU and 702.5 ms on CPU. Tokenization, inference, and resolution are timed separately and reported in the `timings` field.
