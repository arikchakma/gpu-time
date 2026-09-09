# 004 — Tokenizer, packed features, and the label set

Goal: the two contracts everything else depends on. (a) How text becomes tokens with two u32 feature words (identical in browser and training). (b) The 32 labels plus the clause-boundary flag, with labeling conventions written down as examples.

Effort: 1.5 days (tokenizer 0.5, label conventions + 200 hand-labeled oracle sentences 1).

## 1. Tokenizer (`src/tokenizer.ts`)

Four kinds, like gpu-lexer but with digits split from letters because `10pm`, `1st`, `2026-10-01` need it:

| kind | rule | examples |
|---|---|---|
| 0 WORD | run of letters or `'` inside letters (`o'clock`, `New Year's`) | `Monday`, `pm`, `a.m` → `a` `.` `m` (punct splits) |
| 1 NUMBER | run of digits | `10`, `2026` |
| 2 PUNCT | one non-alnum non-space char | `:` `-` `–` `/` `,` `.` `(` |
| 3 SPACE | run of whitespace incl. newlines | |

Tokens carry `start`/`end` offsets; spans in the output map back to the original string. Non-ASCII letters count as WORD (`café`), non-ASCII punctuation as PUNCT (`–`, `—`).

### Feature words (two u32 per token)

Fields are chosen for *time* text. Every field is a small integer that indexes one row of the embedding table (007); a token's vector is the sum of its rows.

| Field | Bits | Rows | Meaning |
|---|---|---|---|
| kind | 2 | 4 | as above |
| lenBucket | 3 | 8 | 1,2,3,4,5-6,7-8,9-12,13+ |
| firstChar | 6 | 64 | lower-folded: a-z → 0-25, 0-9 → 26-35, 28 punct classes → 36-63 |
| lastChar | 6 | 64 | same map |
| hash1 | 8 | 256 | FNV-1a of lower-folded text (word identity, robust to casing) |
| hash2 | 7 | 128 | FNV-1a of text with vowels removed (typo/abbrev robustness: `tues`/`tue`/`tuesday` collide more) |
| flags | 8 | 8 | hasUpper, allCaps, hasDigit, atStart, atEnd, spaceBefore, spaceAfter, isOrdinalSuffixShape (`1st/2nd/3rd/4th`) |
| prevPunct | 4 | 16 | class of the punctuation token immediately before (none, `:`, `-`/`–`, `/`, `.`, `,`, `(`, `'`, `;`, `&`, `+`, `@`, other) |
| nextPunct | 4 | 16 | same, after |
| numBucket | 4 | 16 | for NUMBER: 0, 1, 2, 3-9, 10-12, 13-23, 24, 25-31, 32-59, 60-99, 100-999, 1000-1899, 1900-2099, 2100+, has-leading-zero, non-number |
| **Total rows** | | **580** | vs gpu-lexer 749 |

Packing: word0 = kind|lenBucket<<2|firstChar<<5|lastChar<<11|hash1<<17|numBucket<<25 (29 bits). word1 = hash2|flags<<7|prevPunct<<15|nextPunct<<19 (23 bits). Spare bits reserved.

The **numBucket** is the single most useful time-specific feature: hour (0-23), minute (0-59), day (1-31), year (1900-2099) become separable before the model sees any context.

## 2. Label set (`src/labels.ts`) — 32 classes

| id | label | covers | notes |
|---|---|---|---|
| 0 | O | everything else: `at`, `on`, `the`, `of`, `a`, `and`, `,`, prose | conjunctions are O; grouping comes from clauseStart |
| 1 | NUM | quantity / interval / count digit or word: `3`, `two`, `other` (=2), `a` in `a week before` | |
| 2 | ORD | `first`, `1st`, `31st` (in `on the 31st`), `last` in `last Friday of the month` | |
| 3 | UNIT | `minute(s)`, `hour(s)`, `day(s)`, `week(s)`, `month(s)`, `year(s)`, `min`, `hr`, `wk` | |
| 4 | DIR_BEFORE | `before`, `ago`, `earlier`, `prior to`, `back` | |
| 5 | DIR_AFTER | `after`, `from now`, `later`, `in` (in `in 3 days`), `hence` | `in` is O in `in October` |
| 6 | NOW | `now`, `right now`, `immediately` | |
| 7 | REL_DAY | `today`, `tomorrow`, `yesterday`, `tonight` | `day after tomorrow` → NUM? no: `day`=O `after`=DIR_AFTER `tomorrow`=REL_DAY, compiler handles |
| 8 | DEICTIC | `next`, `this`, `last`, `coming`, `upcoming`, `previous`, `past` | |
| 9 | WEEKDAY | `Monday`, `Mon`, `mon.`, `Tues` | |
| 10 | DAYGROUP | `weekday(s)`, `weekend(s)`, `workday(s)` | |
| 11 | MONTH | `October`, `Oct`, `10` in `10/01` (locale option) | |
| 12 | DOM | day of month: `1` / `1st` in `October 1st`, `31st` in `every month on the 31st` | ORD vs DOM: DOM when it names a date, ORD when it counts |
| 13 | YEAR | `2026`, `'26` | |
| 14 | HOUR | `2` in `2pm`, `14` in `14:00`, `9` in `9 to 5` | |
| 15 | MINUTE | `30` in `2:30` | |
| 16 | SECOND | `15` in `14:00:15` | |
| 17 | MERIDIEM | `am`, `pm`, `a.m.` (each of `a` `.` `m` `.`), `o'clock` | |
| 18 | TIME_NAMED | `noon`, `midnight`, `midday` | |
| 19 | DAYPART | `morning`, `afternoon`, `evening`, `night` | `tonight` = REL_DAY (compiler adds evening) |
| 20 | RANGE_START | `from`, `between` (when a range follows) | |
| 21 | RANGE_END | `to`, `-`, `–`, `till`, `through`, `and` in `between 9 and 11` | |
| 22 | RECUR | `every`, `each`, `per` | |
| 23 | FREQ | `daily`, `weekly`, `biweekly`, `fortnightly`, `monthly`, `yearly`, `annually`, `hourly` | |
| 24 | TIMES | `once`, `twice`, `thrice`, `times` (in `3 times a week`) | |
| 25 | BOUND_START | `starting`, `beginning`, `from` (before a date inside a recurrence), `as of` | model decides RANGE_START vs BOUND_START |
| 26 | BOUND_END | `until`, `till` (before a date), `through` (before a date), `ending`, `up to` | model decides RANGE_END vs BOUND_END |
| 27 | COUNT | `times` in `for 6 times`, `occurrences` | `for` = O |
| 28 | DUR | `for` before a duration, `lasting` | |
| 29 | EXCEPT | `except`, `excluding`, `but not`, `skip` | |
| 30 | TZ | `EST`, `UTC`, `America`, `/`, `New_York` (each token), `Dhaka time` | |
| 31 | HOLIDAY | `Christmas`, `Eve`, `New`, `Year's`, `Halloween` | |

Reserved ids 32–39 for growth (e.g. WEEK_NUM, QUARTER) without changing the head shape (head outputs 40 logits; unused rows are trained to never fire).

### Clause-boundary head (1 sigmoid per token)

`clauseStart = 1` on the first token of every clause after the first. Examples:

```
Monday 10pm - 12am and Saturday Sunday 1pm - 8pm
WEEKDAY HOUR MERIDIEM RANGE_END HOUR MERIDIEM O WEEKDAY WEEKDAY HOUR MERIDIEM RANGE_END HOUR MERIDIEM
                                                ^ clauseStart (Saturday)

Tuesday and Thursday at 3pm
WEEKDAY O WEEKDAY O HOUR MERIDIEM            → no clauseStart: one clause, days [TU,TH]

Mon at 9 , Wed at 10 , Fri at 11
WEEKDAY O HOUR O WEEKDAY O HOUR O WEEKDAY O HOUR  → clauseStart on Wed, Fri
```

Rule for annotators and the generator: a new clause starts when a *date* token appears after a clause that already had a time, or when a recurrence marker restarts (`every Monday …, and every Saturday …`). A weekday directly after another weekday with no intervening time is a list, not a clause.

### Expression boundaries in prose

Expression = maximal run of non-O tokens (allowing O tokens `at on the of a and , -` *inside* only when both neighbours within 2 tokens are non-O). `remind me to call Sam on Monday at 2pm` → `Monday at 2pm` (prepositions at the edge are excluded from the span; `on` is O). Two expressions in one string → two `Expression` objects.

## 3. Worked labelings (also the first rows of `data/gold/labels.jsonl`)

```
1 day before                    NUM UNIT DIR_BEFORE
10 days after                   NUM UNIT DIR_AFTER
in 90 minutes                   DIR_AFTER NUM UNIT
two hours before tomorrow at noon   NUM UNIT DIR_BEFORE REL_DAY O TIME_NAMED
Monday at 2:00 p.m.             WEEKDAY O HOUR O MINUTE MERIDIEM MERIDIEM MERIDIEM MERIDIEM   (p . m .)
next Friday at noon             DEICTIC WEEKDAY O TIME_NAMED
every other Tuesday until Dec   RECUR NUM WEEKDAY BOUND_END MONTH
the first Monday of every month O ORD WEEKDAY O RECUR UNIT
last Friday of the month        ORD WEEKDAY O O UNIT
last Friday                     DEICTIC WEEKDAY
every weekday except Friday     RECUR DAYGROUP EXCEPT WEEKDAY
twice a week                    TIMES O UNIT
3 times a day                   NUM TIMES O UNIT
every 2 weeks on Tuesday        RECUR NUM UNIT O WEEKDAY
from 9 to 5 Mon - Fri           RANGE_START HOUR RANGE_END HOUR WEEKDAY RANGE_END WEEKDAY
between 9am and noon            RANGE_START HOUR MERIDIEM RANGE_END TIME_NAMED
October 1 , 2027 at noon        MONTH DOM O YEAR O TIME_NAMED
2026 - 10 - 01                  YEAR O MONTH O DOM
June 11 - 16 , 2026             MONTH DOM RANGE_END DOM O YEAR
for 6 times                     O NUM COUNT
for 2 hours                     DUR NUM UNIT
starting from tomorrow for the next 10 days   BOUND_START O REL_DAY DUR O DEICTIC NUM UNIT
3 days before Christmas         NUM UNIT DIR_BEFORE HOLIDAY
at 3pm EST                      O HOUR MERIDIEM TZ
noon America / New_York         TIME_NAMED TZ TZ TZ
9 to 5                          HOUR RANGE_END HOUR
every year on the 26th of March RECUR UNIT O O DOM O MONTH
1st and 15th of each month      DOM O DOM O RECUR UNIT
```

## 4. Acceptance criteria

- `tokenizer.ts` round-trips offsets: concatenating token texts reproduces the input for 10K random strings.
- Feature packing is deterministic and identical in bun and browser (hash test vectors committed).
- `data/gold/labels.jsonl` has ≥ 200 hand-labeled sentences covering every label ≥ 5 times and every 002 §1 family ≥ 3 times, reviewed once by a second pass (Claude as reviewer with the rules above; disagreements resolved by hand).
- A `labels.md` doc generated from `labels.ts` so the generator, compiler, and annotators read the same table.
