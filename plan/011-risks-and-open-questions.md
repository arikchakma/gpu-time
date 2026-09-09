# 011 — Risks and open questions

| Risk | Likelihood | Mitigation |
|---|---|---|
| Synthetic-only training overfits to the grammar; real phrasings fail | High | Held-out template split; LLM paraphrase eval set reported as the headline "real language" number; prose carriers from Snips; error-analysis loop budgeted (007 §5) |
| Clause-boundary head is the weak point on 3+ clause inputs | Medium | Multi-clause is 8% of data; add hard examples (`Sat Sun 1pm-8pm Mon 10pm-12am` with no connector) |
| ORD vs DOM vs NUM confusions (`31st`, `first`, `last`) | Medium | numBucket + ordinal-suffix flag; targeted templates; confusion matrix in report |
| GPU slower than CPU for short single inputs | Certain | Documented; `auto` picks CPU below batch threshold; benchmark reports both. Same caveat gpu-lexer makes |
| int6 accuracy drop | Low | QAT from epoch 14; compare pre/post quant on heldout |
| `Intl` timezone helper edge cases (gap/overlap) | Medium | Dedicated DST tests; cross-check with `rrule` and a one-time Temporal-polyfill dev-only comparison in tests |
| 16 KB workgroup memory limit if inputs > 128 tokens | Low | Per-token states in storage buffers; tokenizer splits long text at sentence punctuation |
| Bundle exceeds 30 KB | Medium | Budget enforced in build; fallback to config S (24.8K params) |
| External gold adapters encode a different interpretation policy | Certain | `policy-diff` tag reported separately, never counted as failure or success |

## Open questions (decide during 002 review)

1. `parse()` always async, or sync when backend is CPU? Plan says always async for one code path.
2. Locale for numeric dates: `10/01` US default with `dateOrder: 'MDY' | 'DMY'` option, or unsupported in v1?
3. `next Friday` default: `nextWeek` (chrono/Recognizers) or `immediate` (Duckling/Siri)? Plan says `nextWeek`, exposed as option.
4. Should `bareWeekdays: 'weekly'` exist, or should the model be trained to treat a weekday list with windows as one-off only? Plan: option on the resolver, parser stays literal.
5. Publish gold sets under MIT in this repo or a separate `nl-schedule-bench` package?
6. Package name: `gpu-time` is free on npm as of today (verify at 010).

## Sequence and total effort

001 done → 002 (1d) → 003 (0.5d) → 004 (1.5d) → 005 (3d) → 006 (3d) → 007 (3d) → 008 (3d) → 009 (3d) → 010 (2d). **≈ 20 working days**, with 005 finished and fully tested before the first training run.
