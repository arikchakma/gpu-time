import type { Clause, DateSpec } from "./types.js";
import type { ResolutionContext, NumericOccurrence } from "./occurrence.js";
import {
  hoursForRule,
  expandRecurrence,
  normalizeRecurrence,
  type RecurrenceExpansion,
} from "./recurrence.js";
import { excludedWeekdays } from "./exclusions.js";
import { resolveDates } from "./calendar.js";
import { weekdays } from "./lexicon.js";
import { addDays, civil, dayOfWeek, iso, zonedToEpoch } from "./zoned.js";

export class RecurrenceExportError extends Error {}

function localValue(value: string, allDay: boolean): string {
  return value.slice(0, allDay ? 10 : 19).replace(/[-:]/g, "");
}

function exceptionOccurrences(
  clause: Clause,
  exceptions: DateSpec[],
  context: ResolutionContext,
): NumericOccurrence[] {
  if (!exceptions.length) return [];
  const reference = civil(context.reference, context.options.timeZone);
  let horizon = -Infinity;

  for (const exception of exceptions) {
    for (const period of resolveDates(exception, reference, context.options)) {
      const end = period.end ?? addDays(period.start, 1);
      horizon = Math.max(
        horizon,
        zonedToEpoch(end, context.options.timeZone).epochMs,
      );
    }
  }

  // Export must include exceptions after the visible preview and retain COUNT semantics.
  return (
    expandRecurrence(clause, context, horizon, Infinity).dateExcluded ?? []
  );
}

export function recurrenceRule(
  clause: Clause,
  series: RecurrenceExpansion,
  context: ResolutionContext,
): string {
  const first = series.first!;
  let rule = normalizeRecurrence(clause.recurrence!, context.options.weekStart);
  const timeZone = context.options.timeZone;
  const anchor = civil(first.start, timeZone);
  const property = (name: string, epoch: number) =>
    first.allDay
      ? `${name};VALUE=DATE:${localValue(iso(epoch, timeZone), true)}`
      : `${name};TZID=${timeZone}:${localValue(iso(epoch, timeZone), false)}`;

  if (clause.shift)
    throw new RecurrenceExportError(
      "Shifted recurrences need an explicit calendar transformation before RRULE export.",
    );

  const monthlyException =
    rule.except?.length === 1 ? rule.except[0] : undefined;
  if (
    monthlyException?.kind === "ordinalWeekday" &&
    monthlyException.recurring &&
    rule.freq === "weekly" &&
    rule.interval === 1 &&
    rule.byDay?.length === 1 &&
    rule.byDay[0] === monthlyException.day &&
    !rule.byMonthDay &&
    !rule.bySetPos
  ) {
    // All Mondays except the first is exactly the remaining Mondays each month.
    const positions =
      monthlyException.ordinal > 0 ? [1, 2, 3, 4, 5] : [-1, -2, -3, -4, -5];
    rule = {
      ...rule,
      freq: "monthly",
      bySetPos: positions.filter((value) => value !== monthlyException.ordinal),
      except: [],
    };
  }

  let byDay = rule.byDay;
  const excluded = new Set<string>();
  const dateExceptions: DateSpec[] = [];
  for (const exception of rule.except ?? []) {
    if (exception.kind === "ordinalWeekday" && exception.recurring)
      throw new RecurrenceExportError(
        "Repeating monthly exceptions cannot be represented by a single RRULE; occurrence previews still apply them.",
      );
    const days = excludedWeekdays(exception);
    if (!days) {
      dateExceptions.push(exception);
      continue;
    }
    for (const day of days) excluded.add(day);
  }

  if (excluded.size) {
    if (rule.bySetPos && (byDay ?? weekdays).some((day) => excluded.has(day))) {
      throw new RecurrenceExportError(
        "An ordinal recurrence with weekday exclusions cannot be represented by removing BYDAY values.",
      );
    }
    const defaults =
      rule.freq === "weekly" ? [weekdays[dayOfWeek(anchor)]] : weekdays;
    byDay = (byDay ?? defaults).filter((day) => !excluded.has(day));
  }

  const parts = [
    `FREQ=${rule.freq.toUpperCase()}`,
    `INTERVAL=${rule.interval}`,
  ];
  if (context.options.weekStart === "SU") parts.push("WKST=SU");
  if (byDay?.length) parts.push(`BYDAY=${[...new Set(byDay)].join(",")}`);
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  if (rule.byMonthDay?.length)
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.bySetPos?.length) parts.push(`BYSETPOS=${rule.bySetPos.join(",")}`);

  // BYDAY filtering must not turn an implicit month/day into a whole-month expansion.
  if (excluded.size && !rule.byDay && !rule.byMonthDay && !rule.bySetPos) {
    if (rule.freq === "monthly" || rule.freq === "yearly")
      parts.push(`BYMONTHDAY=${anchor.day}`);
    if (rule.freq === "yearly" && !rule.byMonth)
      parts.push(`BYMONTH=${anchor.month}`);
  }

  const hours = hoursForRule(rule);
  if (hours) parts.push(`BYHOUR=${hours.join(",")}`);
  const exceptions = exceptionOccurrences(clause, dateExceptions, context);
  if (rule.count !== undefined)
    parts.push(`COUNT=${rule.count + exceptions.length}`);
  if (series.until !== undefined && Number.isFinite(series.until)) {
    const last = series.until - 1;
    const until = first.allDay
      ? localValue(iso(last, timeZone), true)
      : new Date(last).toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
    parts.push(`UNTIL=${until}`);
  }

  const lines = [property("DTSTART", first.start)];
  if (first.end !== undefined) lines.push(property("DTEND", first.end));
  lines.push(`RRULE:${parts.join(";")}`);
  if (exceptions.length) {
    const values = exceptions
      .map((occurrence) =>
        localValue(iso(occurrence.start, timeZone), first.allDay),
      )
      .join(",");
    const type = first.allDay ? "VALUE=DATE" : `TZID=${timeZone}`;
    lines.push(`EXDATE;${type}:${values}`);
  }
  return lines.join("\n");
}
