# gpu-time model card

## Model

The published package embeds checkpoint `terse-f32` epoch 10, artifact sha256 `0aba397673a84e9a3caf2fbd6416d54ff0ea69fb5fa9cd02c1484f934d8ec1e6`. It has 24,761 parameters at 6-bit symmetric per-tensor quantization with f32 intermediates, 324 embedding rows, and 40 output slots (35 named semantic roles plus 5 reserved). Weights are 14,641 bytes Brotli; the full minified module including the shader is 34,650 bytes Brotli. Its ancestry runs 21 checkpoints deep and 394,995,596 tokens.

The model predicts one semantic role per token — clock hour and minute, meridiem, weekday, month, ordinal, year, quantity and unit, recurrence markers, range separators, bounds, exceptions, filler — plus a per-token boundary score that splits one input into independent expressions at threshold 3.0. A `CLOCK_OFFSET` role distinguishes half and quarter clock arithmetic.

Timezone is not a model role. Calendar arithmetic, DST, the reference instant, and expansion limits are handled by TypeScript after inference.

## Intended use

Turning short English time expressions typed by a person — a reminder field, a scheduling box, a command bar — into concrete dates, ranges, and recurrence rules on the client, without a server round trip or a grammar bundle.

It is not suitable for parsing documents, extracting dates from long prose, legal or medical scheduling, billing, compliance, or any decision where a wrong or invented date has real consequences. It should not be used for languages other than English; the lexicon is English and there is no language detection.

## Training data

Supervision is entirely generated. `packages/training/torch/generate.py` renders schedules from 26 phrase families; `natural.py` adds 16 natural-phrasing families, including negative prose containing no time expression. Labels come from the generator's structure, never from the runtime parser, so the model is not trained on its own predictions.

The deployed weights are the end of a 21-checkpoint lineage recording 394,995,596 tokens, each run drawing 300,000 fresh examples per epoch. The final run warm-starts from its predecessor rather than training from scratch: a cold run reaches a comparable aggregate score but loses terse forms the lineage already learned.

Generated corpora live under the ignored `packages/training/data/synth/` and are rebuilt with `pnpm gen`. Hand-authored evaluation corpora are tracked in `packages/training/data/gold/`.

Because training data is synthetic, the distribution is the generator's, not a real user's. That is the single most important caveat on every number below.

The surrounding prose is combinatorial rather than a fixed list, and 49,740 real Tatoeba sentences supply background nobody here authored. Terse forms that the renderers previously produced once or twice per 4,000 examples — bare day groups, abbreviated weekday ranges, month-day ranges, bare clock ranges — are now generated as a family in their own right, because at that rarity whether the model learned them was decided by the random seed.

## Evaluation

- **Unseen carriers: 993/1000.** The surrounding words come from a reserved set kept unreachable from the training grammar, scored on strict whole-expression equality. The previous checkpoint scored 511/1000 on the same corpus. No phrase family regressed.
- **Microsoft Recognizers development agreement: 167/563 (29.7%), up from 156.** Independent third-party date/time specifications, and the only measure here that is not our own distribution. Its reserved test split — all 134 grouped test cases — is not used for model selection. Policy differences count as failures rather than being excused.

  The contrast with the line above is the honest summary of this release: our own unseen-carrier score nearly doubled while the independent benchmark moved two points. We got substantially better at the distribution our generator produces and marginally better at somebody else's. Of the 396 non-matching cases, 194 are inputs the parser cannot interpret at all and 137 resolve to a different value, so the larger half is missing grammar rather than disagreement. The weakest family is `DatePeriodParser` at 24/190, dominated by day-number ranges anchored to a month such as "from 4 to 22 this month".

- Original generated interpretations: 4,996/5,000. New generated phrasings: 997/1,000. **Both share rendering families with training and are development metrics, not language accuracy.** They must not be quoted as evidence of natural-language understanding.
- 18/18 packaged public-result fixtures and all 25 adversarial schedules pass. These fixtures influenced implementation and training; they are a regression gate, not an untouched test.
- 786 core tests, 4 benchmark tests, and 6 PyTorch unit tests pass, covering tokenization, compilation, calendar resolution, DST, RFC 5545 export, and inference workspace reuse.
- CPU/WebGPU parity covers 10,000 sequences, 512 fixtures directly against PyTorch, and 1,000 source-versus-packaged shader sequences.
- Warm medians over 10,000 inputs: WebGPU 82.7 ms, CPU 702.5 ms, Chrono 82.8 ms. Other parsers return different structures; this is a timing comparison, not a capability comparison.

## Limitations

- Accuracy on real user phrasing is unmeasured. Every high score above is held-in.
- English only. No language detection; other languages will produce confident nonsense.
- Vague expressions (`ASAP`, `after work`, `soon`) are deliberately given no clock value rather than a guessed one.
- Ambiguous numeric dates depend on the caller's `dateOrder` (`MDY` by default). `03/04/2027` is genuinely ambiguous; `21/04/2016` is not and resolves correctly either way.
- Complex recurring exception combinations preview correctly but can return an `unsupported-export` diagnostic when no single RFC 5545 rule represents them.
- Quantization and browser GPU implementations can differ from the PyTorch reference unless parity is explicitly tested. It is, but only for the fixtures listed above.
- WebGPU startup and dispatch overhead make small inputs slower than a CPU parser, which is why `auto` keeps them on the CPU.
- The build is 34,650 bytes Brotli against a 50,000-byte release gate, so roughly 15 KB of headroom remains for future capacity.

## Reproducibility

`packages/training/active/` holds `export-report.json` (selected weights, lineage, calibration, source hashes, token metrics), `provenance.json` (the 21-entry checkpoint chain with hash verification), and the `parity.*` fixtures that check decoded int6 inference against PyTorch logits.

`packages/training/runs/terse-f32/` keeps the promoted run's report and a source snapshot of the exact generator, tokenizer, and label set used to produce it. `packages/training/exports/0aba3976…/source/` keeps the export-time snapshot and lockfile. The `.pt` checkpoint itself is not tracked, so regenerating weights from scratch requires the local run directory.

`pnpm --filter @gpu-time/training audit:model` re-verifies the weight file hash and the training source hashes against the recorded chain. Superseded runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.

## Promotion

Export is gated. A candidate replaces the shipped weights only if it strictly improves the unseen-carrier score and no individual phrase family regresses beyond a two-proportion tolerance. Both sides are decoded from their int6 wire form and re-scored in the same process on the same corpus — a stored score is never read, and the baseline is decoded from the shipped `weights.gen.ts` itself, so the model being compared against is the model that ships. Weights and the report are published by rename, with the report last, so its presence is the commit point. `--force` overrides the decision and records what it overrode.

Two distinct numbers are involved here and must not be conflated. The published **993/1000** is exact-AST equality measured through the built TypeScript parser, and `packages/training/results/natural-reserved-evaluation.json` remains its authority. The gate instead measures exact token-label-and-boundary equality in PyTorch, which is stricter because every filler `O` must also be correct, and scores **975/1000** for this model on the same corpus. The AST metric is not available before the decision, because computing it would require building the package from the very weights being gated.

Held-in metrics gate nothing. `heldout` is still reported, but `calibrate()` fits the boundary threshold partly on that split, so it is threshold-contaminated and is excluded from the decision by design.
