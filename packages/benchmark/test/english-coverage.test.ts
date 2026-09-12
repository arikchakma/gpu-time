import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(
    import.meta.dirname,
    "../../training/data/gold/english-coverage.jsonl",
  ),
  "utf8",
);
const fixtures = source
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

describe("English coverage fixtures", () => {
  test("have unique ids and all required families", () => {
    expect(new Set(fixtures.map((value) => value.id)).size).toBe(
      fixtures.length,
    );
    expect(new Set(fixtures.map((value) => value.family))).toEqual(
      new Set([
        "month-only",
        "named-date",
        "daypart-clock",
        "relative-date",
        "shifted-time",
        "clock-with-place",
        "same-time",
        "range",
        "negative",
        "compact-named-date",
        "shared-month-range",
        "month-year",
        "calendar-edge-shift",
      ]),
    );
    for (const fixture of fixtures) {
      expect(Number.isNaN(Date.parse(fixture.context.reference))).toBe(false);
      expect(fixture.context.timeZone).toBe("Asia/Dhaka");
      expect(Array.isArray(fixture.occurrences)).toBe(true);
      for (const occurrence of fixture.occurrences) {
        expect(Number.isNaN(Date.parse(occurrence.start))).toBe(false);
        if (occurrence.end)
          expect(Date.parse(occurrence.end)).toBeGreaterThan(
            Date.parse(occurrence.start),
          );
      }
    }
  });

  test("include the requested sentences with explicit expectations", () => {
    expect(
      fixtures.find((value) => value.text === "She is leaving in August.")
        ?.occurrences,
    ).toEqual([{ start: "2027-08-01T00:00:00+06:00", allDay: true }]);
    expect(
      fixtures.find(
        (value) => value.text === "call me 8 pm exactly next year on same time",
      )?.occurrences,
    ).toEqual([{ start: "2027-09-12T20:00:00+06:00", allDay: false }]);
  });
});
