# Completion audit

The approved direct-results flow is implemented and trained. The broader release is not complete.

## Current performance work

The requested sub-100 ms WebGPU batch target is met: **86.7 ms for 10,000 inputs**, down from 188.2 ms in the first optimization and 1,061.2 ms originally. Chrono measures 86.5 ms on the same run and workload. CPU fallback measures 813.4 ms and remains slower. These are warm benchmark medians, with different native output contracts across libraries.

The model is unchanged. The runtime uses real batch processing, shared calendar context, bounded exact conversion/format caches, cached word-level features with fresh positional context, numeric occurrence timestamps until serialization, and precomputed weekly anchors. No complete parse-result cache is used. The larger-GPU-batch and output-plane experiments were discarded rather than retained without evidence.

All 710 tests pass, as do CPU/WebGPU and installed-package checks. A 10,000-string Unicode hash preserves the exact feature encoding. The 192-case recurrence differential remains identical, and 1,000 distinct inputs retain their output hash (8.2 ms WebGPU in that focused profile). Benchmark tables and the playground have been refreshed. See `bench/PERFORMANCE.md` and `bench/results/optimization.json`.

## Approved direction

The user approved: text -> small model -> normalize temporal values -> resolve with caller reference/timezone -> dates, ranges and recurrence results. The public API is `parse(text, { reference, timeZone, ... })`. It returns `occurrences`, `rrules`, diagnostics and preview metadata; no public AST or token-label output. Reusable parsers and batch calls use the same context argument. This supersedes the earlier AST-focused public API and the pending spans-versus-dates question.

The order remains correctness, efficiency, speed, then size. No new architecture or size experiment was needed for this run. Timezone and calendar policy never enter the neural model.

`src/tagger.ts` owns inference. `src/schedule.ts` and the compiler retain private normalized state for the calendar engine. `src/index.ts` is the direct-results API. The playground uses that API and shows Dates & rules, Result, and Compare tabs.

Before changing weights, distinguish data errors, composition errors, resolver policy, and genuine model errors. Token scores alone do not establish correct results. The shared filler normalization and quantity/unit composition fixed several earlier failures without training; preserve those contracts.

## Training completed for the approved flow

`training/runs/direct-results/` contains a completed 12-epoch run with 300,000 fresh examples per epoch: 3.6 million generated examples and 48,942,037 tokens processed. Epoch 8 was selected using validation metrics and then passed the end-to-end gates. The selected model preserves the existing 24,761-parameter architecture. Training source snapshots and checkpoint ancestry are retained for reproducibility.

`research/gpu-lexer/` contains the separately inspected 0.0.2 runtime, extracted weights, network capture and checksums. Its live/npm weights match and decoded weights match the browser GPU upload. Those reference weights are not used in gpu-time. Its trainer is not present in the public package.

## Verified current state

- Selected model: `training/runs/direct-results/best.pt`, epoch 8; 24,761 parameters, int6, f32 intermediates. The current vocabulary contains no timezone role.
- The compact model uses 324 embedding rows, dropping the second hash and halving the first; all 40 role outputs and the clause head remain. CPU and GPU map canonical 580-row features consistently.
- Correctness gates pass: 25 adversarial schedules, 115 authored core forms, 314 formatting variants, 32 non-temporal controls, four invalid-input checks, and 72 prose checks (24 authored plus 48 derived casing variants). These development sets overlap and are not general language accuracy.
- Current generated interpretation check: 4993/5000; every renderer/oracle pair passes. Rendering families overlap training, so this is a development metric. The public API separately passes 18/18 hand-authored final-date/range fixtures, including recurrence, DST and invalid inputs.
- Current broad Microsoft development agreement through the public API: 121/563. The 134 grouped test cases remain reserved. Policy differences and out-of-scope forms remain counted; broader accuracy is not release-ready.
- Earlier failure-stage breakdown distinguished 20 matches to upstream past interpretations from strict future matches. These remain failures in the primary score. Most failures are assembly failures or unsupported combinations.
- Date-order and bare-weekday recurrence options now work and have unit/UI checks. Explicit duration overrides an inferred day-part end. Existing explicit ends still conflict with duration.
- GPU/parser lifecycle tests cover startup/disposal races, queued callers, malformed predictions, actual device loss during submission, bounded recovery, and failed pipeline cleanup.
- Browser checks cover 10,000 CPU/GPU sequences, 512 direct PyTorch fixtures and 1,000 source-versus-packaged shader sequences. Rerun after each selected export.
- Shader specialization/minification now happens during package build using wgslender. Handwritten source stays readable.
- Complete public entry: 33,114 bytes Brotli. The 30,000-byte size gate remains unmet and optimization is deferred. Weight module: 14,913 bytes Brotli.
- Benchmark REPORT.md and summary.json now use the selected model and direct-results public API. All five JavaScript and four Python baselines were rerun; native output contracts still differ.

- The full suite has 710 passing tests, and TypeScript checking passes. CPU/WebGPU checks from the selected export cover 10,000 sequences and the minified package shader matches source inference on 1,000 sequences.
- Recurrence expansion now raises an explicit error when its 100,000-day search is exhausted, rather than returning a silently incomplete series. A finite count completed on the final scan step still succeeds; both behaviors have regression tests.
- The fixed prose corpus improved from 16,662/20,000 to 19,977/20,000 with matching source SHA-256. See `training/prose-before.json` and `training/prose-after.json`. The model had missed ordinary background prose and its casing; augmentation now covers both temporal and background tokens. Duration renderings also include 'for the next N units'.
- A new semantic test checks that all 40 clauses survive parsing across multiple inference windows.
- Recent correctness changes: specification-first recurrence/bounds/duration/yearly/anchor/range data, written ordinals through twelfth, missing AM/PM inference, and explicit range-relationship validation. Timezone training, the TZ role, compiler timezone recognition, and per-clause timezone overrides were removed following the user correction.
- Boundary whitespace is canonicalized for inference while source tokens and offsets are retained. This deliberately uses a simple extra tokenization pass; revisit only in the efficiency stage.
- Modified day groups now stay in one period rather than mixing weekdays from different weeks.

## Authoritative artifacts

- `training/export-report.json`: selected artifact hash, checkpoint ancestry, calibration grid, metrics and export-source archive.
- `training/runs/grammar-coverage/`, `compact/`, `semantic-dates/`, `edge-cases/`, `compositional/`: checkpoints and training source snapshots.
- `training/semantic.py`, `generate.py`, `generate-semantic.py`, `check-semantic.ts`, `evaluate-semantic.ts`: specification-first data and checks across 26 families (including weekday ranges, excluding timezone recognition); legacy templates still supply some slot labels without full expected ASTs.
- `data/gold/results.jsonl`, `tests/results-gold.test.ts` and `scripts/evaluate-results.ts`: final-date expectations and public API checks.
- `scripts/seed-prose.ts` and `data/gold/prose.jsonl`: authored prose, negative controls and derived casing checks.
- `data/gold/grammar.jsonl`, `grammar-variations.jsonl`, `negatives.jsonl` and `tests/grammar-model.test.ts`: authored core checks, explicitly derived variants, negative controls, and automated gates.
- `data/external/recognizers/`: pinned Microsoft sources, normalized expected future/past resolutions, MIT license, grouped splits and exclusions.
- `bench/results/recognizers-development.json`: strict per-case output and failure stages. No policy failures are silently excluded.
- `tests/parser-lifecycle.test.ts`, `tests/browser-lifecycle.ts`, `tests/browser.ts`: runtime checks.
- `scripts/qa-playground.ts`: all 25 examples plus date order, recurrence, weekday/week-start policies, comparisons, keyboard navigation and mobile overflow.
- `plan/000-overview.md` through `011-risks-and-open-questions.md`: full original requirements.

## Remaining work

1. Continue correctness: finish migration from legacy label-only templates to specification-first data (currently most positive training examples); expand independent authored cases, negative controls and semantic combinations. The 115 core examples and derived variants passing is a milestone, not proof of all language coverage.
2. Use independent failures to distinguish incorrect neural roles from missing assembler behavior and calendar-policy differences. Respect plan/002 scope: compound number words and quarters are explicitly out of scope for v1. Prioritize supported forms and combinations; keep broad external results separately reported. Preserve conservative failure diagnostics.
3. Complete independent paraphrase, Duckling and PATE evaluations; audit train/test overlap before final test claims. Current external agreement is far below target.
4. The current benchmark artifacts have been refreshed. Finish normalized cross-library correctness, capability matrices, Python batch throughput/wheel sizes, and the size-versus-correctness plot.
5. After correctness, follow the user order: efficiency, then speed, then size. Ultimately meet the full <=30 KB Brotli budget without dropping required behavior. The smaller-model experiment is implemented; do not keep changing architecture as a substitute for coverage.
6. Finish remaining resolver validation, broader long-input semantic checks, mini-calendar, accessibility/Lighthouse checks and full release audit.
7. Update README/production playground and inspect the final distributable. No publication, deployment or Git commit has occurred.

## Constraints

The model predicts temporal roles and clause boundaries, without timezone recognition. TypeScript validates values, assembles the tree, and performs date/time arithmetic. Bare weekdays remain one-off by default. Use RFC 5545 rules and EXDATE, never deprecated EXRULE. Generated and development accuracy is not general language accuracy. Never mark the active goal complete while required behavior or evidence is missing.

- One-off dates now resolve beyond the default one-year recurrence horizon. An explicit `until` still filters both kinds. This fixes the previously empty result for `in one year`.
- The model interprets text only. The same AST resolves in different caller-selected zones, including different local calendar dates at the same reference instant. Runtime validation and DST behavior remain in JavaScript; model timezone recognition is not a remaining requirement.
