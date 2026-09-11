import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { resolve } from "../src/resolve.js";
import type { Schedule } from "../src/types.js";

const options = {
  reference: "2026-09-09T12:00:00+06:00",
  timeZone: "Asia/Dhaka",
};

function expandWithRRule(fragment: string): string[] {
  const script = `
    import { readFileSync } from 'node:fs';
    import rrule from 'rrule';
    const { fragment, reference } = JSON.parse(readFileSync(0, 'utf8'));
    const properties = fragment.split('\\n').filter(line => /^(DTSTART|RRULE|EXDATE)/.test(line)).join('\\n');
    const rule = rrule.rrulestr(properties);
    const dates = rule.between(new Date(reference), new Date('2035-01-01T00:00:00Z'), true);
    process.stdout.write(JSON.stringify(dates.map(date => date.toISOString())));
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      input: JSON.stringify({ fragment, reference: options.reference }),
      env: { ...process.env, TZ: "UTC" },
    },
  );
  return JSON.parse(output.toString());
}

it("exports a valid DTSTART and rule with the same starts as an independent RFC engine", () => {
  const schedule: Schedule = {
    clauses: [
      {
        time: { start: { hour: 20, minute: 0 }, end: { hour: 22, minute: 0 } },
        recurrence: { freq: "weekly", interval: 2, byDay: ["MO"], count: 3 },
      },
    ],
  };
  const result = resolve(schedule, options);
  expect(result.rrules).toHaveLength(1);
  expect(result.rrules[0]).toContain("DTSTART;TZID=Asia/Dhaka:20260914T200000");
  expect(result.rrules[0]).toContain("DTEND;TZID=Asia/Dhaka:20260914T220000");
  expect(expandWithRRule(result.rrules[0])).toEqual(
    result.occurrences.map((occurrence) =>
      new Date(occurrence.start).toISOString(),
    ),
  );
});

const rules: NonNullable<Schedule["clauses"][number]["recurrence"]>[] = [
  { freq: "daily", interval: 2, count: 6 },
  { freq: "weekly", interval: 1, byDay: ["SA", "SU"], count: 6 },
  {
    freq: "weekly",
    interval: 1,
    byDay: ["MO", "TU", "WE", "TH", "FR"],
    except: [{ kind: "weekday", days: ["FR"] }],
    count: 6,
  },
  { freq: "monthly", interval: 1, byMonthDay: [1, 15], count: 6 },
  { freq: "monthly", interval: 1, byMonthDay: [-1], count: 6 },
  { freq: "monthly", interval: 1, byMonthDay: [31], count: 6 },
  {
    freq: "monthly",
    interval: 1,
    byDay: ["MO", "FR"],
    bySetPos: [1],
    count: 6,
  },
  { freq: "monthly", interval: 1, byDay: ["FR"], bySetPos: [-1], count: 6 },
  {
    freq: "monthly",
    interval: 1,
    except: [{ kind: "dayGroup", group: "weekend" }],
    count: 6,
  },
  { freq: "yearly", interval: 2, byMonth: [3], byMonthDay: [26], count: 3 },
  {
    freq: "yearly",
    interval: 1,
    except: [{ kind: "dayGroup", group: "weekend" }],
    count: 3,
  },
  { freq: "weekly", interval: 1, timesPer: 2, count: 6 },
];

it.each(rules)("matches the independent engine for %j", (recurrence) => {
  const result = resolve(
    { clauses: [{ time: { start: { named: "noon" } }, recurrence }] },
    { ...options, until: "2035-01-01T00:00:00Z" },
  );
  expect(result.rrules).toHaveLength(1);
  expect(expandWithRRule(result.rrules[0])).toEqual(
    result.occurrences.map((occurrence) =>
      new Date(occurrence.start).toISOString(),
    ),
  );
});

it("exports the derived hours for a daily frequency count", () => {
  const result = resolve(
    {
      clauses: [
        { recurrence: { freq: "daily", interval: 1, timesPer: 3, count: 6 } },
      ],
    },
    options,
  );
  expect(result.rrules[0]).toContain("BYHOUR=0,8,16");
  expect(expandWithRRule(result.rrules[0])).toEqual(
    result.occurrences.map((occurrence) =>
      new Date(occurrence.start).toISOString(),
    ),
  );
});

it("rejects conflicting recurrence bounds instead of emitting invalid RFC properties", () => {
  const schedule: Schedule = {
    clauses: [
      {
        recurrence: {
          freq: "daily",
          interval: 1,
          count: 3,
          until: { kind: "calendar", month: 12, day: 31 },
        },
      },
    ],
  };
  expect(() => resolve(schedule, options)).toThrow("count or an end bound");
});

it("exports explicit date exceptions without reducing the requested occurrence count", () => {
  const result = resolve(
    {
      clauses: [
        {
          time: { start: { named: "noon" } },
          recurrence: {
            freq: "daily",
            interval: 1,
            count: 4,
            except: [{ kind: "calendar", year: 2026, month: 9, day: 10 }],
          },
        },
      ],
    },
    options,
  );
  expect(result.rrules).toHaveLength(1);
  expect(result.rrules[0]).toContain("EXDATE;TZID=Asia/Dhaka:20260910T120000");
  expect(expandWithRRule(result.rrules[0])).toEqual(
    result.occurrences.map((occurrence) =>
      new Date(occurrence.start).toISOString(),
    ),
  );
});

it("keeps exception export independent of the preview limit", () => {
  const result = resolve(
    {
      clauses: [
        {
          time: { start: { named: "noon" } },
          recurrence: {
            freq: "daily",
            interval: 1,
            count: 6,
            except: [{ kind: "calendar", year: 2026, month: 9, day: 12 }],
          },
        },
      ],
    },
    { ...options, limit: 1 },
  );
  expect(result.occurrences).toHaveLength(1);
  expect(result.rrules).toHaveLength(1);
  expect(
    expandWithRRule(result.rrules[0]).map((date) => date.slice(0, 10)),
  ).toEqual([
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-13",
    "2026-09-14",
    "2026-09-15",
  ]);
});
