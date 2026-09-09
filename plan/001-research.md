# 001 — Research (done 2026-09-09)

Status: **complete**. This file records what we learned so later phases do not re-derive it. Sources are linked. Where a fact came from inspecting the gpu-lexer npm bundle (the expected GitHub URL returns 404; its visibility is unknown), it is marked *(bundle)*.

Rechecked 2026-09-09: npm still publishes `gpu-lexer@0.0.1`, with no repository field. The published `package/dist/index.js` is 59,570 bytes and matches the inspected local copy. SHA-256: `6c763dfd3e578c5aaa7e5ce0cb3780d01b8a1ba85ee212fe872e57a6e61e21aa`. Sources: [published package](https://registry.npmjs.org/gpu-lexer/-/gpu-lexer-0.0.1.tgz), [live demo](https://gpu-lexer.vercel.app/). Training source, optimizer, data collection and exact training procedure remain unverified. The architecture below is observable in the shipped inference implementation.

## 1. How gpu-lexer actually works

npm `gpu-lexer@0.0.1`, MIT, zero runtime deps, single 59.6 KB ESM file (33.4 KB gzip, 28.2 KB brotli). Build: esbuild + `wgslender` (WGSL minifier), tests with `node --test`.

### Tokenizer *(bundle)*
Not bytes, not BPE. A four-kind lexer: word (`[A-Za-z0-9_]` or non-ASCII), whitespace run, newline, single other char. Each token becomes **two packed u32 feature words**:

- word0: kind (2 bits) · log2 length bucket (3) · first char (7) · last char (7) · FNV-1a hash of chars (8)
- word1: flags hasLower/hasUpper/hasDigit/hasUnderscore/atLineStart/… · previous punctuation pair class (4) · next pair class (4) · second hash (7) · prev/next char-pair hashes (5+5)

### Network *(bundle, fully verified)*
Hidden size **H = 32**, and the WGSL workgroup is 32 threads = one thread per hidden unit.

1. **Feature-bag embedding**: 749 rows × 32. Each token's vector = sum of the rows selected by its feature fields. 23,968 of the 41,321 parameters (58%) live here.
2. **Token encoder**: bias + 5-tap per-lane convolution over positions −2..+2 + embeddings of previous/next non-whitespace token → tanh.
3. **Bidirectional diagonal linear RNN** run as a chunked **parallel scan**: gate `a = σ(Wz·h+b)`, candidate `b = (1−a)·tanh(Wy·h+b)`, state `s_t = a·s_{t−1} + b`. Forward and backward. Combine: `tanh(h + W[32×64]·[fwd;bwd] + b)`.
4. **Binary tree over the token axis** (bottom-up reduce, top-down gated broadcast) with a lane-XOR "butterfly" to mix channels without matmuls. Gives every token global document context.
5. **Head**: gate 16 = σ(W16×64), hidden 72 = tanh(W72×80 [tok;ctx;gate]), logits 9. Argmax. Whitespace tokens skip the head.

**Parameters: 41,321.** **Quantization: int6**, zig-zag signed, one base64-alphabet character per weight, one fp32 scale per tensor, decoded to Float32Array at init. Compute is f32; f16 is storage only, with explicit `f32(f16(x))` rounding. Training-side precision and parity cannot be verified from the shipped runtime.

### Runtime *(bundle)*
11 storage buffers, 7 compute entry points dispatched in order, weights in a separate 165 KB buffer. **All `highlight()` calls in the same microtask are batched into one GPU submission**, each as an independent "stream" (context never leaks between inputs). Labels are packed 4 per u32 via `atomicOr`, read back once, and adjacent equal labels are merged into spans. **There is no CPU fallback**; without WebGPU it throws.

### Public API
```ts
type SyntaxClassName = 'plain'|'comment'|'string'|'number'|'keyword'|'type'|'function'|'constant'|'operator';
interface HighlightSpan { type: SyntaxClassName; start: number; end: number }
export function highlight(code: string): Promise<HighlightSpan[]>;
```

### Training and evaluation (demo page only; code not public)
Labels come from Shiki. 4.72M tokens per epoch, 90 languages, "context-only tokens and replay". Metric: per-token agreement with Shiki on 1,069 held-out files, weighted by language popularity: gpu-lexer 90.2%, Prism 87.0%, hljs 84.7%, Sugar High 76.3%. Perf: 5.56M chars in 472 ms on M4 Pro vs Prism 1.2 s, Shiki 30.4 s.

### What we copy
Feature-packed tokenizer; feature-bag embedding; H=32 with 32-lane workgroups; diagonal linear RNN as a scan; int6 zig-zag export with per-tensor scales; f16-storage rounding parity; microtask batching with per-stream tables; `atomicOr` label packing; growable buffer cache.

### What we change
Inputs are short (typically 5–40 tokens), so the cross-chunk tree machinery is unnecessary; one workgroup per expression with a pooled global context is enough (008). We add a CPU fallback, options, and a JSON compiler on top of the labels.

## 2. Existing natural-language time parsers

Probed on 2026-09-09 against current versions with our target inputs. Sizes are esbuild minified + gzip.

| Library | Runtime · size | Approach | Relative | Weekday+time | Ranges | Recurrence | Multi-clause | Output |
|---|---|---|---|---|---|---|---|---|
| [chrono-node](https://github.com/wanasit/chrono) 2.10 | JS · 44 KB | regex + refiners | ✅ (drops anchors) | ✅ | ⚠️ weekday + overnight → end < start | ❌ won't-fix [#349](https://github.com/wanasit/chrono/issues/349) | ⚠️ unlinked results | components |
| [compromise-dates](https://github.com/spencermountain/compromise) 14.16 | JS · 180 KB | POS rules | ✅ | ✅ | ✅ | ❌ [#1168](https://github.com/spencermountain/compromise/issues/1168) | ⚠️ fragments | `{start,end}` |
| [rrule](https://github.com/jkbrzt/rrule) `fromText` 2.8 | JS · 13.7 KB | token grammar | ❌ | ❌ | ❌ | ⚠️ no "other", `until Dec` errors | ✅ | RRule; silently empty on failure |
| [@microsoft/recognizers-text-date-time](https://github.com/microsoft/Recognizers-Text) 1.3 | JS · **336 KB** | YAML regex sets | ⚠️ | ✅ | ⚠️ end < start | ⚠️ drops "every other" interval | ⚠️ | TIMEX |
| [@breejs/later](https://github.com/breejs/later) 4.2 | JS · 10 KB | grammar | ❌ | ⚠️ canonical form only | ❌ | ⚠️ | ✅ | schedule |
| [dateparser](https://github.com/scrapinghub/dateparser) 1.4 | Py | regex + locale YAML | ⚠️ | ✅ | ❌ [#522](https://github.com/scrapinghub/dateparser/issues/522) | ❌ | ❌ None | datetime |
| [parsedatetime](https://github.com/bear/parsedatetime) 2.6 | Py | regex | ✅ | ✅ | ❌ | ❌ | ❌ | datetime; **returns now on failure** |
| [recurrent](https://github.com/kvh/recurrent) 0.4 | Py | regex over tokens | inherits | ✅ | ❌ | ✅ best in class (`every other Tuesday until Dec`, EXRULE) | ⚠️ crashes on `from 9 to 5 Mon-Fri` | RRULE string |
| [timefhuman](https://github.com/alvinwan/timefhuman) 0.1.5 | Py | lark grammar | ⚠️ sign wrong | ✅ | ✅ | ❌ | ⚠️ time binds to last day | nested lists |
| Duckling / SUTime / HeidelTime / natty | Haskell / Java | rules | ✅ | ✅ | ✅ | ❌ / ✅ | ⚠️ | TIMEX3 |

Dead or too narrow: Sherlock (2021), date.js (2018, returns now), Sugar (2018), any-date-parser, duration-only libs.

**Prior art for a neural or WebGPU time parser: none found** on GitHub, npm, Hugging Face, or HN. Research models exist (BERT-based temporal taggers, SCATE parsers) at hundreds of MB. A sub-100 KB on-device model would be first of its kind.

### Perf of incumbents
chrono ≈ 20–45 µs per parse; parsedatetime ≈ 50 µs; compromise ≈ 1.6 ms; recurrent < 2 ms; dateparser 0.5–1 ms on hits, up to 341 ms on misses (`10pm-12am`), 0.3–0.6 s import.

## 3. Gaps we will target and demonstrate

1. **One structured object for multi-clause input**: `Monday 10pm-12am and Saturday Sunday 1pm-8pm`. Best incumbent output today is three unlinked spans, one with end < start.
2. **Shared time across a weekday list**: `Tuesday and Thursday at 3pm` → every date library binds 3pm to Thursday only.
3. **`every other` + `until <month>`**: only Python `recurrent` handles it.
4. **Anchored relatives**: `3 days before Christmas`, `two hours before tomorrow at noon`.
5. **Sign of bare `before`/`after`**: `1 day before` → date.js and timefhuman *add* a day.
6. **Exceptions**: `every weekday except Friday` → rrule silently drops the exception.
7. **Frequency counts**: `twice a week` → universally unparsed.
8. **Overnight range bound to a weekday**: end < start in chrono, timefhuman, Recognizers.
9. **Ambiguity flags**: `10pm-12pm` (probable typo) — nobody flags it; we emit `confidence` and a diagnostic.
10. **Honest failure** instead of "now" or an empty rule.
11. **Ordinal-of-period**: `first Monday of every month`.
12. **Duration ranges**: `in 5 to 10 minutes` → chrono returns 5:00–10:00 AM.
13. **Size × capability Pareto**: the only library with sets + ranges + timezones is 336 KB and still cannot join clauses; chrono is 44 KB with no recurrence.
14. **Unified output**: nothing emits typed AST + resolved dates + RRULE together.

## 4. The adversarial-25 set (seed of the benchmark gold data)

| # | Input | Incumbent behaviour |
|---|---|---|
| 1 | `Monday 10pm-12am and Saturday Sunday 1pm-8pm` | chrono 3 spans, end<start; compromise 5 fragments |
| 2 | `every other Tuesday until Dec` | chrono → "Tuesday"; rrule → error; Recognizers loses interval |
| 3 | `Tuesday and Thursday at 3pm` | 3pm bound to Thursday only (all JS libs) |
| 4 | `3 days before Christmas` | chrono → Sep 6; dateparser → None; dateutil → Dec 3 |
| 5 | `1 day before` | date.js, timefhuman → tomorrow |
| 6 | `twice a week` | rrule → empty rule; recurrent → None |
| 7 | `every day except Sundays` | rrule → `FREQ=DAILY` |
| 8 | `10pm-12pm` | Recognizers → 14 h duration; nobody flags |
| 9 | `10pm-12am` | dateparser None after 341 ms; dateutil → 22:00 UTC−12 |
| 10 | `from 9 to 5 Mon-Fri` | chrono end<start; recurrent crashes |
| 11 | `from 9am to noon` | chrono → 09:00 → 09:00 next day [#257](https://github.com/wanasit/chrono/issues/257) |
| 12 | `26 July - 22 August` | chrono → Jul 1 [#604](https://github.com/wanasit/chrono/issues/604) |
| 13 | `in 5 to 10 minutes` | chrono → 5–10 AM [#378](https://github.com/wanasit/chrono/issues/378) |
| 14 | `sunday morning` asked on a Sunday | chrono → today [#402](https://github.com/wanasit/chrono/issues/402) |
| 15 | `starting from tomorrow for the next 10 days` | chrono → two unrelated results [#235](https://github.com/wanasit/chrono/issues/235) |
| 16 | `next Monday at 2pm` | dateparser → None [#573](https://github.com/scrapinghub/dateparser/issues/573) |
| 17 | `1st Friday of next month` | dateparser → None [#871](https://github.com/scrapinghub/dateparser/issues/871) |
| 18 | `this week`, `weekend` | dateparser → None |
| 19 | `every Monday at 9am` | compromise → today 09:00 |
| 20 | `every other year on the 26th of March` | recurrent → `BYHOUR=26` [#25](https://github.com/kvh/recurrent/issues/25) |
| 21 | `every 3 days until the end of the month` | Duckling unsupported [#269](https://github.com/facebook/duckling/issues/269) |
| 22 | `every week starting next week` | Recognizers → null [#2724](https://github.com/microsoft/Recognizers-Text/issues/2724) |
| 23 | `every Monday until december 31` | rrule → `UNTIL=2001…` |
| 24 | `1st and 15th of each month` | parsedatetime → now |
| 25 | `June 11-16, 2026` | timefhuman → `[2025-06-11, ['16','2026']]` [#81](https://github.com/alvinwan/timefhuman/issues/81) |

## 5. Ambiguity conventions in the wild (drives 002's resolver options)

- **Bare `Monday`**: chrono → nearest (past or future) unless `forwardDate`; dateparser → Monday of *current* week; Duckling → future only. We default to *future-or-today-if-time-not-passed*, with an option.
- **`next Friday`**: chrono/compromise/Recognizers → Friday of next week; Duckling/date.js/timefhuman → the very next Friday; Siri → upcoming. We emit `modifier: 'next'` and expose `nextWeekday: 'immediate' | 'nextWeek'`.
- **`12am` / `midnight`**: Duckling → next day 00:00; chrono → today 00:00. In a range, `10pm-12am` means end at 24:00 of the start day; we treat end < start as overnight.
- **`next week`**: users expect Mon–Sun, libraries give +7 days. We emit `{kind:'relativeUnit', unit:'week', modifier:'next'}`; resolver returns the range.

## 6. Datasets we may use

| Dataset | Content | License | Use |
|---|---|---|---|
| [MS Recognizers-Text Specs](https://github.com/microsoft/Recognizers-Text/tree/master/Specs/DateTime/English) | ≈ 25 JSON files, incl. `SetParser` (recurrence) and `DateTimePeriodParser` with TIMEX + start/end | MIT | External gold for resolved values |
| [Duckling EN Corpus.hs](https://github.com/facebook/duckling/blob/main/Duckling/Time/EN/Corpus.hs) | ≈ 800 strings → value/interval, ref Tue 2013-02-12 04:30, 27 negatives | BSD | Intervals, parts of day, negatives |
| [PATE](https://zenodo.org/record/3697930) | 1,188 assistant commands, 1,714 TIMEX3 incl. SET | CC BY 4.0 | Assistant-style gold incl. recurrence |
| [SCATE / SemEval-2018 T6](https://github.com/bethard/anafora-annotations) | compositional typed time graph | ODbL | Sanity-check our AST design only |
| [Snips NLU](https://github.com/sonos/nlu-benchmark) | `timeRange` slot spans in prose | CC0 | Prose carriers for span extraction |
| chrono / recurrent / rrule test suites | regression lists | MIT/BSD | Adversarial cases |

Not used: TimeBank (LDC-restricted), TE3-Silver (noisy), SMCalFlow (needs their executor). **No NL→RRULE benchmark exists**; publishing ours is a side contribution.

## 7. Local toolchain confirmed

Node 24.21, npm 11, bun, deno, uv, Python 3.13/3.14, Apple M4 Max (40 cores, 48 GB) → PyTorch with MPS for training. `Math.f16round` is available in Node 24 for f16 rounding parity in the CPU path. Chrome on this machine has WebGPU.
