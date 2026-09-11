import type { Clause, Recurrence } from "./types.js";
import { addCivil, resolveDates, weekBeginning } from "./calendar.js";
import { resolveTime } from "./clock.js";
import {
  NonexistentTimeError,
  addDuration,
  resolveOccurrence,
  type ResolutionContext,
  type NumericOccurrence,
} from "./occurrence.js";
import { weekdays } from "./lexicon.js";
import { excludedWeekdays, exclusionFilter } from "./exclusions.js";
import {
  addDays,
  civil,
  dayNumber,
  dayOfWeek,
  daysInMonth,
  startOfDay,
  zonedToEpoch,
  utc,
  type Civil,
} from "./zoned.js";

export interface RecurrenceExpansion {
  occurrences: NumericOccurrence[];
  first?: NumericOccurrence;
  truncated: boolean;
  /** Exclusive end of the actual rule, independent of the preview horizon. */
  until?: number;
  excluded?: NumericOccurrence[];
  dateExcluded?: NumericOccurrence[];
}

export function hoursForRule(rule: Recurrence): number[] | undefined {
  if (rule.freq !== "daily" || rule.timesPer === undefined) return;
  return Array.from({ length: rule.timesPer }, (_, index) =>
    Math.floor((index * 24) / rule.timesPer!),
  );
}

export function normalizeRecurrence(
  rule: Recurrence,
  weekStart: "MO" | "SU" = "MO",
): Recurrence {
  if (rule.timesPer === undefined) return rule;
  const maximum = rule.freq === "weekly" ? 7 : rule.freq === "daily" ? 24 : 0;
  if (
    !Number.isInteger(rule.timesPer) ||
    rule.timesPer < 1 ||
    rule.timesPer > maximum
  ) {
    throw new RangeError(
      "Frequency counts need 1–7 times per week or 1–24 times per day.",
    );
  }
  if (rule.freq === "weekly" && !rule.byDay) {
    const firstDay = weekStart === "SU" ? 6 : 0;
    const byDay = Array.from(
      { length: rule.timesPer },
      (_, index) =>
        weekdays[(firstDay + Math.floor((index * 7) / rule.timesPer!)) % 7],
    );
    return { ...rule, byDay };
  }
  return rule;
}

function matchesMonthDay(date: Civil, days: number[]): boolean {
  const last = daysInMonth(date.year, date.month);
  return days.some((day) => date.day === (day < 0 ? last + day + 1 : day));
}

function matchesPosition(date: Civil, rule: Recurrence): boolean {
  const months =
    rule.freq === "yearly"
      ? (rule.byMonth ?? Array.from({ length: 12 }, (_, index) => index + 1))
      : [date.month];
  const candidates: number[] = [];

  for (const month of [...months].sort((left, right) => left - right)) {
    const last = daysInMonth(date.year, month);
    for (let day = 1; day <= last; day++) {
      const candidate = { ...date, month, day };
      if (rule.byDay && !rule.byDay.includes(weekdays[dayOfWeek(candidate)]))
        continue;
      if (rule.byMonthDay && !matchesMonthDay(candidate, rule.byMonthDay))
        continue;
      candidates.push(dayNumber(candidate));
    }
  }

  return rule.bySetPos!.some((position) => {
    const index = position > 0 ? position - 1 : candidates.length + position;
    return candidates[index] === dayNumber(date);
  });
}

function matches(
  date: Civil,
  anchor: Civil,
  rule: Recurrence,
  anchorWeek: number,
): boolean {
  const day = weekdays[dayOfWeek(date)];
  if (rule.byDay && !rule.byDay.includes(day)) return false;
  if (rule.byMonth && !rule.byMonth.includes(date.month)) return false;
  if (rule.byMonthDay && !matchesMonthDay(date, rule.byMonthDay)) return false;
  const hours = hoursForRule(rule);
  if (hours && !hours.includes(date.hour)) return false;

  if (rule.freq === "hourly") {
    const hours = Math.round((utc(date) - utc(anchor)) / 3_600_000);
    return hours % rule.interval === 0;
  }

  if (rule.freq === "daily")
    return (dayNumber(date) - dayNumber(anchor)) % rule.interval === 0;
  if (rule.freq === "weekly") {
    const distance = Math.floor((dayNumber(date) - anchorWeek) / 7);
    return (
      distance % rule.interval === 0 &&
      (rule.byDay !== undefined || dayOfWeek(date) === dayOfWeek(anchor))
    );
  }
  if (rule.freq === "monthly") {
    const months = (date.year - anchor.year) * 12 + date.month - anchor.month;
    if (months % rule.interval !== 0) return false;
    if (rule.bySetPos) return matchesPosition(date, rule);
    return Boolean(rule.byMonthDay || rule.byDay) || date.day === anchor.day;
  }
  if (rule.freq === "yearly") {
    if ((date.year - anchor.year) % rule.interval !== 0) return false;
    if (rule.bySetPos) return matchesPosition(date, rule);
    const expandsMonths = rule.byMonth || rule.byMonthDay || rule.byDay;
    if (!expandsMonths && date.month !== anchor.month) return false;
    return Boolean(rule.byMonthDay || rule.byDay) || date.day === anchor.day;
  }
  return false;
}

function candidate(
  clause: Clause,
  date: Civil,
  context: ResolutionContext,
  generatedClock = false,
): NumericOccurrence | undefined {
  try {
    let event = clause;
    if (generatedClock) {
      event = {
        ...clause,
        time: {
          start: { hour: date.hour, minute: date.minute, second: date.second },
        },
      };
      if (clause.time) {
        const window = resolveTime(clause.time, context.options);
        if (window.end !== undefined) {
          if (window.end === window.start)
            throw new RangeError(
              "An hourly recurrence window needs distinct clock boundaries.",
            );
          const length =
            window.end > window.start
              ? window.end - window.start
              : window.end - window.start + 86_400;
          if (length === 86_400) event.duration = { amount: 1, unit: "day" };
          else {
            const end = addCivil(date, length / 60, "minute");
            event.time!.end = {
              hour: end.hour,
              minute: end.minute,
              second: end.second,
            };
          }
        }
      }
    }
    // The recurrence chooses the date; one-off weekday roll-forward must not run again.
    return resolveOccurrence(event, { start: date }, context);
  } catch (error) {
    if (error instanceof NonexistentTimeError) return;
    throw error;
  }
}

export function expandRecurrence(
  clause: Clause,
  context: ResolutionContext,
  horizon: number,
  limit: number,
): RecurrenceExpansion {
  const rule = normalizeRecurrence(
    clause.recurrence!,
    context.options.weekStart,
  );
  if (rule.count !== undefined && (rule.until || rule.span)) {
    throw new RangeError("Use a count or an end bound, not both.");
  }
  if (!Number.isInteger(rule.interval) || rule.interval < 1)
    throw new RangeError("Recurrence interval must be a positive integer.");
  if (
    rule.count !== undefined &&
    (!Number.isInteger(rule.count) || rule.count < 1)
  )
    throw new RangeError("Recurrence count must be a positive integer.");

  // Normalize these once for the whole series, rather than once per occurrence.
  clause = { ...clause, date: undefined };
  context = { ...context, recurring: true };
  const { reference, options } = context;
  const localReference = civil(reference, options.timeZone);
  const requested = rule.start
    ? resolveDates(rule.start, localReference, options)[0].start
    : localReference;
  const generatedClock =
    rule.freq === "hourly" || hoursForRule(rule) !== undefined;
  if (rule.freq === "daily" && rule.timesPer !== undefined && clause.time) {
    throw new RangeError(
      "A daily frequency count needs distinct times; it cannot share one fixed clock.",
    );
  }
  const requestedInstant =
    rule.start || (!clause.time && !generatedClock)
      ? zonedToEpoch(startOfDay(requested), options.timeZone).epochMs
      : reference;
  const stepsPerDay = generatedClock ? 24 : 1;
  let beginning = rule.freq === "hourly" ? requested : startOfDay(requested);
  if (generatedClock && clause.time) {
    const seconds = resolveTime(clause.time, options).start;
    beginning = {
      ...beginning,
      hour: Math.floor(seconds / 3600),
      minute: Math.floor(seconds / 60) % 60,
      second: seconds % 60,
    };
  }
  const isExcluded = exclusionFilter(rule.except ?? [], context);
  const isPatternExcluded = exclusionFilter(
    (rule.except ?? []).filter(
      (exception) => excludedWeekdays(exception) !== undefined,
    ),
    context,
  );
  let until = Infinity;
  if (rule.until) {
    const period = resolveDates(rule.until, localReference, options)[0];
    until = zonedToEpoch(
      period.end ?? addDays(period.start, 1),
      options.timeZone,
    ).epochMs;
  }
  if (rule.span) {
    if (!Number.isInteger(rule.span.amount) || rule.span.amount <= 0)
      throw new RangeError("A recurrence duration must be positive.");
    until = Math.min(
      until,
      addDuration(requestedInstant, rule.span, options.timeZone),
    );
  }
  const seedRule = { ...rule, interval: 1 };
  let first: NumericOccurrence | undefined;
  let anchor: Civil | undefined;
  const beginningWeek =
    rule.freq === "weekly"
      ? dayNumber(weekBeginning(beginning, options.weekStart))
      : 0;

  for (let offset = 0; offset < 366 * 8 * stepsPerDay; offset++) {
    const date = addCivil(beginning, offset, generatedClock ? "hour" : "day");
    if (!matches(date, beginning, seedRule, beginningWeek) || isExcluded(date))
      continue;
    const occurrence = candidate(clause, date, context, generatedClock);
    if (!occurrence || occurrence.start < requestedInstant) continue;
    first = occurrence;
    anchor = date;
    break;
  }
  if (!anchor || !first)
    throw new RangeError("No eligible recurrence start within eight years.");

  if (first.start >= until) return { occurrences: [], truncated: false };
  const lastDay = dayNumber(civil(Math.min(horizon, until), options.timeZone));
  const occurrences: NumericOccurrence[] = [];
  const excluded: NumericOccurrence[] = [];
  const dateExcluded: NumericOccurrence[] = [];
  const cutoff = first.allDay
    ? zonedToEpoch(startOfDay(localReference), options.timeZone).epochMs
    : reference;
  let count = 0;
  const anchorWeek =
    rule.freq === "weekly"
      ? dayNumber(weekBeginning(anchor, options.weekStart))
      : 0;

  const scanLimit = 100_000 * stepsPerDay;
  // With one weekday, the intervening days cannot satisfy the rule.
  const step =
    !generatedClock &&
    rule.freq === "weekly" &&
    (!rule.byDay || rule.byDay.length === 1)
      ? 7 * rule.interval
      : 1;
  let offset = 0;
  for (; offset < scanLimit; offset += step) {
    const date = addCivil(anchor, offset, generatedClock ? "hour" : "day");
    if (dayNumber(date) > lastDay) break;
    if (!matches(date, anchor, rule, anchorWeek)) continue;

    const occurrence =
      offset === 0 ? first : candidate(clause, date, context, generatedClock);
    if (!occurrence) continue;
    const start = occurrence.start;
    if (
      start >= Math.min(horizon, until) ||
      (rule.count !== undefined && count >= rule.count)
    )
      break;
    if (isExcluded(date)) {
      excluded.push(occurrence);
      if (!isPatternExcluded(date)) dateExcluded.push(occurrence);
      continue;
    }
    count++;
    if (start >= cutoff) occurrences.push(occurrence);
    if (occurrences.length > limit)
      return {
        occurrences,
        first,
        until,
        excluded,
        dateExcluded,
        truncated: true,
      };
    if (rule.count !== undefined && count >= rule.count) break;
  }

  if (
    offset >= scanLimit &&
    dayNumber(addCivil(anchor, offset, generatedClock ? "hour" : "day")) <=
      lastDay
  )
    throw new RangeError(
      "The recurrence exceeded the 100000-day search limit. Use a narrower horizon or a later start.",
    );

  return {
    occurrences,
    first,
    until,
    excluded,
    dateExcluded,
    truncated: false,
  };
}
