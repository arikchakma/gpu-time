import { afterAll, beforeAll, expect, it } from "vitest";
import { defineParser } from "../src/index.js";

const context = {
  reference: "2026-09-12T14:37:22+06:00",
  timeZone: "Asia/Dhaka",
  limit: 10,
};

let parser: Awaited<ReturnType<typeof defineParser>>;

beforeAll(async () => {
  parser = await defineParser({ backend: "cpu" });
});

afterAll(() => parser.dispose());

it.each([
  ["next year at the same time.", "2027-09-12T14:37:22+06:00"],
  ["next month on the same time", "2026-10-12T14:37:22+06:00"],
])("preserves the reference clock for %s", async (text, start) => {
  const result = await parser.parse(text, context);
  expect(result.occurrences).toEqual([{ start, allDay: false }]);
});

it("does not turn a same-time phrase without a temporal anchor into a schedule", async () => {
  const result = await parser.parse("We arrived at the same time.", context);
  expect(result.occurrences).toEqual([]);
});

it("expands named clock windows over every day in a date range", async () => {
  const result = await parser.parse(
    "November 3–5 from noon until midnight",
    context,
  );
  expect(result.occurrences.map(({ start, end }) => ({ start, end }))).toEqual([
    {
      start: "2026-11-03T12:00:00+06:00",
      end: "2026-11-04T00:00:00+06:00",
    },
    {
      start: "2026-11-04T12:00:00+06:00",
      end: "2026-11-05T00:00:00+06:00",
    },
    {
      start: "2026-11-05T12:00:00+06:00",
      end: "2026-11-06T00:00:00+06:00",
    },
  ]);
});
