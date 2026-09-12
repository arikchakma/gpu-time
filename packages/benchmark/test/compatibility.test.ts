import { readFileSync } from "node:fs";
import { afterAll, expect, test } from "vitest";
import { matches, type CompatibilityCase } from "../src/compatibility.ts";

test("ignores an unspecified clock, not a wrong date or an explicit clock", () => {
  expect(
    matches(
      [{ start: "2027-05-18T12:00:00Z" }],
      [{ start: "2027-05-18" }],
      "UTC",
    ),
  ).toBe(true);
  expect(
    matches(
      [{ start: "2027-05-19T12:00:00Z" }],
      [{ start: "2027-05-18" }],
      "UTC",
    ),
  ).toBe(false);
  expect(
    matches(
      [{ start: "2027-05-18T13:00:00Z" }],
      [{ start: "2027-05-18T12:00:00Z" }],
      "UTC",
    ),
  ).toBe(false);
  expect(
    matches(
      [{ start: "2027-05-17T20:00:00Z" }],
      [{ start: "2027-05-18" }],
      "Asia/Dhaka",
    ),
  ).toBe(true);
});

test("checks both range endpoints, result count, precision and all-day semantics", () => {
  const point = [{ start: "2027-05-18T12:00:00Z" }];
  expect(
    matches(
      [{ ...point[0], end: "2027-05-18T14:00:00Z" }],
      [{ ...point[0], end: "2027-05-18T13:00:00Z" }],
      "UTC",
    ),
  ).toBe(false);
  expect(
    matches([{ ...point[0], allDay: false, open: "end" }], point, "UTC", true),
  ).toBe(false);
  expect(matches([...point, ...point], point, "UTC")).toBe(false);
  expect(
    matches([{ ...point[0], end: "2027-05-18T13:00:00Z" }], point, "UTC"),
  ).toBe(false);
  expect(
    matches(point, [{ ...point[0], end: "2027-05-18T13:00:00Z" }], "UTC"),
  ).toBe(false);
  expect(matches([{ start: "2027-05-18T12:00:00.001Z" }], point, "UTC")).toBe(
    false,
  );
  expect(
    matches(
      [{ start: "2027-05-18T00:00:00Z", allDay: false }],
      [{ start: "2027-05-18" }],
      "UTC",
      true,
    ),
  ).toBe(false);
});

test("keeps independently authored policy expectations explicit", () => {
  const cases: CompatibilityCase[] = readFileSync(
    new URL("../data/english-compatibility.jsonl", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  expect(cases.length).toBeGreaterThan(56);
  for (const item of cases) {
    expect(Number.isNaN(Date.parse(item.context.reference))).toBe(false);
    if (item.comparison === "policy") {
      expect(item.reason).toBeTruthy();
      expect(item.chronoExpected).toBeDefined();
    } else expect(item.chronoExpected).toBeUndefined();
    for (const range of [...item.expected, ...(item.chronoExpected ?? [])]) {
      expect(Number.isNaN(Date.parse(range.start))).toBe(false);
      if (range.end)
        expect(Date.parse(range.end)).toBeGreaterThan(Date.parse(range.start));
    }
  }
});

let parser:
  Awaited<ReturnType<typeof import("gpu-time").defineParser>> | undefined;
afterAll(() => parser?.dispose());
test("the built public parseMany API preserves independent results", async () => {
  const { defineParser } = await import("gpu-time");
  parser = await defineParser({ backend: "cpu" });
  const context = { reference: "2027-01-06T10:20:30Z", timeZone: "UTC" };
  const texts = ["tomorrow at noon", "the archive is ready", "in 17 minutes"];
  const expected = [
    [{ start: "2027-01-07T12:00:00Z" }],
    [],
    [{ start: "2027-01-06T10:37:30Z" }],
  ];
  const batch = await parser.parseMany(texts, context);
  expect(batch).toHaveLength(texts.length);
  for (const [index, text] of texts.entries()) {
    const single = await parser.parse(text, context);
    expect(batch[index].occurrences).toEqual(single.occurrences);
    expect(batch[index].rrules).toEqual([]);
    expect(batch[index].truncated).toBe(false);
    expect(
      matches(batch[index].occurrences, expected[index], "UTC", true),
    ).toBe(true);
  }
});
