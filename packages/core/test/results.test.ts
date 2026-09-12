import { afterAll, beforeAll, expect, it } from "vitest";
import { defineParser } from "../src/index.js";

let parser: Awaited<ReturnType<typeof defineParser>>;
const context = {
  reference: "2026-09-09T12:00:00+06:00",
  timeZone: "Asia/Dhaka",
};
beforeAll(async () => {
  parser = await defineParser({ backend: "cpu" });
});
afterAll(() => parser.dispose());

it("keeps batch results equivalent to individual calls and independently mutable", async () => {
  const texts = [
    "every Friday",
    "tomorrow at noon",
    "27pm",
    "tomorrow at noon",
  ];
  const batch = await parser.parseMany(texts, context);
  const single = await Promise.all(
    texts.map((text) => parser.parse(text, context)),
  );
  for (let index = 0; index < texts.length; index++) {
    expect(batch[index].occurrences).toEqual(single[index].occurrences);
    expect(batch[index].rrules).toEqual(single[index].rrules);
    expect(batch[index].diagnostics).toEqual(single[index].diagnostics);
  }
  batch[1].occurrences[0].start = "changed";
  expect(batch[3].occurrences[0].start).toBe(single[3].occurrences[0].start);
});

it("keeps resolution failures local to expressions when sharing a context", async () => {
  const results = await parser.parseMany(
    ["May I have your second opinion?", "tomorrow"],
    { ...context, until: "2020-01-01" },
  );
  expect(
    results[0].diagnostics.filter((value) => value.severity === "error"),
  ).toEqual([]);
  expect(
    results[1].diagnostics.some((value) => value.code === "resolution-error"),
  ).toBe(true);
});

it("requires an explicit timezone from JavaScript callers too", async () => {
  await expect(
    Reflect.apply(parser.parse, null, [
      "tomorrow",
      { reference: context.reference },
    ]),
  ).rejects.toThrow("timeZone is required");
});

it("returns the requested dates and overnight range directly", async () => {
  const result = await parser.parse("Sat Sun 1pm-8pm Mon 10pm-12am", context);
  expect(result.occurrences).toEqual([
    {
      start: "2026-09-12T13:00:00+06:00",
      end: "2026-09-12T20:00:00+06:00",
      allDay: false,
    },
    {
      start: "2026-09-13T13:00:00+06:00",
      end: "2026-09-13T20:00:00+06:00",
      allDay: false,
    },
    {
      start: "2026-09-14T22:00:00+06:00",
      end: "2026-09-15T00:00:00+06:00",
      allDay: false,
    },
  ]);
  expect(result).not.toHaveProperty("expressions");
  expect(result).not.toHaveProperty("tokens");
  expect(result.rrules).toEqual([]);
});

it("resolves the same language using the caller's local calendar", async () => {
  const reference = "2026-09-09T00:30:00+06:00";
  const dhaka = await parser.parse("tomorrow at 3pm", {
    reference,
    timeZone: "Asia/Dhaka",
  });
  const newYork = await parser.parse("tomorrow at 3pm", {
    reference,
    timeZone: "America/New_York",
  });
  expect(dhaka.occurrences[0].start).toBe("2026-09-10T15:00:00+06:00");
  expect(newYork.occurrences[0].start).toBe("2026-09-09T15:00:00-04:00");
});

it("generates bounded recurrence and calendar rules", async () => {
  const result = await parser.parse("every Monday at 8pm", {
    ...context,
    limit: 3,
  });
  expect(result.occurrences.map((value) => value.start)).toEqual([
    "2026-09-14T20:00:00+06:00",
    "2026-09-21T20:00:00+06:00",
    "2026-09-28T20:00:00+06:00",
  ]);
  expect(result.truncated).toBe(true);
  expect(result.rrules[0]).toContain("FREQ=WEEKLY");
});

it("returns relative dates and duration windows in a batch", async () => {
  const results = await parser.parseMany(
    ["one day after", "two hours"],
    context,
  );
  expect(results[0].occurrences[0].start).toBe("2026-09-10T12:00:00+06:00");
  expect(results[1].occurrences[0]).toMatchObject({
    start: context.reference,
    end: "2026-09-09T14:00:00+06:00",
  });
});

it("returns diagnostics instead of dates for invalid clock values", async () => {
  const result = await parser.parse("27pm", context);
  expect(result.occurrences).toEqual([]);
  expect(
    result.diagnostics.some((value) => value.code === "invalid-time"),
  ).toBe(true);
});

it("flags temporal input that produced no expression and stays quiet otherwise", async () => {
  const missed = await parser.parse("mid october", context);
  expect(missed.occurrences).toEqual([]);
  expect(missed.diagnostics.map((value) => value.code)).toContain(
    "no-expression",
  );
  const prose = await parser.parse("the meeting was long", context);
  expect(prose.diagnostics).toEqual([]);
});
