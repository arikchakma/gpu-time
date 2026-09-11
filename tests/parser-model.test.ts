import { expect, it } from "vitest";
import { defineParser, resolve } from "../src/schedule.js";
import type { Clause } from "../src/types.js";

it("preserves every clause when a schedule spans several inference windows", async () => {
  const forms = ["Monday at 9am", "Tuesday at 10am", "Wednesday at 11am"];
  const days = ["MO", "TU", "WE"] as const;
  const clauses: Clause[] = Array.from({ length: 40 }, (_, index) => ({
    date: { kind: "weekday", days: [days[index % 3]] },
    time: { start: { hour: 9 + (index % 3), minute: 0 } },
  }));
  const text = clauses.map((_, index) => forms[index % 3]).join(" and ");
  const parser = await defineParser({ backend: "cpu", tokens: true });
  try {
    const result = await parser.parse(text);
    expect(result.tokens!.length).toBeGreaterThan(128);
    expect(result.expressions).toHaveLength(1);
    expect(result.expressions[0].schedule).toEqual({ clauses });
    expect(result.expressions[0].text).toBe(text);
  } finally {
    parser.dispose();
  }
});

it("resolves one timezone-free prediction using each caller's timezone", async () => {
  const parser = await defineParser({ backend: "cpu" });
  try {
    const result = await parser.parse("tomorrow at 3pm");
    const schedule = result.expressions[0].schedule!;
    expect(schedule).toEqual({
      clauses: [
        {
          date: { kind: "relativeDay", offset: 1 },
          time: { start: { hour: 15, minute: 0 } },
        },
      ],
    });
    const original = structuredClone(schedule);
    const reference = "2026-09-09T00:30:00+06:00";
    const dhaka = resolve(schedule, { reference, timeZone: "Asia/Dhaka" });
    const newYork = resolve(schedule, {
      reference,
      timeZone: "America/New_York",
    });
    expect(dhaka.occurrences[0].start).toBe("2026-09-10T15:00:00+06:00");
    expect(newYork.occurrences[0].start).toBe("2026-09-09T15:00:00-04:00");
    expect(schedule).toEqual(original);
    expect(() =>
      resolve(schedule, { reference, timeZone: "not-a-zone" }),
    ).toThrow(RangeError);
  } finally {
    parser.dispose();
  }
});

it("parses the user's shorthand using trained predictions, not oracle labels", async () => {
  const parser = await defineParser({ backend: "cpu", tokens: true });
  const result = await parser.parse("Sat Sun 1pm-8pm Mon 10pm-12am");
  expect(result.expressions).toHaveLength(1);
  expect(result.expressions[0].schedule).toEqual({
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
  });
  const dates = resolve(result.expressions[0].schedule!, {
    reference: "2026-09-09T12:00:00+06:00",
    timeZone: "Asia/Dhaka",
  });
  expect(dates.occurrences.map((occurrence) => occurrence.start)).toEqual([
    "2026-09-12T13:00:00+06:00",
    "2026-09-13T13:00:00+06:00",
    "2026-09-14T22:00:00+06:00",
  ]);
  expect(dates.occurrences[2].end).toBe("2026-09-15T00:00:00+06:00");
  parser.dispose();
});

it("passes dateOrder through to AST assembly without changing neural token predictions", async () => {
  const monthFirst = await defineParser({
    backend: "cpu",
    dateOrder: "MDY",
    tokens: true,
  });
  const dayFirst = await defineParser({
    backend: "cpu",
    dateOrder: "DMY",
    tokens: true,
  });
  try {
    const [a, b] = await Promise.all([
      monthFirst.parse("03/04/2026"),
      dayFirst.parse("03/04/2026"),
    ]);
    expect(a.tokens).toEqual(b.tokens);
    expect(a.expressions[0].schedule).toEqual({
      clauses: [{ date: { kind: "calendar", month: 3, day: 4, year: 2026 } }],
    });
    expect(b.expressions[0].schedule).toEqual({
      clauses: [{ date: { kind: "calendar", month: 4, day: 3, year: 2026 } }],
    });
  } finally {
    monthFirst.dispose();
    dayFirst.dispose();
  }
});

it("ignores boundary whitespace during inference while preserving every source token", async () => {
  const parser = await defineParser({ backend: "cpu", tokens: true });
  try {
    const source = " \ttoday\n";
    const plain = await parser.parse("today");
    const padded = await parser.parse(source);
    expect(padded.expressions[0].schedule).toEqual(
      plain.expressions[0].schedule,
    );
    expect(padded.expressions[0].start).toBe(2);
    expect(padded.expressions[0].end).toBe(7);
    expect(padded.tokens?.map((token) => token.text).join("")).toBe(source);
    expect((await parser.parse(" \n\t")).expressions).toEqual([]);
  } finally {
    parser.dispose();
  }
});
