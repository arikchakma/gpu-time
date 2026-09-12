import type { ParseContext } from "gpu-time";

export interface Window {
  /** A date means date-only precision; an ISO instant means exact time. */
  start: string;
  end?: string;
  allDay?: boolean;
  open?: "start" | "end";
}

export interface CompatibilityCase {
  id: string;
  family: string;
  text: string;
  context: ParseContext;
  comparison: "shared" | "policy";
  expected: Window[];
  dateOrder?: "MDY" | "DMY";
  chronoTimezone?: number;
  chronoForwardDate?: boolean;
  chronoExpected?: Window[];
  reason?: string;
}

const dateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function matches(
  actual: Window[],
  expected: Window[],
  timeZone: string,
  checkAllDay = false,
): boolean {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const endpoint = (value: string, target: string) => {
    if (!Number.isFinite(Date.parse(value))) return false;
    if (!dateOnly(target)) return Date.parse(value) === Date.parse(target);
    const parts = formatter.formatToParts(new Date(value));
    return (
      ["year", "month", "day"]
        .map((type) => parts.find((part) => part.type === type)?.value)
        .join("-") === target
    );
  };
  return (
    actual.length === expected.length &&
    actual.every((value, index) => {
      const target = expected[index];
      return (
        endpoint(value.start, target.start) &&
        Boolean(value.end) === Boolean(target.end) &&
        (!target.end || endpoint(value.end!, target.end)) &&
        (!checkAllDay ||
          (value.allDay === dateOnly(target.start) &&
            value.open === target.open))
      );
    })
  );
}
