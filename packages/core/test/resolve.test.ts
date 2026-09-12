import { expect, it } from "vitest";
import { resolve } from "../src/resolve.js";
import type { Schedule } from "../src/types.js";
const options = {
  reference: "2026-09-09T12:00:00+06:00",
  timeZone: "Asia/Dhaka",
};

it("preserves a range ending at the Unix epoch", () => {
  const result = resolve(
    {
      clauses: [
        {
          date: { kind: "calendar", year: 1969, month: 12, day: 31 },
          time: { start: { hour: 22, minute: 0 }, end: { hour: 0, minute: 0 } },
        },
      ],
    },
    { reference: "1969-12-30T12:00:00Z", timeZone: "UTC" },
  );
  expect(result.occurrences[0]).toMatchObject({
    start: "1969-12-31T22:00:00+00:00",
    end: "1970-01-01T00:00:00+00:00",
  });
});

it("retains second-precision duration behavior for fractional references", () => {
  const result = resolve(
    { clauses: [{ duration: { amount: 2, unit: "hour" } }] },
    { reference: "2026-09-09T12:00:00.500Z", timeZone: "UTC" },
  );
  expect(result.occurrences[0]).toMatchObject({
    start: "2026-09-09T12:00:00+00:00",
    end: "2026-09-09T14:00:00+00:00",
  });
});

it("reports a recurrence search limit instead of returning a silently incomplete series", () => {
  const schedule: Schedule = {
    clauses: [{ recurrence: { freq: "yearly", interval: 100 } }],
  };
  expect(() =>
    resolve(schedule, {
      reference: "2026-01-01T00:00:00Z",
      timeZone: "UTC",
      until: "2500-01-01",
      limit: 10,
    }),
  ).toThrow("100000-day search limit");
});

it("finishes a finite count reached on the final permitted search day", () => {
  const schedule: Schedule = {
    clauses: [{ recurrence: { freq: "daily", interval: 99999, count: 2 } }],
  };
  const result = resolve(schedule, {
    reference: "2026-01-01T00:00:00Z",
    timeZone: "UTC",
    until: "2500-01-01",
    limit: 10,
  });
  expect(result.occurrences).toHaveLength(2);
  expect(result.truncated).toBe(false);
  expect(result.rrules[0]).toContain("COUNT=2");
});

it("makes bare weekday clauses weekly only when the caller requests it", () => {
  const schedule: Schedule = {
    clauses: [
      {
        date: { kind: "weekday", days: ["SA", "SU"] },
        time: { start: { hour: 13, minute: 0 }, end: { hour: 20, minute: 0 } },
      },
    ],
  };
  const original = structuredClone(schedule);
  expect(
    resolve(schedule, { ...options, bareWeekdays: "once" }).occurrences,
  ).toHaveLength(2);
  const recurring = resolve(schedule, {
    ...options,
    bareWeekdays: "weekly",
    limit: 4,
  });
  expect(recurring.occurrences.map((value) => value.start)).toEqual([
    "2026-09-12T13:00:00+06:00",
    "2026-09-13T13:00:00+06:00",
    "2026-09-19T13:00:00+06:00",
    "2026-09-20T13:00:00+06:00",
  ]);
  expect(recurring.rrules[0]).toContain("FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU");
  expect(schedule).toEqual(original);
  expect(
    resolve(
      {
        clauses: [
          { date: { kind: "weekday", days: ["MO"], modifier: "next" } },
        ],
      },
      { ...options, bareWeekdays: "weekly" },
    ).rrules,
  ).toEqual([]);
});

it("lets an explicit duration replace the implied end of a day part", () => {
  const schedule: Schedule = {
    clauses: [
      {
        date: { kind: "relativeDay", offset: 1 },
        time: { start: { part: "morning" } },
        duration: { amount: 30, unit: "minute" },
      },
    ],
  };
  const result = resolve(schedule, options);
  expect(result.occurrences[0]).toMatchObject({
    start: "2026-09-10T06:00:00+06:00",
    end: "2026-09-10T06:30:00+06:00",
  });
  schedule.clauses[0].time!.end = { named: "noon" };
  expect(() => resolve(schedule, options)).toThrow(
    "duration or an explicit end",
  );
});

it("keeps modified day groups in one period instead of mixing weeks", () => {
  for (const weekStart of ["MO", "SU"] as const) {
    const result = resolve(
      {
        clauses: [
          { date: { kind: "dayGroup", group: "weekend", modifier: "this" } },
        ],
      },
      { ...options, weekStart },
    );
    expect(result.occurrences.map((value) => value.start.slice(0, 10))).toEqual(
      ["2026-09-12", "2026-09-13"],
    );
  }
  const weekdays = resolve(
    {
      clauses: [
        { date: { kind: "dayGroup", group: "weekday", modifier: "last" } },
      ],
    },
    options,
  );
  expect(weekdays.occurrences.map((value) => value.start.slice(0, 10))).toEqual(
    ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"],
  );
  const next = resolve(
    {
      clauses: [
        { date: { kind: "dayGroup", group: "weekend", modifier: "next" } },
      ],
    },
    {
      ...options,
      reference: "2026-09-12T12:00:00+06:00",
      nextWeekday: "immediate",
    },
  );
  expect(next.occurrences.map((value) => value.start.slice(0, 10))).toEqual([
    "2026-09-19",
    "2026-09-20",
  ]);
});

it("resolves known one-off dates beyond the default recurrence preview horizon", () => {
  const relative: Schedule = {
    clauses: [{ shift: { amount: 1, unit: "year", direction: "after" } }],
  };
  expect(resolve(relative, options).occurrences[0].start).toBe(
    "2027-09-09T12:00:00+06:00",
  );
  const explicit: Schedule = {
    clauses: [
      {
        date: { kind: "calendar", year: 2027, month: 10, day: 1 },
        time: { start: { named: "noon" } },
      },
    ],
  };
  expect(resolve(explicit, options).occurrences[0].start).toBe(
    "2027-10-01T12:00:00+06:00",
  );
  expect(
    resolve(explicit, { ...options, until: "2027-09-01" }).occurrences,
  ).toEqual([]);
});
it("resolves shared weekend clocks and the following midnight with explicit offsets", () => {
  const schedule: Schedule = {
    clauses: [
      {
        date: { kind: "weekday", days: ["SA", "SU"] },
        time: { start: { hour: 13, minute: 0 }, end: { hour: 20, minute: 0 } },
      },
      {
        date: { kind: "weekday", days: ["MO"] },
        time: { start: { hour: 22, minute: 0 }, end: { hour: 0, minute: 0 } },
      },
    ],
  };
  expect(resolve(schedule, options).occurrences).toEqual([
    {
      start: "2026-09-12T13:00:00+06:00",
      end: "2026-09-12T20:00:00+06:00",
      allDay: false,
      clause: 0,
    },
    {
      start: "2026-09-13T13:00:00+06:00",
      end: "2026-09-13T20:00:00+06:00",
      allDay: false,
      clause: 0,
    },
    {
      start: "2026-09-14T22:00:00+06:00",
      end: "2026-09-15T00:00:00+06:00",
      allDay: false,
      clause: 1,
    },
  ]);
});

it("resolves a bounded daily window differently from continuous endpoints", () => {
  const daily = resolve(
    {
      clauses: [
        {
          recurrence: {
            freq: "daily",
            interval: 1,
            start: {
              kind: "calendarRange",
              from: { month: 11, day: 3 },
              to: { month: 11, day: 5 },
            },
            until: { kind: "calendar", month: 11, day: 5 },
          },
          time: {
            start: { hour: 9, minute: 0 },
            end: { hour: 11, minute: 0 },
          },
        },
      ],
    },
    options,
  );
  expect(daily.occurrences.map(({ start, end }) => ({ start, end }))).toEqual([
    {
      start: "2026-11-03T09:00:00+06:00",
      end: "2026-11-03T11:00:00+06:00",
    },
    {
      start: "2026-11-04T09:00:00+06:00",
      end: "2026-11-04T11:00:00+06:00",
    },
    {
      start: "2026-11-05T09:00:00+06:00",
      end: "2026-11-05T11:00:00+06:00",
    },
  ]);

  const continuous = resolve(
    {
      clauses: [
        {
          date: { kind: "calendar", month: 11, day: 3 },
          endDate: { kind: "calendar", month: 11, day: 5 },
          time: {
            start: { hour: 9, minute: 0 },
            end: { hour: 11, minute: 0 },
          },
        },
      ],
    },
    options,
  );
  expect(continuous.occurrences).toEqual([
    {
      start: "2026-11-03T09:00:00+06:00",
      end: "2026-11-05T11:00:00+06:00",
      allDay: false,
      clause: 0,
    },
  ]);
});

it("keeps bounded daily windows coherent inside and across calendar years", () => {
  const window = (
    from: { year?: number; month: number; day: number },
    to: { year?: number; month: number; day: number },
  ): Schedule => ({
    clauses: [
      {
        recurrence: {
          freq: "daily",
          interval: 1,
          start: { kind: "calendarRange", from, to },
          until: { kind: "calendar", ...to },
        },
        time: {
          start: { hour: 9, minute: 0 },
          end: { hour: 11, minute: 0 },
        },
      },
    ],
  });
  const starts = (schedule: Schedule, reference: string) =>
    resolve(schedule, {
      reference,
      timeZone: "Asia/Dhaka",
      limit: 10,
    }).occurrences.map((occurrence) => occurrence.start);

  expect(
    starts(
      window({ month: 11, day: 3 }, { month: 11, day: 5 }),
      "2026-11-04T08:00:00+06:00",
    ),
  ).toEqual(["2026-11-04T09:00:00+06:00", "2026-11-05T09:00:00+06:00"]);

  const crossYear = [
    window({ month: 12, day: 30 }, { month: 1, day: 2 }),
    window(
      { year: 2026, month: 12, day: 30 },
      { year: 2027, month: 1, day: 2 },
    ),
  ];
  for (const schedule of crossYear)
    expect(starts(schedule, "2026-12-31T08:00:00+06:00")).toEqual([
      "2026-12-31T09:00:00+06:00",
      "2027-01-01T09:00:00+06:00",
      "2027-01-02T09:00:00+06:00",
    ]);

  expect(starts(crossYear[0], "2027-01-03T08:00:00+06:00")).toEqual([
    "2027-12-30T09:00:00+06:00",
    "2027-12-31T09:00:00+06:00",
    "2028-01-01T09:00:00+06:00",
    "2028-01-02T09:00:00+06:00",
  ]);
  expect(starts(crossYear[1], "2027-01-03T08:00:00+06:00")).toEqual([]);
});

it("applies an elapsed shift to its explicit local date and clock anchor", () => {
  const schedule: Schedule = {
    clauses: [
      {
        date: { kind: "relativeDay", offset: 1 },
        time: { start: { named: "noon" } },
        shift: { amount: 2, unit: "hour", direction: "before" },
      },
    ],
  };

  expect(resolve(schedule, options).occurrences).toEqual([
    {
      start: "2026-09-10T10:00:00+06:00",
      allDay: false,
      clause: 0,
    },
  ]);
});

it("preserves the reference clock for unanchored relative quantities", () => {
  const result = resolve(
    { clauses: [{ shift: { amount: 1, unit: "day", direction: "before" } }] },
    options,
  );
  expect(result.occurrences).toEqual([
    { start: "2026-09-08T12:00:00+06:00", allDay: false, clause: 0 },
  ]);
});

it("resolves an inclusive calendar range with an exclusive all-day end", () => {
  const result = resolve(
    {
      clauses: [
        {
          date: {
            kind: "calendarRange",
            from: { year: 2026, month: 6, day: 11 },
            to: { year: 2026, month: 6, day: 16 },
          },
        },
      ],
    },
    options,
  );

  expect(result.occurrences).toEqual([
    {
      start: "2026-06-11T00:00:00+06:00",
      end: "2026-06-17T00:00:00+06:00",
      allDay: true,
      clause: 0,
    },
  ]);
});

it("distinguishes immediate next weekdays from next calendar week", () => {
  const schedule: Schedule = {
    clauses: [
      {
        date: { kind: "weekday", days: ["FR"], modifier: "next" },
        time: { start: { hour: 14, minute: 0 } },
      },
    ],
  };
  expect(resolve(schedule, options).occurrences[0].start).toBe(
    "2026-09-18T14:00:00+06:00",
  );
  expect(
    resolve(schedule, { ...options, nextWeekday: "immediate" }).occurrences[0]
      .start,
  ).toBe("2026-09-11T14:00:00+06:00");
});

it("resolves calendar periods and their final dates instead of adding fixed elapsed days", () => {
  const nextWeek = resolve(
    {
      clauses: [
        { date: { kind: "relativeUnit", unit: "week", modifier: "next" } },
      ],
    },
    options,
  );
  expect(nextWeek.occurrences[0]).toMatchObject({
    start: "2026-09-14T00:00:00+06:00",
    end: "2026-09-21T00:00:00+06:00",
    allDay: true,
  });

  const endOfNextMonth = resolve(
    {
      clauses: [
        {
          date: {
            kind: "relativeUnit",
            unit: "month",
            modifier: "next",
            edge: "end",
          },
        },
      ],
    },
    options,
  );
  expect(endOfNextMonth.occurrences[0]).toEqual({
    start: "2026-10-31T00:00:00+06:00",
    allDay: true,
    clause: 0,
  });
});

it("finds an ordinal weekday inside a relative month", () => {
  const result = resolve(
    {
      clauses: [
        {
          date: {
            kind: "ordinalWeekday",
            ordinal: 1,
            day: "MO",
            of: { kind: "relativeUnit", unit: "month", modifier: "next" },
          },
          time: { start: { named: "noon" } },
        },
      ],
    },
    options,
  );
  expect(result.occurrences[0].start).toBe("2026-10-05T12:00:00+06:00");
});

it("resolves fixed holidays before applying a relative calendar shift", () => {
  const result = resolve(
    {
      clauses: [
        {
          date: { kind: "holiday", name: "christmas" },
          shift: { amount: 3, unit: "day", direction: "before" },
        },
      ],
    },
    options,
  );
  expect(result.occurrences[0]).toMatchObject({
    start: "2026-12-22T00:00:00+06:00",
    allDay: true,
  });
});

it("wraps weekday ranges across a week boundary and distributes day groups", () => {
  const range = resolve(
    { clauses: [{ date: { kind: "weekdayRange", from: "FR", to: "MO" } }] },
    options,
  );
  expect(range.occurrences[0]).toMatchObject({
    start: "2026-09-11T00:00:00+06:00",
    end: "2026-09-15T00:00:00+06:00",
  });

  const weekend = resolve(
    {
      clauses: [
        {
          date: { kind: "dayGroup", group: "weekend", modifier: "this" },
          time: { start: { hour: 13, minute: 0 } },
        },
      ],
    },
    options,
  );
  expect(weekend.occurrences.map((occurrence) => occurrence.start)).toEqual([
    "2026-09-12T13:00:00+06:00",
    "2026-09-13T13:00:00+06:00",
  ]);
});

it("keeps explicit seconds and resolves a named day part to its configured window", () => {
  const precise = resolve(
    {
      clauses: [
        {
          date: { kind: "relativeDay", offset: 1 },
          time: { start: { hour: 14, minute: 30, second: 15 } },
        },
      ],
    },
    options,
  );
  expect(precise.occurrences[0].start).toBe("2026-09-10T14:30:15+06:00");

  const morning = resolve(
    {
      clauses: [
        {
          date: { kind: "relativeDay", offset: 1 },
          time: { start: { part: "morning" } },
        },
      ],
    },
    { ...options, dayParts: { morning: ["07:30", "11:00"] } },
  );
  expect(morning.occurrences[0]).toMatchObject({
    start: "2026-09-10T07:30:00+06:00",
    end: "2026-09-10T11:00:00+06:00",
  });
});

it("rejects a nonexistent explicit time and selects the earlier offset during a repeated hour", () => {
  const timeZone = "America/New_York";
  const gap: Schedule = {
    clauses: [
      {
        date: { kind: "calendar", year: 2026, month: 3, day: 8 },
        time: { start: { hour: 2, minute: 30 } },
      },
    ],
  };
  expect(() =>
    resolve(gap, { reference: "2026-03-07T12:00:00-05:00", timeZone }),
  ).toThrow("does not exist");

  const overlap: Schedule = {
    clauses: [
      {
        date: { kind: "calendar", year: 2026, month: 11, day: 1 },
        time: { start: { hour: 1, minute: 30 } },
      },
    ],
  };
  expect(
    resolve(overlap, { reference: "2026-10-31T12:00:00-04:00", timeZone })
      .occurrences[0].start,
  ).toBe("2026-11-01T01:30:00-04:00");
});

it("resolves durations and relative quantity windows from the reference", () => {
  const duration = resolve(
    {
      clauses: [
        {
          date: { kind: "relativeDay", offset: 1 },
          time: { start: { hour: 9, minute: 0 } },
          duration: { amount: 90, unit: "minute" },
        },
      ],
    },
    options,
  );
  expect(duration.occurrences[0]).toMatchObject({
    start: "2026-09-10T09:00:00+06:00",
    end: "2026-09-10T10:30:00+06:00",
  });

  const window = resolve(
    {
      clauses: [
        {
          shift: {
            amount: 5,
            endAmount: 10,
            unit: "minute",
            direction: "after",
          },
        },
      ],
    },
    options,
  );
  expect(window.occurrences[0]).toMatchObject({
    start: "2026-09-09T12:05:00+06:00",
    end: "2026-09-09T12:10:00+06:00",
    allDay: false,
  });
});

it("expands a bounded weekly rule while preserving its local clock and interval", () => {
  const schedule: Schedule = {
    clauses: [
      {
        time: { start: { hour: 20, minute: 0 }, end: { hour: 22, minute: 0 } },
        recurrence: { freq: "weekly", interval: 2, byDay: ["MO"], count: 3 },
      },
    ],
  };

  expect(
    resolve(schedule, options).occurrences.map(
      (occurrence) => occurrence.start,
    ),
  ).toEqual([
    "2026-09-14T20:00:00+06:00",
    "2026-09-28T20:00:00+06:00",
    "2026-10-12T20:00:00+06:00",
  ]);
});

it("applies recurring weekday exclusions and an inclusive local end date", () => {
  const result = resolve(
    {
      clauses: [
        {
          time: { start: { hour: 9, minute: 0 } },
          recurrence: {
            freq: "daily",
            interval: 1,
            start: { kind: "calendar", year: 2026, month: 9, day: 10 },
            until: { kind: "calendar", year: 2026, month: 9, day: 14 },
            except: [{ kind: "dayGroup", group: "weekend" }],
          },
        },
      ],
    },
    options,
  );
  expect(result.occurrences.map((occurrence) => occurrence.start)).toEqual([
    "2026-09-10T09:00:00+06:00",
    "2026-09-11T09:00:00+06:00",
    "2026-09-14T09:00:00+06:00",
  ]);
});

it("preserves COUNT across past starts and skips DST gaps without consuming it", () => {
  const schedule: Schedule = {
    clauses: [
      {
        time: { start: { hour: 2, minute: 30 } },
        recurrence: {
          freq: "daily",
          interval: 1,
          count: 2,
          start: { kind: "calendar", year: 2026, month: 3, day: 7 },
        },
      },
    ],
  };
  const result = resolve(schedule, {
    reference: "2026-03-07T12:00:00-05:00",
    timeZone: "America/New_York",
  });
  expect(result.occurrences.map((occurrence) => occurrence.start)).toEqual([
    "2026-03-09T02:30:00-04:00",
  ]);
});

it("distinguishes calendar days from elapsed hours across DST and clamps month arithmetic", () => {
  const context = {
    reference: "2026-03-07T12:00:00-05:00",
    timeZone: "America/New_York",
  };
  const day = resolve(
    { clauses: [{ shift: { amount: 1, unit: "day", direction: "after" } }] },
    context,
  );
  const hours = resolve(
    { clauses: [{ shift: { amount: 24, unit: "hour", direction: "after" } }] },
    context,
  );
  expect(day.occurrences[0].start).toBe("2026-03-08T12:00:00-04:00");
  expect(hours.occurrences[0].start).toBe("2026-03-08T13:00:00-04:00");

  const month = resolve(
    { clauses: [{ shift: { amount: 1, unit: "month", direction: "after" } }] },
    { ...options, reference: "2026-01-31T12:00:00+06:00" },
  );
  expect(month.occurrences[0].start).toBe("2026-02-28T12:00:00+06:00");
});

it("skips missing monthly dates and selects ordinal weekdays within each month", () => {
  const monthEnd = resolve(
    {
      clauses: [
        {
          time: { start: { named: "noon" } },
          recurrence: {
            freq: "monthly",
            interval: 1,
            byMonthDay: [31],
            count: 3,
          },
        },
      ],
    },
    options,
  );
  expect(
    monthEnd.occurrences.map((occurrence) => occurrence.start.slice(0, 10)),
  ).toEqual(["2026-10-31", "2026-12-31", "2027-01-31"]);

  const lastFriday = resolve(
    {
      clauses: [
        {
          time: { start: { named: "noon" } },
          recurrence: {
            freq: "monthly",
            interval: 1,
            byDay: ["FR"],
            bySetPos: [-1],
            count: 3,
          },
        },
      ],
    },
    options,
  );
  expect(
    lastFriday.occurrences.map((occurrence) => occurrence.start.slice(0, 10)),
  ).toEqual(["2026-09-25", "2026-10-30", "2026-11-27"]);
});

it("uses month/day fields for yearly rules and skips non-leap years", () => {
  const march = resolve(
    {
      clauses: [
        {
          time: { start: { named: "noon" } },
          recurrence: {
            freq: "yearly",
            interval: 2,
            byMonth: [3],
            byMonthDay: [26],
            count: 2,
          },
        },
      ],
    },
    { ...options, until: "2031-01-01T00:00:00Z" },
  );
  expect(
    march.occurrences.map((occurrence) => occurrence.start.slice(0, 10)),
  ).toEqual(["2027-03-26", "2029-03-26"]);

  const leap = resolve(
    {
      clauses: [
        {
          recurrence: {
            freq: "yearly",
            interval: 1,
            byMonth: [2],
            byMonthDay: [29],
            count: 2,
          },
        },
      ],
    },
    { ...options, until: "2035-01-01T00:00:00Z" },
  );
  expect(
    leap.occurrences.map((occurrence) => occurrence.start.slice(0, 10)),
  ).toEqual(["2028-02-29", "2032-02-29"]);
});

it("expands hourly recurrence as timed events across a DST gap", () => {
  const result = resolve(
    { clauses: [{ recurrence: { freq: "hourly", interval: 1, count: 4 } }] },
    {
      reference: "2026-03-08T00:30:00-05:00",
      timeZone: "America/New_York",
    },
  );
  expect(result.occurrences.map((occurrence) => occurrence.start)).toEqual([
    "2026-03-08T00:30:00-05:00",
    "2026-03-08T01:30:00-05:00",
    "2026-03-08T03:30:00-04:00",
    "2026-03-08T04:30:00-04:00",
  ]);
  expect(result.occurrences.every((occurrence) => !occurrence.allDay)).toBe(
    true,
  );
});

it("spreads unspecified frequency counts with an explicit approximation diagnostic", () => {
  const weekly = resolve(
    {
      clauses: [
        { recurrence: { freq: "weekly", interval: 1, timesPer: 2, count: 4 } },
      ],
    },
    options,
  );
  expect(
    weekly.occurrences.map((occurrence) => occurrence.start.slice(0, 10)),
  ).toEqual(["2026-09-10", "2026-09-14", "2026-09-17", "2026-09-21"]);
  expect(
    weekly.diagnostics.some(
      (diagnostic) => diagnostic.code === "times-per-approximated",
    ),
  ).toBe(true);

  const daily = resolve(
    {
      clauses: [
        { recurrence: { freq: "daily", interval: 1, timesPer: 3, count: 4 } },
      ],
    },
    options,
  );
  expect(daily.occurrences.map((occurrence) => occurrence.start)).toEqual([
    "2026-09-09T16:00:00+06:00",
    "2026-09-10T00:00:00+06:00",
    "2026-09-10T08:00:00+06:00",
    "2026-09-10T16:00:00+06:00",
  ]);
});

it("honors explicit preview bounds for both recurrence and one-off dates", () => {
  const schedule: Schedule = {
    clauses: [
      {
        recurrence: { freq: "daily", interval: 1 },
        time: { start: { named: "noon" } },
      },
    ],
  };
  const result = resolve(schedule, {
    ...options,
    until: "2026-09-11",
    limit: 10,
  });
  expect(result.occurrences).toHaveLength(2);
  expect(result.truncated).toBe(false);
  expect(resolve(schedule, { ...options, limit: 2 }).truncated).toBe(true);
  expect(() => resolve(schedule, { ...options, limit: 0 })).toThrow("limit");
  expect(() => resolve(schedule, { ...options, limit: 1001 })).toThrow("limit");

  const future = resolve(
    { clauses: [{ date: { kind: "calendar", year: 2040, month: 1, day: 1 } }] },
    { ...options, until: "2027-09-09" },
  );
  expect(future.occurrences).toEqual([]);
});

it("limits a recurrence by a calendar duration and warns about a month-only end", () => {
  const bounded = resolve(
    {
      clauses: [
        {
          recurrence: {
            freq: "weekly",
            interval: 1,
            byDay: ["MO"],
            span: { amount: 3, unit: "week" },
          },
          time: { start: { named: "noon" } },
        },
      ],
    },
    options,
  );
  expect(
    bounded.occurrences.map((occurrence) => occurrence.start.slice(0, 10)),
  ).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);

  const monthEnd = resolve(
    {
      clauses: [
        {
          recurrence: {
            freq: "weekly",
            interval: 2,
            byDay: ["TU"],
            until: { kind: "calendar", month: 12 },
          },
        },
      ],
    },
    options,
  );
  expect(
    monthEnd.diagnostics.some(
      (diagnostic) => diagnostic.code === "until-month-only",
    ),
  ).toBe(true);
});

it("resolves standalone clocks in the future and retains clock precision for relative hour periods", () => {
  const clock = resolve(
    { clauses: [{ time: { start: { hour: 9, minute: 0 } } }] },
    options,
  );
  expect(clock.occurrences[0].start).toBe("2026-09-10T09:00:00+06:00");

  const hour = resolve(
    {
      clauses: [
        { date: { kind: "relativeUnit", unit: "hour", modifier: "next" } },
      ],
    },
    options,
  );
  expect(hour.occurrences[0]).toEqual({
    start: "2026-09-09T13:00:00+06:00",
    end: "2026-09-09T14:00:00+06:00",
    allDay: false,
    clause: 0,
  });
});

it("uses anniversaries only for exact clocks on relative calendar periods", () => {
  const reference = "2026-09-12T14:37:22+06:00";
  const resolveClause = (clause: Schedule["clauses"][number]) =>
    resolve({ clauses: [clause] }, { reference, timeZone: "Asia/Dhaka" })
      .occurrences[0];

  expect(
    resolveClause({
      date: { kind: "relativeUnit", unit: "week", modifier: "next" },
      time: { start: { part: "morning" } },
    }),
  ).toEqual({
    start: "2026-09-14T06:00:00+06:00",
    end: "2026-09-14T12:00:00+06:00",
    allDay: false,
    clause: 0,
  });
  expect(
    resolveClause({
      date: { kind: "relativeUnit", unit: "year", modifier: "next" },
      time: { start: { hour: 20, minute: 0 } },
    })?.start,
  ).toBe("2027-09-12T20:00:00+06:00");
  expect(
    resolveClause({
      date: { kind: "relativeUnit", unit: "year", modifier: "next" },
      time: { start: { named: "noon" } },
    })?.start,
  ).toBe("2027-09-12T12:00:00+06:00");
});

it("keeps the reference date and clock for same-time calendar shifts", () => {
  const explicit = resolve(
    {
      clauses: [
        {
          date: { kind: "now" },
          time: { start: { hour: 20, minute: 0 } },
          shift: { amount: 1, unit: "year", direction: "after" },
        },
      ],
    },
    {
      reference: "2026-09-12T14:37:22+06:00",
      timeZone: "Asia/Dhaka",
    },
  );

  expect(explicit.occurrences).toEqual([
    {
      start: "2027-09-12T20:00:00+06:00",
      allDay: false,
      clause: 0,
    },
  ]);

  const implied = resolve(
    {
      clauses: [
        {
          date: { kind: "now" },
          shift: { amount: 1, unit: "year", direction: "after" },
        },
      ],
    },
    {
      reference: "2026-09-12T14:37:22+06:00",
      timeZone: "Asia/Dhaka",
    },
  );
  expect(implied.occurrences).toEqual([
    {
      start: "2027-09-12T14:37:22+06:00",
      allDay: false,
      clause: 0,
    },
  ]);
});

it("resolves an unqualified named month to its next first day without a range", () => {
  expect(
    resolve(
      { clauses: [{ date: { kind: "calendar", month: 8 } }] },
      {
        reference: "2026-09-12T14:37:22+06:00",
        timeZone: "Asia/Dhaka",
      },
    ).occurrences,
  ).toEqual([
    {
      start: "2027-08-01T00:00:00+06:00",
      allDay: true,
      clause: 0,
    },
  ]);
});

it("still rejects an empty hourly recurrence clock window", () => {
  expect(() =>
    resolve(
      {
        clauses: [
          {
            recurrence: { freq: "hourly", interval: 1 },
            time: {
              start: { hour: 14, minute: 0 },
              end: { hour: 14, minute: 0 },
            },
          },
        ],
      },
      options,
    ),
  ).toThrow();
});

it("leaves an open upper bound without an end", () => {
  const schedule: Schedule = {
    clauses: [{ time: { start: { hour: 18, minute: 0 }, open: "end" } }],
  };
  const [occurrence] = resolve(schedule, {
    reference: "2026-09-11T10:00:00Z",
    timeZone: "UTC",
  }).occurrences;
  expect(occurrence.start).toBe("2026-09-11T18:00:00+00:00");
  expect(occurrence.end).toBeUndefined();
  expect(occurrence.open).toBe("end");
});

it("anchors an open lower bound on the day its named edge falls in", () => {
  const schedule: Schedule = {
    clauses: [
      {
        time: {
          start: { hour: 0, minute: 0 },
          end: { hour: 18, minute: 0 },
          open: "start",
        },
      },
    ],
  };
  // Midnight is always behind the reference; searching on it lands tomorrow.
  const [occurrence] = resolve(schedule, {
    reference: "2026-09-11T10:00:00Z",
    timeZone: "UTC",
  }).occurrences;
  expect(occurrence.start).toBe("2026-09-11T00:00:00+00:00");
  expect(occurrence.end).toBe("2026-09-11T18:00:00+00:00");
  expect(occurrence.open).toBe("start");
});

it("omits the open field for a fully bounded occurrence", () => {
  const schedule: Schedule = {
    clauses: [
      { time: { start: { hour: 8, minute: 0 }, end: { hour: 10, minute: 0 } } },
    ],
  };
  const [occurrence] = resolve(schedule, {
    reference: "2026-09-11T10:00:00Z",
    timeZone: "UTC",
  }).occurrences;
  expect(occurrence).not.toHaveProperty("open");
});

it("rolls a yearless calendar date forward instead of into the past", () => {
  const dates = (
    [
      [{ month: 1, day: 2 }, "2027-01-02"],
      [{ day: 3 }, "2026-10-03"],
      [{ month: 12, day: 25 }, "2026-12-25"],
      [{ day: 30 }, "2026-09-30"],
    ] as const
  ).map(([date, expected]) => [
    resolve(
      { clauses: [{ date: { kind: "calendar", ...date } }] },
      options,
    ).occurrences[0].start.slice(0, 10),
    expected,
  ]);
  for (const [actual, expected] of dates) expect(actual).toBe(expected);
});

it("shifts by elapsed seconds", () => {
  const result = resolve(
    {
      clauses: [{ shift: { amount: 90, unit: "second", direction: "after" } }],
    },
    options,
  );
  expect(result.occurrences[0]).toMatchObject({
    start: "2026-09-09T12:01:30+06:00",
  });
});

it("resolves thanksgiving as the fourth Thursday of November", () => {
  const schedule: Schedule = {
    clauses: [{ date: { kind: "holiday", name: "thanksgiving" } }],
  };
  expect(resolve(schedule, options).occurrences[0]).toMatchObject({
    start: "2026-11-26T00:00:00+06:00",
    allDay: true,
  });
  expect(
    resolve(schedule, { ...options, reference: "2026-12-01T12:00:00+06:00" })
      .occurrences[0],
  ).toMatchObject({ start: "2027-11-25T00:00:00+06:00", allDay: true });
});
