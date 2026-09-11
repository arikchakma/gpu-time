import { mkdirSync, writeFileSync } from "node:fs";
import type {
  Clause,
  DateSpec,
  Label,
  Schedule,
  TimeSpec,
} from "../../core/src/types.ts";
import { tokenize } from "../../core/src/tokenizer.ts";

const gold = new URL("../data/gold/", import.meta.url);

const time = (hour: number, end?: number): TimeSpec => ({
  start: { hour, minute: 0 },
  ...(end === undefined ? {} : { end: { hour: end, minute: 0 } }),
});
const noon: TimeSpec = { start: { named: "noon" } };
const weekday = (
  ...days: Extract<DateSpec, { kind: "weekday" }>["days"]
): DateSpec => ({ kind: "weekday", days });
const schedule = (...clauses: Clause[]): Schedule => ({ clauses });

// Expectations are authored from the plans. This file does not call the compiler or resolver.
const adversarial = [
  {
    id: "adversarial-01",
    family: "multi-clause",
    text: "Monday 10pm-12am and Saturday Sunday 1pm-8pm",
    schedule: schedule(
      { date: weekday("MO"), time: time(22, 0) },
      { date: weekday("SA", "SU"), time: time(13, 20) },
    ),
  },
  {
    id: "adversarial-02",
    family: "recurrence-bounds",
    text: "every other Tuesday until Dec",
    schedule: schedule({
      recurrence: {
        freq: "weekly",
        interval: 2,
        byDay: ["TU"],
        until: { kind: "calendar", month: 12 },
      },
    }),
  },
  {
    id: "adversarial-03",
    family: "shared-weekdays",
    text: "Tuesday and Thursday at 3pm",
    schedule: schedule({ date: weekday("TU", "TH"), time: time(15) }),
  },
  {
    id: "adversarial-04",
    family: "anchored-relative",
    text: "3 days before Christmas",
    schedule: schedule({
      date: { kind: "holiday", name: "christmas" },
      shift: { amount: 3, unit: "day", direction: "before" },
    }),
  },
  {
    id: "adversarial-05",
    family: "relative-quantity",
    text: "1 day before",
    schedule: schedule({
      shift: { amount: 1, unit: "day", direction: "before" },
    }),
  },
  {
    id: "adversarial-06",
    family: "frequency-count",
    text: "twice a week",
    schedule: schedule({
      recurrence: { freq: "weekly", interval: 1, timesPer: 2 },
    }),
  },
  {
    id: "adversarial-07",
    family: "exceptions",
    text: "every day except Sundays",
    schedule: schedule({
      recurrence: { freq: "daily", interval: 1, except: [weekday("SU")] },
    }),
  },
  {
    id: "adversarial-08",
    family: "ambiguous-range",
    text: "10pm-12pm",
    schedule: schedule({ time: time(22, 12) }),
    diagnostics: ["probable-typo-range"],
  },
  {
    id: "adversarial-09",
    family: "overnight",
    text: "10pm-12am",
    schedule: schedule({ time: time(22, 0) }),
  },
  {
    id: "adversarial-10",
    family: "weekday-range",
    text: "from 9 to 5 Mon-Fri",
    schedule: schedule({
      time: time(9, 17),
      recurrence: {
        freq: "weekly",
        interval: 1,
        byDay: ["MO", "TU", "WE", "TH", "FR"],
      },
    }),
    diagnostics: ["working-hours"],
  },
  {
    id: "adversarial-11",
    family: "named-clock",
    text: "from 9am to noon",
    schedule: schedule({
      time: { start: { hour: 9, minute: 0 }, end: { named: "noon" } },
    }),
  },
  {
    id: "adversarial-12",
    family: "calendar-range",
    text: "26 July - 22 August",
    schedule: schedule({
      date: {
        kind: "calendarRange",
        from: { month: 7, day: 26 },
        to: { month: 8, day: 22 },
      },
    }),
  },
  {
    id: "adversarial-13",
    family: "relative-window",
    text: "in 5 to 10 minutes",
    schedule: schedule({
      shift: { amount: 5, endAmount: 10, unit: "minute", direction: "after" },
    }),
  },
  {
    id: "adversarial-14",
    family: "day-part",
    text: "sunday morning",
    reference: "2026-09-13T12:00:00+06:00",
    schedule: schedule({
      date: weekday("SU"),
      time: { start: { part: "morning" } },
    }),
  },
  {
    id: "adversarial-15",
    family: "duration",
    text: "starting from tomorrow for the next 10 days",
    schedule: schedule({
      date: { kind: "relativeDay", offset: 1 },
      duration: { amount: 10, unit: "day" },
    }),
  },
  {
    id: "adversarial-16",
    family: "modified-weekday",
    text: "next Monday at 2pm",
    schedule: schedule({
      date: { kind: "weekday", days: ["MO"], modifier: "next" },
      time: time(14),
    }),
  },
  {
    id: "adversarial-17",
    family: "ordinal-date",
    text: "1st Friday of next month",
    schedule: schedule({
      date: {
        kind: "ordinalWeekday",
        ordinal: 1,
        day: "FR",
        of: { kind: "relativeUnit", unit: "month", modifier: "next" },
      },
    }),
  },
  {
    id: "adversarial-18",
    family: "relative-period",
    text: "this week",
    schedule: schedule({
      date: { kind: "relativeUnit", unit: "week", modifier: "this" },
    }),
  },
  {
    id: "adversarial-19",
    family: "weekly",
    text: "every Monday at 9am",
    schedule: schedule({
      recurrence: { freq: "weekly", interval: 1, byDay: ["MO"] },
      time: time(9),
    }),
  },
  {
    id: "adversarial-20",
    family: "yearly",
    text: "every other year on the 26th of March",
    schedule: schedule({
      recurrence: {
        freq: "yearly",
        interval: 2,
        byMonthDay: [26],
        byMonth: [3],
      },
    }),
  },
  {
    id: "adversarial-21",
    family: "period-bound",
    text: "every 3 days until the end of the month",
    schedule: schedule({
      recurrence: {
        freq: "daily",
        interval: 3,
        until: {
          kind: "relativeUnit",
          unit: "month",
          modifier: "this",
          edge: "end",
        },
      },
    }),
  },
  {
    id: "adversarial-22",
    family: "start-bound",
    text: "every week starting next week",
    schedule: schedule({
      recurrence: {
        freq: "weekly",
        interval: 1,
        start: { kind: "relativeUnit", unit: "week", modifier: "next" },
      },
    }),
  },
  {
    id: "adversarial-23",
    family: "calendar-bound",
    text: "every Monday until december 31",
    schedule: schedule({
      recurrence: {
        freq: "weekly",
        interval: 1,
        byDay: ["MO"],
        until: { kind: "calendar", month: 12, day: 31 },
      },
    }),
  },
  {
    id: "adversarial-24",
    family: "monthly-list",
    text: "1st and 15th of each month",
    schedule: schedule({
      recurrence: { freq: "monthly", interval: 1, byMonthDay: [1, 15] },
    }),
  },
  {
    id: "adversarial-25",
    family: "shared-month-range",
    text: "June 11-16, 2026",
    schedule: schedule({
      date: {
        kind: "calendarRange",
        from: { year: 2026, month: 6, day: 11 },
        to: { year: 2026, month: 6, day: 16 },
      },
    }),
  },
];

const userCases = [
  {
    id: "user-shorthand",
    family: "multi-clause",
    text: "Sat Sun 1pm-8pm Mon 10pm-12am",
    schedule: schedule(
      { date: weekday("SA", "SU"), time: time(13, 20) },
      { date: weekday("MO"), time: time(22, 0) },
    ),
  },
  {
    id: "user-relative",
    family: "relative-quantity",
    text: "one day after",
    schedule: schedule({
      shift: { amount: 1, unit: "day", direction: "after" },
    }),
  },
  {
    id: "user-long-groups",
    family: "multi-clause",
    text: "Monday from 8pm to 10pm, and then Saturday and Sunday 1pm to 10pm",
    schedule: schedule(
      { date: weekday("MO"), time: time(20, 22) },
      { date: weekday("SA", "SU"), time: time(13, 22) },
    ),
  },
];

const annotations: {
  text: string;
  tags: string;
  clauses?: string[];
  schedule: Schedule;
}[] = [
  {
    text: "1 day before",
    tags: "NUM UNIT DIR_BEFORE",
    schedule: adversarial[4].schedule,
  },
  {
    text: "one day after",
    tags: "NUM UNIT DIR_AFTER",
    schedule: userCases[1].schedule,
  },
  {
    text: "in 90 minutes",
    tags: "DIR_AFTER NUM UNIT",
    schedule: schedule({
      shift: { amount: 90, unit: "minute", direction: "after" },
    }),
  },
  {
    text: "two hours before tomorrow at noon",
    tags: "NUM UNIT DIR_BEFORE REL_DAY O TIME_NAMED",
    schedule: schedule({
      date: { kind: "relativeDay", offset: 1 },
      time: noon,
      shift: { amount: 2, unit: "hour", direction: "before" },
    }),
  },
  {
    text: "Monday at 2:00 p.m.",
    tags: "WEEKDAY O HOUR O MINUTE MERIDIEM MERIDIEM MERIDIEM MERIDIEM",
    schedule: schedule({ date: weekday("MO"), time: time(14) }),
  },
  {
    text: "next Friday at noon",
    tags: "DEICTIC WEEKDAY O TIME_NAMED",
    schedule: schedule({
      date: { kind: "weekday", days: ["FR"], modifier: "next" },
      time: noon,
    }),
  },
  {
    text: "every other Tuesday until Dec",
    tags: "RECUR NUM WEEKDAY BOUND_END MONTH",
    schedule: adversarial[1].schedule,
  },
  {
    text: "the first Monday of every month",
    tags: "O ORD WEEKDAY O RECUR UNIT",
    schedule: schedule({
      recurrence: {
        freq: "monthly",
        interval: 1,
        byDay: ["MO"],
        bySetPos: [1],
      },
    }),
  },
  {
    text: "last Friday of the month",
    tags: "ORD WEEKDAY O O UNIT",
    schedule: schedule({
      recurrence: {
        freq: "monthly",
        interval: 1,
        byDay: ["FR"],
        bySetPos: [-1],
      },
    }),
  },
  {
    text: "last Friday",
    tags: "DEICTIC WEEKDAY",
    schedule: schedule({
      date: { kind: "weekday", days: ["FR"], modifier: "last" },
    }),
  },
  {
    text: "every weekday except Friday",
    tags: "RECUR DAYGROUP EXCEPT WEEKDAY",
    schedule: schedule({
      recurrence: {
        freq: "weekly",
        interval: 1,
        byDay: ["MO", "TU", "WE", "TH", "FR"],
        except: [weekday("FR")],
      },
    }),
  },
  {
    text: "twice a week",
    tags: "TIMES O UNIT",
    schedule: adversarial[5].schedule,
  },
  {
    text: "3 times a day",
    tags: "NUM TIMES O UNIT",
    schedule: schedule({
      recurrence: { freq: "daily", interval: 1, timesPer: 3 },
    }),
  },
  {
    text: "every 2 weeks on Tuesday",
    tags: "RECUR NUM UNIT O WEEKDAY",
    schedule: schedule({
      recurrence: { freq: "weekly", interval: 2, byDay: ["TU"] },
    }),
  },
  {
    text: "from 9 to 5 Mon-Fri",
    tags: "RANGE_START HOUR RANGE_END HOUR WEEKDAY RANGE_END WEEKDAY",
    schedule: adversarial[9].schedule,
  },
  {
    text: "between 9am and noon",
    tags: "RANGE_START HOUR MERIDIEM RANGE_END TIME_NAMED",
    schedule: adversarial[10].schedule,
  },
  {
    text: "October 1, 2027 at noon",
    tags: "MONTH DOM O YEAR O TIME_NAMED",
    schedule: schedule({
      date: { kind: "calendar", year: 2027, month: 10, day: 1 },
      time: noon,
    }),
  },
  {
    text: "2026-10-01",
    tags: "YEAR O MONTH O DOM",
    schedule: schedule({
      date: { kind: "calendar", year: 2026, month: 10, day: 1 },
    }),
  },
  {
    text: "June 11-16, 2026",
    tags: "MONTH DOM RANGE_END DOM O YEAR",
    schedule: adversarial[24].schedule,
  },
  {
    text: "for 2 hours",
    tags: "DUR NUM UNIT",
    schedule: schedule({ duration: { amount: 2, unit: "hour" } }),
  },
  {
    text: "starting from tomorrow for the next 10 days",
    tags: "BOUND_START O REL_DAY DUR O DEICTIC NUM UNIT",
    schedule: adversarial[14].schedule,
  },
  {
    text: "3 days before Christmas",
    tags: "NUM UNIT DIR_BEFORE HOLIDAY",
    schedule: adversarial[3].schedule,
  },
  {
    text: "9 to 5",
    tags: "HOUR RANGE_END HOUR",
    schedule: schedule({ time: time(9, 17) }),
  },
  {
    text: "every year on the 26th of March",
    tags: "RECUR UNIT O O DOM O O MONTH",
    schedule: schedule({
      recurrence: {
        freq: "yearly",
        interval: 1,
        byMonthDay: [26],
        byMonth: [3],
      },
    }),
  },
  {
    text: "1st and 15th of each month",
    tags: "DOM O O DOM O O RECUR UNIT",
    schedule: adversarial[23].schedule,
  },
  {
    text: userCases[0].text,
    tags: "WEEKDAY WEEKDAY HOUR MERIDIEM RANGE_END HOUR MERIDIEM WEEKDAY HOUR MERIDIEM RANGE_END HOUR MERIDIEM",
    clauses: ["Mon"],
    schedule: userCases[0].schedule,
  },
];

const labeled = annotations.map((example, index) => {
  const tokens = tokenize(example.text);
  const labels = example.tags.split(" ") as Label[];
  const nonSpace = tokens.filter((token) => token.kind !== 3);
  if (nonSpace.length !== labels.length)
    throw new Error(
      `Annotation ${index + 1}: ${nonSpace.length} tokens but ${labels.length} labels (${example.text})`,
    );
  let labelIndex = 0;
  return {
    id: `oracle-${String(index + 1).padStart(3, "0")}`,
    text: example.text,
    tokens: tokens.map((token) => ({
      start: token.start,
      end: token.end,
      label: token.kind === 3 ? "O" : labels[labelIndex++],
      clauseStart:
        example.clauses?.some(
          (text) => token.start === example.text.indexOf(text),
        ) ?? false,
    })),
    schedule: example.schedule,
  };
});

mkdirSync(gold, { recursive: true });
for (const [name, records] of Object.entries({
  adversarial,
  "user-cases": userCases,
  labels: labeled,
})) {
  writeFileSync(
    new URL(`${name}.jsonl`, gold),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}
console.log(
  `Wrote ${adversarial.length} adversarial cases, ${userCases.length} user cases, and ${labeled.length} hand-labeled oracle cases.`,
);
