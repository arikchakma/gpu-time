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

it("keeps an explicit duration before its clock anchor", () => {
  const text = "May 6 for two hours from 10am";
  expect(
    compile(
      text,
      oracle(text, [
        "MONTH",
        "DOM",
        "DUR",
        "NUM",
        "UNIT",
        "RANGE_START",
        "HOUR",
        "MERIDIEM",
      ]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "calendar", month: 5, day: 6 },
        time: { start: { hour: 10, minute: 0 } },
        duration: { amount: 2, unit: "hour" },
      },
    ],
  });
  const shifted = "two hours from 10am";
  expect(
    compile(
      shifted,
      oracle(shifted, ["NUM", "UNIT", "RANGE_START", "HOUR", "MERIDIEM"]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        time: { start: { hour: 10, minute: 0 } },
        shift: { amount: 2, unit: "hour", direction: "after" },
      },
    ],
  });
});

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

it("uses a daypart to disambiguate a clock on the named day", () => {
  const text = "this afternoon at 3";
  expect(
    compile(text, oracle(text, ["O", "DAYPART", "O", "HOUR"]))[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "relativeDay", offset: 0 },
        time: { start: { hour: 15, minute: 0 } },
      },
    ],
  });
});

it("deduplicates a repeated daypart but rejects conflicting dayparts", () => {
  const repeated = "Friday evening is music evening";
  expect(
    compile(
      repeated,
      oracle(repeated, ["WEEKDAY", "DAYPART", "O", "O", "DAYPART"]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "weekday", days: ["FR"] },
        time: { start: { part: "evening" } },
      },
    ],
  });

  const conflicting = "Friday morning is music evening";
  const result = compile(
    conflicting,
    oracle(conflicting, ["WEEKDAY", "DAYPART", "O", "O", "DAYPART"]),
  )[0];
  expect(result.schedule).toBeNull();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "conflicting-daypart",
  );
});

it("compiles last weekday of the month", () => {
  const text = "last Friday of the month at 4pm";
  expect(
    compile(
      text,
      oracle(text, [
        "ORD",
        "WEEKDAY",
        "GLUE",
        "GLUE",
        "UNIT",
        "O",
        "HOUR",
        "MERIDIEM",
      ]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        recurrence: {
          freq: "monthly",
          interval: 1,
          byDay: ["FR"],
          bySetPos: [-1],
        },
        time: { start: { hour: 16, minute: 0 } },
      },
    ],
  });
});

it("keeps last weekday without a month selector as a past weekday", () => {
  const text = "last Friday at 4pm";
  expect(
    compile(
      text,
      oracle(text, ["DEICTIC", "WEEKDAY", "O", "HOUR", "MERIDIEM"]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "weekday", days: ["FR"], modifier: "last" },
        time: { start: { hour: 16, minute: 0 } },
      },
    ],
  });
});

it("keeps recurrence bound normalization inside its clause", () => {
  const text = "every Friday July 8 until 10";
  expect(
    compile(
      text,
      oracle(
        text,
        ["RECUR", "WEEKDAY", "MONTH", "DOM", "RANGE_END", "DOM"],
        [text.indexOf("July")],
      ),
    )[0].schedule,
  ).toEqual({
    clauses: [
      { recurrence: { freq: "weekly", interval: 1, byDay: ["FR"] } },
      {
        date: {
          kind: "calendarRange",
          from: { month: 7, day: 8 },
          to: { month: 7, day: 10 },
        },
      },
    ],
  });
});

it("recognizes a date bound after a frequency word", () => {
  const text = "weekly until March";
  expect(
    compile(text, oracle(text, ["FREQ", "RANGE_END", "MONTH"]))[0].schedule,
  ).toEqual({
    clauses: [
      {
        recurrence: {
          freq: "weekly",
          interval: 1,
          until: { kind: "calendar", month: 3 },
        },
      },
    ],
  });
});

it.each(["O", "GLUE"] as Label[])(
  "does not drop an incomplete until bound labelled %s",
  (label) => {
    const text = "every Thursday until";
    const expression = compile(
      text,
      oracle(text, ["RECUR", "WEEKDAY", label]),
    )[0];
    expect(expression.schedule).toBeNull();
    expect(expression.diagnostics.map((value) => value.code)).toContain(
      "invalid-bound",
    );
  },
);

it("treats until plus a date as a recurrence bound when mislabelled as a range", () => {
  const text = "Every Thursday until JANUARY";
  expect(
    compile(text, oracle(text, ["RECUR", "WEEKDAY", "RANGE_END", "MONTH"]))[0]
      .schedule,
  ).toEqual({
    clauses: [
      {
        recurrence: {
          freq: "weekly",
          interval: 1,
          byDay: ["TH"],
          until: { kind: "calendar", month: 1 },
        },
      },
    ],
  });
});

it("keeps until between clocks as a recurring clock window", () => {
  const text = "every Thursday 9 until 5pm";
  expect(
    compile(
      text,
      oracle(text, [
        "RECUR",
        "WEEKDAY",
        "HOUR",
        "RANGE_END",
        "HOUR",
        "MERIDIEM",
      ]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        recurrence: {
          freq: "weekly",
          interval: 1,
          byDay: ["TH"],
        },
        time: {
          start: { hour: 9, minute: 0 },
          end: { hour: 17, minute: 0 },
        },
      },
    ],
  });
});

it("uses tonight to disambiguate an attached clock", () => {
  const text = "The maintenance starts tonight at 11.";
  expect(
    compile(text, oracle(text, ["O", "O", "O", "REL_DAY", "O", "HOUR", "O"]))[0]
      .schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "relativeDay", offset: 0 },
        time: { start: { hour: 23, minute: 0 } },
      },
    ],
  });
});

it("compiles a date range followed by a clock window as daily windows", () => {
  const text = "November 3–5 from 9am to 11am";
  expect(
    compile(
      text,
      oracle(text, [
        "MONTH",
        "DOM",
        "RANGE_END",
        "DOM",
        "RANGE_START",
        "HOUR",
        "MERIDIEM",
        "RANGE_END",
        "HOUR",
        "MERIDIEM",
      ]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        recurrence: {
          freq: "daily",
          interval: 1,
          start: {
            kind: "calendarRange",
            from: { month: 11, day: 3 },
            to: { month: 11, day: 5 },
          },
          until: { kind: "calendar", month: 11, day: 5 },
        },
        time: {
          start: { hour: 9, minute: 0 },
          end: { hour: 11, minute: 0 },
        },
      },
    ],
  });
});

it("compiles same-time relative periods as shifts from now", () => {
  const explicit = "8 pm exactly next year on same time";
  expect(
    compile(
      explicit,
      oracle(explicit, [
        "HOUR",
        "MERIDIEM",
        "O",
        "DEICTIC",
        "UNIT",
        "O",
        "O",
        "O",
      ]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "now" },
        time: { start: { hour: 20, minute: 0 } },
        shift: { amount: 1, unit: "year", direction: "after" },
      },
    ],
  });

  const qualified = "next year at 8 pm";
  expect(
    compile(
      qualified,
      oracle(qualified, ["DEICTIC", "UNIT", "O", "HOUR", "MERIDIEM"]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "relativeUnit", unit: "year", modifier: "next" },
        time: { start: { hour: 20, minute: 0 } },
      },
    ],
  });

  const period = "next year";
  expect(
    compile(period, oracle(period, ["DEICTIC", "UNIT"]))[0].schedule,
  ).toEqual({
    clauses: [
      { date: { kind: "relativeUnit", unit: "year", modifier: "next" } },
    ],
  });

  const implied = "this time next year";
  expect(
    compile(implied, oracle(implied, ["O", "O", "DEICTIC", "UNIT"]))[0]
      .schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "now" },
        shift: { amount: 1, unit: "year", direction: "after" },
      },
    ],
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
      {
        time: { start: { hour: 20, minute: 0 }, end: { hour: 22, minute: 0 } },
      },
    ],
  });
});

it("keeps a short unknown aside inside one expression and reports it", () => {
  const text = "friday, say, around 3";
  const result = compile(
    text,
    oracle(text, ["WEEKDAY", "O", "O", "O", "O", "HOUR"]),
  );
  expect(result).toHaveLength(1);
  expect(result[0].schedule).toEqual({
    clauses: [
      {
        date: { kind: "weekday", days: ["FR"] },
        time: { start: { hour: 3, minute: 0 } },
      },
    ],
  });
  expect(result[0].diagnostics.map((value) => value.code)).toContain(
    "filler-ignored",
  );

  const long = "friday well anyway who knows 3";
  expect(
    compile(long, oracle(long, ["WEEKDAY", "O", "O", "O", "O", "HOUR"])),
  ).toHaveLength(2);
});

it("warns about a bare hour and minute the same way as a bare hour", () => {
  const text = "4:30";
  const result = compile(text, oracle(text, ["HOUR", "O", "MINUTE"]))[0];
  expect(result.schedule).toEqual({
    clauses: [{ time: { start: { hour: 4, minute: 30 } } }],
  });
  expect(result.diagnostics.map((value) => value.code)).toContain(
    "ambiguous-meridiem",
  );
});

it("repeats a plural day group but keeps a singular one as a single date", () => {
  const plural = "weekends";
  expect(compile(plural, oracle(plural, ["DAYGROUP"]))[0].schedule).toEqual({
    clauses: [
      { recurrence: { freq: "weekly", interval: 1, byDay: ["SA", "SU"] } },
    ],
  });
  const singular = "over the weekend";
  expect(
    compile(singular, oracle(singular, ["O", "O", "DAYGROUP"]))[0].schedule,
  ).toEqual({ clauses: [{ date: { kind: "dayGroup", group: "weekend" } }] });
  const every = "every weekend";
  expect(
    compile(every, oracle(every, ["RECUR", "DAYGROUP"]))[0].schedule,
  ).toEqual({
    clauses: [
      { recurrence: { freq: "weekly", interval: 1, byDay: ["SA", "SU"] } },
    ],
  });
});

it("reads a quantity before from as a shifted anchor, not a span", () => {
  const text = "a week from tuesday";
  expect(
    compile(text, oracle(text, ["NUM", "UNIT", "RANGE_START", "WEEKDAY"]))[0]
      .schedule,
  ).toEqual({
    clauses: [
      {
        date: { kind: "weekday", days: ["TU"] },
        shift: { amount: 1, unit: "week", direction: "after" },
      },
    ],
  });
});

it("keeps a clock stated inside a bound and anchors a modified day part", () => {
  const bounded = "every monday until friday at 5pm";
  expect(
    compile(
      bounded,
      oracle(bounded, [
        "RECUR",
        "WEEKDAY",
        "BOUND_END",
        "WEEKDAY",
        "O",
        "HOUR",
        "MERIDIEM",
      ]),
    )[0].schedule,
  ).toEqual({
    clauses: [
      {
        recurrence: {
          freq: "weekly",
          interval: 1,
          byDay: ["MO"],
          until: { kind: "weekday", days: ["FR"] },
        },
        time: { start: { hour: 17, minute: 0 } },
      },
    ],
  });

  const deictic = "this afternoon";
  const modified = compile(deictic, oracle(deictic, ["DEICTIC", "DAYPART"]))[0];
  expect(modified.schedule).toEqual({
    clauses: [
      {
        date: { kind: "relativeDay", offset: 0 },
        time: { start: { part: "afternoon" } },
      },
    ],
  });
  expect(modified.diagnostics).toEqual([]);
});

it("dates a day part from the modifier in front of it", () => {
  const cases: [string, number][] = [
    ["last night", -1],
    ["this morning", 0],
    ["next morning", 1],
  ];
  for (const [text, offset] of cases) {
    expect(
      compile(text, oracle(text, ["DEICTIC", "DAYPART"]))[0].schedule
        ?.clauses[0]?.date,
    ).toEqual({ kind: "relativeDay", offset });
  }

  // A weekday already consumed the modifier, so the day part must not reuse it.
  const weekday = "last monday night";
  expect(
    compile(weekday, oracle(weekday, ["DEICTIC", "WEEKDAY", "DAYPART"]))[0]
      .schedule?.clauses[0]?.date,
  ).toEqual({ kind: "weekday", days: ["MO"], modifier: "last" });
});

it("reads the widened unit, frequency, day-group, and clock spellings", () => {
  const examples: [string, Label[], object][] = [
    [
      "in a fortnight",
      ["DIR_AFTER", "NUM", "UNIT"],
      { shift: { amount: 2, unit: "week", direction: "after" } },
    ],
    ["quarterly", ["FREQ"], { recurrence: { freq: "monthly", interval: 3 } }],
    ["nightly", ["FREQ"], { recurrence: { freq: "daily", interval: 1 } }],
    [
      "every business day",
      ["RECUR", "DAYGROUP", "DAYGROUP"],
      {
        recurrence: {
          freq: "weekly",
          interval: 1,
          byDay: ["MO", "TU", "WE", "TH", "FR"],
        },
      },
    ],
    [
      "9.30pm",
      ["HOUR", "GLUE", "HOUR", "MERIDIEM"],
      { time: { start: { hour: 21, minute: 30 } } },
    ],
    [
      "for sixty five minutes",
      ["DUR", "NUM", "NUM", "UNIT"],
      { duration: { amount: 65, unit: "minute" } },
    ],
  ];
  for (const [text, labels, clause] of examples)
    expect(compile(text, oracle(text, labels))[0].schedule, text).toEqual({
      clauses: [clause],
    });
});

it("compiles seconds as a shift unit", () => {
  const text = "in 30 seconds";
  expect(
    compile(text, oracle(text, ["DIR_AFTER", "NUM", "UNIT"]))[0].schedule,
  ).toEqual({
    clauses: [{ shift: { amount: 30, unit: "second", direction: "after" } }],
  });
});
