import type {
  CalendarDate,
  DateSpec,
  Modifier,
  ResolveOptions,
  Unit,
  Weekday,
} from "./types.js";
import { weekdays } from "./lexicon.js";
import {
  addDays,
  addMonths,
  dayOfWeek,
  daysInMonth,
  fromUTC,
  startOfDay,
  utc,
  valid,
  type Civil,
} from "./zoned.js";

export interface LocalPeriod {
  start: Civil;
  /** An exclusive end, used for date ranges and whole calendar periods. */
  end?: Civil;
}

const holidays = {
  christmas: [12, 25],
  "christmas-eve": [12, 24],
  "new-year": [1, 1],
  "new-years-eve": [12, 31],
  halloween: [10, 31],
  valentines: [2, 14],
  "july-4th": [7, 4],
  thanksgiving: { month: 11, day: "TH", ordinal: 4 },
} as const;

export function weekBeginning(
  date: Civil,
  weekStart: "MO" | "SU" = "MO",
): Civil {
  const firstDay = weekStart === "SU" ? 6 : 0;
  return addDays(startOfDay(date), -((dayOfWeek(date) - firstDay + 7) % 7));
}

function weekdayDate(
  day: Weekday,
  modifier: Modifier | undefined,
  reference: Civil,
  options: ResolveOptions,
): Civil {
  const target = weekdays.indexOf(day);
  const current = dayOfWeek(reference);
  const future = (target - current + 7) % 7;
  const weekStart = options.weekStart === "SU" ? 6 : 0;
  const position = (target - weekStart + 7) % 7;

  if (
    modifier === "this" ||
    (!modifier && options.bareWeekday === "thisWeek")
  ) {
    return addDays(weekBeginning(reference, options.weekStart), position);
  }
  if (modifier === "last") {
    return addDays(startOfDay(reference), -((current - target + 7) % 7 || 7));
  }
  if (modifier === "next") {
    if (options.nextWeekday === "immediate")
      return addDays(startOfDay(reference), future || 7);
    return addDays(weekBeginning(reference, options.weekStart), 7 + position);
  }
  if (options.bareWeekday === "nearest") {
    return addDays(startOfDay(reference), future > 3 ? future - 7 : future);
  }
  return addDays(startOfDay(reference), future);
}

function calendarDate(spec: CalendarDate, reference: Civil): Civil {
  const date = {
    ...startOfDay(reference),
    year: spec.year ?? reference.year,
    month: spec.month ?? reference.month,
    day: spec.day ?? 1,
  };

  if (!valid(date))
    throw new RangeError("The expression names an invalid calendar date.");
  return date;
}

export function addCivil(date: Civil, amount: number, unit: Unit): Civil {
  switch (unit) {
    case "second":
      return fromUTC(utc(date) + amount * 1000);
    case "minute":
      return fromUTC(utc(date) + amount * 60_000);
    case "hour":
      return fromUTC(utc(date) + amount * 3_600_000);
    case "day":
      return addDays(date, amount);
    case "week":
      return addDays(date, amount * 7);
    case "month":
      return addMonths(date, amount);
    case "year":
      return addMonths(date, amount * 12);
  }
}

function relativePeriod(
  spec: Extract<DateSpec, { kind: "relativeUnit" }>,
  reference: Civil,
  options: ResolveOptions,
): LocalPeriod {
  let beginning = startOfDay(reference);
  if (spec.unit === "week")
    beginning = weekBeginning(reference, options.weekStart);
  if (spec.unit === "month") beginning.day = 1;
  if (spec.unit === "year") beginning = { ...beginning, month: 1, day: 1 };
  if (spec.unit === "hour") beginning = { ...reference, minute: 0, second: 0 };
  if (spec.unit === "minute") beginning = { ...reference, second: 0 };
  if (spec.unit === "second") beginning = { ...reference };

  const offset =
    spec.modifier === "next" ? 1 : spec.modifier === "last" ? -1 : 0;
  const start = addCivil(beginning, offset, spec.unit);
  const end = addCivil(start, 1, spec.unit);

  if (spec.edge === "start") return { start };
  if (spec.edge === "end") {
    const isClockUnit =
      spec.unit === "second" || spec.unit === "minute" || spec.unit === "hour";
    return { start: isClockUnit ? fromUTC(utc(end) - 1000) : addDays(end, -1) };
  }
  return { start, end };
}

export function resolveDates(
  spec: DateSpec | undefined,
  reference: Civil,
  options: ResolveOptions,
): LocalPeriod[] {
  const today = startOfDay(reference);
  if (!spec) return [{ start: today }];

  switch (spec.kind) {
    case "now":
      return [{ start: reference }];

    case "relativeDay":
      return [{ start: addDays(today, spec.offset) }];

    case "weekday":
      return spec.days.map((day) => ({
        start: weekdayDate(day, spec.modifier, reference, options),
      }));

    case "weekdayRange": {
      const start = weekdayDate(spec.from, undefined, reference, options);
      const length =
        ((weekdays.indexOf(spec.to) - weekdays.indexOf(spec.from) + 7) % 7) + 1;
      return [{ start, end: addDays(start, length) }];
    }

    case "dayGroup": {
      const selectedDays =
        spec.group === "weekend" ? weekdays.slice(5) : weekdays.slice(0, 5);
      if (spec.modifier) {
        let start = weekdayDate(selectedDays[0], "this", reference, options);
        if (spec.modifier === "last") start = addDays(start, -7);
        if (spec.modifier === "next") {
          const upcoming =
            options.nextWeekday === "immediate" && utc(start) > utc(today);
          if (!upcoming) start = addDays(start, 7);
        }
        return selectedDays.map((_, index) => ({
          start: addDays(start, index),
        }));
      }
      return selectedDays.map((day) => ({
        start: weekdayDate(day, spec.modifier, reference, options),
      }));
    }

    case "calendar": {
      const date = calendarDate(spec, reference);
      // Without a year, "January 2" and "the 3rd" name the next such date.
      if (spec.year === undefined && utc(date) < utc(today))
        return [
          {
            start: calendarDate(
              spec,
              addCivil(
                reference,
                1,
                spec.month === undefined ? "month" : "year",
              ),
            ),
          },
        ];
      return [{ start: date }];
    }

    case "calendarPeriod": {
      let year = spec.year ?? reference.year;
      if (spec.year === undefined && spec.modifier === "next")
        year += spec.month <= reference.month ? 1 : 0;
      if (spec.year === undefined && spec.modifier === "last")
        year -= spec.month >= reference.month ? 1 : 0;
      const beginning = calendarDate(
        { year, month: spec.month, day: 1 },
        reference,
      );
      const end = addMonths(beginning, 1);
      if (spec.edge === "start") return [{ start: beginning }];
      if (spec.edge === "end") return [{ start: addDays(end, -1) }];
      if (spec.week !== undefined) {
        const start = addDays(beginning, (spec.week - 1) * 7);
        if (spec.week < 1 || spec.week > 5 || start.month !== beginning.month)
          throw new RangeError(
            "The requested week does not exist in that month.",
          );
        const next = addDays(start, 7);
        return [{ start, end: utc(next) < utc(end) ? next : end }];
      }
      return [{ start: beginning, end }];
    }

    case "relativeUnit":
      return [relativePeriod(spec, reference, options)];

    case "holiday": {
      const entry = holidays[spec.name];
      const inYear = (year: number): Civil =>
        "ordinal" in entry
          ? resolveDates(
              {
                kind: "ordinalWeekday",
                ...entry,
                of: { kind: "calendar", year, month: entry.month },
              },
              reference,
              options,
            )[0].start
          : calendarDate({ year, month: entry[0], day: entry[1] }, reference);
      let date = inYear(reference.year);
      if (utc(date) < utc(today)) date = inYear(reference.year + 1);
      return [{ start: date }];
    }

    case "ordinalWeekday": {
      const beginning =
        spec.of.kind === "calendar"
          ? calendarDate({ ...spec.of, day: 1 }, reference)
          : relativePeriod(spec.of, reference, options).start;
      const target = weekdays.indexOf(spec.day);
      let date: Civil;

      if (spec.ordinal > 0) {
        date = addDays(
          beginning,
          ((target - dayOfWeek(beginning) + 7) % 7) + (spec.ordinal - 1) * 7,
        );
      } else {
        const last = {
          ...beginning,
          day: daysInMonth(beginning.year, beginning.month),
        };
        date = addDays(
          last,
          -((dayOfWeek(last) - target + 7) % 7) + (spec.ordinal + 1) * 7,
        );
      }

      if (
        !Number.isInteger(spec.ordinal) ||
        spec.ordinal === 0 ||
        date.month !== beginning.month
      ) {
        throw new RangeError(
          "The requested ordinal weekday does not exist in that month.",
        );
      }
      return [{ start: date }];
    }

    case "calendarRange": {
      const start = calendarDate(spec.from, reference);
      let end = calendarDate({ month: start.month, ...spec.to }, start);

      if (
        utc(end) < utc(start) &&
        spec.to.year === undefined &&
        spec.to.month !== undefined
      ) {
        end = calendarDate({ ...spec.to, year: start.year + 1 }, start);
      }
      if (utc(end) < utc(start))
        throw new RangeError(
          "A date range must end on or after its start date.",
        );

      return [{ start, end: addDays(end, 1) }];
    }
  }
}
