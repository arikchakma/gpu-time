import { Temporal } from "@js-temporal/polyfill";
import { expect, it, vi } from "vitest";
import {
  civil,
  fromUTC,
  iso,
  zonedToEpoch,
  utc,
  dayOfWeek,
} from "../src/zoned.js";

it.each([
  [{ year: 1, month: 1, day: 1 }, "0001-01-01"],
  [{ year: 5, month: 3, day: 0 }, "0005-02-28"],
  [{ year: 99, month: 13, day: 1 }, "0100-01-01"],
  [{ year: 100, month: 2, day: 29 }, "0100-03-01"],
  [{ year: 1969, month: 12, day: 31 }, "1969-12-31"],
  [{ year: 2000, month: 2, day: 29 }, "2000-02-29"],
] as const)("preserves Gregorian date arithmetic for %j", (fields, date) => {
  const epoch = Date.parse(`${date}T00:00:00Z`);
  expect(utc(fields)).toBe(epoch);
  expect(dayOfWeek(fields)).toBe((new Date(epoch).getUTCDay() + 6) % 7);
});

const cases = [
  ["America/New_York", 2026, 3, 8, 2, 30],
  ["America/New_York", 2026, 11, 1, 1, 30],
  ["Europe/London", 2026, 3, 29, 1, 30],
  ["Europe/London", 2026, 10, 25, 1, 30],
  ["Australia/Lord_Howe", 2026, 10, 4, 2, 15],
  ["Australia/Lord_Howe", 2026, 4, 5, 1, 45],
  ["Pacific/Apia", 2011, 12, 30, 12, 0],
  ["Asia/Kathmandu", 1986, 1, 1, 0, 5],
  ["Asia/Dhaka", 2026, 9, 9, 12, 0],
] as const;

it("reuses exact timezone conversions without sharing mutable date objects", () => {
  const epoch = Date.parse("2031-07-18T14:20:30.500Z");
  const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
  try {
    const first = civil(epoch, "Europe/Paris");
    first.hour = 0;
    const second = civil(epoch + 100, "Europe/Paris");
    expect(second.hour).toBe(16);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(civil(epoch, "UTC").hour).toBe(14);
  } finally {
    spy.mockRestore();
  }
});

it("preserves distinct offsets on either side of a DST transition", () => {
  const before = Date.parse("2026-11-01T05:30:00Z");
  const after = Date.parse("2026-11-01T06:30:00Z");
  for (let i = 0; i < 3; i++) {
    expect(iso(before, "America/New_York")).toBe("2026-11-01T01:30:00-04:00");
    expect(iso(after, "America/New_York")).toBe("2026-11-01T01:30:00-05:00");
  }
});

it("keeps overlap decisions correct after cached values are mutated or evicted", () => {
  const fields = {
    year: 2026,
    month: 11,
    day: 1,
    hour: 1,
    minute: 30,
    second: 0,
  };
  const first = zonedToEpoch(fields, "America/New_York");
  first.kind = "gap";
  first.epochMs = 0;
  expect(zonedToEpoch(fields, "America/New_York")).toEqual({
    kind: "overlap",
    epochMs: Date.parse("2026-11-01T05:30:00Z"),
  });
  for (let i = 0; i < 2100; i++)
    zonedToEpoch(fromUTC(Date.UTC(2040, 0, 1) + i * 86400000), "UTC");
  expect(zonedToEpoch(fields, "America/New_York")).toEqual({
    kind: "overlap",
    epochMs: Date.parse("2026-11-01T05:30:00Z"),
  });
});

it.each(cases)(
  "matches Temporal at %s %i-%i-%i %i:%i",
  (timeZone, year, month, day, hour, minute) => {
    const fields = { year, month, day, hour, minute, second: 0 };
    const expected = Temporal.ZonedDateTime.from(
      { ...fields, timeZone },
      { disambiguation: "compatible" },
    );
    const earlier = Temporal.ZonedDateTime.from(
      { ...fields, timeZone },
      { disambiguation: "earlier" },
    );
    const later = Temporal.ZonedDateTime.from(
      { ...fields, timeZone },
      { disambiguation: "later" },
    );
    const actual = zonedToEpoch(fields, timeZone);

    expect(actual.epochMs).toBe(expected.epochMilliseconds);
    const sameWallTime = expected
      .toPlainDateTime()
      .equals(Temporal.PlainDateTime.from(fields));
    const expectedKind = !sameWallTime
      ? "gap"
      : earlier.epochMilliseconds !== later.epochMilliseconds
        ? "overlap"
        : "exact";
    expect(actual.kind).toBe(expectedKind);
    expect(Date.parse(iso(actual.epochMs, timeZone))).toBe(actual.epochMs);
    expect(civil(actual.epochMs, timeZone).hour).toBe(expected.hour);
  },
);
