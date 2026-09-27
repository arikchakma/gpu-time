import { describe, expect, it } from "vitest";
import { defineParser, detectLanguage, en } from "../src/index.ts";
import es from "../src/languages/es.ts";
import type { Language } from "../src/languages/language.ts";
import { weights } from "../src/model/weights.gen.ts";
import { shaderShape } from "../src/model/shader-source.ts";
import { compile } from "../src/compile.ts";
import { tokenize } from "../src/tokenizer.ts";

const context = { reference: "2026-09-16T12:00:00Z", timeZone: "UTC" };
// A stand-in pack: only the code differs, so any routing error shows up as a
// wrong result rather than a crash.
const clone: Language = { ...en, code: "xx" };

describe("language selection", () => {
  it("defaults to the first loaded language", async () => {
    const parser = await defineParser({ languages: [en, clone] });
    const result = await parser.parse("next Monday at 9am", context);
    expect(result.occurrences).toHaveLength(1);
  });

  it("routes an explicit code to its pack", async () => {
    const parser = await defineParser({ languages: [en, clone] });
    const result = await parser.parse("next Monday at 9am", {
      ...context,
      language: "xx",
    });
    expect(result.occurrences).toHaveLength(1);
  });

  it("rejects a language that is not loaded instead of guessing", async () => {
    const parser = await defineParser({ languages: [en] });
    await expect(
      parser.parse("next Monday", { ...context, language: "es" }),
    ).rejects.toThrow(/not loaded/);
  });

  it("keeps English as the default with no languages option", async () => {
    const parser = await defineParser();
    const result = await parser.parse("every Tuesday", context);
    expect(result.rrules[0]).toContain("FREQ=WEEKLY");
  });
});

describe("automatic language selection", () => {
  it("picks the pack whose vocabulary fits, with no language passed", async () => {
    const cases: [string, string][] = [
      ["el lunes que viene a las 9", "es"],
      ["cada dos semanas los martes", "es"],
      ["el último viernes de cada mes", "es"],
      ["mañana por la tarde", "es"],
      ["every other Friday at noon", "en"],
      ["book dinner for October 2 at eight pm", "en"],
      ["the last Friday of each month", "en"],
      ["in 20 minutes for half an hour", "en"],
    ];
    for (const [text, code] of cases)
      expect([text, detectLanguage(text, [en, es])?.code]).toEqual([
        text,
        code,
      ]);
  });

  it("stays undecided when the text fits both equally", () => {
    // A bare numeric date reads the same in either language; the caller's
    // first entry wins rather than a coin flip.
    expect(detectLanguage("25/12/2026", [en, es])).toBeUndefined();
  });

  it("never spends a decision when one language is loaded", () => {
    expect(detectLanguage("cualquier cosa", [en])).toBe(en);
  });
});

describe("numeric date order", () => {
  it("reads a bare numeric date the way the pack declares", async () => {
    const parser = await defineParser({ languages: [en, es] });
    const spanish = await parser.parse("9/2/2016", {
      ...context,
      language: "es",
    });
    const english = await parser.parse("9/2/2016", {
      ...context,
      language: "en",
    });
    expect(spanish.occurrences[0].start.slice(0, 10)).toBe("2016-02-09");
    expect(english.occurrences[0].start.slice(0, 10)).toBe("2016-09-02");
  });
});

describe("modifier after the unit", () => {
  const read = (text: string, labels: string[]) => {
    let next = 0;
    const tokens = tokenize(text).map((token) => ({
      ...token,
      label: token.kind === 3 ? "O" : (labels[next++] ?? "O"),
      clauseStart: false,
      score: 1,
    }));
    return compile(text, tokens as never, { language: es })[0]?.schedule;
  };

  it("reads the Spanish order, where the modifier follows the noun", () => {
    expect(read("el mes pasado", ["O", "UNIT", "DEICTIC"])).toEqual({
      clauses: [
        { date: { kind: "relativeUnit", unit: "month", modifier: "last" } },
      ],
    });
    expect(
      read("la semana que viene", ["O", "UNIT", "DEICTIC", "DEICTIC"]),
    ).toEqual({
      clauses: [
        { date: { kind: "relativeUnit", unit: "week", modifier: "next" } },
      ],
    });
  });

  it("reads a modifier after a day group", () => {
    expect(
      read("el fin de semana próximo", [
        "O",
        "DAYGROUP",
        "DAYGROUP",
        "DAYGROUP",
        "DEICTIC",
      ]),
    ).toEqual({
      clauses: [
        { date: { kind: "dayGroup", group: "weekend", modifier: "next" } },
      ],
    });
  });

  it("repeats a weekday that the article or the noun makes plural", () => {
    const weekly = (day: string) => ({
      clauses: [{ recurrence: { freq: "weekly", interval: 1, byDay: [day] } }],
    });
    expect(read("los lunes", ["GLUE", "WEEKDAY"])).toEqual(weekly("MO"));
    expect(
      read("tengo clase los lunes", ["O", "O", "GLUE", "WEEKDAY"]),
    ).toEqual(weekly("MO"));
    expect(read("los sábados", ["GLUE", "WEEKDAY"])).toEqual(weekly("SA"));
    expect(read("el lunes", ["GLUE", "WEEKDAY"])).toEqual({
      clauses: [{ date: { kind: "weekday", days: ["MO"] } }],
    });
  });

  it("keeps a recurrence when hasta in later prose bounds nothing", () => {
    expect(
      read("todos los días excepto Navidad no podemos salir hasta que llegue", [
        "RECUR",
        "RECUR",
        "UNIT",
        "EXCEPT",
        "HOLIDAY",
      ]),
    ).toEqual({
      clauses: [
        {
          recurrence: {
            freq: "daily",
            interval: 1,
            except: [{ kind: "holiday", name: "christmas" }],
          },
        },
      ],
    });
  });

  it("reads the small hours de la noche and de la madrugada as morning", () => {
    const hour = (text: string, labels: string[]) =>
      (
        read(text, labels) as {
          clauses: { time: { start: { hour: number } } }[];
        }
      ).clauses[0].time.start.hour;
    const night = ["GLUE", "GLUE", "HOUR", "MERIDIEM", "MERIDIEM", "MERIDIEM"];
    expect(hour("a las dos de la noche", night)).toBe(2);
    expect(hour("a las once de la noche", night)).toBe(23);
    expect(hour("a las seis de la noche", night)).toBe(18);
    expect(hour("a las cinco de la madrugada", night)).toBe(5);
  });

  it("reads justo ahora as now", () => {
    expect(read("justo ahora", ["NOW", "NOW"])).toEqual({
      clauses: [{ date: { kind: "now" } }],
    });
  });

  it("reads spoken minutes after y and menos", () => {
    const clock = (hour: number, minute: number) => ({
      clauses: [{ time: { start: { hour, minute } } }],
    });
    const spoken = ["GLUE", "GLUE", "HOUR", "GLUE", "CLOCK_OFFSET"];
    expect(read("a las diez y veinte", spoken)).toEqual(clock(10, 20));
    expect(read("a las ocho menos diez", spoken)).toEqual(clock(7, 50));
    expect(
      read("a las diez y veintiocho de la noche", [
        ...spoken,
        "MERIDIEM",
        "MERIDIEM",
        "MERIDIEM",
      ]),
    ).toEqual(clock(22, 28));
    expect(
      read("a las seis y treinta y cinco", [...spoken, "GLUE", "CLOCK_OFFSET"]),
    ).toEqual(clock(6, 35));
  });

  it("reads último, media hora, spoken years and counted weekdays", () => {
    expect(read("la última semana", ["O", "DEICTIC", "UNIT"])).toEqual({
      clauses: [
        { date: { kind: "relativeUnit", unit: "week", modifier: "last" } },
      ],
    });
    expect(read("en media hora", ["DIR_AFTER", "NUM", "UNIT"])).toEqual({
      clauses: [{ shift: { amount: 0.5, unit: "hour", direction: "after" } }],
    });
    expect(
      read("en mil novecientos noventa y cinco", [
        "O",
        "YEAR",
        "YEAR",
        "YEAR",
        "YEAR",
        "YEAR",
      ]),
    ).toEqual({ clauses: [{ date: { kind: "calendar", year: 1995 } }] });
    expect(
      read("los próximos tres domingos", ["GLUE", "DEICTIC", "NUM", "WEEKDAY"]),
    ).toEqual({
      clauses: [
        {
          recurrence: { freq: "weekly", interval: 1, count: 3, byDay: ["SU"] },
        },
      ],
    });
    expect(read("cada cinco minutos", ["RECUR", "NUM", "UNIT"])).toEqual({
      clauses: [{ recurrence: { freq: "minutely", interval: 5 } }],
    });
    expect(read("en pascua", ["O", "HOLIDAY"])).toEqual({
      clauses: [{ date: { kind: "holiday", name: "easter" } }],
    });
  });

  it("reads a counted weekday, a last day, a holiday year and seconds", () => {
    expect(
      read("tres domingos a las diez", [
        "NUM",
        "WEEKDAY",
        "GLUE",
        "GLUE",
        "HOUR",
      ]),
    ).toEqual({
      clauses: [
        {
          time: { start: { hour: 10, minute: 0 } },
          recurrence: { freq: "weekly", interval: 1, count: 3, byDay: ["SU"] },
        },
      ],
    });
    expect(read("cada tres domingos", ["RECUR", "NUM", "WEEKDAY"])).toEqual({
      clauses: [{ recurrence: { freq: "weekly", interval: 3, byDay: ["SU"] } }],
    });
    expect(
      read("el último día del mes", ["O", "EDGE", "O", "GLUE", "UNIT"]),
    ).toEqual({
      clauses: [
        {
          date: {
            kind: "relativeUnit",
            unit: "month",
            modifier: "this",
            edge: "end",
          },
        },
      ],
    });
    expect(
      read("pascua de dos mil dieciocho", [
        "HOLIDAY",
        "GLUE",
        "YEAR",
        "YEAR",
        "YEAR",
      ]),
    ).toEqual({
      clauses: [{ date: { kind: "holiday", name: "easter", year: 2018 } }],
    });
    expect(read("cada 30 segundos", ["RECUR", "NUM", "UNIT"])).toEqual({
      clauses: [{ recurrence: { freq: "secondly", interval: 30 } }],
    });
  });

  it("splits a three-digit compact clock", () => {
    expect(read("a las 630am", ["GLUE", "GLUE", "HOUR", "MERIDIEM"])).toEqual({
      clauses: [{ time: { start: { hour: 6, minute: 30 } } }],
    });
  });

  it("joins a spoken day of the month across y", () => {
    expect(
      read("el treinta y uno de diciembre", [
        "O",
        "DOM",
        "DOM",
        "DOM",
        "GLUE",
        "MONTH",
      ]),
    ).toEqual({
      clauses: [{ date: { kind: "calendar", day: 31, month: 12 } }],
    });
  });

  it("repeats a plural day part every day", () => {
    expect(read("por las mañanas", ["O", "O", "DAYPART"])).toEqual({
      clauses: [
        {
          time: { start: { part: "morning" } },
          recurrence: { freq: "daily", interval: 1 },
        },
      ],
    });
  });

  it("keeps a plural edge in front", () => {
    expect(
      read("a principios del año pasado", [
        "O",
        "EDGE",
        "O",
        "UNIT",
        "DEICTIC",
      ]),
    ).toEqual({
      clauses: [
        {
          date: {
            kind: "relativeUnit",
            unit: "year",
            modifier: "last",
            edge: "start",
          },
        },
      ],
    });
  });
});

describe("pack models", () => {
  it("gives Spanish its own weight set and English the bundled one", () => {
    expect(es.model).toBeDefined();
    expect(es.model).not.toBe(weights);
    expect(en.model).toBeUndefined();
  });

  it("keeps Spanish on the shapes the packaged shader is built from", () => {
    expect(shaderShape(es.model!)).toBe(shaderShape(weights));
  });

  it("runs each pack against its own model in one parser", async () => {
    const parser = await defineParser({ languages: [en, es] });
    const spanish = await parser.parse("el lunes que viene a las 9", context);
    const english = await parser.parse("next Monday at 9am", context);
    expect(spanish.occurrences[0].start).toBe(english.occurrences[0].start);
    expect(spanish.spans[0].text).toBe("lunes que viene a las 9");
    expect(english.spans[0].text).toBe("next Monday at 9am");
  });
});
