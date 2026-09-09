# Date-resolution performance

The 10,000-input chart workload originally spent about 938 ms in calendar
resolution and called `Intl.DateTimeFormat.formatToParts` 552,500 times.

The fix keeps the model and public results unchanged:

- Cache exact timestamp/zone conversions in two bounded 2,048-entry maps.
  Return independent objects so caller mutation cannot corrupt later results.
  Do not cache a timezone's offset for an entire day: DST can change within it.
- Reuse the local fields when formatting an ISO timestamp.
- Step by whole eligible weeks for a single-weekday recurrence, retaining
  exclusions, count, bounds and DST behavior.
- Reuse existing tokens when the input already has canonical whitespace.

The second pass adds genuine batch processing (one promise and one shared
calendar context per batch), immutable word-feature caching, precomputed weekly
anchors, and numeric timestamps until serialization. ISO formatting has a
bounded 2,048-entry cache. The word-feature cache also caps entries at 2,048 and
retains words of at most 64 characters. Position and surrounding context are
still computed for every token. A 10,000-string Unicode fingerprint verifies
that encoded model features remain unchanged.

Calendar arithmetic uses Date.UTC rather than allocating temporary Date objects;
years 0–99 use a Gregorian-cycle correction, with explicit regression checks.
The test suite also checks batch disposal, mixed single/batch calls, independently
mutable results, fractional reference timestamps and ranges ending at epoch zero.

Current shipped-package warm results for 10,000 inputs: **86.7 ms WebGPU**, **813.4 ms
CPU**, and **86.5 ms Chrono** in the same run. This meets the requested sub-100 ms
WebGPU batch target; it does not claim that every backend or cold call is under
100 ms. Larger GPU submissions were tested but discarded because they did not
show a reliable gain. The shader, model weights and inference math are unchanged.

There is no cache of complete parsed answers. The full benchmark still runs
neural inference and date resolution for every input.

`results/optimization.json` records before/after measurements, the baseline Git
commit, source hashes and an additional 1,000-distinct-input comparison. The
latter produces identical output hashes. A separate differential check covers
192 weekly recurrence combinations across four zones, intervals, counts,
exclusions and both week-start policies. DST gaps, overlaps, half-hour changes,
skipped dates and cache mutation/eviction are covered by the test suite.

## Reproduce the focused profile

```sh
mkdir -p test-results/baseline
git archive 649e5e9 src | tar -x -C test-results/baseline
bun bench/profile.ts baseline --baseline
bun bench/profile.ts optimized
bun bench/profile.ts baseline-distinct --baseline --diverse
bun bench/profile.ts optimized-distinct --diverse
```

Each profile uses a separate headless Chrome instance. Do not run performance
profiles in parallel. Parsing figures are warm medians of three runs; the
resolution-only figure is one instrumented pass. `npm run bench` refreshes the
full shipped-package comparison and the playground tables. Other libraries
return different native outputs, so timing is not a feature-equivalence score.

`bun bench/trace.ts` records a sampled Chrome CPU profile in `test-results/runtime.cpuprofile`.
