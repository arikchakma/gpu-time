import { afterAll, beforeAll, expect, it } from "vitest";
import { defineParser } from "../src/index.js";
import { resolve } from "../src/resolve.js";
import { RRule } from "rrule";

const context = {
  reference: "2026-09-09T00:00:00Z",
  timeZone: "UTC",
  limit: 6,
};
let parser: Awaited<ReturnType<typeof defineParser>>;
beforeAll(async () => {
  parser = await defineParser({ backend: "cpu" });
});
afterAll(() => parser.dispose());

it.each([
  ["set an alarm for eight forty", "2026-09-09T08:40:00+00:00"],
  ["ten thirty-five pm", "2026-09-09T22:35:00+00:00"],
  ["seven o'clock", "2026-09-09T07:00:00+00:00"],
  ["half past seven", "2026-09-09T07:30:00+00:00"],
  ["quarter past nine", "2026-09-09T09:15:00+00:00"],
  ["quarter to six", "2026-09-09T05:45:00+00:00"],
  ["quarter to twelve am", "2026-09-09T23:45:00+00:00"],
  ["eight in the morning", "2026-09-09T08:00:00+00:00"],
  ["six in the evening", "2026-09-09T18:00:00+00:00"],
  ["ten at night", "2026-09-09T22:00:00+00:00"],
  ["twelve at night", "2026-09-09T00:00:00+00:00"],
  ["in two days and six hours", "2026-09-11T06:00:00+00:00"],
  ["in half an hour", "2026-09-09T00:30:00+00:00"],
  ["I'll be back on the 15th", "2026-09-15T00:00:00+00:00"],
  ["book dinner for October 2 at eight pm", "2026-10-02T20:00:00+00:00"],
  ["1st Friday of next month", "2026-10-02T00:00:00+00:00"],
  ["21/04/2016", "2016-04-21T00:00:00+00:00"],
  ["04/21/2016", "2016-04-21T00:00:00+00:00"],
])("resolves %s", async (text, start) => {
  const result = await parser.parse(text, context);
  expect(
    result.diagnostics.filter((value) => value.severity === "error"),
  ).toEqual([]);
  expect(result.occurrences).toHaveLength(1);
  expect(result.occurrences[0].start).toBe(start);
});

it.each([
  [
    "for three hours and thirty minutes",
    "2026-09-09T00:00:00+00:00",
    "2026-09-09T03:30:00+00:00",
  ],
  [
    "for an hour and a half",
    "2026-09-09T00:00:00+00:00",
    "2026-09-09T01:30:00+00:00",
  ],
  ["for 2.5 hours", "2026-09-09T00:00:00+00:00", "2026-09-09T02:30:00+00:00"],
  [
    "from September 4 through September 8",
    "2026-09-04T00:00:00+00:00",
    "2026-09-09T00:00:00+00:00",
  ],
  [
    "Friday the 11th until Tuesday the 15th",
    "2026-09-11T00:00:00+00:00",
    "2026-09-16T00:00:00+00:00",
  ],
  [
    "Friday at 10pm until Saturday at 2am",
    "2026-09-11T22:00:00+00:00",
    "2026-09-12T02:00:00+00:00",
  ],
  ["this September", "2026-09-01T00:00:00+00:00", "2026-10-01T00:00:00+00:00"],
  ["next month", "2026-10-01T00:00:00+00:00", "2026-11-01T00:00:00+00:00"],
  [
    "the first week of October",
    "2026-10-01T00:00:00+00:00",
    "2026-10-08T00:00:00+00:00",
  ],
])("resolves the complete range in %s", async (text, start, end) => {
  const result = await parser.parse(text, context);
  expect(
    result.diagnostics.filter((value) => value.severity === "error"),
  ).toEqual([]);
  expect(result.occurrences).toHaveLength(1);
  expect(result.occurrences[0]).toMatchObject({ start, end });
});

it.each([
  ["every other Friday", ["2026-09-11", "2026-09-25", "2026-10-09"]],
  ["every two weeks on Tuesday", ["2026-09-15", "2026-09-29", "2026-10-13"]],
  ["the last Friday of each month", ["2026-09-25", "2026-10-30", "2026-11-27"]],
  [
    "every Monday except the first Monday of the month",
    ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-12"],
  ],
])("expands %s", async (text, dates) => {
  const result = await parser.parse(text, context);
  expect(
    result.diagnostics.filter((value) => value.severity === "error"),
  ).toEqual([]);
  expect(
    result.occurrences
      .slice(0, dates.length)
      .map((value) => value.start.slice(0, 10)),
  ).toEqual(dates);
  expect(result.rrules).toHaveLength(1);
});

it("shares a weekday schedule across two clock points", async () => {
  const result = await parser.parse(
    "every weekday at nine am and five pm",
    context,
  );
  expect(result.occurrences.slice(0, 4).map((value) => value.start)).toEqual([
    "2026-09-09T09:00:00+00:00",
    "2026-09-09T17:00:00+00:00",
    "2026-09-10T09:00:00+00:00",
    "2026-09-10T17:00:00+00:00",
  ]);
  expect(result.rrules).toHaveLength(2);
});

it("keeps a weekday recurrence's inclusive end bound", async () => {
  const result = await parser.parse("weekdays at nine until December 20", {
    ...context,
    reference: "2026-12-17T00:00:00Z",
  });
  expect(result.occurrences.map((value) => value.start)).toEqual([
    "2026-12-17T09:00:00+00:00",
    "2026-12-18T09:00:00+00:00",
  ]);
});

it("applies calendar days before elapsed hours across DST", () => {
  const result = resolve(
    {
      clauses: [
        {
          shift: {
            amount: 1,
            unit: "day",
            components: [{ amount: 2, unit: "hour" }],
            direction: "after",
          },
        },
      ],
    },
    { reference: "2026-03-07T12:00:00-05:00", timeZone: "America/New_York" },
  );
  expect(result.occurrences[0].start).toBe("2026-03-08T14:00:00-04:00");
});

it("exports repeating monthly exclusions beyond the preview", () => {
  const result = resolve(
    {
      clauses: [
        {
          recurrence: {
            freq: "weekly",
            interval: 1,
            byDay: ["MO"],
            except: [
              {
                kind: "ordinalWeekday",
                ordinal: 1,
                day: "MO",
                of: { kind: "calendar" },
                recurring: true,
              },
            ],
          },
        },
      ],
    },
    context,
  );
  const line = result.rrules[0]
    .split("\n")
    .find((value) => value.startsWith("RRULE:"))!;
  const rule = new RRule({
    ...RRule.parseString(line),
    dtstart: new Date("2026-09-14T00:00:00Z"),
  });
  const dates = rule
    .between(new Date("2026-10-01Z"), new Date("2026-11-01Z"))
    .map((value) => value.toISOString().slice(0, 10));
  expect(dates).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
});

it("uses the caller's date order for ambiguous numeric dates", async () => {
  const dmy = await defineParser({ backend: "cpu", dateOrder: "DMY" });
  try {
    const european = await dmy.parse("03/04/2027", context);
    const american = await parser.parse("03/04/2027", context);
    expect(european.occurrences[0].start).toBe("2027-04-03T00:00:00+00:00");
    expect(american.occurrences[0].start).toBe("2027-03-04T00:00:00+00:00");
  } finally {
    dmy.dispose();
  }
});

it("keeps the original compact multi-day input", async () => {
  const result = await parser.parse("Sat Sun 1pm-8pm Mon 10pm-12am", context);
  expect(result.occurrences.map(({ start, end }) => [start, end])).toEqual([
    ["2026-09-12T13:00:00+00:00", "2026-09-12T20:00:00+00:00"],
    ["2026-09-13T13:00:00+00:00", "2026-09-13T20:00:00+00:00"],
    ["2026-09-14T22:00:00+00:00", "2026-09-15T00:00:00+00:00"],
  ]);
});

it("resolves explicit cross-date clocks through a DST change", () => {
  const result = resolve(
    {
      clauses: [
        {
          date: { kind: "calendar", year: 2026, month: 3, day: 7 },
          endDate: { kind: "calendar", year: 2026, month: 3, day: 8 },
          time: { start: { hour: 22, minute: 0 }, end: { hour: 4, minute: 0 } },
        },
      ],
    },
    { ...context, timeZone: "America/New_York" },
  );
  expect(result.occurrences[0]).toMatchObject({
    start: "2026-03-07T22:00:00-05:00",
    end: "2026-03-08T04:00:00-04:00",
  });
});

it.each([
  ["please set an alarm for six twenty-seven pm", "18:27:00"],
  ["remind me at eleven forty-two", "11:42:00"],
  ["schedule a call for half past four pm", "16:30:00"],
])("understands varied wording: %s", async (text, clock) => {
  const result = await parser.parse(text, context);
  expect(result.occurrences).toHaveLength(1);
  expect(result.occurrences[0].start.slice(11, 19)).toBe(clock);
});

it.each(["-", "to", "until"])(
  "allows equal clocks on different explicit dates (%s)",
  async (separator) => {
    const result = await parser.parse(
      `17 August 2013 2pm ${separator} 19 August 2013 2pm`,
      { ...context, timeZone: "Asia/Dhaka" },
    );
    expect(
      result.diagnostics.filter((value) => value.severity === "error"),
    ).toEqual([]);
    expect(result.occurrences).toEqual([
      {
        start: "2013-08-17T14:00:00+06:00",
        end: "2013-08-19T14:00:00+06:00",
        allDay: false,
      },
    ]);
  },
);

it.each([17, 16])(
  "rejects an equal or reversed full datetime range ending August %i",
  async (day) => {
    const result = await parser.parse(
      `17 August 2013 2pm - ${day} August 2013 2pm`,
      context,
    );
    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics.some((value) => value.severity === "error")).toBe(
      true,
    );
  },
);

it("compares complete instants for equal clocks across a DST transition", () => {
  const result = resolve(
    {
      clauses: [
        {
          date: { kind: "calendar", year: 2026, month: 3, day: 7 },
          endDate: { kind: "calendar", year: 2026, month: 3, day: 8 },
          time: {
            start: { hour: 14, minute: 0 },
            end: { hour: 14, minute: 0 },
          },
        },
      ],
    },
    { ...context, timeZone: "America/New_York" },
  );
  const { start, end } = result.occurrences[0];
  expect(start).toBe("2026-03-07T14:00:00-05:00");
  expect(end).toBe("2026-03-08T14:00:00-04:00");
  expect(Date.parse(end!) - Date.parse(start)).toBe(23 * 3600000);
});
