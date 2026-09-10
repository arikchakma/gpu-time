# Completion audit

The public date/range API and the approved natural-language additions are implemented and trained. The broader release remains experimental.

## Size and runtime optimization

The committed 6-bit model remains selected. Smaller 4-bit candidates were rejected after individual regressions, including incorrect grouping in a playground case. A candidate was temporarily shown in the playground and then rolled back. All 25 playground examples are now included in the automated model gate.

Runtime changes retain the original weights: numeric internal roles, bounded embedding caching, reusable CPU workspaces, four GPU scratch buffers instead of seven, and fewer calendar allocations. The package excludes duplicate internal bundles. Balanced minification preserves CPU throughput. Benchmarks reuse existing evaluation corpora unless `--refresh-corpus` is explicitly supplied; changing training renderers must not silently change comparison inputs.

## Current scope

Text -> neural language recognition -> TypeScript value normalization -> dates, ranges and recurrence rules. The caller supplies reference/timezone. There is no public AST or token-label output, and no timezone role in the model.

The September 9 scope approval adds spoken clocks, fractional clock expressions, time-of-day qualifiers, combined and fractional clock quantities, dates inside sentences, numeric date formats, date and datetime ranges, whole-month periods, numbered weeks within months, recurrence variants/bounds/exceptions, and shared clock points. This supersedes the original plan's exclusion of compound number words. README.md records interpretation policies.

## Selected model and training

- Selected checkpoint: `training/runs/natural-language-final/best.pt`, epoch 8.
- Same 24,761-parameter architecture, int6 weights, f32 intermediates, 324 embedding rows and 40 output slots. The added CLOCK_OFFSET role distinguishes half/quarter clock arithmetic; timezone remains outside the model.
- Two completed runs: `natural-language-v2` (10 epochs) and `natural-language-final` (8 epochs), each using 300,000 fresh generated examples per epoch. Together these runs processed 5.4 million examples and 83,308,190 tokens. Checkpoint ancestry records which selected epochs contributed to the deployed weights.
- `training/natural.py` supplies 16 additional specification/rendering families. Each epoch mixes new and legacy forms, including negative prose. `data/synth/` holds generated training data locally; checkpoints are in the run directories. These large files are intentionally ignored by Git.
- An initial unselected run was stopped after its split rule excluded most new families. New phrasing now has a separate evaluation; the original structural holdout remains separate. Source snapshots, configurations, checkpoint hashes and calibration are retained in run/export artifacts.

## Verified results

- 790 tests pass, including the original 710 checks and 80 added checks covering new language, calendar composition and regressions. TypeScript passes.
- 18/18 packaged public-result fixtures and all 25 adversarial schedules pass.
- Original generated interpretations: 4996/5000. New generated phrasing: 997/1000. All renderer/oracle checks pass. Both sets share rendering families with training and are development metrics.
- The separate 1,000-case unseen sentence-frame evaluation scores 511/1000 under strict whole-expression equality. Many failures contain the correct temporal result plus a false temporal interpretation in surrounding prose. This is a real remaining limitation; it is not omitted from the report or used as an independent success claim.
- Microsoft development agreement: 156/563 (previously 121/563). All 134 grouped Microsoft test cases remain reserved. Policy differences remain failures in the primary score.
- CPU/WebGPU parity covers 10,000 sequences, 512 direct PyTorch fixtures, and 1,000 source-versus-packaged shader sequences.
- The full benchmark, installed-package smoke check, checkpoint provenance audit and production playground build pass. Live UI checks pass for 25 adversarial and seven new natural-language cases, with WebGPU, no page errors and no mobile overflow.
- Warm 10,000-input medians: WebGPU 80.3 ms, CPU 726.8 ms, Chrono 91.6 ms. WebGPU remains below the requested 100 ms target on this workload. Other parsers have different output contracts. No complete parse-result cache is used.
- Public bundle: 35,058 bytes Brotli; weights: 14,995 bytes Brotli. The existing 30,000-byte release gate remains unmet.

The generator also normalizes ordinal suffix spelling and the midnight meaning of `twelve at night`. These value/rendering corrections do not change model role supervision; exact training reproduction uses the saved run sources.

## Equal-clock datetime range correction

`17 August 2013 2pm - 19 August 2013 2pm` was correctly recognized by the model but rejected by clock-only validation. Range ordering is now checked after complete timestamps are resolved. Regression checks cover the exact input, separator variants, zero/reversed ranges, DST and empty hourly recurrence windows. The model is unchanged.

## Behavior and limits

- Bare weekdays stay one-off; explicit recurrence and conventional weekday groups repeat.
- Shared clocks inherit their preceding date/recurrence and export separate rules.
- Calendar days and weeks preserve wall-clock time; hours/minutes use elapsed time. Combined quantities apply in spoken order. Fractional calendar days/months/years have no implicit conversion.
- Date-only ranges include the last named day, represented with an exclusive midnight endpoint. Explicit datetime ranges retain their stated clock endpoints.
- Numbered weeks of a named month are seven-day blocks starting on day one, clipped at month end.
- Numeric date order is caller-configurable. Month/day roles identified by the model are normalized using the values when one exceeds 12. Named dates without a year retain the reference year.
- Weekly single-weekday rules excluding one monthly ordinal export as equivalent monthly ordinal rules. More complex repeating exceptions still filter previews but can return an unsupported-export diagnostic.
- Ambiguity policies and vague expressions remain explicit product choices. The package does not invent an alarm action or interpret personal phrases such as after work.

## Authoritative artifacts

- `training/export-report.json`: selected weights, lineage, calibration, source hashes and token metrics.
- `training/natural.py`, `training/check-natural.py`: new supervision and independent oracle generation.
- `training/natural-evaluation.json`, `training/natural-reserved-evaluation.json`: per-family results and failure examples.
- `tests/natural-language.test.ts`, `tests/compile.test.ts`: authored public results and normalization regressions.
- `data/gold/natural-browser.jsonl`, `scripts/qa-playground.ts`: new browser cases alongside the original UI checks.
- `bench/results/REPORT.md`, `summary.json`, `recognizers-development.json`: current timing, size and independent date expectations.
- `bench/PERFORMANCE.md`, `bench/results/optimization.json`: the earlier optimization history, before this model expansion.

## Remaining release work

Improve recognition of unfamiliar surrounding prose and broader independent language coverage. Complete the remaining independent paraphrase, Duckling/PATE, normalized cross-library capability and release evaluations. Meet the package-size gate after correctness. Passing authored examples does not establish unrestricted natural-language understanding.
