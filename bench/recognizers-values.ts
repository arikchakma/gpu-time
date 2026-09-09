import type { Occurrence } from "../src/types.js";

export interface Expected {
  start: string;
  end?: string;
  precision: "date" | "datetime" | "time";
}

export function normalize(value?: Record<string, string>): Expected | null {
  if (!value) return null;
  if (value.time || value.startTime) {
    const start = value.time ?? value.startTime;
    const end = value.endTime;
    const valid = (clock: string) =>
      /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(clock);
    if (!valid(start) || (end !== undefined && !valid(end))) return null;
    return { start, ...(end === undefined ? {} : { end }), precision: "time" };
  }
  const start =
    value.dateTime ?? value.date ?? value.startDateTime ?? value.startDate;
  const end = value.endDateTime ?? value.endDate;
  const valid = (date: string) =>
    /^\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d:\d\d)?$/.test(date);
  if (!start || !valid(start) || (end !== undefined && !valid(end)))
    return null;
  const iso = (date: string) => {
    const text = date.replace(" ", "T");
    return (text.includes("T") ? text : text + "T00:00:00") + "Z";
  };
  return {
    start: iso(start),
    ...(end === undefined ? {} : { end: iso(end) }),
    precision: value.date || value.startDate ? "date" : "datetime",
  };
}

function matchesValue(
  actual: string,
  expected: string,
  precision: Expected["precision"],
) {
  const iso = new Date(actual).toISOString();
  if (precision === "date") return iso.slice(0, 10) === expected.slice(0, 10);
  if (precision === "time") return iso.slice(11, 19) === expected;
  return Date.parse(actual) === Date.parse(expected);
}

export function matches(
  actual: Pick<Occurrence, "start" | "end">,
  expected: Expected,
) {
  if (!matchesValue(actual.start, expected.start, expected.precision))
    return false;
  if (expected.end === undefined) return actual.end === undefined;
  if (
    !actual.end ||
    !matchesValue(actual.end, expected.end, expected.precision)
  )
    return false;
  if (expected.precision !== "time") return true;
  // Time-only sources specify no date. Compare their clock values and overnight
  // duration, so an accidental extra day cannot pass by matching the clocks.
  const epoch = (clock: string) => Date.parse(`2000-01-01T${clock}Z`);
  const difference = epoch(expected.end) - epoch(expected.start);
  const duration = difference < 0 ? difference + 86_400_000 : difference;
  return Date.parse(actual.end) - Date.parse(actual.start) === duration;
}
