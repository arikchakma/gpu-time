# gpu-time model card

## Model

The published package embeds checkpoint `natural-language-final` epoch 8, artifact sha256 `0195bf43c825edead571340824b9f71ed5cfbdb37d7181273af4a8cf36664aac`. It has 24,761 parameters at 6-bit symmetric per-tensor quantization with f32 intermediates, 324 embedding rows, and 40 output slots (35 named semantic roles plus 5 reserved). Logical packed weights are 18,571 bytes, 14,995 bytes Brotli. The full minified module including the shader is 35,120 bytes Brotli.

The model predicts one semantic role per token — clock hour and minute, meridiem, weekday, month, ordinal, year, quantity and unit, recurrence markers, range separators, bounds, exceptions, filler — plus a per-token boundary score that splits one input into independent expressions at threshold 4.25. A `CLOCK_OFFSET` role distinguishes half and quarter clock arithmetic.

Timezone is not a model role. Calendar arithmetic, DST, the reference instant, and expansion limits are handled by TypeScript after inference.

## Intended use

Turning short English time expressions typed by a person — a reminder field, a scheduling box, a command bar — into concrete dates, ranges, and recurrence rules on the client, without a server round trip or a grammar bundle.

It is not suitable for parsing documents, extracting dates from long prose, legal or medical scheduling, billing, compliance, or any decision where a wrong or invented date has real consequences. It should not be used for languages other than English; the lexicon is English and there is no language detection.

## Training data

Supervision is entirely generated. `packages/training/torch/generate.py` renders schedules from 26 phrase families; `natural.py` adds 16 natural-phrasing families, including negative prose containing no time expression. Labels come from the generator's structure, never from the runtime parser, so the model is not trained on its own predictions.

Two completed runs contributed to the deployed weights: `natural-language-v2` (10 epochs) and `natural-language-final` (8 epochs), each drawing 300,000 fresh examples per epoch. Together they processed 5.4 million examples and 83,308,190 tokens; the checkpoint records 337,245,315 tokens seen across its full ancestry.

Generated corpora live under the ignored `packages/training/data/synth/` and are rebuilt with `pnpm gen`. Hand-authored evaluation corpora are tracked in `packages/training/data/gold/`.

Because training data is synthetic, the distribution is the generator's, not a real user's. That is the single most important caveat on every number below.

## Evaluation

- **Unseen sentence frames: 511/1000.** Sentence shapes never seen in training, scored on strict whole-expression equality. This is the primary honest measure. Many failures return the correct temporal result alongside a spurious second interpretation drawn from surrounding prose.
- **Microsoft Recognizers development agreement: 156/563.** Independent third-party date/time specifications. Its reserved test split — all 134 grouped test cases — is not used for model selection. Policy differences count as failures rather than being excused.
- Original generated interpretations: 4,996/5,000. New generated phrasings: 997/1,000. **Both share rendering families with training and are development metrics, not language accuracy.** They must not be quoted as evidence of natural-language understanding.
- 18/18 packaged public-result fixtures and all 25 adversarial schedules pass. These fixtures influenced implementation and training; they are a regression gate, not an untouched test.
- 786 core tests, 4 benchmark tests, and 6 PyTorch unit tests pass, covering tokenization, compilation, calendar resolution, DST, RFC 5545 export, and inference workspace reuse.
- CPU/WebGPU parity covers 10,000 sequences, 512 fixtures directly against PyTorch, and 1,000 source-versus-packaged shader sequences.
- Warm medians over 10,000 inputs: WebGPU 80.3 ms, CPU 726.8 ms, Chrono 91.6 ms. Other parsers return different structures; this is a timing comparison, not a capability comparison.

## Limitations

- Unfamiliar surrounding prose is the dominant failure mode. The model frequently finds the right expression and then also labels something that is not a time expression.
- Accuracy on real user phrasing is unmeasured. Every high score above is held-in.
- English only. No language detection; other languages will produce confident nonsense.
- Vague expressions (`ASAP`, `after work`, `soon`) are deliberately given no clock value rather than a guessed one.
- Ambiguous numeric dates depend on the caller's `dateOrder` (`MDY` by default). `03/04/2027` is genuinely ambiguous; `21/04/2016` is not and resolves correctly either way.
- Complex recurring exception combinations preview correctly but can return an `unsupported-export` diagnostic when no single RFC 5545 rule represents them.
- Quantization and browser GPU implementations can differ from the PyTorch reference unless parity is explicitly tested. It is, but only for the fixtures listed above.
- WebGPU startup and dispatch overhead make small inputs slower than a CPU parser, which is why `auto` keeps them on the CPU.
- The 30,000-byte Brotli release gate is unmet at 35,120 bytes.

## Reproducibility

`packages/training/active/` holds `export-report.json` (selected weights, lineage, calibration, source hashes, token metrics), `provenance.json` (the 20-entry checkpoint chain with hash verification), and the `parity.*` fixtures that check decoded int6 inference against PyTorch logits.

`packages/training/runs/natural-language-final/` keeps the promoted run's report and a source snapshot of the exact generator, tokenizer, and label set used to produce it. `packages/training/exports/0195bf43…/source/` keeps the export-time snapshot and lockfile. The `.pt` checkpoint itself is not tracked, so regenerating weights from scratch requires the local run directory.

`pnpm --filter @gpu-time/training audit:model` re-verifies the weight file hash and the training source hashes against the recorded chain. Superseded runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.
