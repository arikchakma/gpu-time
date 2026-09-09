import type { Clause, Duration, ResolveOptions, Shift } from "./types.js";
import type { LocalPeriod } from "./calendar.js";
import { resolveTime } from "./clock.js";
import {
  addDays,
  addMonths,
  civil,
  zonedToEpoch,
  type Civil,
} from "./zoned.js";

export interface NumericOccurrence {
  start: number;
  end?: number;
  allDay: boolean;
  clause: number;
}

// Public timestamps have second precision. Keep the same precision internally.
const seconds = (epoch: number) => Math.floor(epoch / 1000) * 1000;

export interface ResolutionContext {
  reference: number;
  options: ResolveOptions;
  clauseIndex: number;
  recurring?: boolean;
}

export class NonexistentTimeError extends RangeError {}

export function addDuration(
  epoch: number,
  duration: Duration,
  timeZone: string,
): number {
  const { amount, unit } = duration;
  if (unit === "minute") return epoch + amount * 60_000;
  if (unit === "hour") return epoch + amount * 3_600_000;

  const local = civil(epoch, timeZone);
  const isMonthUnit = unit === "month" || unit === "year";
  const shifted = isMonthUnit
    ? addMonths(local, amount * (unit === "year" ? 12 : 1))
    : addDays(local, amount * (unit === "week" ? 7 : 1));

  return zonedToEpoch(shifted, timeZone).epochMs;
}

function applyShift(
  epoch: number,
  shift: Shift | undefined,
  timeZone: string,
): number {
  if (!shift) return epoch;
  const amount = shift.amount * (shift.direction === "before" ? -1 : 1);
  return addDuration(epoch, { amount, unit: shift.unit }, timeZone);
}

function atTime(date: Civil, seconds: number, timeZone: string): number {
  const local = {
    ...addDays(date, Math.floor(seconds / 86_400)),
    hour: Math.floor(seconds / 3600) % 24,
    minute: Math.floor(seconds / 60) % 60,
    second: seconds % 60,
  };

  const result = zonedToEpoch(local, timeZone);
  if (result.kind === "gap") {
    throw new NonexistentTimeError(
      `The requested local time does not exist in ${timeZone}.`,
    );
  }
  return result.epochMs;
}

function secondsOfDay(date: Civil): number {
  return date.hour * 3600 + date.minute * 60 + date.second;
}

function futureStart(
  date: Civil,
  seconds: number,
  step: number,
  context: ResolutionContext,
): { date: Civil; start: number } {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const start = atTime(date, seconds, context.options.timeZone);
      if (!step || start >= context.reference) return { date, start };
    } catch (error) {
      if (!step || !(error instanceof NonexistentTimeError)) throw error;
    }
    date = addDays(date, step);
  }
  throw new RangeError("No eligible upcoming clock time was found.");
}

export function resolveOccurrence(
  clause: Clause,
  period: LocalPeriod,
  context: ResolutionContext,
): NumericOccurrence {
  const { reference, options, clauseIndex } = context;
  const usesReferenceClock =
    !clause.time &&
    ((!clause.date && (clause.shift || clause.duration)) ||
      clause.date?.kind === "now");
  const impliedClock =
    clause.date?.kind === "relativeUnit" &&
    (clause.date.unit === "hour" || clause.date.unit === "minute");
  const time = clause.time ? resolveTime(clause.time, options) : undefined;
  const startSeconds = time?.start ?? secondsOfDay(period.start);
  const endSeconds =
    clause.duration && !clause.time?.end ? undefined : time?.end;

  const isTimedWeekday =
    clause.time &&
    (clause.date?.kind === "weekday" || clause.date?.kind === "dayGroup") &&
    !clause.date.modifier &&
    (options.bareWeekday ?? "future") === "future";

  const standaloneClock = clause.time && !clause.date && !clause.shift;
  const step = context.recurring
    ? 0
    : isTimedWeekday
      ? 7
      : standaloneClock
        ? 1
        : 0;
  const { date, start } = usesReferenceClock
    ? { date: period.start, start: reference }
    : futureStart(period.start, startSeconds, step, context);

  const occurrence: NumericOccurrence = {
    start: seconds(applyShift(start, clause.shift, options.timeZone)),
    allDay: !clause.time && !usesReferenceClock && !impliedClock,
    clause: clauseIndex,
  };

  if (endSeconds !== undefined) {
    const crossesMidnight = endSeconds < startSeconds;
    const endDate = crossesMidnight ? addDays(date, 1) : date;
    const end = atTime(endDate, endSeconds, options.timeZone);
    occurrence.end = seconds(applyShift(end, clause.shift, options.timeZone));
  }

  if (endSeconds === undefined && period.end) {
    const end = atTime(period.end, secondsOfDay(period.end), options.timeZone);
    occurrence.end = seconds(applyShift(end, clause.shift, options.timeZone));
  }

  if (clause.shift?.endAmount !== undefined) {
    const shiftedEnd = applyShift(
      start,
      { ...clause.shift, amount: clause.shift.endAmount },
      options.timeZone,
    );
    const shiftedStart = occurrence.start;
    occurrence.start = seconds(Math.min(shiftedStart, shiftedEnd));
    occurrence.end = seconds(Math.max(shiftedStart, shiftedEnd));
  }

  if (clause.duration) {
    if (occurrence.end !== undefined)
      throw new RangeError("Use a duration or an explicit end, not both.");
    const end = addDuration(
      occurrence.start,
      clause.duration,
      options.timeZone,
    );
    occurrence.end = seconds(end);
  }

  if (occurrence.end !== undefined && occurrence.end <= occurrence.start) {
    throw new RangeError("The resolved end must be after the start.");
  }
  return occurrence;
}
