import { expect, it } from "vitest";
import { tokenize } from "../src/tokenizer.js";
import { compile } from "../src/compile.js";
import type { Label, Token } from "../src/types.js";
import { LABELS } from "../src/labels.js";

export function oracle(
  text: string,
  labels: Label[],
  starts: number[] = [],
): Token[] {
  let labelIndex = 0;
  return tokenize(text).map((token) => ({
    ...token,
    label: token.kind === 3 ? "O" : (labels[labelIndex++] ?? "O"),
    clauseStart: starts.includes(token.start),
    score: 1,
  }));
}

it("composes a quantity and unit as a duration without an introducer", () => {
  const text = "90 days";
  expect(compile(text, oracle(text, ["NUM", "UNIT"]))[0].schedule).toEqual({
    clauses: [{ duration: { amount: 90, unit: "day" } }],
  });
  const dated = "tomorrow two hours";
  expect(
    compile(dated, oracle(dated, ["REL_DAY", "NUM", "UNIT"]))[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "relativeDay", offset: 1 },
        duration: { amount: 2, unit: "hour" },
      },
    ],
  });
});

it("rejects multiple duration values instead of silently replacing one", () => {
  const text = "for two hours for three minutes";
  const result = compile(
    text,
    oracle(text, ["DUR", "NUM", "UNIT", "DUR", "NUM", "UNIT"]),
  )[0];
  expect(result.schedule).toBeNull();
  expect(result.diagnostics.map((value) => value.code)).toContain(
    "conflicting-duration",
  );
});

it.each([
  ["two in the afternoon", 14],
  ["five in the morning", 5],
  ["seven in the evening", 19],
  ["twelve in the morning", 0],
  ["twelve in the afternoon", 12],
  ["two in afternoon", 14],
])("assembles a clock period identified by the model: %s", (text, hour) => {
  const labels = tokenize(text)
    .filter((token) => token.kind !== 3)
    .map((_, index): Label => (index === 0 ? "HOUR" : "MERIDIEM"));
  expect(compile(text, oracle(text, labels))[0].schedule).toEqual({
    clauses: [{ time: { start: { hour, minute: 0 } } }],
  });
});

it("ignores model-labeled filler inside semantic values while retaining source spans", () => {
  const text = "twelve in the afternoon";
  const tokens = oracle(text, ["HOUR", "MERIDIEM", "GLUE", "MERIDIEM"]);
  tokens.find((token) => token.text === "the")!.score = 0.01;
  const result = compile(text, tokens)[0];
  expect(result.schedule).toEqual({
    clauses: [{ time: { start: { hour: 12, minute: 0 } } }],
  });
  expect(result.text).toBe(text);
  expect(result.start).toBe(0);
  expect(result.end).toBe(text.length);
  expect(result.confidence).toBe(1);
  expect(tokens.find((token) => token.text === "the")?.label).toBe("GLUE");
});

it("assembles a learned relative quantity range and rejects reversed bounds", () => {
  const labels: Label[] = ["DIR_AFTER", "NUM", "RANGE_END", "NUM", "UNIT"];
  const text = "in 5 to 10 minutes";
  expect(compile(text, oracle(text, labels))[0].schedule).toEqual({
    clauses: [
      {
        shift: { amount: 5, endAmount: 10, unit: "minute", direction: "after" },
      },
    ],
  });
  const reversed = "in 10 to 5 minutes";
  expect(compile(reversed, oracle(reversed, labels))[0].schedule).toBeNull();
});

it("distributes each time window to its adjacent weekday list without connectors", () => {
  const text = "Sat Sun 1pm-8pm Mon 10pm-12am";
  const tokens = oracle(
    text,
    [
      "WEEKDAY",
      "WEEKDAY",
      "HOUR",
      "MERIDIEM",
      "RANGE_END",
      "HOUR",
      "MERIDIEM",
      "WEEKDAY",
      "HOUR",
      "MERIDIEM",
      "RANGE_END",
      "HOUR",
      "MERIDIEM",
    ],
    [text.indexOf("Mon")],
  );
  expect(compile(text, tokens)[0]).toMatchObject({
    start: 0,
    end: text.length,
    text,
    schedule: {
      clauses: [
        {
          date: { kind: "weekday", days: ["SA", "SU"] },
          time: {
            start: { hour: 13, minute: 0 },
            end: { hour: 20, minute: 0 },
          },
        },
        {
          date: { kind: "weekday", days: ["MO"] },
          time: { start: { hour: 22, minute: 0 }, end: { hour: 0, minute: 0 } },
        },
      ],
    },
    diagnostics: [],
  });
});
it("preserves explicit recurrence, intervals, bounds, and excluded weekdays", () => {
  const text = "every other Tuesday until Dec except Friday";
  const tokens = oracle(text, [
    "RECUR",
    "NUM",
    "WEEKDAY",
    "BOUND_END",
    "MONTH",
    "EXCEPT",
    "WEEKDAY",
  ]);
  expect(compile(text, tokens)[0].schedule).toEqual({
    clauses: [
      {
        recurrence: {
          freq: "weekly",
          interval: 2,
          byDay: ["TU"],
          until: { kind: "calendar", month: 12 },
          except: [{ kind: "weekday", days: ["FR"] }],
        },
      },
    ],
  });
});
it("retains a relative amount and its named anchor instead of resolving now", () => {
  const text = "two hours before tomorrow at noon";
  expect(
    compile(
      text,
      oracle(text, ["NUM", "UNIT", "DIR_BEFORE", "REL_DAY", "O", "TIME_NAMED"]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "relativeDay", offset: 1 },
        time: { start: { named: "noon" } },
        shift: { amount: 2, unit: "hour", direction: "before" },
      },
    ],
  });
});

it("rejects unknown values even when the model assigns a confident temporal label", () => {
  for (const label of ["REL_DAY", "TIME_NAMED", "DAYPART"] as const) {
    const text = "constructor";
    expect(compile(text, oracle(text, [label]))[0].schedule).toBeNull();
  }

  const invalidMinute = "2:banana";
  expect(
    compile(invalidMinute, oracle(invalidMinute, ["HOUR", "O", "MINUTE"]))[0]
      .schedule,
  ).toBeNull();
});

it("returns diagnostics when the model predicts a bound without an attached date", () => {
  for (const [text, labels] of [
    ["every Monday until", ["RECUR", "WEEKDAY", "BOUND_END"]],
    ["starting", ["BOUND_START"]],
  ] satisfies [string, Label[]][]) {
    const result = compile(text, oracle(text, labels))[0];
    expect(result.schedule).toBeNull();
    expect(result.diagnostics[0].code).toBe("invalid-bound");
  }
});

it("does not silently complete an unfinished range or recurrence", () => {
  const range = "Monday 5pm to";
  expect(
    compile(
      range,
      oracle(range, ["WEEKDAY", "HOUR", "MERIDIEM", "RANGE_END"]),
    )[0].diagnostics[0].code,
  ).toBe("incomplete-range");
  const recurrence = "every";
  expect(
    compile(recurrence, oracle(recurrence, ["RECUR"]))[0].diagnostics[0].code,
  ).toBe("incomplete-recurrence");
});

it("does not invent a time window when the model omitted its relationship", () => {
  const text = "Monday 9 Tuesday 10";
  const result = compile(
    text,
    oracle(text, ["WEEKDAY", "HOUR", "WEEKDAY", "HOUR"]),
  )[0];
  expect(result.schedule).toBeNull();
  expect(result.diagnostics[0].code).toBe("unlinked-times");
});

it("infers the missing period across noon and midnight without changing explicit periods", () => {
  for (const [text, labels, start, end] of [
    ["9am to 5", ["HOUR", "MERIDIEM", "RANGE_END", "HOUR"], 9, 17],
    ["10 to 2am", ["HOUR", "RANGE_END", "HOUR", "MERIDIEM"], 22, 2],
    ["8 to midnight", ["HOUR", "RANGE_END", "TIME_NAMED"], 20, undefined],
    [
      "10pm to 12pm",
      ["HOUR", "MERIDIEM", "RANGE_END", "HOUR", "MERIDIEM"],
      22,
      12,
    ],
  ] satisfies [string, Label[], number, number | undefined][]) {
    const time = compile(text, oracle(text, labels))[0].schedule?.clauses[0]
      .time;
    expect(time?.start, text).toEqual({ hour: start, minute: 0 });
    expect(time?.end, text).toEqual(
      end === undefined ? { named: "midnight" } : { hour: end, minute: 0 },
    );
  }
  const equal = "9:00:00 to 9am";
  expect(
    compile(
      equal,
      oracle(equal, [
        "HOUR",
        "GLUE",
        "MINUTE",
        "GLUE",
        "SECOND",
        "RANGE_END",
        "HOUR",
        "MERIDIEM",
      ]),
    )[0].schedule,
  ).toBeNull();
});

it("handles malformed model roles and boundaries without throwing or emitting invalid diagnostic offsets", () => {
  const text = "Monday 5 at noon every 3 days until tomorrow";
  let state = 123456;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let trial = 0; trial < 1000; trial++) {
    const tokens = tokenize(text).map((token): Token => ({
      ...token,
      label: token.kind === 3 ? "O" : LABELS[random() % LABELS.length],
      clauseStart: random() % 5 === 0,
      score: 0.9,
    }));
    const expressions = compile(text, tokens);
    for (const expression of expressions) {
      for (const diagnostic of expression.diagnostics) {
        expect(diagnostic.start).toBeGreaterThanOrEqual(0);
        expect(diagnostic.end).toBeGreaterThanOrEqual(diagnostic.start);
        expect(diagnostic.end).toBeLessThanOrEqual(text.length);
      }
    }
  }
});

it("applies numeric date order only to ambiguous date fields identified by the model", () => {
  const text = "3/4/2026";
  const tokens = oracle(text, ["MONTH", "GLUE", "DOM", "GLUE", "YEAR"]);
  expect(compile(text, tokens, { dateOrder: "DMY" })[0].schedule).toEqual({
    clauses: [{ date: { kind: "calendar", day: 3, month: 4, year: 2026 } }],
  });
  expect(compile(text, tokens, { dateOrder: "MDY" })[0].schedule).toEqual({
    clauses: [{ date: { kind: "calendar", month: 3, day: 4, year: 2026 } }],
  });
  expect(
    tokens.filter((token) => token.kind !== 3).map((token) => token.label),
  ).toEqual(["MONTH", "GLUE", "DOM", "GLUE", "YEAR"]);

  for (const [source, labels, expected] of [
    [
      "2026-3-4",
      ["YEAR", "GLUE", "MONTH", "GLUE", "DOM"],
      { year: 2026, month: 3, day: 4 },
    ],
    ["March 4", ["MONTH", "DOM"], { month: 3, day: 4 }],
    ["23/4", ["DOM", "GLUE", "MONTH"], { month: 4, day: 23 }],
  ] satisfies [string, Label[], object][]) {
    expect(
      compile(source, oracle(source, labels), { dateOrder: "DMY" })[0].schedule,
    ).toEqual({ clauses: [{ date: { kind: "calendar", ...expected } }] });
  }
});

it("assembles the uncovered core forms from explicit semantic labels", () => {
  const examples: [string, Label[], object][] = [
    [
      "the day after tomorrow",
      ["REL_DAY", "REL_DAY", "REL_DAY", "REL_DAY"],
      { date: { kind: "relativeDay", offset: 2 } },
    ],
    [
      "end of next month",
      ["EDGE", "GLUE", "DEICTIC", "UNIT"],
      {
        date: {
          kind: "relativeUnit",
          unit: "month",
          modifier: "next",
          edge: "end",
        },
      },
    ],
    [
      "3 weeks from now",
      ["NUM", "UNIT", "DIR_AFTER", "NOW"],
      {
        date: { kind: "now" },
        shift: { amount: 3, unit: "week", direction: "after" },
      },
    ],
    [
      "a week before Christmas",
      ["NUM", "UNIT", "DIR_BEFORE", "HOLIDAY"],
      {
        date: { kind: "holiday", name: "christmas" },
        shift: { amount: 1, unit: "week", direction: "before" },
      },
    ],
    [
      "this weekend",
      ["DEICTIC", "DAYGROUP"],
      { date: { kind: "dayGroup", group: "weekend", modifier: "this" } },
    ],
    [
      "every day through Friday",
      ["RECUR", "UNIT", "BOUND_END", "WEEKDAY"],
      {
        recurrence: {
          freq: "daily",
          interval: 1,
          until: { kind: "weekday", days: ["FR"] },
        },
      },
    ],
  ];
  for (const [text, labels, clause] of examples)
    expect(compile(text, oracle(text, labels))[0].schedule, text).toEqual({
      clauses: [clause],
    });
});

it("composes model-labeled spoken minutes and fractional clocks", () => {
  const examples: [string, Label[], number, number][] = [
    ["eight forty", ["HOUR", "MINUTE"], 8, 40],
    [
      "ten thirty-five pm",
      ["HOUR", "MINUTE", "MINUTE", "MINUTE", "MERIDIEM"],
      22,
      35,
    ],
    [
      "quarter to twelve am",
      ["CLOCK_OFFSET", "GLUE", "HOUR", "MERIDIEM"],
      23,
      45,
    ],
  ];
  for (const [text, labels, hour, minute] of examples)
    expect(compile(text, oracle(text, labels))[0].schedule).toEqual({
      clauses: [{ time: { start: { hour, minute } } }],
    });
});

it("keeps a combined shift distinct from an occurrence duration", () => {
  const text = "in two days and six hours for half an hour";
  const result = compile(
    text,
    oracle(text, [
      "DIR_AFTER",
      "NUM",
      "UNIT",
      "GLUE",
      "NUM",
      "UNIT",
      "DUR",
      "NUM",
      "NUM",
      "UNIT",
    ]),
  );
  expect(result[0].schedule).toEqual({
    clauses: [
      {
        shift: {
          amount: 2,
          unit: "day",
          direction: "after",
          components: [{ amount: 6, unit: "hour" }],
        },
        duration: { amount: 0.5, unit: "hour" },
      },
    ],
  });
});

it("does not invent fractional calendar durations", () => {
  const text = "for 1.5 months";
  expect(
    compile(text, oracle(text, ["DUR", "NUM", "NUM", "NUM", "UNIT"]))[0]
      .schedule,
  ).toBeNull();
});

it("validates ISO date order independently of the model's month/day roles", () => {
  const text = "2026-13-01";
  const result = compile(
    text,
    oracle(text, ["YEAR", "GLUE", "DOM", "GLUE", "MONTH"]),
  )[0];
  expect(result.schedule).toBeNull();
  expect(
    result.diagnostics.some((value) => value.code === "invalid-date"),
  ).toBe(true);
});

it("reports a missing recurrence bound when until is recognized as a range separator", () => {
  const text = "every Monday until";
  const result = compile(
    text,
    oracle(text, ["RECUR", "WEEKDAY", "RANGE_END"]),
  )[0];
  expect(result.schedule).toBeNull();
  expect(
    result.diagnostics.some((value) => value.code === "invalid-bound"),
  ).toBe(true);
});

it("reads an open upper bound from a bare direction token", () => {
  const text = "after 6pm";
  expect(
    compile(text, oracle(text, ["DIR_AFTER", "HOUR", "MERIDIEM"]))[0].schedule,
  ).toEqual({
    clauses: [{ time: { start: { hour: 18, minute: 0 }, open: "end" } }],
  });
});

it("floors an open lower bound at midnight", () => {
  const text = "before 6pm";
  expect(
    compile(text, oracle(text, ["DIR_BEFORE", "HOUR", "MERIDIEM"]))[0].schedule,
  ).toEqual({
    clauses: [
      {
        time: {
          start: { hour: 0, minute: 0 },
          end: { hour: 18, minute: 0 },
          open: "start",
        },
      },
    ],
  });
});

it("rejects an open bound with no clock instead of dropping the direction", () => {
  const text = "after Friday";
  const result = compile(text, oracle(text, ["DIR_AFTER", "WEEKDAY"]))[0];
  expect(result.schedule).toBeNull();
  expect(result.diagnostics.map((value) => value.code)).toContain(
    "open-bound-needs-time",
  );
});

it("rejects an open bound applied to a range", () => {
  const text = "after 8 to 10pm";
  const result = compile(
    text,
    oracle(text, ["DIR_AFTER", "HOUR", "RANGE_END", "HOUR", "MERIDIEM"]),
  )[0];
  expect(result.schedule).toBeNull();
  expect(result.diagnostics.map((value) => value.code)).toContain(
    "open-bound-needs-time",
  );
});

it("marks a bare range start as open rather than returning a bare instant", () => {
  const open = "from 6pm";
  expect(
    compile(open, oracle(open, ["RANGE_START", "HOUR", "MERIDIEM"]))[0]
      .schedule,
  ).toEqual({
    clauses: [{ time: { start: { hour: 18, minute: 0 }, open: "end" } }],
  });

  const closed = "from 8 to 10pm";
  expect(
    compile(
      closed,
      oracle(closed, ["RANGE_START", "HOUR", "RANGE_END", "HOUR", "MERIDIEM"]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      { time: { start: { hour: 20, minute: 0 }, end: { hour: 22, minute: 0 } } },
    ],
  });
});
