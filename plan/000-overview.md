# gpu-time — plan overview

**One sentence:** a tiny trained model (target ≈ 30K parameters, ≈ 15 KB compressed) that runs in the browser on WebGPU, reads English time expressions such as `1 day before`, `Monday at 2pm`, or `Monday 10pm-12am and Saturday Sunday 1pm-8pm`, and returns JSON: a typed schedule tree, resolved ISO dates, and RFC 5545 `RRULE` strings.

The design copies gpu-lexer's shape (Vercel Labs, 27.5 KB, Sept 2026): cheap rule-based tokenizer → hand-packed token features → small neural sequence tagger on the GPU → deterministic post-processing on the CPU. The neural part decides *what each token means in context*. Plain code turns those labels into dates. Calendar math is never learned; it is computed.

## Why a model at all (for a non-expert reader)

Regex parsers (chrono-node, dateparser, …) break when the same word means different things depending on context:

| Word | Meaning A | Meaning B |
|---|---|---|
| `10` | hour in `Monday 10pm` | count in `10 days before` |
| `and` | joins a list in `Saturday and Sunday 1pm` | starts a new clause in `Monday 10pm and Saturday 1pm` |
| `last` | "previous" in `last Friday` | "final" in `last Friday of every month` |
| `from` | range start in `from 9 to 5` | recurrence start in `every Monday from October` |
| `in` | "after" in `in 3 days` | filler in `in October` |

A sequence model sees the whole sentence and labels each token by context. Once every token has the right label, building the schedule is bookkeeping. That is why gpu-lexer works with 41K parameters and why we can too.

## Phases

| # | File | Deliverable | Depends on |
|---|---|---|---|
| 001 | `001-research.md` | What gpu-lexer really does, what existing parsers fail at, which datasets we may use | — |
| 002 | `002-scope-and-json-schema.md` | Supported language, output JSON types, ambiguity policy | 001 |
| 003 | `003-project-structure.md` | Repo layout, tooling, build, size budget | 002 |
| 004 | `004-tokenizer-and-labels.md` | Rule tokenizer, packed features, the label set | 002, 003 |
| 005 | `005-compiler-and-resolver.md` | Labels → schedule JSON → dates/RRULE (built and tested on hand labels **before** any model exists) | 004 |
| 006 | `006-dataset.md` | Synthetic generator, prose carriers, augmentation, held-out and gold sets, token counts | 004, 005 |
| 007 | `007-model-and-training.md` | Architecture, exact parameter count, training recipe, int6 export, parity tests | 006 |
| 008 | `008-webgpu-inference.md` | WGSL kernel, buffers, batching, CPU fallback, backend selection | 007 |
| 009 | `009-benchmark.md` | Harness vs chrono-node, compromise, rrule, Recognizers, dateparser, recurrent, timefhuman; accuracy, perf, size | 005, 008 |
| 010 | `010-playground-and-release.md` | Demo site, worker, docs, npm publish | 009 |
| 011 | `011-risks-and-open-questions.md` | What can go wrong and what we have not decided | all |

Each phase file has: goal, work items, files produced, acceptance criteria, effort. Effort is in focused working days for one person with Claude Code.

## Headline numbers (targets, justified in the phase files)

| Metric | Target | Reference |
|---|---|---|
| Parameters | 32,693 (config M) | gpu-lexer: 41,321 |
| Weights on the wire | ≈ 24.5 KB raw int6 → ≈ 14 KB brotli | gpu-lexer: 31 KB → 20.8 KB |
| Whole library, brotli | ≤ 30 KB (model + tokenizer + compiler + resolver + GPU runtime) | gpu-lexer 27.5 KB; chrono-node 44 KB gz; compromise-dates 180 KB gz |
| Labels | 32 token classes + 1 clause-boundary head | gpu-lexer: 9 classes |
| Training tokens | ≈ 2.7M per epoch, fresh synthetic data every epoch, ≈ 50M seen | gpu-lexer: 4.7M per epoch |
| Held-out template accuracy | ≥ 98% token labels, ≥ 95% exact schedule match | — |
| Adversarial-25 set (inputs that break incumbents) | ≥ 22/25 fully correct | best incumbent: ≈ 8/25 |
| CPU latency, single short input | ≤ 50 µs (same order as chrono-node) | chrono ≈ 20–45 µs |
| WebGPU throughput | ≥ 100K expressions/s batched, off the main thread | — |
| Cold start (decode weights + create pipeline) | ≤ 30 ms | — |

## Decisions already made

1. **Token-level tagger, not seq2seq.** Output is per-token labels; JSON is assembled by code. Same as gpu-lexer. Autoregressive decoding on GPU would be slow and large.
2. **Tokenizer is code, features are hand-packed** (two 32-bit words per token), embedding is a "bag of feature rows". Copied from gpu-lexer; it is why the model stays tiny.
3. **The model never sees the calendar.** It does not know today's date. Relativity ("next", "in 3 days") is emitted as typed nodes; the resolver applies a reference date and timezone.
4. **CPU fallback is mandatory** (gpu-lexer has none). Same weights, same math, in plain JS. Also lets Node/SSR use the parser.
5. **No Temporal polyfill.** Timezone math uses built-in `Intl.DateTimeFormat` (≈ 2 KB of helper code). A polyfill would be 130 KB and dwarf the model.
6. **Prose input is supported.** `remind me to call Sam on Monday at 2pm` yields one expression with offsets 21–37, like gpu-lexer's spans. This is also what makes the GPU worthwhile: tagging every time expression in a long document is the large-input case.
7. **Ambiguity is a resolver option, not a parser opinion.** `next Friday` is emitted as `{weekday: FR, modifier: 'next'}`; the resolver has a policy flag. Survey shows no two libraries agree.
8. **Honest failure.** Anything the compiler cannot assemble returns `schedule: null` with diagnostics and offsets. Never "now" (parsedatetime and date.js do that, and users hate it).

## Non-goals for v1

Non-English input, holidays beyond a handful of fixed dates, fuzzy periods that need world knowledge ("end of the quarter", "business days"), compound spelled-out numbers ("twenty-three"), full `.ics` generation, parsing RRULE strings back to English.

## Glossary

- **Token**: a run of letters, a run of digits, one punctuation char, or a run of spaces. `10pm` is two tokens: `10`, `pm`.
- **Label / tag**: the class the model assigns each token, e.g. `HOUR`, `WEEKDAY`, `DIR_BEFORE`.
- **Clause**: one date-plus-time unit. `Monday 10pm-12am and Saturday Sunday 1pm-8pm` has two clauses.
- **Schedule**: the JSON tree for a whole expression; a list of clauses.
- **Resolver**: code that turns a schedule plus a reference date/timezone into concrete instants.
- **RRULE**: the iCalendar recurrence string, e.g. `FREQ=WEEKLY;BYDAY=MO`.
- **int6**: each weight stored as one of 64 values (6 bits) with one scale factor per tensor. gpu-lexer's trick for ~0.5 bytes/parameter after brotli.
- **Parallel scan**: a way to run a recurrent network across all positions at once on a GPU instead of one step at a time.
- **QAT**: quantization-aware training; the trainer simulates int6 rounding so accuracy does not drop at export.
