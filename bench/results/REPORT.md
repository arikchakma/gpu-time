# gpu-time benchmark results

Development measurements from real executions. This report does not establish a general accuracy ranking.
Public date/range fixtures: **18/18** exact results, including recurrence and daylight-saving transitions.
gpu-time timing includes its public date-resolution and recurrence-preview work. Other libraries retain their native output contracts.

Browser: 152.0.7977.83. Hardware: Apple M4 Max. Reference: 2026-09-09T12:00:00+06:00, Asia/Dhaka.

## Browser parsing time

Dedicated worker per library; ten warmups; 100 single-input samples; fixed repeated four-input batches. Timings cover public parse calls, including gpu-time date resolution and recurrence previews, excluding worker messaging and DOM. No complete parse-result cache is used. Initialization includes local development module loading. Different output contracts make this an experimental workload comparison, not an interchangeable-feature ranking.

Each batch size has one warmup and three measurements. The table reports median duration. Failures count thrown exceptions in one trial; partial parses and empty native results can still be fast.

| Library | Single p50 (µs) | Single p95 (µs) | 1,000 inputs (ms) | 10,000 inputs (ms) | Throws / 10,000 | Single returned output |
|---|---:|---:|---:|---:|---:|---|
| gpu-time CPU | 145.0 | 175.0 | 84.16 | 813.42 | 0 | Yes |
| gpu-time WebGPU | 315.0 | 665.0 | 11.64 | 86.66 | 0 | Yes |
| Chrono (English) | 15.0 | 25.0 | 9.48 | 86.47 | 0 | Yes |
| Compromise + dates | 1405.0 | 1850.0 | 597.57 | 6260.70 | 0 | Yes |
| rrule | <5 | 5.0 | 1.55 | 13.53 | 2500 | No |
| Microsoft Recognizers | 560.0 | 770.0 | 602.78 | 5974.81 | 0 | Yes |
| Later | <5 | 5.0 | 0.88 | 7.11 | 0 | No |

A zero-duration sample is below the isolated browser timer's 5 µs resolution, displayed as <5. Native caches remain enabled. Returning output does not imply correctness.

## Independent source cases

Microsoft Recognizers development: **121/563 (21.49%)** strict agreement with upstream future civil dates and intervals. These expected values come from upstream specifications, not gpu-time.

The corpus is pinned to [da7edcff59f6](https://github.com/microsoft/Recognizers-Text/tree/da7edcff59f669b2a460ab9d400e36298f0d658e/Specs/DateTime/English). 134 grouped cases remain reserved and are not evaluated here. No mismatches are removed as policy differences. Component-specific empty results are not treated as global negative sentences. Symbolic SET/duration values without concrete dates are listed among exclusions.

| Source component | Exact resolved results |
|---|---:|
| DateParser | 36/113 |
| TimeParser | 13/73 |
| TimePeriodParser | 34/60 |
| DateTimeParser | 7/53 |
| DatePeriodParser | 18/190 |
| DateTimePeriodParser | 13/74 |

| Failure stage | Cases |
|---|---:|
| value-mismatch | 128 |
| matches-upstream-past | 19 |
| correct | 121 |
| interpretation-failed | 272 |
| no-result | 19 |
| resolution-error | 4 |

Matches to an upstream past interpretation remain failures in the strict future score. Assembly failures can come from incorrect model roles or missing assembler support; the stage alone does not attribute the cause.

The separate synthetic AST check scores **4993/5000**. Its expected ASTs are sampled before rendering, and all 5000 renderer/oracle pairs pass compiler equality. Fresh values share training rendering families, so this is a development check rather than independent language accuracy.


## Python parsing time

In-process native parsing, ten warmups and 100 samples. Exceptions are captured, not silently dropped. Native return values are retained; naive datetimes remain naive. Browser and Python timings use different runtimes.

| Library | Version | Single p50 (µs) | Single p95 (µs) |
|---|---|---:|---:|
| dateparser | 1.4.3 | 3793.0 | 4130.3 |
| parsedatetime | 2.6 | 18.2 | 18.8 |
| recurrent | 0.4.1 | 150.2 | 155.6 |
| timefhuman | 0.1.5 | 5.1 | 5.4 |

## Browser bundle size

Standalone minified browser ESM bundles, gzip level 9, Brotli quality 11. Exact import expressions included. Chrono uses its English entry; Recognizers' public entry includes its shipped language coverage.

All gpu-time runtime exports, its resolver and trained weights are included. Different libraries provide different language coverage and output contracts. Exact imports and locked dependencies are recorded in [size.json](size.json).

| Library | Minified bytes | Gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| gpu-time | 82205 | 39367 | 33734 |
| Chrono (English) | 45491 | 13258 | 11848 |
| Compromise + dates | 487957 | 179679 | 156071 |
| rrule | 45944 | 13663 | 12380 |
| Microsoft Recognizers | 1371105 | 337137 | 203114 |
| Later | 29698 | 10110 | 9027 |

## Complete schedule checks

Exact AST equality from the shipped CPU model, without oracle labels. These fixtures were used during development and overlap between sets; their totals must not be combined.

| Set | Exact schedules |
|---|---:|
| adversarial | 25 / 25 |
| user-cases | 3 / 3 |
| labels | 26 / 26 |
| grammar | 115 / 115 |
| negatives | 32 / 32 |
| grammar-variations | 314 / 314 |
| prose | 72 / 72 |

WebGPU matches CPU labels and clause boundaries on 10,000 sequences (71,630 non-space tokens), with 0 role mismatches and 0 boundary mismatches. Direct PyTorch comparison covers 512 sequences. Maximum GPU/PyTorch logit error: 0.000008106231689453125. Real device destruction and recovery also passed.

## Actual adversarial outputs

Normalized occurrences/rules are shown when the adapter can represent them. Otherwise the native output is preserved. An output is not necessarily correct. Full native payloads are in [browser.json](browser.json) and [python.json](python.json).

### adversarial-01: Monday 10pm-12am and Saturday Sunday 1pm-8pm

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-12T13:00:00+06:00","allDay":false,"end":"2026-09-12T20:00:00+06:00"},{"start":"2026-09-13T13:00:00+06:00","allDay":false,"end":"2026-09-13T20:00:00+06:00"},{"start":"2026-09-14T22:00:00+06:00","allDay":false,"end":"2026-09-15T00:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-12T13:00:00+06:00","allDay":false,"end":"2026-09-12T20:00:00+06:00"},{"start":"2026-09-13T13:00:00+06:00","allDay":false,"end":"2026-09-13T20:00:00+06:00"},{"start":"2026-09-14T22:00:00+06:00","allDay":false,"end":"2026-09-15T00:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-14T16:00:00.000Z","end":"2026-09-13T18:00:00.000Z"},{"start":"2026-09-12T06:00:00.000Z"},{"start":"2026-09-13T07:00:00.000Z","end":"2026-09-13T14:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-14T00:00:00.000+06:00","end":"2026-09-14T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"},{"start":"2026-09-09T22:00:00.000+06:00","end":"2026-09-10T00:00:00.000+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":2,"minutes":0},"unit":"time"},{"start":"2026-09-12T00:00:00.000+06:00","end":"2026-09-12T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"},{"start":"2026-09-13T00:00:00.000+06:00","end":"2026-09-13T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"},{"start":"2026-09-09T13:00:00.000+06:00","end":"2026-09-09T20:00:00.000+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":7,"minutes":0},"unit":"time"}],"rrules":null}` |
| rrule | `"Error: expected every but found monday"` |
| Microsoft Recognizers | `[{"start":0,"end":15,"resolution":{"values":[{"timex":"(XXXX-WXX-1T22,XXXX-WXX-1T00,PT2H)","type":"datetimerange","start":"2026-09-07 22:00:00","end":"2026-09-07 00:00:00"},{"timex":"(XXXX-WXX-1T22,XXXX-WXX-1T00,PT2H)","type":"datetimerange","start":"2026-09-14 22:00:00","end":"2026-09-14 00:00:00"}]},"text":"monday 10pm-12am","typeName":"datetimeV2.datetimerange"},{"start":21,"end":28,"resolution":{"values":[{"timex":"XXXX-WXX-6","type":"date","value":"2026-09-05"},{"timex":"XXXX-WXX-6","type":"date","value":"2026-09-12"}]},"text":"saturday","typeName":"datetimeV2.date"},{"start":30,"end":43,"resolution":{"values":[{"timex":"(XXXX-WXX-7T13,XXXX-WXX-7T20,PT7H)","type":"datetimerange","start":"2026-09-06 13:00:00","end":"2026-09-06 20:00:00"},{"timex":"(XXXX-WXX-7T13,XXXX-WXX-7T20,PT7H)","type":"datetimerange","start":"2026-09-13 13:00:00","end":"2026-09-13 20:00:00"}]},"text":"sunday 1pm-8pm","typeName":"datetimeV2.datetimerange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-14T20:00:00+06:00",3]` |
| recurrent | `"2026-09-14T20:00:00"` |
| timefhuman | `[["2026-09-14T22:00:00","2026-09-14T00:00:00"],"2026-09-12T00:00:00",["2026-09-13T13:00:00","2026-09-13T20:00:00"]]` |

### adversarial-02: every other Tuesday until Dec

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-09-29T00:00:00+06:00","allDay":true},{"start":"2026-10-13T00:00:00+06:00","allDay":true},{"start":"2026-10-27T00:00:00+06:00","allDay":true},{"start":"2026-11-10T00:00:00+06:00","allDay":true},{"start":"2026-11-24T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260915\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261201"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-09-29T00:00:00+06:00","allDay":true},{"start":"2026-10-13T00:00:00+06:00","allDay":true},{"start":"2026-10-27T00:00:00+06:00","allDay":true},{"start":"2026-11-10T00:00:00+06:00","allDay":true},{"start":"2026-11-24T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260915\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261201"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-15T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-15T00:00:00.000+06:00","end":"2026-12-31T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":3,"days":17,"hours":0,"minutes":0}}],"rrules":null}` |
| rrule | `"Error: Unexpected end"` |
| Microsoft Recognizers | `[{"start":0,"end":18,"resolution":{"values":[{"timex":"XXXX-WXX-2","type":"set","value":"not resolved"}]},"text":"every other tuesday","typeName":"datetimeV2.set"},{"start":20,"end":28,"resolution":{"values":[{"timex":"XXXX-12","Mod":"before","type":"daterange","sourceEntity":"datetimerange","end":"2025-12-01"},{"timex":"XXXX-12","Mod":"before","type":"daterange","sourceEntity":"datetimerange","end":"2026-12-01"}]},"text":"until dec","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":6}` |
| dateparser | `null` |
| parsedatetime | `["2026-12-01T12:00:00+06:00",1]` |
| recurrent | `"RRULE:BYDAY=TU;INTERVAL=2;FREQ=WEEKLY;UNTIL=20261201"` |
| timefhuman | `["2026-09-15T00:00:00"]` |

### adversarial-03: Tuesday and Thursday at 3pm

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-10T15:00:00+06:00","allDay":false},{"start":"2026-09-15T15:00:00+06:00","allDay":false}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-10T15:00:00+06:00","allDay":false},{"start":"2026-09-15T15:00:00+06:00","allDay":false}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-15T06:00:00.000Z"},{"start":"2026-09-10T09:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-15T00:00:00.000+06:00","end":"2026-09-15T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"},{"start":"2026-09-10T15:00:00.000+06:00","end":"2026-09-10T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":9,"minutes":0},"unit":"time"}],"rrules":null}` |
| rrule | `"Error: expected every but found tuesday"` |
| Microsoft Recognizers | `[{"start":0,"end":6,"resolution":{"values":[{"timex":"XXXX-WXX-2","type":"date","value":"2026-09-08"},{"timex":"XXXX-WXX-2","type":"date","value":"2026-09-15"}]},"text":"tuesday","typeName":"datetimeV2.date"},{"start":12,"end":26,"resolution":{"values":[{"timex":"XXXX-WXX-4T15","type":"datetime","value":"2026-09-03 15:00:00"},{"timex":"XXXX-WXX-4T15","type":"datetime","value":"2026-09-10 15:00:00"}]},"text":"thursday at 3pm","typeName":"datetimeV2.datetime"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-15T15:00:00+06:00",3]` |
| recurrent | `"2026-09-15T15:00:00"` |
| timefhuman | `["2026-09-15T00:00:00","2026-09-10T15:00:00"]` |

### adversarial-04: 3 days before Christmas

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-12-22T00:00:00+06:00","allDay":true}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-12-22T00:00:00+06:00","allDay":true}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-06T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-12-22T00:00:00.000+06:00","end":"2026-12-22T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"}],"rrules":null}` |
| rrule | `"Error: expected every but found number"` |
| Microsoft Recognizers | `[{"start":0,"end":5,"resolution":{"values":[{"timex":"P3D","type":"duration","value":"259200"}]},"text":"3 days","typeName":"datetimeV2.duration"},{"start":7,"end":22,"resolution":{"values":[{"timex":"XXXX-12-25","Mod":"before","type":"daterange","sourceEntity":"datetimepoint","end":"2025-12-25"},{"timex":"XXXX-12-25","Mod":"before","type":"daterange","sourceEntity":"datetimepoint","end":"2026-12-25"}]},"text":"before christmas","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-06T12:00:00+06:00",1]` |
| recurrent | `"2026-09-06T12:00:00"` |
| timefhuman | `["2026-09-12T12:00:00"]` |

### adversarial-05: 1 day before

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-08T12:00:00+06:00","allDay":false}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-08T12:00:00+06:00","allDay":false}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-08T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-08T00:00:00.000+06:00","end":"2026-09-08T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"}],"rrules":null}` |
| rrule | `"Error: expected every but found number"` |
| Microsoft Recognizers | `[{"start":0,"end":4,"resolution":{"values":[{"timex":"P1D","type":"duration","value":"86400"}]},"text":"1 day","typeName":"datetimeV2.duration"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `"2026-09-08T12:00:00+06:00"` |
| parsedatetime | `["2026-09-08T12:00:00+06:00",1]` |
| recurrent | `"2026-09-08T12:00:00"` |
| timefhuman | `["2026-09-10T12:00:00"]` |

### adversarial-06: twice a week

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-10T00:00:00+06:00","allDay":true},{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-17T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-24T00:00:00+06:00","allDay":true},{"start":"2026-09-28T00:00:00+06:00","allDay":true},{"start":"2026-10-01T00:00:00+06:00","allDay":true},{"start":"2026-10-05T00:00:00+06:00","allDay":true},{"start":"2026-10-08T00:00:00+06:00","allDay":true},{"start":"2026-10-12T00:00:00+06:00","allDay":true},{"start":"2026-10-15T00:00:00+06:00","allDay":true},{"start":"2026-10-19T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260910\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-10T00:00:00+06:00","allDay":true},{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-17T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-24T00:00:00+06:00","allDay":true},{"start":"2026-09-28T00:00:00+06:00","allDay":true},{"start":"2026-10-01T00:00:00+06:00","allDay":true},{"start":"2026-10-05T00:00:00+06:00","allDay":true},{"start":"2026-10-08T00:00:00+06:00","allDay":true},{"start":"2026-10-12T00:00:00+06:00","allDay":true},{"start":"2026-10-15T00:00:00+06:00","allDay":true},{"start":"2026-10-19T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260910\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-16T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[],"rrules":null}` |
| rrule | `null` |
| Microsoft Recognizers | `[{"start":6,"end":11,"resolution":{"values":[{"timex":"P1W","type":"duration","value":"604800"}]},"text":"a week","typeName":"datetimeV2.duration"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-16T12:00:00+06:00",1]` |
| recurrent | `null` |
| timefhuman | `["2026-09-16T12:00:00"]` |

### adversarial-07: every day except Sundays

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-09T00:00:00+06:00","allDay":true},{"start":"2026-09-10T00:00:00+06:00","allDay":true},{"start":"2026-09-11T00:00:00+06:00","allDay":true},{"start":"2026-09-12T00:00:00+06:00","allDay":true},{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-09-16T00:00:00+06:00","allDay":true},{"start":"2026-09-17T00:00:00+06:00","allDay":true},{"start":"2026-09-18T00:00:00+06:00","allDay":true},{"start":"2026-09-19T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-22T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260909\nRRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-09T00:00:00+06:00","allDay":true},{"start":"2026-09-10T00:00:00+06:00","allDay":true},{"start":"2026-09-11T00:00:00+06:00","allDay":true},{"start":"2026-09-12T00:00:00+06:00","allDay":true},{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-09-16T00:00:00+06:00","allDay":true},{"start":"2026-09-17T00:00:00+06:00","allDay":true},{"start":"2026-09-18T00:00:00+06:00","allDay":true},{"start":"2026-09-19T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-22T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260909\nRRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA"]}` |
| Chrono (English) | `{"occurrences":[],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-12T00:00:00.000+06:00","end":"2026-09-12T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day","repeat":{"interval":{"day":1},"choose":"AND"}}],"rrules":null}` |
| rrule | `{"occurrences":[{"start":"2026-09-09T12:00:00.000Z"},{"start":"2026-09-10T12:00:00.000Z"},{"start":"2026-09-11T12:00:00.000Z"},{"start":"2026-09-12T12:00:00.000Z"},{"start":"2026-09-13T12:00:00.000Z"},{"start":"2026-09-14T12:00:00.000Z"},{"start":"2026-09-15T12:00:00.000Z"},{"start":"2026-09-16T12:00:00.000Z"},{"start":"2026-09-17T12:00:00.000Z"},{"start":"2026-09-18T12:00:00.000Z"},{"start":"2026-09-19T12:00:00.000Z"},{"start":"2026-09-20T12:00:00.000Z"}],"rrules":["DTSTART;TZID=Asia/Dhaka:20260909T120000\nRRULE:FREQ=DAILY"]}` |
| Microsoft Recognizers | `[{"start":0,"end":8,"resolution":{"values":[{"timex":"P1D","type":"set","value":"not resolved"}]},"text":"every day","typeName":"datetimeV2.set"},{"start":17,"end":23,"resolution":{"values":[{"timex":"XXXX-WXX-7","type":"set","value":"not resolved"}]},"text":"sundays","typeName":"datetimeV2.set"}]` |
| Later | `{"schedules":[{"D":[1]}],"exceptions":[],"error":6}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-09T12:00:00+06:00",0]` |
| recurrent | `"RRULE:INTERVAL=1;FREQ=DAILY\nEXRULE:BYDAY=SU;INTERVAL=1;FREQ=WEEKLY"` |
| timefhuman | `[]` |

### adversarial-08: 10pm-12pm

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-09T22:00:00+06:00","allDay":false,"end":"2026-09-10T12:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-09T22:00:00+06:00","allDay":false,"end":"2026-09-10T12:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-09T16:00:00.000Z","end":"2026-09-10T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-09T22:00:00.000+06:00","end":"2026-09-10T12:00:00.000+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":14,"minutes":0},"unit":"time"}],"rrules":null}` |
| rrule | `"Error: expected every but found number"` |
| Microsoft Recognizers | `[{"start":0,"end":8,"resolution":{"values":[{"timex":"(T22,T12,PT14H)","type":"timerange","start":"22:00:00","end":"12:00:00"}]},"text":"10pm-12pm","typeName":"datetimeV2.timerange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-09T12:00:00+06:00",2]` |
| recurrent | `"2026-09-09T22:00:00"` |
| timefhuman | `[["2026-09-09T22:00:00","2026-09-10T12:00:00"]]` |

### adversarial-09: 10pm-12am

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-09T22:00:00+06:00","allDay":false,"end":"2026-09-10T00:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-09T22:00:00+06:00","allDay":false,"end":"2026-09-10T00:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-09T16:00:00.000Z","end":"2026-09-09T18:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-09T22:00:00.000+06:00","end":"2026-09-10T00:00:00.000+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":2,"minutes":0},"unit":"time"}],"rrules":null}` |
| rrule | `"Error: expected every but found number"` |
| Microsoft Recognizers | `[{"start":0,"end":8,"resolution":{"values":[{"timex":"(T22,T00,PT2H)","type":"timerange","start":"22:00:00","end":"00:00:00"}]},"text":"10pm-12am","typeName":"datetimeV2.timerange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-09T00:00:00+06:00",2]` |
| recurrent | `"2026-09-09T22:00:00"` |
| timefhuman | `[["2026-09-09T22:00:00","2026-09-10T00:00:00"]]` |

### adversarial-10: from 9 to 5 Mon-Fri

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-10T09:00:00+06:00","allDay":false,"end":"2026-09-10T17:00:00+06:00"},{"start":"2026-09-11T09:00:00+06:00","allDay":false,"end":"2026-09-11T17:00:00+06:00"},{"start":"2026-09-14T09:00:00+06:00","allDay":false,"end":"2026-09-14T17:00:00+06:00"},{"start":"2026-09-15T09:00:00+06:00","allDay":false,"end":"2026-09-15T17:00:00+06:00"},{"start":"2026-09-16T09:00:00+06:00","allDay":false,"end":"2026-09-16T17:00:00+06:00"},{"start":"2026-09-17T09:00:00+06:00","allDay":false,"end":"2026-09-17T17:00:00+06:00"},{"start":"2026-09-18T09:00:00+06:00","allDay":false,"end":"2026-09-18T17:00:00+06:00"},{"start":"2026-09-21T09:00:00+06:00","allDay":false,"end":"2026-09-21T17:00:00+06:00"},{"start":"2026-09-22T09:00:00+06:00","allDay":false,"end":"2026-09-22T17:00:00+06:00"},{"start":"2026-09-23T09:00:00+06:00","allDay":false,"end":"2026-09-23T17:00:00+06:00"},{"start":"2026-09-24T09:00:00+06:00","allDay":false,"end":"2026-09-24T17:00:00+06:00"},{"start":"2026-09-25T09:00:00+06:00","allDay":false,"end":"2026-09-25T17:00:00+06:00"}],"rrules":["DTSTART;TZID=Asia/Dhaka:20260910T090000\nDTEND;TZID=Asia/Dhaka:20260910T170000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-10T09:00:00+06:00","allDay":false,"end":"2026-09-10T17:00:00+06:00"},{"start":"2026-09-11T09:00:00+06:00","allDay":false,"end":"2026-09-11T17:00:00+06:00"},{"start":"2026-09-14T09:00:00+06:00","allDay":false,"end":"2026-09-14T17:00:00+06:00"},{"start":"2026-09-15T09:00:00+06:00","allDay":false,"end":"2026-09-15T17:00:00+06:00"},{"start":"2026-09-16T09:00:00+06:00","allDay":false,"end":"2026-09-16T17:00:00+06:00"},{"start":"2026-09-17T09:00:00+06:00","allDay":false,"end":"2026-09-17T17:00:00+06:00"},{"start":"2026-09-18T09:00:00+06:00","allDay":false,"end":"2026-09-18T17:00:00+06:00"},{"start":"2026-09-21T09:00:00+06:00","allDay":false,"end":"2026-09-21T17:00:00+06:00"},{"start":"2026-09-22T09:00:00+06:00","allDay":false,"end":"2026-09-22T17:00:00+06:00"},{"start":"2026-09-23T09:00:00+06:00","allDay":false,"end":"2026-09-23T17:00:00+06:00"},{"start":"2026-09-24T09:00:00+06:00","allDay":false,"end":"2026-09-24T17:00:00+06:00"},{"start":"2026-09-25T09:00:00+06:00","allDay":false,"end":"2026-09-25T17:00:00+06:00"}],"rrules":["DTSTART;TZID=Asia/Dhaka:20260910T090000\nDTEND;TZID=Asia/Dhaka:20260910T170000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-14T03:00:00.000Z","end":"2026-09-13T23:00:00.000Z"},{"start":"2026-09-11T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-14T09:00:00.000+06:00","end":"2026-09-14T17:00:00.000+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":8,"minutes":0},"unit":"time"},{"start":"2026-09-11T00:00:00.000+06:00","end":"2026-09-11T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"}],"rrules":null}` |
| rrule | `"Error: expected every but found friday"` |
| Microsoft Recognizers | `[{"start":12,"end":18,"resolution":{"values":[{"timex":"(XXXX-WXX-1,XXXX-WXX-5,P4D)","type":"daterange","start":"2026-09-07","end":"2026-09-11"}]},"text":"mon-fri","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-14T12:00:00+06:00",1]` |
| recurrent | `"TypeError: '<' not supported between instances of 'datetime.datetime' and 'NoneType'"` |
| timefhuman | `[["2026-09-14T05:00:00","2026-09-11T05:00:00"]]` |

### adversarial-11: from 9am to noon

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-10T09:00:00+06:00","allDay":false,"end":"2026-09-10T12:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-10T09:00:00+06:00","allDay":false,"end":"2026-09-10T12:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-09T06:00:00.000Z","end":"2026-09-10T03:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-09T09:00:00.000+06:00","end":"2026-09-09T18:58:10.035+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":9,"minutes":58},"unit":"time"}],"rrules":null}` |
| rrule | `"Error: expected every but found friday"` |
| Microsoft Recognizers | `[{"start":0,"end":15,"resolution":{"values":[{"timex":"(T09,T12,PT3H)","type":"timerange","start":"09:00:00","end":"12:00:00"}]},"text":"from 9am to noon","typeName":"datetimeV2.timerange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-09T09:00:00+06:00",2]` |
| recurrent | `null` |
| timefhuman | `[["2026-09-10T09:00:00","2026-09-10T12:00:00"]]` |

### adversarial-12: 26 July - 22 August

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-07-26T00:00:00+06:00","allDay":true,"end":"2026-08-23T00:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-07-26T00:00:00+06:00","allDay":true,"end":"2026-08-23T00:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2027-07-26T06:00:00.000Z","end":"2027-08-22T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2027-07-26T00:00:00.000+06:00","end":"2027-07-26T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"},{"start":"2027-08-01T00:00:00.000+06:00","end":"2027-08-31T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":1,"days":0,"hours":0,"minutes":0},"unit":"month"}],"rrules":null}` |
| rrule | `"Error: expected every but found number"` |
| Microsoft Recognizers | `[{"start":0,"end":11,"resolution":{"values":[{"timex":"2022-07-26","type":"date","value":"2022-07-26"}]},"text":"26 july - 22","typeName":"datetimeV2.date"},{"start":13,"end":18,"resolution":{"values":[{"timex":"XXXX-08","type":"daterange","start":"2026-08-01","end":"2026-09-01"},{"timex":"XXXX-08","type":"daterange","start":"2027-08-01","end":"2027-09-01"}]},"text":"august","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2027-08-22T12:00:00+06:00",1]` |
| recurrent | `"2027-08-22T12:00:00"` |
| timefhuman | `[["2026-07-26T00:00:00","2026-08-22T00:00:00"]]` |

### adversarial-13: in 5 to 10 minutes

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-09T12:05:00+06:00","allDay":false,"end":"2026-09-09T12:10:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-09T12:05:00+06:00","allDay":false,"end":"2026-09-09T12:10:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-09T06:10:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[],"rrules":null}` |
| rrule | `"Error: expected every but found on"` |
| Microsoft Recognizers | `[{"start":8,"end":17,"resolution":{"values":[{"timex":"PT10M","type":"duration","value":"600"}]},"text":"10 minutes","typeName":"datetimeV2.duration"}]` |
| Later | `{"schedules":[{"Y":[]}],"exceptions":[],"error":3}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-09T12:10:00+06:00",2]` |
| recurrent | `"2026-09-09T12:10:00"` |
| timefhuman | `["2026-09-09T12:10:00"]` |

### adversarial-14: sunday morning

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-13T06:00:00+06:00","allDay":false,"end":"2026-09-13T12:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-13T06:00:00+06:00","allDay":false,"end":"2026-09-13T12:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-13T00:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-13T09:00:00.000+06:00","end":"2026-09-13T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":15,"minutes":0},"unit":"time"}],"rrules":null}` |
| rrule | `"Error: expected every but found sunday"` |
| Microsoft Recognizers | `[{"start":0,"end":13,"resolution":{"values":[{"timex":"XXXX-WXX-7TMO","type":"datetimerange","start":"2026-09-06 08:00:00","end":"2026-09-06 12:00:00"},{"timex":"XXXX-WXX-7TMO","type":"datetimerange","start":"2026-09-13 08:00:00","end":"2026-09-13 12:00:00"}]},"text":"sunday morning","typeName":"datetimeV2.datetimerange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-13T06:00:00+06:00",3]` |
| recurrent | `"2026-09-13T06:00:00"` |
| timefhuman | `["2026-09-13T06:00:00"]` |

### adversarial-15: starting from tomorrow for the next 10 days

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-10T00:00:00+06:00","allDay":true,"end":"2026-09-20T00:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-10T00:00:00+06:00","allDay":true,"end":"2026-09-20T00:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-10T06:00:00.000Z"},{"start":"2026-09-19T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[],"rrules":null}` |
| rrule | `null` |
| Microsoft Recognizers | `[{"start":14,"end":21,"resolution":{"values":[{"timex":"2026-09-10","type":"date","value":"2026-09-10"}]},"text":"tomorrow","typeName":"datetimeV2.date"},{"start":31,"end":42,"resolution":{"values":[{"timex":"(2026-09-10,2026-09-20,P10D)","type":"daterange","start":"2026-09-10","end":"2026-09-20"}]},"text":"next 10 days","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-20T09:00:00+06:00",1]` |
| recurrent | `"2026-09-20T09:00:00"` |
| timefhuman | `["2026-09-10T00:00:00","2026-09-19T12:00:00"]` |

### adversarial-16: next Monday at 2pm

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-14T14:00:00+06:00","allDay":false}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-14T14:00:00+06:00","allDay":false}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-14T08:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-14T14:00:00.000+06:00","end":"2026-09-14T23:59:59.999+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":10,"minutes":0},"unit":"time"}],"rrules":null}` |
| rrule | `null` |
| Microsoft Recognizers | `[{"start":0,"end":17,"resolution":{"values":[{"timex":"2026-09-14T14","type":"datetime","value":"2026-09-14 14:00:00"}]},"text":"next monday at 2pm","typeName":"datetimeV2.datetime"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-14T14:00:00+06:00",3]` |
| recurrent | `"2026-09-14T14:00:00"` |
| timefhuman | `["2026-09-14T14:00:00"]` |

### adversarial-17: 1st Friday of next month

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-10-02T00:00:00+06:00","allDay":true}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-10-02T00:00:00+06:00","allDay":true}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-11T06:00:00.000Z"},{"start":"2026-10-09T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-10-02T00:00:00.000+06:00","end":"2026-10-02T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day"}],"rrules":null}` |
| rrule | `"Error: expected every but found nth"` |
| Microsoft Recognizers | `[{"start":0,"end":23,"resolution":{"values":[{"timex":"XXXX-10-WXX-5-#1","type":"date","value":"2026-10-02"}]},"text":"1st friday of next month","typeName":"datetimeV2.date"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-10-01T09:00:00+06:00",1]` |
| recurrent | `"2026-10-02T12:00:00"` |
| timefhuman | `["2026-09-01T00:00:00","2026-09-11T00:00:00"]` |

### adversarial-18: this week

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-07T00:00:00+06:00","allDay":true,"end":"2026-09-14T00:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-07T00:00:00+06:00","allDay":true,"end":"2026-09-14T00:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-10T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-07T00:00:00.000+06:00","end":"2026-09-13T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":7,"hours":0,"minutes":0},"unit":"week"}],"rrules":null}` |
| rrule | `"Error: expected every but found thursday"` |
| Microsoft Recognizers | `[{"start":0,"end":8,"resolution":{"values":[{"timex":"2026-W37","type":"daterange","start":"2026-09-07","end":"2026-09-14"}]},"text":"this week","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `"2026-09-09T12:00:00+06:00"` |
| parsedatetime | `["2026-09-11T17:00:00+06:00",1]` |
| recurrent | `"2026-09-11T17:00:00"` |
| timefhuman | `[]` |

### adversarial-19: every Monday at 9am

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-14T09:00:00+06:00","allDay":false},{"start":"2026-09-21T09:00:00+06:00","allDay":false},{"start":"2026-09-28T09:00:00+06:00","allDay":false},{"start":"2026-10-05T09:00:00+06:00","allDay":false},{"start":"2026-10-12T09:00:00+06:00","allDay":false},{"start":"2026-10-19T09:00:00+06:00","allDay":false},{"start":"2026-10-26T09:00:00+06:00","allDay":false},{"start":"2026-11-02T09:00:00+06:00","allDay":false},{"start":"2026-11-09T09:00:00+06:00","allDay":false},{"start":"2026-11-16T09:00:00+06:00","allDay":false},{"start":"2026-11-23T09:00:00+06:00","allDay":false},{"start":"2026-11-30T09:00:00+06:00","allDay":false}],"rrules":["DTSTART;TZID=Asia/Dhaka:20260914T090000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-14T09:00:00+06:00","allDay":false},{"start":"2026-09-21T09:00:00+06:00","allDay":false},{"start":"2026-09-28T09:00:00+06:00","allDay":false},{"start":"2026-10-05T09:00:00+06:00","allDay":false},{"start":"2026-10-12T09:00:00+06:00","allDay":false},{"start":"2026-10-19T09:00:00+06:00","allDay":false},{"start":"2026-10-26T09:00:00+06:00","allDay":false},{"start":"2026-11-02T09:00:00+06:00","allDay":false},{"start":"2026-11-09T09:00:00+06:00","allDay":false},{"start":"2026-11-16T09:00:00+06:00","allDay":false},{"start":"2026-11-23T09:00:00+06:00","allDay":false},{"start":"2026-11-30T09:00:00+06:00","allDay":false}],"rrules":["DTSTART;TZID=Asia/Dhaka:20260914T090000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-14T03:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-09T09:00:00.000+06:00","end":"2026-09-09T09:00:00.000+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":0,"days":0,"hours":0,"minutes":0},"unit":"millisecond","repeat":{"interval":{"day":1},"filter":{"weekDays":{"monday":true}},"choose":"AND"}}],"rrules":null}` |
| rrule | `{"occurrences":[{"start":"2026-09-14T09:00:00.000Z"},{"start":"2026-09-21T09:00:00.000Z"},{"start":"2026-09-28T09:00:00.000Z"},{"start":"2026-10-05T09:00:00.000Z"},{"start":"2026-10-12T09:00:00.000Z"},{"start":"2026-10-19T09:00:00.000Z"},{"start":"2026-10-26T09:00:00.000Z"},{"start":"2026-11-02T09:00:00.000Z"},{"start":"2026-11-09T09:00:00.000Z"},{"start":"2026-11-16T09:00:00.000Z"},{"start":"2026-11-23T09:00:00.000Z"},{"start":"2026-11-30T09:00:00.000Z"}],"rrules":["DTSTART;TZID=Asia/Dhaka:20260909T120000\nRRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9"]}` |
| Microsoft Recognizers | `[{"start":0,"end":18,"resolution":{"values":[{"timex":"XXXX-WXX-1T09","type":"set","value":"not resolved"}]},"text":"every monday at 9am","typeName":"datetimeV2.set"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":6}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-14T09:00:00+06:00",3]` |
| recurrent | `"RRULE:BYDAY=MO;BYHOUR=9;BYMINUTE=0;INTERVAL=1;FREQ=WEEKLY"` |
| timefhuman | `["2026-09-14T09:00:00"]` |

### adversarial-20: every other year on the 26th of March

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2027-03-26T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20270326\nRRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=26"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2027-03-26T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20270326\nRRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=26"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2027-03-26T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2027-03-26T00:00:00.000+06:00","end":"2027-03-26T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":1,"hours":0,"minutes":0},"unit":"day","repeat":{"interval":{"year":2},"choose":"AND"}}],"rrules":null}` |
| rrule | `"Error: Unexpected end"` |
| Microsoft Recognizers | `[{"start":0,"end":15,"resolution":{"values":[{"timex":"P2Y","type":"set","value":"not resolved"}]},"text":"every other year","typeName":"datetimeV2.set"},{"start":20,"end":36,"resolution":{"values":[{"timex":"XXXX-03-26","type":"date","value":"2026-03-26"},{"timex":"XXXX-03-26","type":"date","value":"2027-03-26"}]},"text":"the 26th of march","typeName":"datetimeV2.date"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":6}` |
| dateparser | `null` |
| parsedatetime | `["2027-03-01T12:00:00+06:00",1]` |
| recurrent | `"RRULE:BYMONTHDAY=26;BYMONTH=3;INTERVAL=2;FREQ=YEARLY"` |
| timefhuman | `["2026-03-26T00:00:00"]` |

### adversarial-21: every 3 days until the end of the month

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-09T00:00:00+06:00","allDay":true},{"start":"2026-09-12T00:00:00+06:00","allDay":true},{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-09-18T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-24T00:00:00+06:00","allDay":true},{"start":"2026-09-27T00:00:00+06:00","allDay":true},{"start":"2026-09-30T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260909\nRRULE:FREQ=DAILY;INTERVAL=3;UNTIL=20260930"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-09T00:00:00+06:00","allDay":true},{"start":"2026-09-12T00:00:00+06:00","allDay":true},{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-09-18T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-24T00:00:00+06:00","allDay":true},{"start":"2026-09-27T00:00:00+06:00","allDay":true},{"start":"2026-09-30T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260909\nRRULE:FREQ=DAILY;INTERVAL=3;UNTIL=20260930"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-12T06:00:00.000Z"},{"start":"2026-10-09T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-01T00:00:00.000+06:00","end":"2026-09-09T00:00:00.000+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":8,"hours":0,"minutes":0}}],"rrules":null}` |
| rrule | `"Error: Cannot parse until date: the end of the month"` |
| Microsoft Recognizers | `[{"start":0,"end":11,"resolution":{"values":[{"timex":"P3D","type":"set","value":"not resolved"}]},"text":"every 3 days","typeName":"datetimeV2.set"},{"start":13,"end":38,"resolution":{"values":[{"timex":"2026-09","Mod":"before-end","type":"daterange","sourceEntity":"datetimerange","end":"2026-10-01"}]},"text":"until the end of the month","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[{"D":[1,4,7,10,13,16,19,22,25,28,31]}],"exceptions":[],"error":13}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-09T12:00:00+06:00",1]` |
| recurrent | `"RRULE:INTERVAL=3;FREQ=DAILY;UNTIL=20260930"` |
| timefhuman | `["2026-09-12T12:00:00"]` |

### adversarial-22: every week starting next week

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-28T00:00:00+06:00","allDay":true},{"start":"2026-10-05T00:00:00+06:00","allDay":true},{"start":"2026-10-12T00:00:00+06:00","allDay":true},{"start":"2026-10-19T00:00:00+06:00","allDay":true},{"start":"2026-10-26T00:00:00+06:00","allDay":true},{"start":"2026-11-02T00:00:00+06:00","allDay":true},{"start":"2026-11-09T00:00:00+06:00","allDay":true},{"start":"2026-11-16T00:00:00+06:00","allDay":true},{"start":"2026-11-23T00:00:00+06:00","allDay":true},{"start":"2026-11-30T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260914\nRRULE:FREQ=WEEKLY;INTERVAL=1"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-28T00:00:00+06:00","allDay":true},{"start":"2026-10-05T00:00:00+06:00","allDay":true},{"start":"2026-10-12T00:00:00+06:00","allDay":true},{"start":"2026-10-19T00:00:00+06:00","allDay":true},{"start":"2026-10-26T00:00:00+06:00","allDay":true},{"start":"2026-11-02T00:00:00+06:00","allDay":true},{"start":"2026-11-09T00:00:00+06:00","allDay":true},{"start":"2026-11-16T00:00:00+06:00","allDay":true},{"start":"2026-11-23T00:00:00+06:00","allDay":true},{"start":"2026-11-30T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260914\nRRULE:FREQ=WEEKLY;INTERVAL=1"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-16T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-14T00:00:00.000+06:00","end":"2026-09-20T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":7,"hours":0,"minutes":0},"unit":"week","repeat":{"interval":{"week":1},"choose":"AND"}}],"rrules":null}` |
| rrule | `{"occurrences":[{"start":"2026-09-09T12:00:00.000Z"},{"start":"2026-09-16T12:00:00.000Z"},{"start":"2026-09-23T12:00:00.000Z"},{"start":"2026-09-30T12:00:00.000Z"},{"start":"2026-10-07T12:00:00.000Z"},{"start":"2026-10-14T12:00:00.000Z"},{"start":"2026-10-21T12:00:00.000Z"},{"start":"2026-10-28T12:00:00.000Z"},{"start":"2026-11-04T12:00:00.000Z"},{"start":"2026-11-11T12:00:00.000Z"},{"start":"2026-11-18T12:00:00.000Z"},{"start":"2026-11-25T12:00:00.000Z"}],"rrules":["DTSTART;TZID=Asia/Dhaka:20260909T120000\nRRULE:FREQ=WEEKLY"]}` |
| Microsoft Recognizers | `[{"start":0,"end":9,"resolution":{"values":[{"timex":"P1W","type":"set","value":"not resolved"}]},"text":"every week","typeName":"datetimeV2.set"},{"start":11,"end":28,"resolution":{"values":[{"timex":"2026-W38","Mod":"since","type":"daterange","sourceEntity":"datetimerange","start":"2026-09-14"}]},"text":"starting next week","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[{"wy":[]}],"exceptions":[],"error":20}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-16T09:00:00+06:00",1]` |
| recurrent | `"DTSTART:20260916\nRRULE:INTERVAL=1;FREQ=WEEKLY"` |
| timefhuman | `[]` |

### adversarial-23: every Monday until december 31

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-28T00:00:00+06:00","allDay":true},{"start":"2026-10-05T00:00:00+06:00","allDay":true},{"start":"2026-10-12T00:00:00+06:00","allDay":true},{"start":"2026-10-19T00:00:00+06:00","allDay":true},{"start":"2026-10-26T00:00:00+06:00","allDay":true},{"start":"2026-11-02T00:00:00+06:00","allDay":true},{"start":"2026-11-09T00:00:00+06:00","allDay":true},{"start":"2026-11-16T00:00:00+06:00","allDay":true},{"start":"2026-11-23T00:00:00+06:00","allDay":true},{"start":"2026-11-30T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260914\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261231"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-14T00:00:00+06:00","allDay":true},{"start":"2026-09-21T00:00:00+06:00","allDay":true},{"start":"2026-09-28T00:00:00+06:00","allDay":true},{"start":"2026-10-05T00:00:00+06:00","allDay":true},{"start":"2026-10-12T00:00:00+06:00","allDay":true},{"start":"2026-10-19T00:00:00+06:00","allDay":true},{"start":"2026-10-26T00:00:00+06:00","allDay":true},{"start":"2026-11-02T00:00:00+06:00","allDay":true},{"start":"2026-11-09T00:00:00+06:00","allDay":true},{"start":"2026-11-16T00:00:00+06:00","allDay":true},{"start":"2026-11-23T00:00:00+06:00","allDay":true},{"start":"2026-11-30T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260914\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261231"]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-09-14T06:00:00.000Z","end":"2026-12-31T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-09-09T00:00:00.000+06:00","end":"2026-12-31T00:00:00.000+06:00","timezone":"Etc/GMT-6","duration":{"years":0,"months":3,"days":22,"hours":0,"minutes":0},"repeat":{"interval":{"day":1},"filter":{"weekDays":{"monday":true}},"choose":"AND"}}],"rrules":null}` |
| rrule | `{"occurrences":[],"rrules":["DTSTART;TZID=Asia/Dhaka:20260909T120000\nRRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20011230T180000"]}` |
| Microsoft Recognizers | `[{"start":0,"end":29,"resolution":{"values":[{"timex":"(XXXX-WXX-1,XXXX-12-31,P107D)","type":"set","value":"not resolved"}]},"text":"every monday until december 31","typeName":"datetimeV2.set"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":6}` |
| dateparser | `null` |
| parsedatetime | `["2026-12-31T12:00:00+06:00",1]` |
| recurrent | `"RRULE:BYDAY=MO;INTERVAL=1;FREQ=WEEKLY;UNTIL=20261231"` |
| timefhuman | `["2026-09-14T00:00:00","2026-12-31T00:00:00"]` |

### adversarial-24: 1st and 15th of each month

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-10-01T00:00:00+06:00","allDay":true},{"start":"2026-10-15T00:00:00+06:00","allDay":true},{"start":"2026-11-01T00:00:00+06:00","allDay":true},{"start":"2026-11-15T00:00:00+06:00","allDay":true},{"start":"2026-12-01T00:00:00+06:00","allDay":true},{"start":"2026-12-15T00:00:00+06:00","allDay":true},{"start":"2027-01-01T00:00:00+06:00","allDay":true},{"start":"2027-01-15T00:00:00+06:00","allDay":true},{"start":"2027-02-01T00:00:00+06:00","allDay":true},{"start":"2027-02-15T00:00:00+06:00","allDay":true},{"start":"2027-03-01T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260915\nRRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15"]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-09-15T00:00:00+06:00","allDay":true},{"start":"2026-10-01T00:00:00+06:00","allDay":true},{"start":"2026-10-15T00:00:00+06:00","allDay":true},{"start":"2026-11-01T00:00:00+06:00","allDay":true},{"start":"2026-11-15T00:00:00+06:00","allDay":true},{"start":"2026-12-01T00:00:00+06:00","allDay":true},{"start":"2026-12-15T00:00:00+06:00","allDay":true},{"start":"2027-01-01T00:00:00+06:00","allDay":true},{"start":"2027-01-15T00:00:00+06:00","allDay":true},{"start":"2027-02-01T00:00:00+06:00","allDay":true},{"start":"2027-02-15T00:00:00+06:00","allDay":true},{"start":"2027-03-01T00:00:00+06:00","allDay":true}],"rrules":["DTSTART;VALUE=DATE:20260915\nRRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15"]}` |
| Chrono (English) | `{"occurrences":[],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":null,"end":null,"timezone":null,"duration":{},"repeat":{"interval":{"month":1},"choose":"AND"}}],"rrules":null}` |
| rrule | `"Error: expected every but found nth"` |
| Microsoft Recognizers | `[{"start":16,"end":25,"resolution":{"values":[{"timex":"P1M","type":"set","value":"not resolved"}]},"text":"each month","typeName":"datetimeV2.set"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `null` |
| parsedatetime | `["2026-09-09T12:00:00+06:00",0]` |
| recurrent | `"RRULE:BYMONTHDAY=1,15;INTERVAL=1;FREQ=MONTHLY"` |
| timefhuman | `["2026-09-01T00:00:00","2026-09-15T00:00:00"]` |

### adversarial-25: June 11-16, 2026

| Library | Actual output |
|---|---|
| gpu-time CPU | `{"occurrences":[{"start":"2026-06-11T00:00:00+06:00","allDay":true,"end":"2026-06-17T00:00:00+06:00"}],"rrules":[]}` |
| gpu-time WebGPU | `{"occurrences":[{"start":"2026-06-11T00:00:00+06:00","allDay":true,"end":"2026-06-17T00:00:00+06:00"}],"rrules":[]}` |
| Chrono (English) | `{"occurrences":[{"start":"2026-06-11T06:00:00.000Z","end":"2026-06-16T06:00:00.000Z"}],"rrules":null}` |
| Compromise + dates | `{"occurrences":[{"start":"2026-06-11T00:00:00.000+06:00","end":"2026-06-16T23:59:59.999+06:00","timezone":"Asia/Dhaka","duration":{"years":0,"months":0,"days":6,"hours":0,"minutes":0}}],"rrules":null}` |
| rrule | `"Error: expected every but found june"` |
| Microsoft Recognizers | `[{"start":0,"end":15,"resolution":{"values":[{"timex":"(2026-06-11,2026-06-16,P5D)","type":"daterange","start":"2026-06-11","end":"2026-06-16"}]},"text":"june 11-16, 2026","typeName":"datetimeV2.daterange"}]` |
| Later | `{"schedules":[],"exceptions":[],"error":0}` |
| dateparser | `"2026-06-11T00:00:00+06:00"` |
| parsedatetime | `["2027-06-11T20:26:00+06:00",3]` |
| recurrent | `"2027-06-11T20:26:00"` |
| timefhuman | `[["2026-06-11T00:00:00","2026-06-16T00:00:00"]]` |

## Remaining acceptance work

- Native outputs differ: gpu-time returns resolved dates, ranges and recurrence rules; other libraries return components, dates, TIMEX or recurrence constraints. Speed is not feature equivalence.
- The four-input batch workload includes unsupported inputs. Reported thrown-error counts do not include silent partial parses or abstentions.
- Internal interpretation checks and direct-result fixtures are development checks. Sets overlap and are not a final independent accuracy benchmark.
- Cross-library resolved-date correctness, remaining external corpora, a broader gold set and Python batch throughput remain incomplete. Microsoft development agreement is reported separately; its test split remains reserved.
- The complete gpu-time library exceeds its 30,000-byte Brotli budget.
