# gpu-time model card

## Model

The package embeds `english-coverage-layer2-negative-blend-075`, with artifact SHA-256 `2bfbbe5038b4829b4609fc5fd0ed000238a3c273ed2f2e8eb327a23499a8bff9`. It combines 25% of the two-layer warm checkpoint with 75% of its negative-correction checkpoint.

The model has 38,745 parameters, two scan layers, 580 embedding rows, and 40 role slots (35 named roles plus five reserved). A 40x40 CRF transition matrix supports Viterbi decoding. Weights use 6-bit symmetric per-tensor quantization with f32 intermediates. The active report records 22,227 Brotli bytes for the weights, 16 unique checkpoint artifacts, and 890,783,110 training tokens. Averaging adds no training tokens. The complete package is 44,795 Brotli bytes, below the 50,000-byte limit.

The model predicts one role per token, such as hour, weekday, quantity, recurrence marker, or filler. A separate boundary score splits the input into expressions at threshold 0.75, fitted by `calibrate.py` on the development splits. The `CLOCK_OFFSET` role represents half-hour and quarter-hour clock arithmetic.

Timezone is not a model role. TypeScript handles calendar arithmetic, daylight saving time, the reference instant, and expansion limits after the model runs.

## Intended use

The parser turns short English time expressions into dates, ranges, and recurrence rules on the client. Examples include reminder fields, schedule forms, and command bars.

It is not suitable for parsing documents, extracting dates from long prose, legal or medical scheduling, billing, compliance, or any decision where a wrong or invented date has real consequences. It supports English only and has no language detection.

## Training data

Supervision is entirely generated. `packages/training/torch/generate.py` renders schedules, and `natural.py` adds natural-phrasing families, including negative prose containing no time expression. Labels come from the generator's structure, never from the runtime parser, so the model is not trained on its own predictions.

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

- **Historical unseen carriers: 993/1000 for `terse-f32`.** This measured exact schedule structures, not token labels. Current reports identify their model artifact and frozen source corpus explicitly.
- **Microsoft Recognizers development agreement: 217/563 (38.5%), previously 202/563 for `balanced-prose`.** Its 134-case test split remains unused. Policy differences still count as failures.

  This comparison includes interpretation-policy differences and is not a promotion gate. The weakest family is `DatePeriodParser`, at 16/190, **down from 23/190**.

  **Known regression.** Seven `DatePeriodParser` cases lost their end date and now return a single instant. All seven share one shape: a duration carrier followed by an anchor, as in `set OOO for 3 days from today` (May 23 to May 26 before, May 26 now) and `set ooo for a week starting tomorrow`. The cause is the `anchored-shift` training family, which teaches `<N> <unit> from <anchor>` as a shift and never shows a leading `for`, `within`, or `lasting`. The model therefore labels those carriers `O` and reads every such phrase as a shift. Three further cases lost a range because `qualifiedRelativeUnit` in `occurrence.ts` drops the end date when a relative unit carries a clock; that is deliberate, so `this week 8am` returns one instant.

  A fix is prepared but not promoted. `natural.py` gains an `anchored-duration` family that contrasts the carrier against `anchored-shift`, with eight matching prose negatives in `background.py` and three tests. Trained alone it corrects all four sentences above. Every checkpoint average against the promoted weights either dilutes the correction away or regresses the reserved-carrier set from 1000/1000 to 991/1000. Promotion waits on joint training rather than post-hoc averaging. Candidate runs are under `runs/anchored-duration-v4` and `runs/adv4-*`.

- **Authored English coverage: 56/56, up from 37/56 before these changes.** The 56 independent cases cover 12 families and include both user-reported examples. The copied Chrono tests and their comparison runner were removed. `pnpm test:english` runs these cases through the built package and is part of `pnpm test`.
- **Hand-authored chat gold: 276/330, compared with 273/330 before these changes.** Per family: question 26/27, tatoeba 71/86, calendar 44/51, abbrev 24/28, correction 14/16, prose 20/22, relative 19/22, recognizers 46/62, negation 12/16. The promotion comparison uses the same compiler for both models and records no gold set or family regression. Individual examples can still change within a family.
- **Non-temporal negatives: 191/192, up from 187/192.** Four existing failures recover without new negative failures. Only `negative-096` remains under `it.fails` in `packages/core/test/grammar-model.test.ts`.
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
