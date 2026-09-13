# gpu-time model card

## Model

The package embeds `lessgen2`, with artifact SHA-256 `27982a9b9294c33b745cfa54f597d039feed52634c6c29c8c68ad47ce18f8aa3`. It fine-tunes `risk-w0.005` under focal distillation against that same checkpoint, so the update learns new forms without flipping cases the reference already answers correctly. Its lineage runs back through `ad-f001` and `english-coverage-layer2-negative-blend-075`; `audit:model` verifies the chain.

The model has 38,745 parameters, two scan layers, 580 embedding rows, and 40 role slots (35 named roles plus five reserved). A 40x40 CRF transition matrix supports Viterbi decoding. Weights use 6-bit symmetric per-tensor quantization with f32 intermediates. The active report records 22,519 Brotli bytes for the weights. The published package is 44,682 Brotli bytes, below the 50,000-byte limit.

The model predicts one role per token, such as hour, weekday, quantity, recurrence marker, or filler. A separate boundary score splits the input into expressions at threshold 1.0, fitted by `calibrate.py` on the development splits. The `CLOCK_OFFSET` role represents half-hour and quarter-hour clock arithmetic.

Timezone is not a model role. TypeScript handles calendar arithmetic, daylight saving time, the reference instant, and expansion limits after the model runs.

## Intended use

The parser turns short English time expressions into dates, ranges, and recurrence rules on the client. Examples include reminder fields, schedule forms, and command bars.

It is not suitable for parsing documents, extracting dates from long prose, legal or medical scheduling, billing, compliance, or any decision where a wrong or invented date has real consequences. It supports English only and has no language detection.

## Training data

Training data comes from three sources. `generate.py` and `natural.py` write schedules and natural phrasing, and the generator supplies the labels. Tatoeba supplies real English, and a sentence enters only when two parsers agree. `data/teacher/teacher.jsonl` holds 1,004 written sentences. A language model proposes those labels and the compiler accepts them.

The third source covers what agreement cannot reach. chrono-node cannot read recurrence, so `every <month>` had no correct label anywhere in the training data.

The shipped model uses 60,000 generated rows. The default is 300,000.

The earlier `balanced-prose` model followed `step7-crf2` through `carrier-consistent`, `contrast-coverage`, and `prose-coverage`. The current model warm-starts from that lineage and adds a second scan layer. Training adds prose months, compact dates, clock-qualified dayparts, shifts, idioms, and mixed temporal/non-temporal contexts. Imperative carriers and trailing actions remain `O`; only the time expression receives temporal roles. A targeted correction adds ordinal rankings, street addresses, and place-name contrasts. The final 75% correction average passed every existing export gate without `--force`. These fixtures guide development and are not an untouched test set.

Generated corpora live under the ignored `packages/training/data/synth/` and include the training data built with `pnpm gen`. Hand-authored evaluation corpora are tracked in `packages/training/data/gold/`.

The training data reflect the generators, so these scores do not establish accuracy on real user language.

The generators combine surrounding phrases and use filtered Tatoeba sentences as background text. They also generate terse forms, including bare day groups, abbreviated weekday ranges, month-day ranges, and bare clock ranges.

Sentences with no time expression are family 23, roughly 15% of draws before structural exclusions. That branch runs before terse and natural rendering, so it no longer loses half its draws to positive examples. `background.numeric()` samples uniformly across 12 categories: measured durations, ordinals on ordinary nouns, numbered objects, addresses, arithmetic and partitive counts, scores, numeric ranges, ages, percentages, month names used as people, vague counts, and general numeric prose. Contrasts include "he ran a mile in four minutes" against "call me in four minutes", "the 3rd edition" against "on the 3rd", and "May said three things" against "May 3". Duration phrases and fractional words occur as filler sparingly because those same words also carry roles in valid shifts and clocks.

`background.carrier_contrast()` pairs scheduling verbs with a non-date target ("the report is scheduled for review"), while the half-weight `carrier-date` family supplies date targets. `background.month_part()` renders `mid`, `mid-`, `early` and `late` before a month name as filler, matching the policy that the library has no mid-month sub-period. The `datetime-range` family renders a full date and clock at both endpoints, in day-first and month-first order, so the number after the separator is a day of month rather than an hour.

Carrier words are mined from the borrowed prose rather than listed: `background.vocabulary()` collects roughly 2,300 nouns and 1,000 verbs by the word that follows a determiner or an infinitive, minus the time vocabulary. The same expression therefore appears beside thousands of different filler words, in statements, questions, requests, verbless event titles, lists, and two-sentence messages. Sentence-final `?`, `!`, `.`, `)` and quotes are glued to the last token of many carriers, and the weekday and month abbreviations the lexicon accepts (`tues`, `weds`, `thurs`, `thu`, `sept`) are emitted alongside the three-letter forms.

Carrier prepositions now consistently receive the background label `O`; `for` introducing a duration remains `DUR`. Exception examples now include calendar days, months, full dates, and holidays. Numeric negatives include addresses, arithmetic, numbered lists, and compound measured durations, without increasing the overall negative sampling probability. A small `prose-shift` family adds single future shifts, and partial month/month-year dates appear in ordinary prose. Generator labels were checked against independently constructed schedules before retraining.

## Evaluation

The saved reports cover different model versions. Each result below describes its recorded run.

- **Real English: 5791/6011 exact schedules, up from 5399/6011.** The holdout is 6,011 labelled sentences drawn from a public corpus and never shown to training; gold texts are excluded so the benchmark cannot train on itself. This is the only set here written by people rather than by the generator.

- **Historical unseen carriers: 993/1000 for `terse-f32`.** This measured exact schedule structures, not token labels. Current reports identify their model artifact and frozen source corpus explicitly.
- **Microsoft Recognizers development agreement: 229/563 (40.7%), up from 226/563.** `DateParser` sits at 70 against a committed floor of 71. One case out of 113 is inside the measured seed spread, so the floor reports it as a warning; the overall count rose by six and five of the six families held or improved. Its 134-case test split remains unused. Policy differences still count as failures.

  This comparison includes interpretation-policy differences. `pnpm test:recognizers` now holds every family at a committed floor, so a silent drop fails the build. The weakest family is `DatePeriodParser`, at 18/190, recovered from 16/190.

  **Recovered regression.** An earlier promotion on this line read a duration carrier as a shift, so `set OOO for 3 days from today` returned one instant instead of May 23 to May 26. `natural.py` gains an `anchored-duration` family that contrasts a leading `for`, `within` or `lasting` against `anchored-shift`; both families now share the same anchors and weight, `from` stays background so it cannot fight the `from X to Y` range shape, and `extractShift` in `compile.ts` leaves the quantity to the duration when a forward direction follows an explicit carrier. Three of the four shapes are correct again. `within 2 weeks from today` still returns one instant and is tracked as open work.

  Two earlier training attempts were rejected and are worth recording. Checkpoint averaging either diluted the correction away or dropped the reserved-carrier set from 1000/1000 to 991/1000. Plain fine-tuning recovered more cases but cost eleven others, including `DateParser` 71 to 69. Focal distillation ([Yan et al., CVPR 2021](https://arxiv.org/abs/2011.09161)), at `--distill-alpha 0 --distill-beta 5 --distill-lambda 0.1`, keeps every family at or above its previous score and passes the unchanged promotion gate. `architecture.md` records the loss.

- **Authored English coverage: 71/71, up from 70/71.** The gaps file is empty for the first time; `drinks at 9 at the bar` was its last entry. The 71 independent cases cover 13 families and include both user-reported examples. `pnpm test:english` runs these cases through the built package and is part of `pnpm test`.

  **Recovered regression: a bare hour followed by a place.** `Dinner at 8 at Nobu` returned nothing. In the previous corpus, `at <NUM>` followed by `at`, `in`, `near` or `by` was followed by a time of day in 2,231 of 2,244 cases, so the model learned that the preposition announces a daypart and discarded the hour when a venue arrived instead. The correct reading was never far away: measured over the shipped model's top sixteen paths, it ranked **second in twelve of the thirteen failing cases**, losing by a median of 2.889 points against the 3.475 the CRF charges for an isolated `HOUR`.

  Rebalancing the corpus did not fix it. Moving the daypart share from 99.4% to 11.3% traded the family for `qualified-clock`; moving it to 65% brought the original bug back. Cold starts fixed all thirteen and cost four pooled cases and twenty-eight reserved schedules. Weight interpolation across basins destroyed the model outright.

  What worked is training on whole sequences. `train.py --risk-lambda` adds a term that fires only where the decoder's best path is wrong, pushing the gold path above it by a margin; sequences already decoded correctly contribute nothing. The promoted run uses `--risk-lambda 0.005 --risk-margin 4`. `architecture.md` records the loss. `drinks at 9 at the bar` still fails and stays listed in `english-coverage.gaps.json`; its correct reading sits second by 5.393 points, the widest gap in the family.
- **Hand-authored chat gold: 287/330, up from 284/330.** Pooled across the eight gold sets the promotion records 1034/1043 against 1031/1043. The promotion comparison uses the same compiler for both models. `chat-relative` lost one case and is recorded as a warning rather than a failure; see the gate note below.
- **Non-temporal negatives: 191/192, held.** No negative regressed under the real-English training described below. Only `negative-096` remains under `it.fails` in `packages/core/test/grammar-model.test.ts`.
- **Prose gold: 73/73, preserved.** The date-carrier and non-date contrast examples preserve "The meeting is scheduled for next week" in all three casings.
- **Frozen generated schedules: 4996/5000 semantic and 959/1000 natural**, down three each from `balanced-prose`. These development checks expose a small synthetic-coverage tradeoff despite the authored-case improvements and successful promotion gate. The natural corpus contains 24 legacy rows whose supplied labels fail compiler equality because a recurrence marker is missing. The corpus remains unchanged. The complete `pnpm benchmark` command still stops at this oracle failure.
- The saved reports record 18/18 packaged public-result fixtures and 25/25 adversarial schedules. These fixtures influenced implementation and training; they are a regression gate, not an untouched test.
- Unit tests cover tokenization, compilation, calendar resolution, DST, RFC 5545 export, and inference workspace reuse.
- CPU/WebGPU comparison covers 10,000 sequences, 512 fixtures directly against PyTorch, and 1,000 source-versus-packaged shader sequences. The report identifies the tested artifact.
- Warm medians over 10,000 inputs: WebGPU 122.4 ms, CPU 993.9 ms, Chrono 89.2 ms. Other parsers return different structures; this is a timing comparison, not a capability comparison. Exact predecessor pruning reduces Viterbi work without changing paths.

## Limitations

- Accuracy on real user phrasing is unmeasured. The generated expressions share training families, including those with reserved surrounding prose.
- English only. Other languages can produce incorrect results without a diagnostic.
- Vague expressions (`ASAP`, `after work`, `soon`) are deliberately given no clock value rather than a guessed one.
- Ambiguous numeric dates depend on the caller's `dateOrder` (`MDY` by default). `03/04/2027` is ambiguous. `21/04/2016` is not and resolves correctly either way.
- Complex recurring exception combinations preview correctly but can return an `unsupported-export` diagnostic when no single RFC 5545 rule represents them.
- The model reads a month name standing alone correctly in 8 of 12 cases. `every <month>` and `in <month>` are correct for all twelve.
- `each may` returns the right answer, but the model labels `each` as filler instead of a recurrence marker. The answer rests on the month alone.
- The seed spread on this model is about 1.85 points. Treat any smaller single-run difference as noise. Compare three to five seeds.
- Quantization and browser GPU implementations can differ from the PyTorch reference unless parity is explicitly tested. It is, but only for the fixtures listed above.
- WebGPU startup and dispatch overhead make small inputs slower than a CPU parser, which is why `auto` keeps them on the CPU.
- The release build must stay within the 50,000-byte Brotli limit.

## Reproducibility

`packages/training/active/` holds `export-report.json` (selected weights, lineage, calibration, source hashes, token metrics), `provenance.json` (the checkpoint chain with hash verification), and the `parity.*` fixtures that check decoded int6 inference against PyTorch logits.

`parity.texts.json` preserves the 10,000 input strings used by `pnpm test:browser`. Once these inputs and the binary fixtures are committed, a clean clone can verify inference parity without a training corpus or ancestor generator. This does not reproduce training, checkpoint averaging, or the full provenance audit.

`packages/training/runs/english-coverage-layer2-negative-blend-075/` keeps the averaging report and source snapshot. The report records both parents, their hashes, and coefficients; the lineage counts shared ancestors once. Training runs retain their own generator/tokenizer snapshots locally. The export source directory keeps the exporter, model, training, averaging, calibration, and lockfile snapshots. Checkpoints are not tracked, so re-export requires those local files.

New export snapshots are keyed by both the weight artifact hash and the source-set hash. Identical source snapshots are reused; changed sources create a new directory and cannot overwrite an earlier snapshot. Legacy snapshot paths remain valid. A candidate `--out` defaults its report, parity fixtures, and snapshots beside that output, and mixed candidate/active destinations are rejected before loading a checkpoint.

`pnpm model:audit` passes only where the recorded local checkpoints and run history are available. A clean clone lacks the ignored `.pt` files, including both averaging parents, and cannot rerun that full audit or reproduce the average. The committed provenance report records a local verification, not clean-clone reproducibility. It also records the skipped legacy `carrier-int5` prose dataset hash, because that input was never snapshotted.

`pnpm --filter @gpu-time/training audit:model` re-verifies the weight file hash and the training source hashes against the recorded chain. Superseded runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.

## Promotion

Export builds the candidate and shipped baseline separately and compares exact schedules on `chat`, `prose`, `user-cases`, `negatives`, and `adversarial`. Every gold set and family must preserve its count, including small sets. A pooled improvement cannot hide a family regression. Corpus hashes and supports must match. The exporter replaces files by rename and writes the report last. `--force` remains an explicit recorded override and was not used for this promotion.

Reserved-carrier exact labels and boundaries must improve, or tie a baseline that already scores perfectly, without any family regression; bare expressions must not regress. Both use the deployed decoder and the same frozen corpus for candidate and baseline. These gates guard generated-language coverage and do not estimate real-user accuracy.

The active model scores **1000/1000** on reserved labels and boundaries and **1000/1000** bare, compared with **983/1000** and **1000/1000** for `step7-crf2` using Viterbi. Its older reported 935/1000 incorrectly used independent argmax predictions. All 17 remaining Viterbi differences were filler/connector annotations; the built predecessor already returned all 1000 reserved schedules correctly. Fixing the evaluator is separate from improving the weights.

The active model's training included related carrier wording, such as "the rehearsal will begin" alongside reserved "our rehearsal begins at". Exact-string separation therefore does not establish semantic separation of the carriers. New narrative frames now exclude reserved-carrier words from their event-name pool, but the active weights have not been retrained with that filter; the recorded 1000/1000 remains a limited development result.

On the unchanged `step7-crf2` development splits with Viterbi, exact validation labels/boundaries change from 99.64% to 99.53%, and heldout from 97.09% to 97.34%. On the expanded `prose-coverage` splits used for final calibration, the baseline scores 97.46%/95.47% and the selected model 98.04%/96.22%. Counts from different corpora or decoders must not be compared as if they measured the same task.

Held-in metrics do not control promotion. `calibrate()` uses the `heldout` split to select the boundary threshold, so that split supplies development metrics.
