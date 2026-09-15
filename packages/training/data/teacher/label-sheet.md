# Label sheet for a teacher subagent

One role per token. Everything that is not part of a schedule is `O`. The
compiler, not the teacher, has the final say: a proposal is kept only when it
compiles to the schedule the teacher stated.

## Roles

| Label | Carries | Example |
| --- | --- | --- |
| `NUM` | a plain amount | **1** day, **two** weeks |
| `ORD` | a position in a series | **third** week of may, **last** friday of the month |
| `UNIT` | the thing counted | for 1 **day**, two **weeks** |
| `DIR_BEFORE` | points back, or caps a clock | 1 week **ago**, **until** 3pm, **before** noon |
| `DIR_AFTER` | points forward, or opens a clock | **in** 5 years, **after** 3pm |
| `NOW` | the moment of speaking | **now** |
| `REL_DAY` | a named day near today | **today**, **tomorrow**, **tonight** |
| `DEICTIC` | this / next / last on a unit | **next** jan, **this** week |
| `WEEKDAY` | a day name | **wed**, **tuesdays** |
| `DAYGROUP` | a set of days | each **weekday**, over the **weekend** |
| `MONTH` | a month, named or numeric | **March**, **3**.7 |
| `DOM` | day of the month | 3.**7**, the **15th** |
| `YEAR` | a year | 3.7.**1991**, April **1905** |
| `HOUR` | hour of the day | **8**pm, at **six**, **3** o'clock |
| `MINUTE` | minutes | 11:**45** |
| `SECOND` | seconds | 09:00:**26** |
| `MERIDIEM` | am / pm and o'clock | 8**pm**, 3 **o'clock** |
| `TIME_NAMED` | a named clock time | **noon**, **midnight** |
| `DAYPART` | a part of the day | today **night**, this **afternoon** |
| `RANGE_START` | opens a two-sided range | **from** 11pm to 2am |
| `RANGE_END` | closes a two-sided range | 12am **-** 9am, 5 **to** 6pm |
| `RECUR` | starts a repeat rule | **every** day, **each** weekday |
| `FREQ` | a repeat rule in one word | **daily**, **weekly** |
| `TIMES` | counts repeats in a period | 2 **times** per day |
| `BOUND_START` | when a series starts | **starting** next week |
| `BOUND_END` | when a series ends | every day **until** Monday |
| `COUNT` | how many occurrences | for 4 **occurrences** |
| `DUR` | opens a length of time | **for** 1 day |
| `EXCEPT` | removes days from a rule | every day **except** Sun |
| `HOLIDAY` | a named holiday | **Christmas** |
| `JOIN` | separates two clauses | tue at 9 **;** sun 7 |
| `GLUE` | holds a date together, carries nothing | 3**.**7, **at** six, the **of** in "first of the month" |
| `EDGE` | start or end of a period | **end** of next year |
| `CLOCK_OFFSET` | a fraction before or after an hour | **half** past two |

## Rules

1. **A calendar must be able to act on it.** "after four hours in the museum"
   is a length of time, not an hour of the day: `four` is `NUM`, `hours` is
   `UNIT`. "until four this afternoon" is an hour of the day: `four` is `HOUR`.
2. **Spelled hours are hours.** at **six**, from **ten** tomorrow, **seven**
   o'clock. The corpus labels almost all of these `O` today. That is the bug.
3. **A bound word next to a clock is a direction, not filler.** after 3pm →
   `DIR_AFTER`; until 3pm, before 11am → `DIR_BEFORE`.
4. **Say no often.** A sentence with no schedule in it gets `"schedule": "none"`
   and no labels. "This may work", "Good afternoon", "Every march is composed of
   discrete steps", "I saw them yelling at each other yesterday" — only
   `yesterday` in the last one.
5. **Do not invent.** If the sentence is vague (`soon`, `ASAP`, `early next
   year`), return `"schedule": "none"`.
6. Punctuation inside a date is `GLUE`. Punctuation outside is `O`.

## Output

For each input row return one object, nothing else:

```json
{"id":"taught-0","labels":{"8":"HOUR","10":"MERIDIEM"},"schedule":{"clauses":[{"time":{"start":{"hour":7,"minute":0}}}]}}
```

`labels` maps the token index from the batch to a role; leave out every `O`
token. `schedule` is the schedule the sentence states, in the shape of
`packages/core/src/types.ts`, or the string `"none"`.
