# 009 — Benchmark

Goal: a reproducible harness that shows, per library, what parses correctly, what fails, how fast, and how big. It is what the README and playground will cite, so every number must come from `bench/results/*.json` produced by one command.

Effort: 3 days.

## 1. Baselines

| Library | Run via | Why included |
|---|---|---|
| chrono-node | bench/baselines/chrono.ts | JS incumbent, 44 KB |
| compromise + compromise-dates | .ts | closest feature-wise, 180 KB |
| rrule `fromText` | .ts | JS recurrence incumbent |
| @microsoft/recognizers-text-date-time | .ts | only JS lib with sets + ranges + tz, 336 KB |
| @breejs/later `parse.text` | .ts | grammar-based schedules |
| dateparser, parsedatetime, recurrent, timefhuman | bench/sidecar.py over JSON lines | strongest Python options |
| **gpu-time cpu / webgpu** | our API | |

Cited but not run: Duckling, SUTime, HeidelTime, natty (JVM/Haskell, no recurrence or 474 MB models).

Each adapter normalizes to `{ occurrences: [{start,end?}] | null, rrule: string[] | null, abstained: boolean, error?: string }` under the same reference `2026-09-09T12:00:00+06:00`, `Asia/Dhaka` (or the library's closest option).

## 2. Gold sets (from 006)

adversarial-25 · gold-families (~400) · heldout-templates (1,000 sampled) · paraphrase-eval (1,000) · external Recognizers / Duckling / PATE.

## 3. Metrics (`bench/metrics.ts`)

| Metric | Definition | Exposes |
|---|---|---|
| coverage | returned something non-abstaining | refusals |
| correct | occurrences match gold within 1 min (one-off) or the first 12 expanded occurrences match (recurrence, expanded with the `rrule` package from the emitted RRULE) | the real question |
| sane | every returned window has end ≥ start | gap #8 |
| honest-abstain | on inputs with no time expression, returned nothing (returning "now" counts as a failure) | parsedatetime / date.js behaviour |
| clause-join | multi-clause inputs returned as one structured result | gap #1 |
| capability matrix | per family: ✅ ≥ 90% / ⚠️ 50–90% / ❌ < 50% | the "they can't, we can" table |
| structure | exact `Schedule` match (ours only; incumbents have no comparable AST) | |

## 4. Perf and size

- `bench/perf.browser.ts` (Playwright, Chrome, dedicated worker, DOM excluded, warm): µs per parse for single inputs; throughput for batches of 1K and 10K; gpu-time CPU vs WebGPU; incumbents' JS libraries in the same worker; Python libs measured in-process by the sidecar. Report p50/p95 and cold start.
- `bench/size.ts`: esbuild `--bundle --minify` of each library's minimal import, gzip and brotli bytes; Python wheel sizes for reference.

## 5. Output

`bench/results/REPORT.md` with: capability matrix; accuracy table per gold set; the adversarial-25 table with every library's actual output; perf table; size table; a size-vs-correctness Pareto chart (SVG) for the README and playground. Plus `bench/results/summary.json` consumed by the playground's Compare tab.

## 6. Acceptance criteria

- `bun run bench` runs end to end in < 10 min and is deterministic (fixed reference date, pinned versions in package.json / `bench/requirements.txt`).
- Every claim in README.md links to a row in `REPORT.md`.
- We publish the gold sets and adapters (MIT) as a standalone NL→schedule/RRULE benchmark; none exists today.
