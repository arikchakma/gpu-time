import { writeFileSync } from "node:fs";
import type {
  Clause,
  DateSpec,
  Recurrence,
  Schedule,
  TimeSpec,
  Unit,
  Weekday,
} from "../../core/src/types.ts";

const gold = new URL("../data/gold/", import.meta.url);

const clock = (hour: number, minute = 0): TimeSpec => ({
  start: { hour, minute },
});
const named = (name: "noon" | "midnight"): TimeSpec => ({
  start: { named: name },
});
const window = (start: number, end: number): TimeSpec => ({
  ...clock(start),
  end: { hour: end, minute: 0 },
});
const weekday = (...days: Weekday[]): DateSpec => ({ kind: "weekday", days });
const relative = (offset: number): DateSpec => ({
  kind: "relativeDay",
  offset,
});
const shift = (
  amount: number,
  unit: Unit,
  direction: "before" | "after",
): Clause => ({ shift: { amount, unit, direction } });
const recurrence = (
  freq: Recurrence["freq"],
  extra: Partial<Recurrence> = {},
): Clause => ({ recurrence: { freq, interval: 1, ...extra } });
const calendar = (month: number, day?: number, year?: number): DateSpec => ({
  kind: "calendar",
  month,
  ...(day === undefined ? {} : { day }),
  ...(year === undefined ? {} : { year }),
});
const cases: {
  id: string;
  family: string;
  text: string;
  schedule: Schedule;
}[] = [];
function example(family: string, text: string, ...clauses: Clause[]) {
  cases.push({
    id: `grammar-${String(cases.length + 1).padStart(3, "0")}`,
    family,
    text,
    schedule: { clauses },
  });
}

// Explicit expectations from plan/002, authored without calling any parser.
example("now-relative-day", "now", { date: { kind: "now" } });
example("now-relative-day", "today", { date: relative(0) });
example("now-relative-day", "tonight", { date: relative(0) });
example("now-relative-day", "tomorrow", { date: relative(1) });
example("now-relative-day", "yesterday", { date: relative(-1) });
example("now-relative-day", "the day after tomorrow", { date: relative(2) });
example("relative-quantity", "1 day before", shift(1, "day", "before"));
example("relative-quantity", "10 days after", shift(10, "day", "after"));
example("relative-quantity", "in 90 minutes", shift(90, "minute", "after"));
example("relative-quantity", "3 weeks from now", {
  ...shift(3, "week", "after"),
  date: { kind: "now" },
});
example("relative-quantity", "two months later", shift(2, "month", "after"));
example("relative-quantity", "5 days ago", shift(5, "day", "before"));
example("anchored-relative", "2 days before Friday", {
  ...shift(2, "day", "before"),
  date: weekday("FR"),
});
example("anchored-relative", "two hours before tomorrow at noon", {
  ...shift(2, "hour", "before"),
  date: relative(1),
  time: named("noon"),
});
example("anchored-relative", "3 days after October 1", {
  ...shift(3, "day", "after"),
  date: calendar(10, 1),
});
example("anchored-relative", "a week before Christmas", {
  ...shift(1, "week", "before"),
  date: { kind: "holiday", name: "christmas" },
});
example("relative-unit", "next week", {
  date: { kind: "relativeUnit", unit: "week", modifier: "next" },
});
example("relative-unit", "last month", {
  date: { kind: "relativeUnit", unit: "month", modifier: "last" },
});
example("relative-unit", "this weekend", {
  date: { kind: "dayGroup", group: "weekend", modifier: "this" },
});
example("relative-unit", "in one year", shift(1, "year", "after"));
example("relative-unit", "end of next month", {
  date: { kind: "relativeUnit", unit: "month", modifier: "next", edge: "end" },
});
example("weekday", "Monday", { date: weekday("MO") });
example("weekday", "Mon", { date: weekday("MO") });
example("weekday", "next Friday", {
  date: { kind: "weekday", days: ["FR"], modifier: "next" },
});
example("weekday", "this Monday", {
  date: { kind: "weekday", days: ["MO"], modifier: "this" },
});
example("weekday", "last Tuesday", {
  date: { kind: "weekday", days: ["TU"], modifier: "last" },
});
example("weekday", "Monday and Wednesday", { date: weekday("MO", "WE") });
example(
  "day-group",
  "weekdays",
  recurrence("weekly", { byDay: ["MO", "TU", "WE", "TH", "FR"] }),
);
example("day-group", "weekends", recurrence("weekly", { byDay: ["SA", "SU"] }));
example(
  "day-group",
  "every weekday",
  recurrence("weekly", { byDay: ["MO", "TU", "WE", "TH", "FR"] }),
);
example(
  "day-group",
  "Mon-Fri",
  recurrence("weekly", { byDay: ["MO", "TU", "WE", "TH", "FR"] }),
);
example(
  "day-group",
  "Monday through Friday",
  recurrence("weekly", { byDay: ["MO", "TU", "WE", "TH", "FR"] }),
);
example("clock", "2pm", { time: clock(14) });
example("clock", "2 p.m.", { time: clock(14) });
example("clock", "14:00", { time: clock(14) });
example("clock", "2:30pm", { time: clock(14, 30) });
example("clock", "noon", { time: named("noon") });
example("clock", "midnight", { time: named("midnight") });
example("day-part", "morning", { time: { start: { part: "morning" } } });
example("day-part", "afternoon", { time: { start: { part: "afternoon" } } });
example("day-part", "evening", { time: { start: { part: "evening" } } });
example("day-part", "night", { time: { start: { part: "night" } } });
example("day-part", "Monday evening", {
  date: weekday("MO"),
  time: { start: { part: "evening" } },
});
example("day-part", "tomorrow morning", {
  date: relative(1),
  time: { start: { part: "morning" } },
});
example("explicit-date", "October 1", { date: calendar(10, 1) });
example("explicit-date", "Oct 1st", { date: calendar(10, 1) });
example("explicit-date", "1 October", { date: calendar(10, 1) });
example("explicit-date", "10/01", { date: calendar(10, 1) });
example("explicit-date", "2026-10-01", { date: calendar(10, 1, 2026) });
example("explicit-date", "October 1, 2027 at noon", {
  date: calendar(10, 1, 2027),
  time: named("noon"),
});
example("time-window", "10pm-12am", { time: window(22, 0) });
example("time-window", "from 8 to 10pm", { time: window(20, 22) });
example("time-window", "between 9am and noon", {
  time: { start: { hour: 9, minute: 0 }, end: { named: "noon" } },
});
example("time-window", "Monday 1pm-8pm", {
  date: weekday("MO"),
  time: window(13, 20),
});
example("time-window", "9 to 5", { time: window(9, 17) });
example("date-range", "June 11-16", {
  date: {
    kind: "calendarRange",
    from: { month: 6, day: 11 },
    to: { month: 6, day: 16 },
  },
});
example("date-range", "26 July - 22 August", {
  date: {
    kind: "calendarRange",
    from: { month: 7, day: 26 },
    to: { month: 8, day: 22 },
  },
});
example("date-range", "from Monday to Wednesday", {
  date: { kind: "weekdayRange", from: "MO", to: "WE" },
});
example("duration", "for 2 hours", { duration: { amount: 2, unit: "hour" } });
example("duration", "for 90 minutes", {
  duration: { amount: 90, unit: "minute" },
});
example("duration", "for the next 10 days", {
  duration: { amount: 10, unit: "day" },
});
example(
  "multi-clause",
  "Monday 10pm-12am and Saturday Sunday 1pm-8pm",
  { date: weekday("MO"), time: window(22, 0) },
  { date: weekday("SA", "SU"), time: window(13, 20) },
);
example(
  "multi-clause",
  "Mon at 9, Wed at 10, Fri at 11",
  { date: weekday("MO"), time: clock(9) },
  { date: weekday("WE"), time: clock(10) },
  { date: weekday("FR"), time: clock(11) },
);
example("recurrence", "every Monday at 8pm", {
  ...recurrence("weekly", { byDay: ["MO"] }),
  time: clock(20),
});
example("recurrence", "each Tuesday", recurrence("weekly", { byDay: ["TU"] }));
example("recurrence", "daily at noon", {
  ...recurrence("daily"),
  time: named("noon"),
});
example("recurrence", "weekly", recurrence("weekly"));
example(
  "recurrence",
  "every 2 weeks on Tuesday",
  recurrence("weekly", { interval: 2, byDay: ["TU"] }),
);
example(
  "recurrence",
  "every other Friday",
  recurrence("weekly", { interval: 2, byDay: ["FR"] }),
);
example("recurrence", "twice a week", recurrence("weekly", { timesPer: 2 }));
example("recurrence", "3 times a day", recurrence("daily", { timesPer: 3 }));
example(
  "monthly-yearly",
  "every month on the 31st",
  recurrence("monthly", { byMonthDay: [31] }),
);
example(
  "monthly-yearly",
  "the first Monday of every month",
  recurrence("monthly", { byDay: ["MO"], bySetPos: [1] }),
);
example(
  "monthly-yearly",
  "last Friday of the month",
  recurrence("monthly", { byDay: ["FR"], bySetPos: [-1] }),
);
example(
  "monthly-yearly",
  "1st and 15th of each month",
  recurrence("monthly", { byMonthDay: [1, 15] }),
);
example(
  "monthly-yearly",
  "every year on March 26",
  recurrence("yearly", { byMonth: [3], byMonthDay: [26] }),
);
example("monthly-yearly", "annually", recurrence("yearly"));
example(
  "bounds",
  "every Monday starting October 1",
  recurrence("weekly", { byDay: ["MO"], start: calendar(10, 1) }),
);
example(
  "bounds",
  "every week from next week",
  recurrence("weekly", {
    start: { kind: "relativeUnit", unit: "week", modifier: "next" },
  }),
);
example(
  "bounds",
  "every Monday until December 31",
  recurrence("weekly", { byDay: ["MO"], until: calendar(12, 31) }),
);
example(
  "bounds",
  "every Tuesday until Dec",
  recurrence("weekly", { byDay: ["TU"], until: calendar(12) }),
);
example(
  "bounds",
  "every day through Friday",
  recurrence("daily", { until: weekday("FR") }),
);
example(
  "bounds",
  "every Monday for 6 times",
  recurrence("weekly", { byDay: ["MO"], count: 6 }),
);
example(
  "bounds",
  "every Monday for 10 weeks",
  recurrence("weekly", { byDay: ["MO"], span: { amount: 10, unit: "week" } }),
);
example(
  "exceptions",
  "every weekday except Friday",
  recurrence("weekly", {
    byDay: ["MO", "TU", "WE", "TH", "FR"],
    except: [weekday("FR")],
  }),
);
example(
  "exceptions",
  "every day except Sundays",
  recurrence("daily", { except: [weekday("SU")] }),
);
example("prose", "remind me to call Sam on Monday at 2pm", {
  date: weekday("MO"),
  time: clock(14),
});
example(
  "prose",
  "the meeting is every other Tuesday until Dec",
  recurrence("weekly", { byDay: ["TU"], interval: 2, until: calendar(12) }),
);
example("prose", "deadline: 3 days before Christmas", {
  ...shift(3, "day", "before"),
  date: { kind: "holiday", name: "christmas" },
});
example("holiday", "Christmas", {
  date: { kind: "holiday", name: "christmas" },
});
example("holiday", "Christmas Eve", {
  date: { kind: "holiday", name: "christmas-eve" },
});
example("holiday", "New Year's Day", {
  date: { kind: "holiday", name: "new-year" },
});
example("holiday", "Halloween", {
  date: { kind: "holiday", name: "halloween" },
});
example("holiday", "Valentine's Day", {
  date: { kind: "holiday", name: "valentines" },
});

example("explicit-date", "October sixth", { date: calendar(10, 6) });
example("explicit-date", "twelfth of October", { date: calendar(10, 12) });
example("explicit-date", "February ninth, 2028", {
  date: calendar(2, 9, 2028),
});
example("clock", "twelve pm", { time: clock(12) });
example("clock", "eleven am", { time: clock(11) });
example("time-window", "9am to 5", { time: window(9, 17) });
example("time-window", "10 to 2am", { time: window(22, 2) });
example("time-window", "8 to midnight", {
  time: { start: { hour: 20, minute: 0 }, end: { named: "midnight" } },
});
example(
  "relative-quantity",
  "twelve minutes after",
  shift(12, "minute", "after"),
);
example(
  "monthly-yearly",
  "every month on the seventh",
  recurrence("monthly", { byMonthDay: [7] }),
);
example("holiday", "Christmas Eve at noon", {
  date: { kind: "holiday", name: "christmas-eve" },
  time: named("noon"),
});

example("clock-period", "two in the afternoon", { time: clock(14) });
example("clock-period", "five in the morning", { time: clock(5) });
example("clock-period", "seven in the evening", { time: clock(19) });
example("clock-period", "twelve in the morning", { time: clock(0) });
example("clock-period", "twelve in the afternoon", { time: clock(12) });
example("clock-period", "2:30 in the afternoon", { time: clock(14, 30) });
example("clock-period", "tomorrow at eight in the morning", {
  date: relative(1),
  time: clock(8),
});
example("clock-period", "every Monday at six in the evening", {
  ...recurrence("weekly", { byDay: ["MO"] }),
  time: clock(18),
});
example("clock-period", "from 5 to 7 in the evening", { time: window(17, 19) });
example("clock-period", "from 9 in the morning to 5 in the afternoon", {
  time: window(9, 17),
});

writeFileSync(
  new URL("grammar.jsonl", gold),
  cases.map((value) => JSON.stringify(value)).join("\n") + "\n",
);
console.log(
  `Authored ${cases.length} core grammar cases across ${new Set(cases.map((value) => value.family)).size} families.`,
);
