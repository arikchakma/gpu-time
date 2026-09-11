# Architecture

## Contract

`parse(text, context)` accepts one string and a caller context of `{ reference, timeZone, limit }`, and returns `{ occurrences, rrules, diagnostics, truncated, backend, timings }`. `parseMany(texts, context)` batches several inputs through one dispatch. `defineParser(options)` returns a reusable instance with an explicit `backend` and a `dispose()` method.

`reference` is an ISO instant, `timeZone` an IANA name, `limit` the maximum number of previewed occurrences. An unknown timezone rejects the call rather than falling back. Invalid expressions return diagnostics instead of fabricated dates.

The caller context never enters the model. Timezone, daylight-saving transitions, the reference date, and expansion limits are resolved by ordinary TypeScript after inference. There is no public AST or token-label output; `packages/core/src/schedule.ts` exposes the intermediate schedule for in-repo evaluation only and is not a published entry point.

The package keeps its WebGPU device, pipelines, weights, and grow-only buffers resident between calls. `parse` and `parseMany` schedule through one internal default instance, so the function API does not imply per-call initialization.

## Source preparation

One CPU scan splits the input into tokens and emits a sparse feature row per token. Each row records character shape, casing, digit and punctuation class, length bucket, lexicon membership for the closed vocabulary of time words, and hashes of neighboring tokens. There are 324 embedding rows in the feature table.

No grammar, regex collection, date library, or semantic segmenter runs on the CPU. The scan is mechanical and language-neutral in structure, though the lexicon itself is English.

## Learned context

The promoted model has 24,761 parameters, int6 weights, and f32 intermediates.

1. Sparse token features are summed into one learned vector per token.
2. Learned affine state updates scan the sequence in both directions, giving every token whole-sentence context. The browser kernel evaluates these scans in parallel blocks and carries exact block prefixes, so block boundaries do not reset context.
3. A classifier produces 40 output slots: 35 named semantic roles plus 5 reserved. The roles cover clock hours and minutes, meridiem, weekday, month, ordinal, year, quantity and unit, recurrence markers, range separators, bounds, exceptions, and filler. A `CLOCK_OFFSET` role distinguishes half and quarter clock arithmetic.
4. A boundary score per token cuts the sequence into independent expressions at threshold 4.25, so one input can yield several schedules.

Timezone has no role in the model. It was deliberately excluded: timezone arithmetic has exact answers that calendar code should compute, not approximate.

## Compilation and resolution

Predicted roles compile to a typed `Schedule`: date anchors, clock points, ranges, quantities, recurrence rules, and exclusions. Compilation is pure normalization — it assigns values to roles, resolves spoken numbers, and rejects role sequences that cannot form a valid schedule. It never consults the reference date.

The resolver then turns a schedule into instants. Calendar days and weeks preserve wall-clock time across DST; hours and minutes add elapsed time. Combined quantities apply in spoken order. Date-only ranges include the last named day and return an exclusive midnight endpoint; explicit clock endpoints return the stated instant. Recurrence produces a bounded preview plus RFC 5545 properties, with `truncated` signalling more occurrences beyond the preview. A weekly weekday rule with a monthly ordinal exception exports as the remaining ordinal weekdays; more complex exception combinations still preview correctly but return an `unsupported-export` diagnostic when one rule cannot represent them.

`packages/core/schema/schedule.schema.json` is generated from `src/types.ts` and validates the gold corpora.

## Model representation

Weights are symmetric per-tensor int6, generated into `packages/core/src/model/weights.gen.ts` by the training export and verified by sha256 against `packages/training/active/export-report.json`. Logical packed size is 18,571 bytes; the weights compress to 14,995 bytes Brotli. The full minified module is 27,064 bytes raw, 16,981 gzip, 35,058 Brotli including the shader.

The WGSL kernel in `src/model/kernel.wgsl` is specialized at build time: `src/model/shader-source.ts` splices model constants into it, `wgslender` minifies the result, and the build inlines the minified shader and the trimmed weight table directly into the JavaScript bundle. The `.wgsl` file never ships. For f16 storage the build emits two shader variants, with and without native half support.

## Backend selection

`backend: "auto"` dispatches to WebGPU once a batch reaches 32 expressions or 512 tokens, and runs on CPU below that, where device dispatch and readback dominate. `"cpu"` forces the scalar path. `"webgpu"` forces the GPU path and **disables the internal CPU fallback**, so the caller owns both the no-WebGPU case and a mid-session device loss. The CPU path is not a toy: it is the parity reference, and the browser test checks 10,000 sequences against it.

## Training and supervision

Supervision is generated, not scraped. `packages/training/torch/generate.py` renders schedules from 26 phrase families, and `natural.py` adds 16 natural-phrasing families including negative prose that contains no time expression at all. Labels come from the generator's own structure, never from the runtime parser — the model is never trained on its own output.

Each epoch draws fresh examples. The structural holdout and the unseen-sentence-frame evaluation are kept separate, because a split that only holds out rendered strings leaks the phrase family.

The text surrounding a time expression matters as much as the expression itself, because the model's only concept of "not a time" comes from whatever non-temporal text it was shown. That text has two sources. `background.py` composes carrier phrases from a slot grammar rather than drawing from a fixed list, and real English sentences from the pinned Tatoeba export supply prose nobody here wrote. Borrowed sentences need no labeler — every token in them is `O` — but any sentence containing a time word is filtered out first, since one stray `tomorrow` would be a silently wrong label.

Every run snapshots its source files and their hashes into `runs/<run>/source/`, so an exported checkpoint can be traced to the exact generator and tokenizer that produced it. Export records that lineage in `active/export-report.json` and `active/provenance.json`; `pnpm --filter @gpu-time/training audit:model` re-verifies the chain. Export is also gated: a candidate ships only if it strictly improves the unseen-carrier score with no per-family regression, with both sides decoded from int6 and re-scored in the same process. See `MODEL_CARD.md` for the decision and the two metrics involved.

## Performance boundaries

WebGPU helps for warm, large, or batched inputs. Device acquisition, pipeline compilation, buffer allocation, and weight upload all land on the first call; later calls reuse them. The runtime returns values to JavaScript, so it pays one readback synchronization per dispatch.

For a single short phrase a CPU parser is faster, which is exactly why `auto` keeps small inputs on the CPU. Warm medians over 10,000 inputs are 80.3 ms on WebGPU and 726.8 ms on CPU. Tokenization, inference, and resolution are timed separately and reported in the `timings` field.
