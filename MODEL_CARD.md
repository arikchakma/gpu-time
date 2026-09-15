# gpu-time model card

## Model

The published package embeds checkpoint `runs/shorthand/epoch-39`, artifact SHA-256 `168f2268...`. The full hash and every score live in `packages/training/active/export-report.json`, which is the only place to read them from.

The model has 38,745 parameters, two scan layers, 580 embedding rows, and 35 role labels over 40 slots. A 40x40 CRF transition matrix supports Viterbi decoding, which scores whole label sequences instead of single tokens. Weights use 6-bit symmetric per-tensor quantization with f32 intermediates, and pack to 22,501 Brotli bytes. The full published package is 45,521 Brotli bytes, under the 50,000-byte release limit.

The model predicts one role per token, such as hour, weekday, quantity, recurrence marker, or filler. A separate boundary score splits the input into expressions at threshold 1.5. `calibrate.py` fits that threshold on the development splits.

Timezone is not a model role. TypeScript resolves calendar arithmetic, daylight saving time, the reference instant, and expansion limits after the model runs.

## Intended use

The model turns short English time expressions into dates, ranges, and recurrence rules in the browser. It fits reminder fields, schedule forms, and command bars.

It is not suitable for parsing documents or extracting dates from long prose. It is also not suitable for legal or medical scheduling, billing, compliance, or any decision where a wrong date has real consequences. It supports English only and has no language detection.

## Training data

Training data comes from three sources:

- Generated. `generate.py` and `natural.py` write schedules and English phrasing, and supply the labels. The shipped model used 60,000 generated rows per epoch.
- Harvested. A Tatoeba sentence enters when gpu-time and chrono-node agree on both the span and the instant. This gives about 101,000 rows.
- Written. The files under `packages/training/data/teacher/` hold sentences that a language model labelled. A row enters only when the compiler produces the schedule the label claims. This source reaches what agreement cannot, because chrono-node cannot read recurrence at all.

Generated corpora live under `packages/training/data/synth/` and Git ignores them. Hand-written evaluation corpora are tracked under `packages/training/data/gold/`.

The generated scores below share rendering families with training. They measure coverage of the generators, not accuracy on real user language.

## Evaluation

The shipped checkpoint scores:

- Real English: 5,866 of 6,011 exact schedules (97.6%). These sentences come from a public corpus and were never shown to training. Gold texts are excluded.
- Authored English coverage: 71 of 71, with no open gaps.
- Chat gold: 303 of 331. Pooled over the five promotion sets: 593 of 625.
- Reported user failures: 25 of 37.
- Microsoft Recognizers, development split: 234 of 563 (41.6%). Policy differences count as failures, and the test split stays unused.
- Chrono comparison: 74 of 85. Shared behavior is 65 of 75 and policy cases are 9 of 10.
- Non-temporal negatives: 188 of 192.
- Reserved carriers: 973 of 1,000 schedules and 981 of 1,000 bare expressions.
- Token accuracy: 99.26% on validation and 98.85% on heldout.

Parity is a separate gate. 512 fixtures compare decoded int6 inference against PyTorch logits, and `pnpm test:browser` compares 1,000 sequences in real WebGPU.

The timing numbers in `packages/benchmark/results/summary.json` were recorded for an earlier checkpoint. Other parsers return different structures, so that comparison measures time, not capability.

## Limitations

- "in N units" meaning elapsed time reads as future time. "He ran a quarter mile in four minutes" returns a time. Four negatives fail this way.
- A person named after a weekday reads as the weekday. "My friend Wednesday never answers her phone" returns a date.
- A trailing two-digit field in a slash triple reads as a day, not a year, so `07/19/27` fails.
- The em dash is unsupported and `13:20—15:50` returns nothing. The en dash works, on a weaker feature path.
- A cold start learns the corpus better than a warm start, at a price. Measured on 15 September 2026, a cold run answered 26 of the 37 reported failures against a warm run's 15. It also dropped the Chrono comparison from 74 to 67, which fails `pnpm test`. Nobody has repeated that measurement on the current corpus.
- Accuracy on real user phrasing is unmeasured.
- English only. Other languages can return a wrong result with no diagnostic.
- Vague expressions (`ASAP`, `after work`, `soon`) get no clock value by design.
- An ambiguous numeric date follows the caller's `dateOrder`, which defaults to `MDY`. `03/04/2027` is ambiguous and `21/04/2016` is not.
- The seed spread is about 1.85 points. Treat any smaller single-run difference as noise.
- Quantization and browser GPU implementations can differ from the PyTorch reference unless parity is tested. It is tested, but only for the fixtures above.
- WebGPU startup and dispatch overhead make small inputs slower than a CPU parser, which is why the `auto` backend keeps them on the CPU.
- A complex recurring exception can preview correctly and still return an `unsupported-export` diagnostic, because no single RFC 5545 rule represents it.

## Reproducibility

`packages/training/active/` holds `export-report.json` (weights, lineage, calibration, source hashes, metrics), `provenance.json` (the checkpoint chain with hash verification), and the `parity.*` fixtures. A clean clone verifies inference parity from those files alone. It cannot reproduce training, because Git ignores the checkpoints.

Export builds the candidate and the shipped baseline in the same run and compares exact schedules. Every gold set and family must hold its count, so a pooled gain cannot hide a family regression. Reserved-carrier labels and boundaries must improve, or tie a baseline that already scores perfectly. `--force` overrides the gate and records what it overrode. This promotion did not use it.

`pnpm model:audit` re-verifies the weight hash and the training source hashes against the recorded chain. It passes only where the local checkpoints are present.
