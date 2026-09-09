# 002 — Scope and JSON schema

**User correction, 2026-09-09:** timezone is caller-supplied resolver context.
The model and `Schedule` AST contain no timezone role or field. Any timezone
recognition, per-clause timezone, or timezone training requirements below or in
other original plan files are superseded. The resolver still handles IANA zones,
reference instants and daylight-saving transitions through JavaScript.

Goal: freeze what the parser understands and exactly what JSON it returns, before writing any code. Everything downstream (labels, generator, compiler, benchmark gold) derives from this file.

Effort: 1 day. Output: this file, plus `src/types.ts` and `schema/schedule.schema.json` when 003 scaffolds the repo.

## 1. Supported language (v1)

The generator (006) and the gold set (009) must cover every row. Surface variation (casing, abbreviations, `10pm`/`10 pm`/`10:00pm`/`22:00`, `–`/`-`/`to`, digits/number words up to twelve, optional `at`/`on`/`the`) is covered by the generator, not by this table.

| Family | Examples |
|---|---|
| Now / relative day | `now`, `today`, `tonight`, `tomorrow`, `yesterday`, `the day after tomorrow` |
| Relative quantity | `1 day before`, `10 days after`, `in 90 minutes`, `3 weeks from now`, `two months later`, `5 days ago` |
| Anchored relative | `2 days before Friday`, `two hours before tomorrow at noon`, `3 days after October 1`, `a week before Christmas` |
| Relative unit | `next week`, `last month`, `this weekend`, `in one year`, `end of next month` |
| Weekday | `Monday`, `Mon`, `next Friday`, `this Monday`, `last Tuesday`, `Monday and Wednesday` |
| Day groups | `weekdays`, `weekends`, `every weekday`, `Mon-Fri`, `Monday through Friday` |
| Clock time | `2pm`, `2 p.m.`, `14:00`, `2:30pm`, `noon`, `midnight`, `half past two` (stretch) |
| Part of day | `morning`, `afternoon`, `evening`, `night`, `Monday evening`, `tomorrow morning` |
| Explicit date | `October 1`, `Oct 1st`, `1 October`, `10/01` (locale option), `2026-10-01`, `October 1, 2027 at noon` |
| Time window | `10pm-12am`, `from 8 to 10pm`, `between 9am and noon`, `Monday 1pm-8pm`, `9 to 5` |
| Date range | `June 11-16`, `26 July - 22 August`, `from Monday to Wednesday` |
| Duration | `for 2 hours`, `for 90 minutes`, `for the next 10 days` |
| Multi-clause | `Monday 10pm-12am and Saturday Sunday 1pm-8pm`, `Mon at 9, Wed at 10, Fri at 11` |
| Recurrence | `every Monday at 8pm`, `each Tuesday`, `daily at noon`, `weekly`, `every 2 weeks on Tuesday`, `every other Friday`, `twice a week`, `3 times a day` |
| Monthly / yearly | `every month on the 31st`, `the first Monday of every month`, `last Friday of the month`, `1st and 15th of each month`, `every year on March 26`, `annually` |
| Recurrence bounds | `starting October 1`, `from next week`, `until December 31`, `until Dec`, `through Friday`, `for 6 times`, `for 10 weeks` |
| Exceptions | `every weekday except Friday`, `every day except Sundays` |
| Timezone | `at 3pm EST`, `2pm UTC`, `noon America/New_York`, `9am Dhaka time` (IANA + a fixed table of unambiguous abbreviations; ambiguous ones such as `CST` produce a diagnostic) |
| Prose carriers | `remind me to call Sam on Monday at 2pm`, `the meeting is every other Tuesday until Dec`, `deadline: 3 days before Christmas` |
| Holidays (fixed-date only) | `Christmas`, `Christmas Eve`, `New Year's Day`, `Halloween`, `Valentine's Day` |

Out of scope for v1: non-English, movable holidays (Easter, Thanksgiving), business-day math, `end of quarter`, week numbers, compound number words (`twenty-three`), seconds precision beyond `HH:MM:SS`, fuzzy quantities (`a few days`, `sometime next week` → emitted as `approximate: true` on the shift, resolver picks the middle; stretch).

## 2. Public API

```ts
import { createParser } from 'gpu-time';

const parser = await createParser({ backend: 'auto' });        // 'auto' | 'webgpu' | 'cpu'
const result = parser.parse('Monday 10pm-12am and Saturday Sunday 1pm-8pm');  // sync on CPU, Promise on GPU? → see below
const resolved = resolve(result.expressions[0].schedule, {
  reference: '2026-09-09T12:00:00+06:00',
  timeZone: 'Asia/Dhaka',
});
```

`parse()` always returns a `Promise<ParseResult>` (GPU is async; keeping one signature avoids two code paths). Batch: `parser.parseMany(strings[])`. Calls in the same microtask are coalesced into one GPU submission, like gpu-lexer.

Options:

```ts
interface ParserOptions {
  backend?: 'auto' | 'webgpu' | 'cpu';   // auto = webgpu if available AND (batch ≥ 32 or input ≥ 512 tokens), else cpu
  tokens?: boolean;                       // include per-token labels for debugging / playground
}
```

## 3. Output JSON

```ts
interface ParseResult {
  expressions: Expression[];       // zero or more per input string (prose may contain several)
  backend: 'webgpu' | 'cpu';
  timings: { tokenizeMs: number; inferMs: number; compileMs: number };
  tokens?: Token[];                 // when options.tokens
}

interface Token { start: number; end: number; text: string; label: Label; clauseStart: boolean; score: number }

interface Expression {
  start: number; end: number; text: string;   // offsets into the input, like gpu-lexer spans
  confidence: number;               // 0..1 = min softmax margin over the expression's tokens
  schedule: Schedule | null;        // null when the labels do not compile
  diagnostics: Diagnostic[];        // always present, may be empty
}

interface Diagnostic { code: DiagnosticCode; message: string; start: number; end: number; severity: 'error' | 'warning' }
// e.g. 'ambiguous-meridiem', 'end-equals-start', 'probable-typo-range', 'ambiguous-timezone', 'unsupported', 'missing-time'

interface Schedule { clauses: Clause[] }

interface Clause {
  date?: DateSpec;           // absent = reference date (e.g. bare "at 3pm")
  time?: TimeSpec;           // absent = all day
  shift?: Shift;             // "2 days before <date>"; date absent = shift from reference
  duration?: Duration;       // "for 2 hours"
  recurrence?: Recurrence;
  timeZone?: string;         // IANA
}

type Weekday = 'MO'|'TU'|'WE'|'TH'|'FR'|'SA'|'SU';
type Unit = 'minute'|'hour'|'day'|'week'|'month'|'year';

type DateSpec =
  | { kind: 'now' }
  | { kind: 'relativeDay'; offset: number }                              // yesterday -1, today 0, tomorrow 1, day after tomorrow 2
  | { kind: 'weekday'; days: Weekday[]; modifier?: 'this'|'next'|'last' } // list → shared time distributes over all days
  | { kind: 'weekdayRange'; from: Weekday; to: Weekday }                  // Mon-Fri, Friday through Monday (wraps)
  | { kind: 'dayGroup'; group: 'weekday'|'weekend'; modifier?: 'this'|'next'|'last' }
  | { kind: 'calendar'; year?: number; month?: number; day?: number }     // October 1 / 2026-10-01 / March
  | { kind: 'calendarRange'; from: CalendarDate; to: CalendarDate }       // June 11-16
  | { kind: 'relativeUnit'; unit: Unit; modifier: 'this'|'next'|'last'; edge?: 'start'|'end' } // next week, end of next month
  | { kind: 'ordinalWeekday'; ordinal: number; day: Weekday; of: MonthRef }  // first Monday of next month; ordinal -1 = last
  | { kind: 'holiday'; name: 'christmas'|'christmas-eve'|'new-year'|'new-years-eve'|'halloween'|'valentines' };

interface TimeSpec { start: ClockTime; end?: ClockTime }   // end < start ⇒ overnight; equal ⇒ diagnostic
type ClockTime =
  | { hour: number; minute: number; second?: number }       // 24h; meridiem already applied
  | { named: 'noon'|'midnight' }
  | { part: 'morning'|'afternoon'|'evening'|'night'; }      // resolver maps to a default window (configurable)

interface Shift { amount: number; unit: Unit; direction: 'before'|'after'; approximate?: boolean }
interface Duration { amount: number; unit: Unit }

interface Recurrence {
  freq: 'hourly'|'daily'|'weekly'|'monthly'|'yearly';
  interval: number;                       // every other = 2
  byDay?: Weekday[];
  byMonthDay?: number[];                  // 1..31, -1 = last day
  bySetPos?: number[];                    // first Monday = byDay MO + bySetPos 1
  byMonth?: number[];
  timesPer?: number;                      // "twice a week" → freq weekly, timesPer 2 (no fixed days; resolver/RRULE export chooses or emits COUNT-style hint)
  count?: number;                         // for 6 times
  until?: DateSpec;                       // inclusive local date
  start?: DateSpec;                       // starting October 1
  except?: DateSpec[];                    // except Friday → EXRULE / EXDATE
}
```

Design rules:

- **Every field is a typed node, never a resolved instant.** The same schedule resolves differently under a different reference date. This is what lets the model stay calendar-free.
- **Lists distribute.** `Tuesday and Thursday at 3pm` → one clause with `days: ['TU','TH']` and one `time`. Gap #2.
- **Clause boundaries are model output.** The `clauseStart` head marks where a new `Clause` begins. Gap #1.
- **Overnight is implicit.** `end < start` means the window crosses midnight. `10pm-12pm` compiles (end 12:00 < start 22:00 → 14 h overnight) but emits `probable-typo-range` when the window is ≥ 12 h and the end token was `12pm`. Gap #9.

## 4. Resolver API

```ts
interface ResolveOptions {
  reference: string;                       // ISO with offset or Z; required
  timeZone: string;                        // IANA; required (no host-timezone dependence)
  weekStart?: 'MO'|'SU';                   // default MO
  bareWeekday?: 'future'|'nearest'|'thisWeek';   // default future (today allowed if time has not passed)
  nextWeekday?: 'immediate'|'nextWeek';    // default nextWeek (matches chrono, Recognizers, Siri disagrees)
  dayParts?: Record<'morning'|'afternoon'|'evening'|'night', [string, string]>; // default 06–12, 12–17, 17–21, 21–24
  until?: string;                          // preview horizon, default +1 year
  limit?: number;                          // default 30, max 1000
}

interface Resolved {
  occurrences: { start: string; end?: string; allDay: boolean; clause: number }[];  // ISO 8601 with offset
  rrules: string[];                        // one RFC 5545 fragment set per recurring clause: DTSTART;TZID=…, RRULE:…, EXRULE:…
  truncated: boolean;
}
```

DST rules (documented, tested): recurring events keep local clock time; a non-existent local time (spring-forward gap) is skipped without consuming `count`; an ambiguous time (fall-back) takes the earlier offset; `31st` skips months without a 31st; month arithmetic clamps (Jan 31 + 1 month = Feb 28).

## 5. Interpretation policy (parser side, fixed)

| Input | Meaning |
|---|---|
| `1 day before` | shift −1 day from reference, keep clock time |
| `tomorrow` | next local date, no time (allDay) |
| bare `Monday 8pm` | one-off, `kind: weekday` without recurrence. `bareWeekdays: 'weekly'` resolver option converts to weekly |
| `every`, `each`, `daily`…, `Mon-Fri`, `weekdays` | recurrence |
| `Monday 8pm to 10pm, Saturday and Sunday 1pm to 10pm` | two one-off clauses; each clause with a recurrence word gets its own rule |
| `from 8 to 10pm` | shared meridiem: 20:00–22:00 |
| `9 to 5` | no meridiem: 9:00–17:00 by the "working-hours" heuristic only when end < start under 24h reading; else `ambiguous-meridiem` warning |
| `for 6 times` | `count: 6`; `for 2 hours` | `duration` |
| `until Dec` | `until: {kind:'calendar', month:12}` → resolver uses Dec 1 with `warning: 'until-month-only'` (recurrent uses Dec 1; rrule errors) |
| `except Friday` | `except: [{kind:'weekday', days:['FR']}]` → `EXRULE` in export |

## 6. Acceptance criteria

- `schema/schedule.schema.json` (JSON Schema draft 2020-12) generated from `src/types.ts` and validated against every gold example in 006/009.
- Every row in §1 has at least one gold example with a hand-written expected `Schedule`.
- Each adversarial-25 input has an agreed expected `Schedule` written down in `data/gold/adversarial.jsonl`.
