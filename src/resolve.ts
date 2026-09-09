import type {
  Occurrence,
  ResolveOptions,
  Resolved,
  Schedule,
  Clause,
} from "./types.js";
import { resolveDates } from "./calendar.js";
import { resolveOccurrence } from "./occurrence.js";
import { addMonths, civil, instant, zonedToEpoch } from "./zoned.js";
import { expandRecurrence } from "./recurrence.js";
import { recurrenceRule, RecurrenceExportError } from "./rrule.js";

function previewHorizon(
  options: ResolveOptions,
  localReference: ReturnType<typeof civil>,
): number {
  if (!options.until)
    return zonedToEpoch(addMonths(localReference, 12), options.timeZone)
      .epochMs;

  const date = options.until.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!date) return instant(options.until);

  const period = resolveDates(
    {
      kind: "calendar",
      year: Number(date[1]),
      month: Number(date[2]),
      day: Number(date[3]),
    },
    localReference,
    options,
  )[0];
  return zonedToEpoch(period.start, options.timeZone).epochMs;
}

function weekdayPolicy(clause: Clause, options: ResolveOptions): Clause {
  if (
    options.bareWeekdays !== "weekly" ||
    clause.recurrence ||
    clause.date?.kind !== "weekday" ||
    clause.date.modifier
  )
    return clause;
  const { date, ...rest } = clause;
  return {
    ...rest,
    recurrence: { freq: "weekly", interval: 1, byDay: [...date.days] },
  };
}

export function resolve(schedule: Schedule, options: ResolveOptions): Resolved {
  const reference = instant(options.reference);
  const localReference = civil(reference, options.timeZone);
  const occurrences: Occurrence[] = [];
  const rrules: string[] = [];
  const diagnostics: Resolved["diagnostics"] = [];
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("limit must be an integer from 1 through 1000.");
  const horizon = previewHorizon(options, localReference);
  if (horizon <= reference)
    throw new RangeError(
      "The preview horizon must be after the reference instant.",
    );
  let truncated = false;

  for (const [clauseIndex, original] of schedule.clauses.entries()) {
    const clause = weekdayPolicy(original, options);
    const context = { reference, options, clauseIndex };
    if (clause.recurrence) {
      if (
        clause.recurrence.until?.kind === "calendar" &&
        clause.recurrence.until.day === undefined
      ) {
        diagnostics.push({
          code: "until-month-only",
          severity: "warning",
          start: 0,
          end: 0,
          message: `Clause ${clauseIndex + 1}: a month-only end means the first day of that month, inclusive.`,
        });
      }
      if (
        clause.recurrence.timesPer !== undefined &&
        (clause.recurrence.freq === "daily" || !clause.recurrence.byDay)
      ) {
        diagnostics.push({
          code: "times-per-approximated",
          severity: "warning",
          start: 0,
          end: 0,
          message: `Clause ${clauseIndex + 1}: unspecified frequency times were spread across whole hours or weekdays.`,
        });
      }
      const series = expandRecurrence(clause, context, horizon, limit);
      if (series.first) {
        try {
          rrules.push(recurrenceRule(clause, series, context));
        } catch (error) {
          if (!(error instanceof RecurrenceExportError)) throw error;
          diagnostics.push({
            code: "unsupported-export",
            severity: "warning",
            start: 0,
            end: 0,
            message: error.message,
          });
        }
      }
      occurrences.push(...series.occurrences);
      truncated ||= series.truncated;
      continue;
    }
    const periods = resolveDates(clause.date, localReference, options);
    for (const period of periods) {
      const occurrence = resolveOccurrence(clause, period, context);
      if (!options.until || Date.parse(occurrence.start) < horizon)
        occurrences.push(occurrence);
    }
  }

  occurrences.sort(
    (left, right) => Date.parse(left.start) - Date.parse(right.start),
  );
  return {
    occurrences: occurrences.slice(0, limit),
    rrules,
    truncated: truncated || occurrences.length > limit,
    diagnostics,
  };
}
