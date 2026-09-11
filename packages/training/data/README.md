# Training data

`data/gold/` contains tracked, authored fixtures and generated variations. Expected schedules come from specifications, not model predictions. These fixtures guide development, so they are not untouched test data. The seeding scripts in `../src/` write one JSON record per line, with an `id`, `text`, and expected `schedule`. A `null` schedule means no schedule is expected.

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

`grammar.jsonl` is the authored
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
(`semantic-checks.jsonl`, `natural-evaluation.jsonl`, and related files) and the featurized
`.bin` shards that `torch/train.py` reads. Generate the default training data with:

```sh
pnpm --filter @gpu-time/training gen
```

Supervision comes from the renderer's semantic slots, never from the runtime parser,
so a `data/synth/` split is only as trustworthy as the generator that produced it.
Each split records a `.manifest.json` with the generator's own sha256 and a
`.fingerprints.json` of structural signatures, which is how train/validation/heldout
splits are kept disjoint.

`data/prose/` contains downloaded background text and is git-ignored. `sentences.txt` holds filtered English sentences from the [Tatoeba](https://tatoeba.org) export, one per line. These add phrasing beyond the generator's own templates. Fetch it with:

```sh
pnpm --filter @gpu-time/training corpus:fetch
```

`corpus.json` is the tracked pin: the export URL, its license, the retrieval date, the
sha256 of the archive that was downloaded, and every filter and selection parameter.
Tatoeba rebuilds the export weekly, so a later fetch will disagree with the pinned
digest; the fetcher stops and asks for the pin to be updated rather than swapping the
corpus out underneath a run. The archive and `sentences.txt` itself stay out of git.

Every borrowed token is labeled `O`. A missed time expression can receive the wrong label. The filter removes sentences with a weekday, month, unit, holiday, or quantity in
`../../core/src/lexicon.ts`, if a number resembles a date or time, or if it uses one of the
temporal words `corpus.json` lists (`today`, `noon`, `pm`, `ago`, and the rest) that the
lexicon does not export. `a` and `an` are the only quantities kept — they are temporal
only next to a unit, and every unit is already gone.

The earlier 2026-09-11 retrieval recorded these counts under the digit-rejecting filter. The current filter permits plain numbers:

| dropped by     | sentences |
| -------------- | --------- |
| length         | 704,301   |
| time word      | 195,553   |
| sentence shape | 27,740    |
| digit          | 24,672    |
| duplicate      | 0         |
| kept           | 1,083,878 |

The fetcher selects an evenly spaced sample of up to 50,000 sentences. The file is optional. If it is absent, `torch/generate.py` uses its own phrase grammar.

Tatoeba's sentences are CC-BY 2.0 FR. Anything shipped from a model trained on them owes
Tatoeba (https://tatoeba.org) attribution.
