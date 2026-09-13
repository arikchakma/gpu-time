# Architecture

## Contract

`parse(text, context)` accepts one string and a caller context of `{ reference, timeZone, limit }`, and returns `{ occurrences, rrules, diagnostics, truncated, backend, timings }`. `parseMany(texts, context)` batches several inputs, with multiple dispatches for large batches. `defineParser(options)` returns a reusable instance with an explicit `backend` and a `dispose()` method.

`reference` is an ISO instant, `timeZone` an IANA name, `limit` the maximum number of previewed occurrences. An unknown timezone rejects the call rather than falling back. Diagnostics report known problems, but model errors can still produce incorrect dates.

The caller context never enters the model. Timezone, daylight-saving transitions, the reference date, and expansion limits are resolved by ordinary TypeScript after inference. There is no public AST or token-label output; `packages/core/src/schedule.ts` exposes the intermediate schedule for in-repo evaluation only and is not a published entry point.

The package keeps its WebGPU device, pipelines, weights, and grow-only buffers resident between calls. `parse` and `parseMany` schedule through one internal default instance, so the function API does not imply per-call initialization.

## Source preparation

One CPU scan splits the input into tokens. It writes one sparse feature row for each token. The row records the token kind, a length bucket, the first and last character class, an 8-bit hash of the lowercased token, a 7-bit hash of its consonant skeleton, eight flag bits for casing and position, the punctuation class on each side, and a number bucket. The feature table has 580 rows. Nothing writes to row 523. The model has no dictionary. `lexicon.ts` holds the month names, but only the compiler imports it. The tokenizer never does, so a month name reaches the model as spelling alone. The row carries no hash of the neighbouring tokens either. Context reaches the model through the five-tap convolution and the bidirectional scan below.

The tokenizer uses regular expressions and an English lexicon. The compiler and calendar resolver also run on the CPU.

## Learned context

The promoted model has 38,745 parameters, two scan layers, int6 weights, and f32 intermediates. The role transition matrix accounts for 1,600 parameters.

1. Sparse token features are summed into one learned vector per token.
2. Learned affine state updates scan the sequence in both directions, giving every token context within its input window. The browser kernel evaluates these scans in parallel blocks and carries exact block prefixes, so block boundaries do not reset context.
3. A classifier produces 40 output slots: 35 named semantic roles plus 5 reserved. The roles cover clock hours and minutes, meridiem, weekday, month, ordinal, year, quantity and unit, recurrence markers, range separators, bounds, exceptions, and filler. A `CLOCK_OFFSET` role distinguishes half and quarter clock arithmetic.
4. A boundary score per token cuts the sequence into independent expressions at threshold 0.75, so one input can yield several schedules.

Timezone has no role in the model. TypeScript computes timezone arithmetic after the model runs.

Two architecture options are recorded in the weights header and in `active/export-report.json` under `options`. `train.py --layers 2` adds a second scan block over the first one's output, with the same residual. The kernel uses the layer count from `shader-source.ts`. Both layers are active in the promoted model. `train.py --transitions` adds a 40x40 role transition matrix and trains the roles as a linear-chain CRF. Viterbi decodes the non-whitespace tokens on the CPU for both backends. The GPU returns its emissions to this same decoder. Per-token confidence is the emission softmax at the chosen label, not a CRF posterior marginal.

## Compilation and resolution

Predicted roles compile to a typed `Schedule`: date anchors, clock points, ranges, quantities, recurrence rules, and exclusions. The compiler assigns values to roles, resolves spoken numbers, and rejects role sequences that cannot form a valid schedule. It never consults the reference date.

The resolver then turns a schedule into instants. Calendar days and weeks preserve wall-clock time across DST; hours and minutes add elapsed time. Combined quantities apply in spoken order. Date-only ranges include the last named day and return an exclusive midnight endpoint; explicit clock endpoints return the stated instant. Recurrence produces a bounded preview plus RFC 5545 properties, with `truncated` signalling more occurrences beyond the preview. A weekly weekday rule with a monthly ordinal exception exports as the remaining ordinal weekdays; more complex exception combinations still preview correctly but return an `unsupported-export` diagnostic when one rule cannot represent them.

`packages/core/schema/schedule.schema.json` is generated from `src/types.ts` and validates the gold corpora.

## Model representation

The training exporter writes 6-bit symmetric per-tensor weights to `packages/core/src/model/weights.gen.ts`. Its SHA-256 hash must match `packages/training/active/export-report.json`. The active report records 29,059 logical packed bytes and 22,227 Brotli bytes for the weight module. The full package must pass the 50,000-byte Brotli release limit.

The WGSL kernel in `src/model/kernel.wgsl` is specialized at build time: `src/model/shader-source.ts` splices model constants into it, `wgslender` minifies the result, and the build inlines the minified shader and the trimmed weight table directly into the JavaScript bundle. The `.wgsl` file never ships. For f16 storage the build emits two shader variants, with and without native half support.

## Backend selection

`backend: "auto"` dispatches to WebGPU once a batch reaches 32 inputs or 512 tokens, and runs on CPU below that, where device dispatch and readback dominate. `"cpu"` forces the scalar path. `"webgpu"` forces the GPU path and **disables the internal CPU fallback**, so the caller owns both the no-WebGPU case and a mid-session device loss. Browser tests compare GPU output with the CPU reference.

## Training and supervision

Supervision is generated, not scraped. `packages/training/torch/generate.py` renders schedules, and `natural.py` adds natural-phrasing families including negative prose that contains no time expression at all. Labels come from the generator's own structure, never from the runtime parser — the model is never trained on its own output.

Each epoch draws fresh examples. The structural holdout and the unseen-sentence-frame evaluation are kept separate, because a split that only holds out rendered strings leaks the phrase family.

The model learns to distinguish time expressions from surrounding prose. `background.py` combines carrier phrases, and filtered Tatoeba sentences supply additional background. Every borrowed token receives the filler label `O`. The filter removes known time words and number patterns that resemble dates or times.

A warm-started run forgets. Fine-tuning the promoted checkpoint on a new family
learned that family and broke eleven unrelated cases, a failure known as a
**negative flip**: a case the reference model answered correctly and the update
does not. `train.py --distill <reference>` applies focal distillation from
[Positive-Congruent Training](https://arxiv.org/abs/2011.09161) (Yan et al.,
CVPR 2021), matching the reference's emissions and weighting the tokens it
already gets right:

```
loss = crf_nll + lambda * mean over tokens of
       (alpha + beta * [reference predicts the gold label]) * 0.5 * ||logits_new - logits_reference||^2
```

The paper's FD-LM variant matches logits directly and reports alpha=1, beta=5,
lambda=1. The promoted model uses `--distill-alpha 0 --distill-beta 5
--distill-lambda 0.1`: alpha=0 constrains only what the reference already
answers correctly and leaves everything else free to change, which is what lets
a new family be learned at all. At alpha=1, lambda=1 the update matched the
reference exactly and learned nothing. Checkpoint averaging was measured as the
alternative and was worse in both directions: it either diluted the new family
away or regressed reserved carriers.

A tagger trained on tokens is graded on sequences. `train.py --risk-lambda`
closes that gap. Each step decodes the batch, and for every sequence whose best
path is not the gold path it pushes the gold path above the decoder's choice:

```
loss = crf_nll + lambda * mean over wrongly decoded sequences of
       softplus( score(best path) + margin - score(gold path) )
```

Sequences already decoded correctly contribute nothing, so the term applies
pressure only where the model is wrong. The promoted model uses
`--risk-lambda 0.005 --risk-margin 4`. Scale matters: `crf_nll` is averaged per
token and settles near 0.02, while the penalty is averaged per wrong sequence
and is roughly the margin, so a lambda above about 0.01 drowns the token
objective. At `--risk-lambda 0.05` the model reached 71/71 authored English and
lost five chat cases; at 0.005 it reaches 70/71 and gains three.

This is the k=2 case of the ranked-candidate losses surveyed by
[Edunov et al., NAACL 2018](https://arxiv.org/abs/1711.04956), whose controlled
comparison found a sequence-level term must be mixed with the token loss rather
than replacing it, and the gold-versus-best-incorrect formulation of
[Suzuki et al., COLING-ACL 2006](https://aclanthology.org/P06-1028/).

## Real English

The generator writes both the sentences and their labels, so the model could only
ever learn the generator. `pnpm --filter @gpu-time/training harvest` adds text
written by people, labelled by whichever teacher can actually judge it:

| Source | Teacher | Rows |
| --- | --- | --- |
| `agreed` | chrono-node and our tagger agree on span and every stated field | 54,0k |
| `negatives` | both parsers silent, so the time-shaped words are not times | 7,9k |
| `recurrence` | our tagger alone; chrono has no recurrence support | 6,4k |
| `rescued` | chrono's span, our roles, for sentences we went silent on | 3,0k |
| `possessive` | our tagger on the bare word behind `'s` | 1,2k |
| `corrected` | chrono's span with the dropped modifier forced to `DEICTIC` | 1,0k |
| `duration` | three language judgements distilled into one rule | 0,7k |

Every row outside `agreed` is verified by compiling its labels and checking the
result against what the sentence states, so a wrong guess cannot enter the corpus.
Three filters protect the corpus: gold texts are dropped, a row may never label an
unambiguous time word as filler, and a sentence the duration rule claims may not
also appear labelled as a time.

`train.py --real <file>` appends these rows to every training epoch. Evaluation
splits are drawn first and excluded from training, which closed a 13.9% overlap
between validation and training.

Every run snapshots its sources and hashes. Export records lineage in `active/export-report.json` and `active/provenance.json`; `pnpm model:audit` checks it when the local checkpoints and history are available. A clean clone can check inference parity from committed fixtures, but cannot reproduce the full checkpoint audit. The promoted checkpoint records its reference checkpoint and distillation settings; earlier promotions on this line were weighted averages and record both parent hashes and coefficients, counting shared ancestors once. Evaluation uses Viterbi, including quantized transitions. Export requires no gold set or family regression through the built package, reserved-carrier improvement (or a tie at a perfect baseline) without family loss, and preserved bare expressions. These development gates do not establish real-user accuracy. See `MODEL_CARD.md` for metrics and remaining tradeoffs.

## Performance boundaries

WebGPU helps for warm, large, or batched inputs. Explicit WebGPU mode initializes the device during parser creation. Automatic mode waits until a batch needs it. Later calls reuse GPU resources. The runtime returns values to JavaScript, so it pays one readback synchronization per dispatch.

Automatic mode keeps small inputs on the CPU to reduce dispatch overhead. The recorded warm medians over 10,000 inputs are 122.4 ms on WebGPU and 993.9 ms on CPU. Viterbi discards a predecessor only when its best possible transition loses to a proven lower bound; ties and f32 step rounding are preserved. Tokenization, inference, and resolution are timed separately and reported in the `timings` field.
