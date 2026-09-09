import { Temporal } from "@js-temporal/polyfill";
import { expect, it } from "vitest";
import { civil, iso, zonedToEpoch } from "../src/zoned.js";

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
