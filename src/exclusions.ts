import type { DateSpec, Weekday } from "./types.js";
import type { ResolutionContext } from "./occurrence.js";
import { resolveDates } from "./calendar.js";
import { weekdays } from "./lexicon.js";
import { addDays, civil, dayNumber, dayOfWeek, type Civil } from "./zoned.js";

export function excludedWeekdays(spec: DateSpec): Weekday[] | undefined {
  if (spec.kind === "weekday" && !spec.modifier) return spec.days;
  if (spec.kind === "dayGroup" && !spec.modifier) {
    return spec.group === "weekend" ? weekdays.slice(5) : weekdays.slice(0, 5);
  }
  if (spec.kind === "weekdayRange") {
    const start = weekdays.indexOf(spec.from);
    const length = ((weekdays.indexOf(spec.to) - start + 7) % 7) + 1;
    return Array.from({ length }, (_, index) => weekdays[(start + index) % 7]);
  }
}

export function exclusionFilter(
  exceptions: DateSpec[],
  context: ResolutionContext,
): (date: Civil) => boolean {
  const reference = civil(context.reference, context.options.timeZone);
  const patterns = new Set<Weekday>();
  const periods: { start: number; end: number }[] = [];

  for (const exception of exceptions) {
    const days = excludedWeekdays(exception);
    if (days) {
      for (const day of days) patterns.add(day);
      continue;
    }

    for (const period of resolveDates(exception, reference, context.options)) {
      periods.push({
        start: dayNumber(period.start),
        end: dayNumber(period.end ?? addDays(period.start, 1)),
      });
    }
  }

  return (date) => {
    if (patterns.has(weekdays[dayOfWeek(date)])) return true;
    const day = dayNumber(date);
    return periods.some((period) => day >= period.start && day < period.end);
  };
}
