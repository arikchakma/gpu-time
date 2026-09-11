# Training data

`data/gold/` is hand-authored and tracked. Nothing in it comes from the model, so it can
be used to judge the model. The seeding scripts in `../src/` are the authoring surface:
they encode the cases in TypeScript and rewrite the corresponding `.jsonl`, one record
per line, each with an `id`, a `text`, and the expected `schedule` (`null` where no
schedule should be produced).

| file                       | records | written by             | read by                                                                                                   |
| -------------------------- | ------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `grammar.jsonl`            | 115     | `pnpm seed:grammar`    | `grammar-model.test.ts`, `evaluate-model.ts`                                                              |
| `grammar-variations.jsonl` | 314     | `pnpm seed:variations` | `grammar-model.test.ts`, `evaluate-model.ts`                                                              |
| `adversarial.jsonl`        | 25      | `pnpm seed:gold`       | `grammar-model.test.ts`, `schema.test.ts`, `evaluate-model.ts`, `perf.browser.ts`, benchmark `sidecar.py` |
| `user-cases.jsonl`         | 3       | `pnpm seed:gold`       | `schema.test.ts`, `evaluate-model.ts`                                                                     |
| `labels.jsonl`             | 26      | `pnpm seed:gold`       | `oracle.test.ts`, `schema.test.ts`, `evaluate-model.ts`, `pnpm evaluate:oracle`                           |
| `negatives.jsonl`          | 32      | `pnpm seed:negatives`  | `grammar-model.test.ts`, `evaluate-model.ts`                                                              |
| `prose.jsonl`              | 72      | `pnpm seed:prose`      | `grammar-model.test.ts`, `evaluate-model.ts`                                                              |
| `results.jsonl`            | 18      | authored by hand       | `results-gold.test.ts`, `evaluate-results.ts`                                                             |
| `oracle-baseline.json`     | —       | `pnpm evaluate:oracle` | recorded baseline, not an input                                                                           |

A few notes on what the individual corpora are for. `grammar.jsonl` is the authored
grammar surface; `grammar-variations.jsonl` is derived from it mechanically (casing,
spacing, and weekday/month abbreviation) rather than written by hand. `labels.jsonl`
carries per-token label and clause-boundary annotations, which is what lets
`evaluate:oracle` run the compiler on perfect tags and separate compiler bugs from
model errors; `oracle-baseline.json` is that run's recorded output. `negatives.jsonl`
is deliberately non-temporal text, including words that are time words in other
contexts, so a `null` schedule is the correct answer. `results.jsonl` is the only
corpus with a resolution context and expected occurrences rather than a schedule —
it checks the resolver end to end.

Regenerate any of them with, for example:

```sh
pnpm --filter @gpu-time/training seed:grammar
```

`data/synth/` is generated, git-ignored, and never hand-edited. It holds the sampled
training, validation, and heldout splits per run, plus the independent check corpora
(`semantic-checks.jsonl`, `natural-evaluation.jsonl`, and friends) and the featurized
`.bin` shards that `torch/train.py` reads. Rebuild it with:

```sh
pnpm --filter @gpu-time/training gen
```

Supervision comes from the renderer's semantic slots, never from the runtime parser,
so a `data/synth/` split is only as trustworthy as the generator that produced it.
Each split records a `.manifest.json` with the generator's own sha256 and a
`.fingerprints.json` of structural signatures, which is how train/validation/heldout
splits are kept disjoint.
