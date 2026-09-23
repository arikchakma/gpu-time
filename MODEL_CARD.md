# gpu-time model card

## Model

The published package embeds checkpoint `runs/shorthand/epoch-39`, artifact SHA-256 `168f2268...`. The full hash and every score live in `packages/training/active/export-report.json`, which is the only place to read them from.

The model has 38,745 parameters, two scan layers, 580 embedding rows, and 35 role labels over 40 slots. A 40x40 CRF transition matrix supports Viterbi decoding, which scores whole label sequences instead of single tokens. Weights use 6-bit symmetric per-tensor quantization with f32 intermediates, and pack to 22,501 Brotli bytes. The full published package is 45,561 Brotli bytes, under the 50,000-byte release limit.

The model predicts one role per token, such as hour, weekday, quantity, recurrence marker, or filler. A separate boundary score splits the input into expressions at threshold 1.5. `calibrate.py` fits that threshold on the development splits.

Timezone is not a model role. TypeScript resolves calendar arithmetic, daylight saving time, the reference instant, and expansion limits after the model runs.

## Intended use

The model turns short English time expressions into dates, ranges, and recurrence rules in the browser. It fits reminder fields, schedule forms, and command bars.

It is not suitable for parsing documents or extracting dates from long prose. It is also not suitable for legal or medical scheduling, billing, compliance, or any decision where a wrong date has real consequences. It supports English and Spanish. Each language pack carries its own model, and the caller chooses the language. There is no language detection.

## Training data

Training data comes from three sources:

- Generated. `generate.py` and `natural.py` write schedules and English phrasing, and supply the labels. The shipped model used 60,000 generated rows per epoch.
- Harvested. A Tatoeba sentence enters when gpu-time and chrono-node agree on both the span and the instant. This gives about 101,000 rows.
- Written. The files under `packages/training/data/teacher/` hold sentences that a language model labelled. A row enters only when the compiler produces the schedule the label claims. This source reaches what agreement cannot, because chrono-node cannot read recurrence at all.

Generated corpora live under `packages/training/data/synth/` and Git ignores them. Hand-written evaluation corpora are tracked under `packages/training/data/gold/`.

The generated scores below share rendering families with training. They measure coverage of the generators, not accuracy on real user language.

## Evaluation

The shipped checkpoint scores:

- Real English: 5,869 of 6,011 exact schedules (97.6%). These sentences come from a public corpus and were never shown to training. Gold texts are excluded. This checkpoint won a screen of about 600 on this set, so the score means "no regression", not a gain.
- Authored English coverage: 77 of 77, with no open gaps.
- Chat gold: 301 of 331. Pooled over the five promotion sets: 591 of 625.
- Reported user failures: 26 of 37.
- Microsoft Recognizers, development split: 239 of 563 (42.5%). Policy differences count as failures, and the test split stays unused.
- Chrono comparison: 76 of 85. Shared behavior is 68 of 75 and policy cases are 8 of 10.
- Non-temporal negatives: 188 of 192.
- Reserved carriers: 921 of 1,000 schedules and 933 of 1,000 bare expressions. The checkpoint this one replaces scores 894 and 913 on the same corpus. That corpus now draws all 43 families, not 17, so it is harder than the one that gave the 973 and 981 reported here before.
- Compact 24-hour clocks: 15 of 17 shapes, and no false fire on the four look-alike numbers.
- Token accuracy: 99.31% on validation and 98.87% on heldout.

Parity is a separate gate. 512 fixtures compare decoded int6 inference against PyTorch logits, and `pnpm test:browser` compares 1,000 sequences in real WebGPU.

The timing numbers in `packages/benchmark/results/summary.json` were recorded for an earlier checkpoint. Other parsers return different structures, so that comparison measures time, not capability.

## Spanish model

`gpu-time/languages/es` embeds its own model, checkpoint `runs/es-v4d/epoch-32`. It has the same shapes as the English model: 38,745 parameters, two scan layers, and 6-bit weights. The weights pack to 24,386 Brotli bytes, and the whole Spanish pack is 25,767. Every score lives in `packages/core/src/model/weights-es.report.json`, the only place to read them from.

Training data:

- Generated. `spanish.py` and `natural_es.py` write Spanish phrasing, 20,000 rows per epoch.
- Harvested. A Tatoeba sentence enters when chrono-node's Spanish parser finds exactly one date, agrees with gpu-time on it, and the compiler produces the same schedule from the whole sentence. This gives 2,664 training rows.
- Written. Sonnet teachers labelled 1,317 real Tatoeba sentences by `data/teacher/label-sheet.es.md`, and the compiler checked every row. 271 of them hold no calendar time, such as "hoy por hoy", "llegar tarde" or "buenas noches", so the model learns when to stay quiet. Each row is repeated four times.

The shipped checkpoint scores:

- Real Tatoeba holdout: 164 of 179 exact schedules. Training never saw these sentences.
- Teacher holdout: 156 of 172. Training never saw these sentences either.
- Chrono's Spanish test phrases: 66 of 72, with 6 known gaps.
- Generated reserved carriers: 616 of 998. These forms are kept out of training on purpose, so the score catches regressions and is not accuracy.
- Token accuracy: 99.93% on validation and 95.13% on heldout.

The three gold sets above also chose the checkpoint, so they read a little high. `data/gold/spanish-fresh.jsonl` holds 227 more teacher-labelled sentences that no choice ever used. The shipped model scores 173 of 227 on it: 41 of 60 sentences with no time and 132 of 167 with one. Run `node --experimental-strip-types src/evaluate-model.ts --language es --dir ../training/data/gold --sets spanish-fresh` in `packages/benchmark` to measure it. Once a later choice uses this set, it stops being fresh.

Spanish limitations:

- The model still finds a time in some sentences that have none: a goodbye "¡Hasta mañana!", "hoy por hoy", and general facts such as "el lunes es el día que viene después del domingo".
- A bare "ahora" at the end of a sentence ("hazlo ahora") is sometimes missed.
- Compact three-digit clocks (`750am`) are unsupported, as in English.
- Parity: 512 fixtures compare the int6 inference against PyTorch, and `pnpm test:browser` compares 5,070 Spanish sequences in real WebGPU.

## Limitations

- "in N units" meaning elapsed time reads as future time. "He ran a quarter mile in four minutes" returns a time. Four negatives fail this way.
- A bare four-digit clock from 1900 to 2059 reads as a year, so `at 1930` returns the year 1930. A calendar writes those digits as a year more often than as an evening. Other compact clocks read: `2200`, `0930`, `1150`, `1430-1600`.
- A four-digit year below 1900 can read as a clock. "signed in February 1819" is the shape that fails.
- A person named after a weekday reads as the weekday. "My friend Wednesday never answers her phone" returns a date.
- A trailing two-digit field in a slash triple reads as a day, not a year, so `07/19/27` fails.
- The em dash is unsupported and `13:20—15:50` returns nothing. The en dash works, on a weaker feature path.
- A cold start learns the corpus better than a warm start, at a price. Measured on 15 September 2026, a cold run answered 26 of the 37 reported failures against a warm run's 15. It also dropped the Chrono comparison from 74 to 67, which fails `pnpm test`. Nobody has repeated that measurement on the current corpus.
- Accuracy on real user phrasing is unmeasured.
- English and Spanish only. Other languages can return a wrong result with no diagnostic.
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
