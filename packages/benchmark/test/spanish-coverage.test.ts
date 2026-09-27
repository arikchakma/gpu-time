import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(
    import.meta.dirname,
    "../../training/data/gold/spanish-coverage.jsonl",
  ),
  "utf8",
);
const fixtures = source
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

describe("Spanish coverage fixtures", () => {
  test("have unique ids and all required families", () => {
    expect(new Set(fixtures.map((value) => value.id)).size).toBe(
      fixtures.length,
    );
    expect(new Set(fixtures.map((value) => value.family))).toEqual(
      new Set([
        "casual",
        "month-name-little-endian",
        "slash",
        "time-exp",
        "time-units-within",
      ]),
    );
    for (const fixture of fixtures) {
      expect(Number.isNaN(Date.parse(fixture.context.reference))).toBe(false);
      expect(fixture.context.timeZone).toBe("UTC");
      if (fixture.spanOnly) {
        expect(typeof fixture.matched).toBe("string");
        expect(fixture.text.includes(fixture.matched)).toBe(true);
      } else {
        expect(Array.isArray(fixture.occurrences)).toBe(true);
        for (const occurrence of fixture.occurrences)
          expect(Number.isNaN(Date.parse(occurrence.start))).toBe(false);
      }
    }
  });

  test("every row states exactly one expectation", () => {
    for (const fixture of fixtures) {
      const kinds = [
        fixture.spanOnly === true,
        Array.isArray(fixture.occurrences) && fixture.occurrences.length === 0,
        Array.isArray(fixture.occurrences) && fixture.occurrences.length > 0,
      ].filter(Boolean);
      expect(kinds.length).toBe(1);
    }
  });
});
