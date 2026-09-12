import type {
  Clause,
  Duration,
  OpenBound,
  ResolveOptions,
  Shift,
} from "./types.js";
import { addCivil, resolveDates, type LocalPeriod } from "./calendar.js";
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
  open?: OpenBound;
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
  if (duration.components) {
    let result = addDuration(
      epoch,
      { amount: duration.amount, unit: duration.unit },
      timeZone,
    );
    for (const component of duration.components)
      result = addDuration(result, component, timeZone);
    return result;
  }
  const { amount, unit } = duration;
  if (unit === "second") return epoch + amount * 1000;
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
  return addDuration(
    epoch,
    {
      amount,
      unit: shift.unit,
      ...(shift.components
        ? {
            components: shift.components.map((value) => ({
              ...value,
              amount: value.amount * (shift.direction === "before" ? -1 : 1),
            })),
          }
        : {}),
    },
    timeZone,
  );
}

function atTime(date: Civil, seconds: number, timeZone: string): number {
  const dayOffset = Math.floor(seconds / 86_400);
  const local =
    seconds === secondsOfDay(date)
      ? date
      : {
          ...(dayOffset ? addDays(date, dayOffset) : date),
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
    (clause.date.unit === "hour" ||
      clause.date.unit === "minute" ||
      clause.date.unit === "second");
  const relativeDate =
    clause.date?.kind === "relativeUnit" && !clause.date.edge
      ? clause.date
      : undefined;
  const qualifiedRelativeUnit = Boolean(
    clause.time && !("part" in clause.time.start) && relativeDate,
  );
  const occurrenceDate =
    qualifiedRelativeUnit && relativeDate
      ? addCivil(
          civil(reference, options.timeZone),
          relativeDate.modifier === "this"
            ? 0
            : relativeDate.modifier === "last"
              ? -1
              : 1,
          relativeDate.unit,
        )
      : period.start;
  const time = clause.time ? resolveTime(clause.time, options) : undefined;
  const startSeconds = time?.start ?? secondsOfDay(occurrenceDate);
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
  // "before 6pm" floors the start at midnight, which is always in the past, so
  // search on the edge the phrase actually named or every one lands tomorrow.
  const searchSeconds =
    clause.time?.open === "start" && endSeconds !== undefined
      ? endSeconds
      : startSeconds;
  const { date, start: searched } = usesReferenceClock
    ? { date: occurrenceDate, start: reference }
    : futureStart(occurrenceDate, searchSeconds, step, context);
  const start =
    searchSeconds === startSeconds
      ? searched
      : atTime(date, startSeconds, options.timeZone);

  const occurrence: NumericOccurrence = {
    start: seconds(applyShift(start, clause.shift, options.timeZone)),
    allDay: !clause.time && !usesReferenceClock && !impliedClock,
    clause: clauseIndex,
    ...(clause.time?.open ? { open: clause.time.open } : {}),
  };

  if (endSeconds !== undefined) {
    const crossesMidnight = endSeconds < startSeconds;
    const endDate = clause.endDate
      ? resolveDates(clause.endDate, date, options)[0].start
      : crossesMidnight
        ? addDays(date, 1)
        : date;
    const end = atTime(endDate, endSeconds, options.timeZone);
    occurrence.end = seconds(applyShift(end, clause.shift, options.timeZone));
  }

  if (
    endSeconds === undefined &&
    period.end &&
    !qualifiedRelativeUnit &&
    clause.time?.open !== "end"
  ) {
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
