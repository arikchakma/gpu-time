# gpu-time model card

## Model

The package embeds checkpoint `step7-crf2`, epoch index 15, with artifact SHA-256 `a91218532329ee47300260b9709b636ef99a4cdf51857f0ce4f739762433ee0d`. It has 34,553 parameters, 580 embedding rows, and 40 role slots (35 named roles plus five reserved). The 1,600 parameters over the earlier 32,953 are a 40x40 role transition matrix, trained as a linear-chain CRF (`train.py --transitions`) and decoded by Viterbi. Weights use 6-bit symmetric per-tensor quantization, with f32 intermediate calculations. The active report records 19,051 Brotli bytes for the weights, seven checkpoints, and 724,460,578 training tokens.

The model predicts one role per token, such as hour, weekday, quantity, recurrence marker, or filler. A separate boundary score splits the input into expressions at threshold 0.0, fitted by `calibrate.py` on the development splits. The `CLOCK_OFFSET` role represents half-hour and quarter-hour clock arithmetic.

Timezone is not a model role. TypeScript handles calendar arithmetic, daylight saving time, the reference instant, and expansion limits after the model runs.

## Intended use

The parser turns short English time expressions into dates, ranges, and recurrence rules on the client. Examples include reminder fields, schedule forms, and command bars.

It is not suitable for parsing documents, extracting dates from long prose, legal or medical scheduling, billing, compliance, or any decision where a wrong or invented date has real consequences. It supports English only and has no language detection.

## Training data

Supervision is entirely generated. `packages/training/torch/generate.py` renders schedules, and `natural.py` adds natural-phrasing families, including negative prose containing no time expression. Labels come from the generator's structure, never from the runtime parser, so the model is not trained on its own predictions.

The active weights have a seven-checkpoint history with 724,460,578 training tokens. The final run starts from `step5-keepo-crf3` and draws 300,000 fresh examples per epoch. A fresh model can lose terse forms that earlier checkpoints learned.

Generated corpora live under the ignored `packages/training/data/synth/` and include the training data built with `pnpm gen`. Hand-authored evaluation corpora are tracked in `packages/training/data/gold/`.

The training data reflect the generators, so these scores do not establish accuracy on real user language.

The generators combine surrounding phrases and use filtered Tatoeba sentences as background text. They also generate terse forms, including bare day groups, abbreviated weekday ranges, month-day ranges, and bare clock ranges.

Sentences with no time expression at all are family 23, and they are about 15% of the corpus, up from about 8%. The rise is not a weight change: family 23 used to lose roughly half its draws to the terse and natural branches, which emit labelled expressions, so its 15% weight only produced 8% negatives. `background.numeric()` renders them in nine categories chosen from what the previous weights got wrong -- a measured duration after a completion verb, an ordinal on an ordinary noun, a numbered thing, a score, a numeric range, an age, a percentage, a month name used as a person, and a vague count -- drawn uniformly over categories so the older twenty-five number frames cannot swamp them. Each category is the non-temporal half of a contrastive pair whose labelled half the generator already emits: "he ran a mile in four minutes" against "call me in four minutes", "the 3rd edition" against "on the 3rd", "May said three things" against "May 3". Two surfaces are deliberately kept sparse, because they are also role words: "in N minutes" as filler appears about once per five labelled shifts, and "half" and "quarter" as filler about once per twenty-five labelled `CLOCK_OFFSET` uses. Raising either share measurably costs the role.

Two negative groups are contrastive by construction rather than by category. `background.carrier_contrast()` renders the scheduling verbs of `natural.py`'s `carrier-date` family -- scheduled for, rescheduled for, penciled in for, set for, push X to -- with a non-date after the preposition ("the report is scheduled for review"), so the verb and its preposition cannot decide the label on their own; it runs at roughly two thirds the volume of the labelled `carrier-date` family, which is itself weighted at half a share. `background.month_part()` renders `mid`, `mid-`, `early` and `late` before a month name as all filler, matching the policy that the library has no mid-month sub-period. `natural.py`'s `datetime-range` family renders a full day-month-year date and a clock on both sides of a dash, en dash, "to" or "until", in both day-first and month-first order, so the number after the separator is a day of month and never an hour.

Carrier words are mined from the borrowed prose rather than listed: `background.vocabulary()` collects roughly 2,300 nouns and 1,000 verbs by the word that follows a determiner or an infinitive, minus the time vocabulary. The same expression therefore appears beside thousands of different filler words, in statements, questions, requests, verbless event titles, lists, and two-sentence messages. Sentence-final `?`, `!`, `.`, `)` and quotes are glued to the last token of many carriers, and the weekday and month abbreviations the lexicon accepts (`tues`, `weds`, `thurs`, `thu`, `sept`) are emitted alongside the three-letter forms.

## Evaluation

The saved reports cover different model versions. Each result below describes its recorded run.

- **Unseen carriers: 993/1000 for `terse-f32`.** The reserved surrounding words are absent from training. The score requires exact schedule structures. `packages/training/results/natural-reserved-evaluation.json` identifies the older artifact, not the current `spoken2` weights.
- **Microsoft Recognizers development agreement: 167/563 (29.7%), up from 156.** Independent third-party date/time specifications, and the only measure here that is not our own distribution. Its reserved test split — all 134 grouped test cases — is not used for model selection. Policy differences count as failures rather than being excused.

  Of the 396 non-matching cases, 194 fail interpretation and 137 return a different value. Interpretation failures can come from wrong model roles or missing compiler support. The failure stage alone does not identify the cause. The weakest family is `DatePeriodParser` at 24/190.

- **Hand-authored chat gold: 268/330 for `step7-crf2`, down two from `step5-keepo-crf3`.** Per family: question 26/27, tatoeba 69/86 (was 64/86), calendar 44/51 (was 45/51), abbrev 24/28 (was 25/28), correction 13/16 (was 14/16), prose 20/22, relative 19/22, recognizers 44/62 (was 46/62), negation 9/16 (was 11/16). Chat is hand-written for this project, so it is a development set, not held-out data.
- **Non-temporal negatives: 183/192, and 125/132 on the original 132 rows, up from 111/132 before the negatives work.** `negatives.jsonl` grew by sixty rows (133-192) covering measurement durations after a completion verb, ordinals on nouns, numbered things, scores, numeric ranges, ages, percents, month names used as people, fractions and vague counts. On the older `step3-580b` weights that 192-row file scored 150/192. Nine negatives still fail and `packages/core/test/grammar-model.test.ts` keeps them as running `it.fails` cases.
- **Prose gold: 73/73, recovered from 70/73.** "The meeting is scheduled for next week" in three casings used to label `for` as `DUR` and compile to null. `natural.py`'s `carrier-date` family teaches the scheduling verb with a date after it, and `background.carrier_contrast()` teaches the same verbs pointing at a non-date, so the preposition alone no longer decides.
- Recorded `terse-f32` results: 4,972/5,000 generated interpretations and 999/1,000 natural phrasings. Both share training families and are development metrics, not real-user language accuracy.
- The saved reports record 18/18 packaged public-result fixtures and 25/25 adversarial schedules. These fixtures influenced implementation and training; they are a regression gate, not an untouched test.
- Unit tests cover tokenization, compilation, calendar resolution, DST, RFC 5545 export, and inference workspace reuse.
- The recorded `terse-f32` CPU/WebGPU comparison covers 10,000 sequences, 512 fixtures directly against PyTorch, and 1,000 source-versus-packaged shader sequences.
- Warm medians over 10,000 inputs: WebGPU 82.7 ms, CPU 702.5 ms, Chrono 82.8 ms. Other parsers return different structures; this is a timing comparison, not a capability comparison.

## Limitations

- Accuracy on real user phrasing is unmeasured. The generated expressions share training families, including those with reserved surrounding prose.
- English only. Other languages can produce incorrect results without a diagnostic.
- Vague expressions (`ASAP`, `after work`, `soon`) are deliberately given no clock value rather than a guessed one.
- Ambiguous numeric dates depend on the caller's `dateOrder` (`MDY` by default). `03/04/2027` is ambiguous. `21/04/2016` is not and resolves correctly either way.
- Complex recurring exception combinations preview correctly but can return an `unsupported-export` diagnostic when no single RFC 5545 rule represents them.
- Quantization and browser GPU implementations can differ from the PyTorch reference unless parity is explicitly tested. It is, but only for the fixtures listed above.
- WebGPU startup and dispatch overhead make small inputs slower than a CPU parser, which is why `auto` keeps them on the CPU.
- The release build must stay within the 50,000-byte Brotli limit.

## Reproducibility

`packages/training/active/` holds `export-report.json` (selected weights, lineage, calibration, source hashes, token metrics), `provenance.json` (the checkpoint chain with hash verification), and the `parity.*` fixtures that check decoded int6 inference against PyTorch logits.

`packages/training/runs/step7-crf2/` keeps the promoted run's report and a source snapshot of the exact generator, tokenizer, and label set used to produce it. The export source directory recorded in `export-report.json` keeps the export-time snapshot and lockfile. The `.pt` checkpoint itself is not tracked, so re-export requires the local checkpoint.

`pnpm --filter @gpu-time/training audit:model` currently stops on this chain. The ancestor run `carrier-int5` lists `data/prose/sentences.txt` in its `sourceHashes` but never snapshotted the file, and the prose corpus has changed since that run, so the recorded hash can no longer be satisfied by any file on disk. Later runs record the prose under `datasetHashes` instead, which the audit does not try to open. `active/provenance.json` therefore still describes the previous artifact.

`pnpm --filter @gpu-time/training audit:model` re-verifies the weight file hash and the training source hashes against the recorded chain. Superseded runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.

## Promotion

Export is gated on the hand-authored gold sets in `packages/training/data/gold/`: `chat`, `prose`, `user-cases`, `negatives`, and `adversarial`. Nothing in that set is rendered by the training generators. The exporter builds the distributed package twice — once from the candidate weights module, once from the shipped `weights.gen.ts` — and scores both through `packages/benchmark/src/evaluate-model.ts`, the same script and the same exact-schedule comparison `pnpm evaluate` uses. A candidate ships when its pooled exact-schedule count is no worse than the baseline's beyond a two-proportion z=1.96 tolerance. A tie ships; an improvement is not required. Support is pooled across the sets because the smallest of them holds three rows. It replaces files by rename and writes the report last. `--force` overrides the decision and records what it overrode.

The reserved-carrier and bare-expression scores are still measured on every export and recorded under `promotion.synthetic` in `export-report.json`, with per-family two-proportion guards, but they are labelled non-blocking and decide nothing. Those corpora come from the same renderers as part of training, so they measure the generator against itself.

The historical **993/1000** result measures exact schedule structures through the built TypeScript parser. The synthetic telemetry measures exact token labels and expression boundaries in PyTorch, including filler labels. The active model scores **999/1000** on reserved carriers and **1000/1000** bare, compared with **970/1000** and **1000/1000** for its predecessor. These metrics measure different outputs and cannot be compared directly.

Held-in metrics do not control promotion. `calibrate()` uses the `heldout` split to select the boundary threshold, so that split supplies development metrics.
