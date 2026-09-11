# gpu-time model card

## Model

The package embeds checkpoint `spoken2`, epoch index 9, with artifact SHA-256 `c69ab6c9be8ec854790c004b5d540dc6a41bececbacdbf34a4725de6b711d6d5`. It has 24,761 parameters, 324 embedding rows, and 40 role slots (35 named roles plus five reserved). Weights use 6-bit symmetric per-tensor quantization, with f32 intermediate calculations. The active report records 13,888 Brotli bytes for the weights, 22 checkpoints, and 457,005,477 training tokens.

The model predicts one role per token, such as hour, weekday, quantity, recurrence marker, or filler. A separate boundary score splits the input into expressions at threshold 1.75. The `CLOCK_OFFSET` role represents half-hour and quarter-hour clock arithmetic.

Timezone is not a model role. TypeScript handles calendar arithmetic, daylight saving time, the reference instant, and expansion limits after the model runs.

## Intended use

The parser turns short English time expressions into dates, ranges, and recurrence rules on the client. Examples include reminder fields, schedule forms, and command bars.

It is not suitable for parsing documents, extracting dates from long prose, legal or medical scheduling, billing, compliance, or any decision where a wrong or invented date has real consequences. It supports English only and has no language detection.

## Training data

Supervision is entirely generated. `packages/training/torch/generate.py` renders schedules, and `natural.py` adds natural-phrasing families, including negative prose containing no time expression. Labels come from the generator's structure, never from the runtime parser, so the model is not trained on its own predictions.

The active weights have a 22-checkpoint history with 457,005,477 training tokens. The final run starts from `terse-f32` and draws 300,000 fresh examples per epoch. A fresh model can lose terse forms that earlier checkpoints learned.

Generated corpora live under the ignored `packages/training/data/synth/` and include the training data built with `pnpm gen`. Hand-authored evaluation corpora are tracked in `packages/training/data/gold/`.

The training data reflect the generators, so these scores do not establish accuracy on real user language.

The generators combine surrounding phrases and use filtered Tatoeba sentences as background text. They also generate terse forms, including bare day groups, abbreviated weekday ranges, month-day ranges, and bare clock ranges.

## Evaluation

The saved reports cover different model versions. Each result below describes its recorded run.

- **Unseen carriers: 993/1000 for `terse-f32`.** The reserved surrounding words are absent from training. The score requires exact schedule structures. `packages/training/results/natural-reserved-evaluation.json` identifies the older artifact, not the current `spoken2` weights.
- **Microsoft Recognizers development agreement: 167/563 (29.7%), up from 156.** Independent third-party date/time specifications, and the only measure here that is not our own distribution. Its reserved test split — all 134 grouped test cases — is not used for model selection. Policy differences count as failures rather than being excused.

  Of the 396 non-matching cases, 194 fail interpretation and 137 return a different value. Interpretation failures can come from wrong model roles or missing compiler support. The failure stage alone does not identify the cause. The weakest family is `DatePeriodParser` at 24/190.

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

`packages/training/active/` holds `export-report.json` (selected weights, lineage, calibration, source hashes, token metrics), `provenance.json` (the 22-entry checkpoint chain with hash verification), and the `parity.*` fixtures that check decoded int6 inference against PyTorch logits.

`packages/training/runs/spoken2/` keeps the promoted run's report and a source snapshot of the exact generator, tokenizer, and label set used to produce it. The export source directory recorded in `export-report.json` keeps the export-time snapshot and lockfile. The `.pt` checkpoint itself is not tracked, so re-export requires the local checkpoint.

`pnpm --filter @gpu-time/training audit:model` re-verifies the weight file hash and the training source hashes against the recorded chain. Superseded runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.

## Promotion

Export is gated. A candidate must improve the unseen-carrier score and pass per-family and bare-expression guards with a two-proportion statistical tolerance. The exporter decodes both models from their 6-bit form and scores them on the same corpus in one process. It reads the baseline from the shipped `weights.gen.ts`. It replaces files by rename and writes the report last. `--force` overrides the decision and records what it overrode.

The historical **993/1000** result measures exact schedule structures through the built TypeScript parser. The export gate measures exact token labels and expression boundaries in PyTorch, including filler labels. The active model scores **982/1000**, compared with **975/1000** for its predecessor. These metrics measure different outputs and cannot be compared directly.

Held-in metrics do not control promotion. `calibrate()` uses the `heldout` split to select the boundary threshold, so that split supplies development metrics.