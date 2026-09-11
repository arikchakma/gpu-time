import { expect, it } from "vitest";
import { matches, normalize } from "../src/recognizers-values.ts";

it("preserves time-only source expectations without inventing a date", () => {
  expect(normalize({ time: "08:40:00" })).toEqual({
    start: "08:40:00",
    precision: "time",
  });
  expect(normalize({ startTime: "22:00:00", endTime: "00:00:00" })).toEqual({
    start: "22:00:00",
    end: "00:00:00",
    precision: "time",
  });
  expect(normalize({ time: "27:00:00" })).toBeNull();
  expect(normalize({ startTime: "22:00:00", endTime: "invalid" })).toBeNull();
});

it("requires exact seconds for datetimes", () => {
  const expected = normalize({ dateTime: "2026-09-09 14:30:25" })!;
  expect(matches({ start: "2026-09-09T14:30:25Z" }, expected)).toBe(true);
  expect(matches({ start: "2026-09-09T14:30:00Z" }, expected)).toBe(false);
});

it("checks overnight duration as well as time-only clocks", () => {
  const expected = normalize({ startTime: "22:00:00", endTime: "00:00:00" })!;
  expect(
    matches(
      { start: "2026-09-09T22:00:00Z", end: "2026-09-10T00:00:00Z" },
      expected,
    ),
  ).toBe(true);
  expect(
    matches(
      { start: "2026-09-09T22:00:00Z", end: "2026-09-11T00:00:00Z" },
      expected,
    ),
  ).toBe(false);
  expect(matches({ start: "2026-09-09T22:00:00Z" }, expected)).toBe(false);
});

it("compares date-only values at their stated precision", () => {
  const expected = normalize({ date: "2026-09-09" })!;
  expect(matches({ start: "2026-09-09T15:00:00Z" }, expected)).toBe(true);
  expect(matches({ start: "2026-09-10T00:00:00Z" }, expected)).toBe(false);
});
