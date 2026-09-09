# 005 — Compiler and resolver (built before the model)

Current contract: normalize model-labeled filler once before composing semantic
values. Word tokens labeled `GLUE` do not change a clock, date, range, or recurrence;
punctuation needed to read values is retained. Preserve source offsets and raw
model predictions. Filler uncertainty does not reduce semantic confidence.
Equivalent meaningful predictions must produce the same AST despite harmless
differences in filler labeling. Validate this contract before retraining.

Goal: turn labels + clauseStart flags into a `Schedule`, and a `Schedule` into dates and RRULEs. Built and tested **against hand-written labels** from `data/gold/labels.jsonl` so the deterministic half is finished and trusted before any training happens. When the model arrives, it only has to produce those labels.

Effort: 3 days (compile 1.5, resolve + rrule + zoned 1.5).

## 1. Compiler (`src/compile.ts`)

Input: `Token[]` with `label`, `clauseStart`, `score`. Output: `Expression[]`.

Pipeline:

1. **Segment expressions** (004 §2 rule) → spans of tokens.
2. **Split clauses** at `clauseStart`.
3. **Per clause, a single left-to-right pass with a small state machine** collecting fields into a `ClauseBuilder`:
   - `NUM`/`ORD` are held in a pending slot until the next `UNIT`, `WEEKDAY`, `TIMES`, `COUNT`, or `MERIDIEM` decides what they are. Number words map through `lexicon.ts` (`a`/`an`→1, `other`→2, `twice`→2, …).
   - `HOUR [: MINUTE [: SECOND]] [MERIDIEM]` → `ClockTime`; a bare `HOUR` without meridiem is kept as `{hour, minute:0, meridiem:'unknown'}` until the clause ends, then resolved by: shared meridiem from the range partner (`from 8 to 10pm` → both pm); 24-hour if hour > 12; `9 to 5` working-hours heuristic (start ≤ 12 < end+12 → am/pm); else `ambiguous-meridiem` warning and 24-hour reading.
   - `RANGE_START`/`RANGE_END` pair times into `TimeSpec`, weekdays into `weekdayRange`, dates into `calendarRange`. `RANGE_END` between two `DOM`s shares the month (`June 11-16`).
   - `NUM UNIT DIR_*` → `Shift`; the anchor is whatever `DateSpec`/`TimeSpec` follows the direction word (`3 days before Christmas`), else the reference.
   - `RECUR`/`FREQ`/`TIMES` open a `Recurrence`; `NUM UNIT` right after `RECUR` is the interval; `ORD WEEKDAY … RECUR UNIT(month)` → `bySetPos`; `DOM` list under a monthly recurrence → `byMonthDay`; `DAYGROUP`/`weekdayRange` → `byDay`.
   - `BOUND_START`/`BOUND_END`/`COUNT`/`EXCEPT` attach to the open recurrence; if there is none, `BOUND_END` after a one-off becomes a `calendarRange`/`duration` (`from tomorrow for 10 days`).
   - `TZ` tokens are joined and looked up (IANA verbatim; abbreviations via a fixed table with `ambiguous-timezone` for `CST`, `IST`, `BST`).
4. **Validate**: equal start/end → error; window ≥ 12 h ending at `12pm` → `probable-typo-range` warning; recurrence without freq → derive from `byDay` (weekly) or `byMonthDay` (monthly) else error; unattached `NUM` → error `unsupported`.
5. **Confidence** = min over the expression's non-space tokens of (top1 − top2 softmax margin); diagnostics get `warning: low-confidence` when < 0.5.

Everything here is table-driven where possible (`lexicon.ts`); the state machine is one function of ~300 lines. No grammar library.

## 2. Zoned time helper (`src/zoned.ts`, ≈ 80 lines)

Replaces the Temporal polyfill. Needs only: local wall-clock ↔ UTC in a named zone.

- `offsetAt(epochMs, tz)`: `Intl.DateTimeFormat(tz, {hourCycle:'h23', …}).formatToParts` → wall fields → offset = wall − UTC. Cached per (tz, hour-bucket).
- `zonedToEpoch(y,m,d,hh,mm,tz)`: guess with offset at the naive UTC instant, correct once, then detect gap/overlap by re-checking (standard two-pass algorithm used by date-fns-tz). Returns `{epochMs, kind:'exact'|'gap'|'overlap'}`.
- Date arithmetic on plain `{y,m,d}` fields (days-from-civil algorithm); month add with clamping.

## 3. Resolver (`src/resolve.ts`)

For each clause:

| Clause shape | Algorithm |
|---|---|
| `now` / `relativeDay` / `calendar` / `holiday` | direct civil date; apply `time` or allDay |
| `weekday` list, no recurrence | for each day: next occurrence per `bareWeekday` policy; `modifier` next/this/last per `nextWeekday` and `weekStart` |
| `relativeUnit` | start/end of the unit relative to reference; `edge` picks one end |
| `ordinalWeekday` | compute within `of` month |
| `shift` | resolve anchor (or reference), add ±amount·unit in civil fields (days+) or epoch (hours/minutes) |
| `time` window with end < start | end on the next civil day |
| `recurrence` | iterate civil days from `start ?? reference`, test `byDay/byMonthDay/bySetPos/byMonth` and `interval` (measured from first eligible occurrence), skip `except`, stop at `until`/`count`/`limit`/horizon; `timesPer` without `byDay` → occurrences spread evenly (documented heuristic) |

DST behaviour and clamping rules as in 002 §4. Iteration caps: 100K days scanned per clause, 8-year initial search, `limit ≤ 1000`.

## 4. RRULE export (`src/rrule.ts`)

Per recurring clause emit lines:

```
DTSTART;TZID=Asia/Dhaka:20260914T200000
DTEND;TZID=Asia/Dhaka:20260914T220000
RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO
EXRULE:FREQ=WEEKLY;BYDAY=FR         (for except)
```

`until` → `UNTIL=` in UTC per RFC 5545 when DTSTART has TZID. `count` → `COUNT=`. `timesPer` has no RRULE equivalent → emit the spread days as `BYDAY` with a `warning: 'timesPer-approximated'`. Distinct time windows on distinct day sets are distinct rules (RFC 5545 cannot express `MO 20–22, SA/SU 13–22` in one rule).

## 5. Tests (`tests/compile.test.ts`, `tests/resolve.test.ts`)

- Compile: every row of `data/gold/labels.jsonl` → expected `Schedule` (deep equal). Every 004 §3 worked example.
- Resolve: fixed reference `2026-09-09T12:00:00+06:00` `Asia/Dhaka`; adversarial-25 expected occurrences; DST cases in `America/New_York` (2026-03-08 gap, 2026-11-01 overlap) and `Europe/London`; `31st` monthly; `Jan 31 + 1 month`; overnight windows; `Friday through Monday` wrap.
- RRULE: expand our rules with the `rrule` npm package (dev dep) for 24 occurrences and compare with our resolver's occurrences → catches both sides.
- Property test: random `Schedule`s (from the generator's spec sampler in 006) → resolve never throws and always returns `end ≥ start`.

## 6. Acceptance criteria

- 100% of `labels.jsonl` compiles to the expected schedule.
- All adversarial-25 resolve correctly from oracle labels.
- `resolve` + `rrule` + `zoned` ≤ 4 KB brotli; `compile` + `lexicon` ≤ 4 KB brotli.
- No dependency on host timezone: tests pass under `TZ=UTC` and `TZ=Asia/Dhaka`.
