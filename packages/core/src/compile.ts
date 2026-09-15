import { Role, LABELS, labelId } from "./labels.js";
import type {
  Clause,
  CalendarDate,
  ClockTime,
  DayPart,
  Diagnostic,
  DateSpec,
  Duration,
  Expression,
  Modifier,
  OpenBound,
  Recurrence,
  Shift,
  TimeSpec,
  Token as SourceToken,
  PredictionToken as Token,
  Weekday,
  Unit,
  ParserOptions,
} from "./types.js";
import {
  compoundOrdinal,
  dayNames,
  holidayNames,
  month,
  number,
  unit,
  weekday,
  weekdays,
} from "./lexicon.js";

import { readDuration, readNumber } from "./quantity.js";

const approximately = new Set(["about", "around", "roughly"]);
const filler = new Set([
  ...approximately,
  "at",
  "on",
  "the",
  "of",
  "a",
  "an",
  "and",
  "then",
  "from",
  "for",
  "end",
  "start",
  ",",
  ";",
  "&",
  ":",
  "-",
  "–",
  "—",
  ".",
  "st",
  "nd",
  "rd",
  "th",
]);
const relativeDays: Record<string, number> = {
  today: 0,
  tonight: 0,
  tomorrow: 1,
  yesterday: -1,
  "the day after tomorrow": 2,
  "the day before yesterday": -2,
  tmrw: 1,
  tmr: 1,
  tmw: 1,
  tonite: 0,
};
const dayParts: Record<string, DayPart> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night",
};
const recurrenceBounds = new Set([
  Role.BOUND_START,
  Role.BOUND_END,
  Role.EXCEPT,
]);
const modifiers: Record<string, Modifier> = {
  this: "this",
  next: "next",
  nxt: "next",
  coming: "next",
  upcoming: "next",
  last: "last",
  previous: "last",
  past: "last",
};

const lower = (token?: Token) => token?.text.toLowerCase() ?? "";
const sameTimePair = (first?: Token, second?: Token) =>
  ["same", "this"].includes(lower(first)) && lower(second) === "time";

const unitFrequencies: Partial<Record<Unit, Recurrence["freq"]>> = {
  hour: "hourly",
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};
const frequencyWords: Record<string, Recurrence["freq"]> = {
  hourly: "hourly",
  daily: "daily",
  nightly: "daily",
  weekly: "weekly",
  biweekly: "weekly",
  fortnightly: "weekly",
  monthly: "monthly",
  bimonthly: "monthly",
  quarterly: "monthly",
  yearly: "yearly",
  annually: "yearly",
};
const frequencyIntervals: Record<string, number> = {
  biweekly: 2,
  fortnightly: 2,
  bimonthly: 2,
  quarterly: 3,
};

function frequencyFor(token: Token): Recurrence["freq"] {
  const value = unit(token.text);
  const frequency = value && unitFrequencies[value];
  if (!frequency)
    fail(
      token,
      "unsupported",
      "Expected an hourly, daily, weekly, monthly, or yearly period.",
    );
  return frequency;
}

interface ParsedClock {
  value: ClockTime;
  token: Token;
  meridiem?: string;
  needsMeridiem: boolean;
}

class CompileError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

function diagnostic(
  token: Token,
  code: string,
  message: string,
  severity: Diagnostic["severity"] = "error",
): Diagnostic {
  return { code, message, start: token.start, end: token.end, severity };
}

function fail(token: Token, code: string, message: string): never {
  throw new CompileError(diagnostic(token, code, message));
}

const clockPeriods = new Map([
  ["inmorning", "am"],
  ["inthemorning", "am"],
  ["inafternoon", "pm"],
  ["intheafternoon", "pm"],
  ["inevening", "pm"],
  ["intheevening", "pm"],
  ["atnight", "pm"],
  ["inthenight", "pm"],
]);

function readClock(
  tokens: Token[],
  index: number,
): { clock: ParsedClock; next: number } {
  const token = tokens[index];
  let hour = number(token.text.toLowerCase());
  let minute = 0;
  let second: number | undefined;
  let meridiem: string | undefined;
  let next = index + 1;

  // Minutes are always two digits: "9.30pm" and "9:05" are clocks, while
  // "9.5 hours" and the ratio "2:3" are not.
  const separated =
    tokens[next]?.text === ":"
      ? tokens[next + 1]?.label === Role.MINUTE &&
        /^\d{2}$/.test(tokens[next + 1]?.text ?? "")
      : tokens[next]?.text === "." &&
        /^\d{1,2}$/.test(token.text) &&
        /^\d{2}$/.test(tokens[next + 1]?.text ?? "");
  if (separated) {
    minute = number(tokens[next + 1].text);
    next += 2;
  }

  if (tokens[next]?.label === Role.MINUTE) {
    const spoken = readNumber(tokens, next, Role.MINUTE);
    minute = spoken.value;
    next = spoken.next;
  }

  if (tokens[next]?.text === ":" && tokens[next + 1]?.label === Role.SECOND) {
    second = number(tokens[next + 1].text);
    next += 2;
  }

  while (tokens[next]?.label === Role.MERIDIEM) {
    const part = tokens[next].text.toLowerCase().replace(/\./g, "");
    meridiem = (meridiem ?? "") + part;
    next++;
  }
  if (meridiem) {
    meridiem = meridiem.replace(/[’]/g, "'").replace(/^oclock/, "o'clock");
    if (meridiem.startsWith("o'clock") && meridiem.length > 7)
      meridiem = meridiem.slice(7);
    if (hour === 12 && ["atnight", "inthenight"].includes(meridiem))
      meridiem = "am";
    meridiem = clockPeriods.get(meridiem) ?? meridiem;
  }

  const endOfDay = hour === 24 && minute === 0 && (second ?? 0) === 0;
  const invalidHour =
    !Number.isInteger(hour) || hour < 0 || (hour > 23 && !endOfDay);
  const invalidMinute = !Number.isInteger(minute) || minute < 0 || minute > 59;
  const invalidSecond =
    second !== undefined &&
    (!Number.isInteger(second) || second < 0 || second > 59);
  const invalidMeridiem =
    meridiem &&
    (!["am", "pm", "o'clock"].includes(meridiem) || hour < 1 || hour > 12);

  if (invalidHour || invalidMinute || invalidSecond || invalidMeridiem) {
    fail(token, "invalid-time", "Clock components are out of range.");
  }

  if (meridiem === "am" || meridiem === "pm") {
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }

  const value: ClockTime = { hour, minute };
  if (second !== undefined) value.second = second;

  return {
    clock: {
      value,
      token,
      meridiem,
      needsMeridiem: !meridiem && hour > 0 && hour <= 12,
    },
    next,
  };
}

function inheritMeridiem(
  clock: ParsedClock | undefined,
  partner: ParsedClock | undefined,
  isStart: boolean,
): void {
  if (
    !clock ||
    !partner ||
    clock.meridiem ||
    !("hour" in clock.value) ||
    clock.value.hour < 1 ||
    clock.value.hour > 12 ||
    /^0\d/.test(clock.token.text)
  )
    return;
  if (
    !["am", "pm"].includes(partner.meridiem ?? "") &&
    !("named" in partner.value)
  )
    return;
  const fixed = literalSeconds(partner.value);
  if (fixed === undefined) return;
  const base = clock.value.hour % 12;
  const minuteSeconds = clock.value.minute * 60 + (clock.value.second ?? 0);
  const candidates = [base, base + 12].map((hour) => {
    const seconds = hour * 3600 + minuteSeconds;
    const elapsed = isStart ? fixed - seconds : seconds - fixed;
    return { hour, duration: (elapsed + 86400) % 86400 };
  });
  clock.value.hour =
    candidates[0].duration <= candidates[1].duration
      ? candidates[0].hour
      : candidates[1].hour;
  clock.needsMeridiem = false;
}

function literalSeconds(clock: ClockTime): number | undefined {
  if ("named" in clock) return clock.named === "noon" ? 43200 : 0;
  if ("hour" in clock)
    return clock.hour * 3600 + clock.minute * 60 + (clock.second ?? 0);
}

function qualifyClock(clock: ParsedClock, part: DayPart): void {
  // "o'clock" names no half of the day, so "ten o'clock in the evening" is 22:00.
  if (
    !("hour" in clock.value) ||
    (clock.meridiem && clock.meridiem !== "o'clock")
  )
    return;
  const hour = clock.value.hour;
  if (hour < 1 || hour > 12) return;

  if (part === "morning") clock.value.hour = hour % 12;
  else if (part === "night" && hour === 12) clock.value.hour = 0;
  else clock.value.hour = (hour % 12) + 12;
  clock.needsMeridiem = false;
}

function compileTime(
  clocks: ParsedClock[],
  diagnostics: Diagnostic[],
): TimeSpec | undefined {
  if (clocks.length === 0) return;
  if (clocks.length > 2) {
    fail(
      clocks[2].token,
      "unsupported",
      "More than two clocks need a new clause.",
    );
  }

  const [start, end] = clocks;
  inheritMeridiem(start, end, true);
  inheritMeridiem(end, start, false);

  const canInferWorkingHours = start.needsMeridiem && end?.needsMeridiem;
  if (
    canInferWorkingHours &&
    "hour" in start.value &&
    "hour" in end.value &&
    end.value.hour < start.value.hour
  ) {
    end.value.hour += 12;
    start.needsMeridiem = false;
    end.needsMeridiem = false;
    diagnostics.push(
      diagnostic(
        start.token,
        "working-hours",
        "Assumed a daytime working-hours range.",
        "warning",
      ),
    );
  }

  for (const clock of clocks) {
    if (clock.needsMeridiem) {
      diagnostics.push(
        diagnostic(
          clock.token,
          "ambiguous-meridiem",
          "No AM/PM marker; interpreted as a 24-hour clock.",
          "warning",
        ),
      );
    }
  }

  if (
    end &&
    ((literalSeconds(start.value) !== undefined &&
      literalSeconds(start.value) === literalSeconds(end.value)) ||
      JSON.stringify(start.value) === JSON.stringify(end.value))
  ) {
    fail(end.token, "end-equals-start", "Start and end times are equal.");
  }

  const time: TimeSpec = { start: start.value };
  if (end) time.end = end.value;
  return time;
}

function compileDateAndTime(
  tokens: Token[],
  diagnostics: Diagnostic[],
): Clause {
  const clause: Clause = {};
  const days: Weekday[] = [];
  const clocks: ParsedClock[] = [];
  let modifier: Modifier | undefined;
  let edge: "start" | "end" | undefined;
  let calendar: CalendarDate | undefined;
  let calendarEnd: CalendarDate | undefined;
  let ordinal: number | undefined;
  let rangedDays = false;
  let pendingDayRange = false;
  let firstDayIndex = -1;
  let openBound: OpenBound | undefined;
  let openToken: Token | undefined;
  let dayPartClock: ParsedClock | undefined;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    // "today's meeting" tokenizes as one word. Only a date role drops the
    // possessive, so a holiday such as "Valentine's Day" keeps it.
    const possessive = [
      Role.REL_DAY,
      Role.WEEKDAY,
      Role.DAYPART,
      Role.MONTH,
    ].includes(token.label);
    const word = possessive
      ? token.text.toLowerCase().replace(/['\u2019]s$/, "")
      : token.text.toLowerCase();

    switch (token.label) {
      case Role.O:
      case Role.RANGE_START:
      case Role.RECUR:
        break;

      case Role.DIR_BEFORE:
      case Role.DIR_AFTER:
        // extractShift already took the directions that carry an amount and a
        // unit ("3 days after Friday"). Whatever survives to here is an open
        // bound, which used to fall through to the unsupported-role catch-all.
        if (openBound)
          fail(token, "unsupported", "An expression takes one open bound.");
        openBound = token.label === Role.DIR_AFTER ? "end" : "start";
        openToken = token;
        break;

      case Role.RANGE_END:
        if (calendar && clocks.length === 0) calendarEnd ??= {};
        if (
          days.length &&
          tokens.slice(index + 1).find((token) => token.label !== Role.O)
            ?.label === Role.WEEKDAY
        ) {
          pendingDayRange = true;
          rangedDays = true;
        }
        break;

      case Role.REL_DAY: {
        let phrase = word;
        while (tokens[index + 1]?.label === Role.REL_DAY)
          phrase += " " + tokens[++index].text.toLowerCase();
        if (!Object.hasOwn(relativeDays, phrase))
          fail(token, "unsupported", "Unknown relative day.");
        clause.date = { kind: "relativeDay", offset: relativeDays[phrase] };
        break;
      }

      case Role.EDGE:
        if (!["start", "beginning", "end", "rest", "remainder"].includes(word))
          fail(token, "unsupported", "Unknown calendar edge.");
        edge = word === "start" || word === "beginning" ? "start" : "end";
        break;

      case Role.NOW:
        if (!["now", "immediately"].includes(word))
          fail(token, "unsupported", "Unknown immediate-time expression.");
        clause.date = { kind: "now" };
        break;

      case Role.DEICTIC:
        modifier = Object.hasOwn(modifiers, word) ? modifiers[word] : undefined;
        if (!modifier) fail(token, "unsupported", "Unknown date modifier.");
        break;

      case Role.UNIT: {
        const value = unit(word);
        if (!value) fail(token, "unsupported", "Unknown calendar unit.");
        const boundary =
          edge ??
          (/^eo[dwm]$/.test(word) ||
          tokens.some((part) => part.text.toLowerCase() === "end")
            ? "end"
            : undefined);
        if (ordinal !== undefined && value === "week") {
          clause.date = { kind: "calendarPeriod", month: 0, week: ordinal };
          break;
        }
        if (ordinal !== undefined && value === "month" && !modifier) {
          break;
        }
        if (!modifier && !boundary)
          fail(
            token,
            "unsupported",
            "A standalone unit needs a modifier or a quantity.",
          );
        clause.date = {
          kind: "relativeUnit",
          unit: value,
          modifier: modifier ?? "this",
          ...(boundary ? { edge: boundary } : {}),
        };
        break;
      }

      case Role.ORD:
        ordinal = number(word);
        if (
          !Number.isInteger(ordinal) ||
          ordinal === 0 ||
          Math.abs(ordinal) > 5
        )
          fail(token, "invalid-ordinal", "Use first through fifth, or last.");
        break;

      case Role.DAYGROUP: {
        // "business day" arrives as two tokens, like a compound holiday.
        const text =
          tokens[index + 1]?.label === Role.DAYGROUP &&
          /^days?$/.test(tokens[index + 1].text.toLowerCase())
            ? word + tokens[++index].text.toLowerCase()
            : word;
        const group = /^weekends?$/.test(text)
          ? "weekend"
          : /^((week|work)(day|night)s?|businessdays?)$/.test(text)
            ? "weekday"
            : undefined;
        if (!group) fail(token, "unsupported", "Unknown day group.");
        clause.date = {
          kind: "dayGroup",
          group,
          ...(modifier ? { modifier } : {}),
        };
        break;
      }

      case Role.NUM:
      case Role.CLOCK_OFFSET: {
        let target = index + 1;
        // "three minutes to eight" offsets an hour the way "quarter to" does.
        const offset =
          token.label === Role.NUM
            ? // "ten past six" says the unit only by position.
              ["past", "to"].includes(tokens[target]?.text.toLowerCase() ?? "")
              ? number(word)
              : unit(tokens[target++]?.text ?? "") === "minute"
                ? number(word)
                : NaN
            : word === "half"
              ? 30
              : word === "quarter"
                ? 15
                : NaN;
        const direction = tokens[target]?.text.toLowerCase();
        if (!["past", "to"].includes(direction) || !Number.isFinite(offset))
          fail(
            token,
            "invalid-time",
            "A fractional clock needs past or to and an hour.",
          );
        target++;
        if (tokens[target]?.label !== Role.HOUR)
          fail(token, "invalid-time", "A fractional clock needs an hour.");
        const { clock, next } = readClock(tokens, target);
        if (!("hour" in clock.value) || clock.value.minute !== 0)
          fail(token, "invalid-time", "A fractional clock needs a whole hour.");
        const total =
          (clock.value.hour * 60 +
            (direction === "to" ? -offset : offset) +
            1440) %
          1440;
        clock.value = { hour: Math.floor(total / 60), minute: total % 60 };
        clocks.push(clock);
        index = next - 1;
        break;
      }

      case Role.TIME_NAMED:
        if (!["noon", "midday", "midnight"].includes(word))
          fail(token, "unsupported", "Unknown named clock time.");
        clocks.push({
          value: { named: word === "midnight" ? "midnight" : "noon" },
          token,
          needsMeridiem: false,
        });
        break;

      case Role.DAYPART: {
        const part = Object.hasOwn(dayParts, word) ? dayParts[word] : undefined;
        if (!part) fail(token, "unsupported", "Unknown day part.");
        // "last night" names a day. Without this the modifier is dropped and
        // the day part lands on today. A weekday already consumed it.
        if (modifier && clause.date === undefined)
          clause.date = {
            kind: "relativeDay",
            offset: modifier === "last" ? -1 : modifier === "next" ? 1 : 0,
          };
        if (dayPartClock) {
          if ("part" in dayPartClock.value && dayPartClock.value.part === part)
            break;
          fail(
            token,
            "conflicting-daypart",
            "An expression has conflicting day parts.",
          );
        }
        dayPartClock = {
          value: { part },
          token,
          needsMeridiem: false,
        };
        break;
      }

      case Role.MONTH: {
        const value = month(word) ?? number(word);
        if (!Number.isInteger(value) || value < 1 || value > 12)
          fail(token, "invalid-date", "Unknown month.");
        calendar ??= {};
        const target = calendarEnd ?? calendar;
        if (target.month !== undefined)
          fail(
            token,
            "invalid-date",
            "A calendar date has more than one month.",
          );
        target.month = value;
        break;
      }

      case Role.DOM: {
        let value = number(word);
        // "twenty-first" arrives as separate tokens, optionally hyphenated.
        const onesIndex =
          tokens[index + 1]?.text === "-" ? index + 2 : index + 1;
        const ones = tokens[onesIndex];
        if (ones) {
          const combined = compoundOrdinal(word, ones.text);
          if (Number.isInteger(combined)) {
            value = combined;
            index = onesIndex;
          }
        }
        if (!Number.isInteger(value) || value < 1 || value > 31)
          fail(token, "invalid-date", "Day of month must be between 1 and 31.");
        calendar ??= {};
        const target = calendarEnd ?? calendar;
        if (target.day !== undefined)
          fail(
            token,
            "invalid-date",
            "Multiple dates need a range or recurrence.",
          );
        target.day = value;
        break;
      }

      case Role.YEAR: {
        const value = number(word);
        if (!Number.isInteger(value) || value < 1 || value > 9999)
          fail(token, "invalid-date", "Year is out of range.");
        // Two-digit years pivot at 69, the POSIX strptime rule.
        const year = value < 100 ? (value < 69 ? 2000 : 1900) + value : value;
        calendar ??= {};
        if (calendarEnd) calendarEnd.year = year;
        if (!calendarEnd || calendar.year === undefined) calendar.year = year;
        break;
      }

      case Role.WEEKDAY: {
        const day = weekday(word);
        if (!day) fail(token, "unsupported", "Unknown weekday.");
        if (firstDayIndex < 0) firstDayIndex = index;
        if (pendingDayRange) {
          let position = weekdays.indexOf(days.at(-1)!);
          while (weekdays[position] !== day) {
            position = (position + 1) % 7;
            days.push(weekdays[position]);
          }
          pendingDayRange = false;
        } else days.push(day);
        break;
      }

      case Role.HOLIDAY: {
        let text = word;
        while (tokens[index + 1]?.label === Role.HOLIDAY)
          text += tokens[++index].text.toLowerCase();
        const key = text.replace(/['’\s-]/g, "");
        if (!Object.hasOwn(holidayNames, key))
          fail(token, "unsupported", "Unknown fixed-date holiday.");
        clause.date = { kind: "holiday", name: holidayNames[key] };
        break;
      }

      case Role.MERIDIEM:
        // "at" introduces a following clock; it is also part of "at night".
        if (word === "at" && tokens[index + 1]?.label === Role.HOUR) break;
        fail(token, "invalid-time", "A time-of-day qualifier needs a clock.");

      case Role.HOUR: {
        const { clock, next } = readClock(tokens, index);
        clocks.push(clock);
        index = next - 1;
        break;
      }

      default:
        fail(
          token,
          "unsupported",
          `Unsupported token role ${LABELS[token.label]}.`,
        );
    }
  }

  if (clause.date?.kind === "calendarPeriod") {
    if (!calendar?.month)
      fail(tokens[0], "invalid-date", "A week of a month needs a named month.");
    clause.date = {
      ...clause.date,
      month: calendar.month,
      ...(calendar.year ? { year: calendar.year } : {}),
    };
    calendar = undefined;
    ordinal = undefined;
  }
  if (ordinal !== undefined && ordinal > 0 && !days.length) {
    // "the first of the month" names a calendar day; only a weekday makes it ordinal.
    calendar ??= {};
    calendar.day ??= ordinal;
    ordinal = undefined;
  }
  if (ordinal !== undefined) {
    if (days.length !== 1)
      fail(tokens[0], "invalid-ordinal", "An ordinal needs one weekday.");
    const of =
      clause.date?.kind === "relativeUnit" &&
      ["month", "year"].includes(clause.date.unit)
        ? {
            kind: "relativeUnit" as const,
            unit: clause.date.unit as "month" | "year",
            modifier: clause.date.modifier,
          }
        : {
            kind: "calendar" as const,
            ...(calendar?.month ? { month: calendar.month } : {}),
            ...(calendar?.year ? { year: calendar.year } : {}),
          };
    clause.date = {
      kind: "ordinalWeekday",
      ordinal,
      day: days[0],
      of,
      ...(tokens.some(
        (value) =>
          value.label === Role.RECUR ||
          (value.label === Role.UNIT && unit(value.text) === "month"),
      ) && !modifier
        ? { recurring: true }
        : {}),
    };
    calendar = undefined;
  } else if (days.length) {
    const selected = [...new Set(days)];
    const preceding = tokens.slice(0, firstDayIndex);
    const explicitDateRange =
      rangedDays &&
      preceding.some((token) => token.label === Role.RANGE_START) &&
      !preceding.some(
        (token) => token.label === Role.HOUR || token.label === Role.TIME_NAMED,
      );
    if (explicitDateRange)
      clause.date = {
        kind: "weekdayRange",
        from: selected[0],
        to: selected.at(-1)!,
      };
    else if (rangedDays)
      clause.recurrence = { freq: "weekly", interval: 1, byDay: selected };
    else
      clause.date = {
        kind: "weekday",
        days: selected,
        ...(modifier ? { modifier } : {}),
      };
  }
  if (calendar) {
    delete clause.recurrence;
    if (
      (clause.date?.kind === "weekday" ||
        clause.date?.kind === "weekdayRange") &&
      calendar.day !== undefined
    )
      delete clause.date;
    if (clause.date)
      fail(
        tokens[0],
        "invalid-date",
        "Conflicting date specifications need separate clauses.",
      );
    if (calendarEnd) {
      if (calendar.day === undefined || calendarEnd.day === undefined)
        fail(
          tokens[0],
          "invalid-date",
          "Both ends of a calendar range need a day.",
        );
      const from = { ...calendar };
      const to = { ...calendar, ...calendarEnd };
      if (from.month === undefined && to.month !== undefined)
        from.month = to.month;
      clause.date = { kind: "calendarRange", from, to };
    } else if (
      calendar.month !== undefined &&
      calendar.day === undefined &&
      (modifier || edge)
    )
      clause.date = {
        kind: "calendarPeriod",
        month: calendar.month,
        ...(calendar.year ? { year: calendar.year } : {}),
        ...(modifier ? { modifier } : {}),
        ...(edge ? { edge } : {}),
      };
    else clause.date = { kind: "calendar", ...calendar };
  }

  if (dayPartClock) {
    if (clocks.length) {
      const part = dayPartClock.value;
      if ("part" in part)
        for (const clock of clocks) qualifyClock(clock, part.part);
      if (
        !clause.date &&
        (modifier === "this" ||
          tokens.some((token) => token.text.toLowerCase() === "this"))
      )
        clause.date = { kind: "relativeDay", offset: 0 };
    } else clocks.push(dayPartClock);
  }
  if (
    clocks.length &&
    tokens.some(
      (token) =>
        token.label === Role.REL_DAY &&
        ["tonight", "tonite"].includes(token.text.toLowerCase()),
    )
  ) {
    for (const clock of clocks) qualifyClock(clock, "night");
  }

  if (
    clocks.length === 2 &&
    !tokens.some(
      (token) =>
        token.label === Role.RANGE_END &&
        token.start > clocks[0].token.start &&
        token.start < clocks[1].token.start,
    )
  ) {
    fail(
      clocks[1].token,
      "unlinked-times",
      "Two clocks need a range separator or separate clauses.",
    );
  }
  const time = compileTime(clocks, diagnostics);
  // "later this week" carries no clock, so the open bound names an edge of the period.
  if (
    openBound &&
    !time &&
    clause.date?.kind === "relativeUnit" &&
    !clause.date.edge
  ) {
    clause.date = { ...clause.date, edge: openBound };
    openBound = undefined;
  }
  if (openToken && openBound) {
    if (!time)
      fail(
        openToken,
        "open-bound-needs-time",
        'An open bound needs a clock time, as in "after 6pm".',
      );
    if (time.end)
      fail(
        openToken,
        "open-bound-needs-time",
        "An open bound takes one time, not a range.",
      );
    if (openBound === "end") time.open = "end";
    else {
      // "before 6pm" reads as midnight up to 6pm; the start is the floor.
      time.end = time.start;
      time.start = { hour: 0, minute: 0 };
      time.open = "start";
    }
  } else if (
    time &&
    !time.end &&
    clocks.length === 1 &&
    tokens.some((token) => token.label === Role.RANGE_START) &&
    !tokens.some((token) => token.label === Role.RANGE_END)
  ) {
    // "from 6pm" means the same as "after 6pm". It used to return a bare
    // instant and drop the openness, which a caller could not detect. A
    // "from" that opens a real range ("from 8 to 10pm") keeps both edges.
    time.open = "end";
  } else if (
    time &&
    !time.end &&
    clocks.length === 1 &&
    !tokens.some((token) => token.label === Role.RANGE_START) &&
    tokens.some(
      (token, index) =>
        token.label === Role.RANGE_END &&
        // Only when the separator belongs to the clock. In "14-15 jul at 9:45"
        // it joins two days, and that clause is a date range, not a deadline.
        tokens
          .slice(index + 1, tokens.indexOf(clocks[0].token))
          .every((between) => filler.has(lower(between))),
    )
  ) {
    // The mirror of the branch above: "until 3pm" has no reading where 3pm
    // starts the window, so a range end with nothing opening it is a deadline.
    time.end = time.start;
    time.start = { hour: 0, minute: 0 };
    time.open = "start";
  }
  // 24:00 is an end of day, which is why clock.ts takes it as a range end and
  // refuses it as a start. Checked here, after the deadline swaps above, so a
  // bad start reports a diagnostic instead of throwing when it resolves.
  if (time && "hour" in time.start && time.start.hour === 24)
    fail(clocks[0].token, "invalid-time", "24:00 is only an end of day.");
  if (time) clause.time = time;
  const firstClockIndex = tokens.findIndex((token) =>
    [Role.HOUR, Role.TIME_NAMED, Role.DAYPART, Role.CLOCK_OFFSET].includes(
      token.label,
    ),
  );
  if (
    clause.date?.kind === "calendarRange" &&
    time?.end &&
    tokens.findIndex((token) => token.label === Role.RANGE_END) <
      firstClockIndex
  ) {
    clause.recurrence = {
      freq: "daily",
      interval: 1,
      start: clause.date,
      until: { kind: "calendar", ...clause.date.to },
    };
    delete clause.date;
  }
  if (modifier && !clause.date && clause.time)
    diagnostics.push(
      diagnostic(
        tokens[0],
        "dropped-constraint",
        "A date modifier was ignored because the expression names no date.",
        "warning",
      ),
    );
  if (!clause.date && !clause.time && !clause.recurrence) {
    fail(tokens[0], "unsupported", "The expression has no date or time.");
  }

  return clause;
}

function extractShift(tokens: Token[]): { tokens: Token[]; shift?: Shift } {
  const directionIndex = tokens.findIndex(
    (token) =>
      token.label === Role.DIR_BEFORE || token.label === Role.DIR_AFTER,
  );
  if (directionIndex < 0) return { tokens };

  const amountIndex = tokens.findIndex((token) => token.label === Role.NUM);
  const unitIndex = tokens.findIndex((token) => token.label === Role.UNIT);
  if (amountIndex < 0 || unitIndex < 0) return { tokens };

  // "for 3 days from today" spans from an anchor, so a forward direction after
  // an explicit duration introduces that anchor. "ago" never does.
  const durationIndex = tokens.findIndex((token) => token.label === Role.DUR);
  if (
    tokens[directionIndex].label === Role.DIR_AFTER &&
    durationIndex >= 0 &&
    durationIndex < amountIndex &&
    amountIndex < directionIndex
  )
    return { tokens: tokens.filter((_, index) => index !== directionIndex) };

  const amountToken = tokens[amountIndex];
  const quantity = readDuration(tokens, amountIndex);
  const amount = quantity?.duration.amount ?? number(amountToken.text);
  const durationUnit = quantity?.duration.unit ?? unit(tokens[unitIndex].text);

  if (
    !durationUnit ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    (!Number.isInteger(amount) && !["minute", "hour"].includes(durationUnit))
  ) {
    fail(amountToken, "invalid-shift", "Invalid relative quantity.");
  }

  const consumed = new Set([amountIndex, unitIndex, directionIndex]);
  if (quantity)
    for (let i = amountIndex; i < quantity.next; i++) consumed.add(i);
  let endAmount: number | undefined;
  const rangeIndex = tokens.findIndex(
    (token, index) =>
      index > amountIndex &&
      index < unitIndex &&
      token.label === Role.RANGE_END,
  );
  if (rangeIndex >= 0) {
    const endToken = tokens[rangeIndex + 1];
    endAmount = endToken?.label === Role.NUM ? number(endToken.text) : NaN;
    if (!Number.isInteger(endAmount) || endAmount < amount)
      fail(
        tokens[rangeIndex],
        "invalid-shift",
        "A relative range needs an end amount at least as large as its start.",
      );
    consumed.add(rangeIndex);
    consumed.add(rangeIndex + 1);
  }
  return {
    tokens: tokens.filter((_, index) => !consumed.has(index)),
    shift: {
      amount,
      ...(quantity?.duration.components
        ? { components: quantity.duration.components }
        : {}),
      ...(endAmount === undefined ? {} : { endAmount }),
      ...(approximately.has(lower(tokens[amountIndex - 1]))
        ? { approximate: true }
        : {}),
      unit: durationUnit,
      direction:
        tokens[directionIndex].label === Role.DIR_BEFORE ? "before" : "after",
    },
  };
}

function compileClause(input: Token[], diagnostics: Diagnostic[]): Clause {
  input = contextualBounds(input);
  const last = input.findLast((token) => token.label !== Role.O);
  if (last?.label === Role.RANGE_END) {
    if (
      last.text.toLowerCase() === "until" &&
      input.some((token) =>
        [Role.RECUR, Role.FREQ, Role.DAYGROUP].includes(token.label),
      )
    )
      fail(last, "invalid-bound", "A bound needs a date.");
    fail(last, "incomplete-range", "A range needs an end value.");
  }
  if (
    input.some((token) => token.label === Role.RECUR) &&
    !input.some((token) =>
      [
        Role.UNIT,
        Role.FREQ,
        Role.WEEKDAY,
        Role.DAYGROUP,
        Role.MONTH,
        Role.DAYPART,
      ].includes(token.label),
    )
  )
    fail(
      input[0],
      "incomplete-recurrence",
      "A recurrence needs a frequency or calendar selector.",
    );
  let { tokens, shift } = extractShift(input);
  const body: Token[] = [];
  const boundIndex = tokens.findIndex((token) =>
    recurrenceBounds.has(token.label),
  );
  const selectors = boundIndex < 0 ? tokens : tokens.slice(0, boundIndex);
  const implicitOrdinal =
    selectors.some((token) => token.label === Role.ORD) &&
    selectors.some((token) => token.label === Role.WEEKDAY) &&
    selectors.some(
      (token) => token.label === Role.UNIT && unit(token.text) === "month",
    ) &&
    !selectors.some((token) => token.label === Role.DEICTIC);
  // Only a plural name repeats on its own: "weekends" and "tuesdays" recur, "the
  // weekend" names the coming one. An explicit RECUR marker still makes a series.
  const pluralDayGroup = selectors.some(
    (token) =>
      (token.label === Role.DAYGROUP ||
        (token.label === Role.WEEKDAY &&
          dayNames.includes(token.text.toLowerCase().replace(/s$/, "")))) &&
      /s$/i.test(token.text),
  );
  // The weekly default belongs to a weekday. "every morning" repeats once a day
  // and "every May" once a year, so a lone day part or month sets its own period.
  const alone = (label: Role) =>
    selectors.some((token) => token.label === label) &&
    !selectors.some(
      (token) =>
        token.label !== label &&
        [
          Role.UNIT,
          Role.FREQ,
          Role.WEEKDAY,
          Role.DAYGROUP,
          Role.MONTH,
          Role.DAYPART,
        ].includes(token.label),
    );
  const period = implicitOrdinal
    ? "monthly"
    : alone(Role.MONTH)
      ? "yearly"
      : alone(Role.DAYPART)
        ? "daily"
        : "weekly";
  let recurrence: Recurrence | undefined =
    selectors.some((token) => token.label === Role.RECUR) ||
    implicitOrdinal ||
    (pluralDayGroup && !selectors.some((token) => token.label === Role.DEICTIC))
      ? { freq: period, interval: 1 }
      : undefined;
  let duration: Duration | undefined;
  let startingDate: DateSpec | undefined;
  let boundTime: TimeSpec | undefined;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.label === Role.RECUR) {
      recurrence ??= { freq: "weekly", interval: 1 };
      continue;
    }

    if (token.label === Role.FREQ) {
      const word = token.text.toLowerCase();
      if (!Object.hasOwn(frequencyWords, word))
        fail(token, "unsupported", "Unknown recurrence frequency.");
      recurrence = {
        ...recurrence,
        freq: frequencyWords[word],
        interval: frequencyIntervals[word] ?? recurrence?.interval ?? 1,
      };
      continue;
    }

    if (
      token.label === Role.TIMES ||
      (token.label === Role.NUM && tokens[index + 1]?.label === Role.TIMES)
    ) {
      const count = number(token.text);
      let period = index + (token.label === Role.NUM ? 2 : 1);
      while (
        tokens[period]?.label === Role.O ||
        tokens[period]?.label === Role.RECUR
      )
        period++;
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        tokens[period]?.label !== Role.UNIT
      )
        fail(
          token,
          "invalid-frequency",
          "A frequency count needs a positive number and a period.",
        );
      recurrence = {
        ...recurrence,
        freq: frequencyFor(tokens[period]),
        interval: recurrence?.interval ?? 1,
        timesPer: count,
      };
      index = period;
      continue;
    }

    if (recurrence && token.label === Role.UNIT) {
      recurrence.freq = frequencyFor(token);
      if (/^fortnights?$/i.test(token.text)) recurrence.interval = 2;
      continue;
    }
    if (recurrence && token.label === Role.ORD) {
      const value = number(token.text);
      if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 5)
        fail(token, "invalid-ordinal", "Use first through fifth, or last.");
      // "the last day of every month" picks a day of the month, not an occurrence.
      if (
        tokens[index + 1]?.label === Role.UNIT &&
        unit(tokens[index + 1].text) === "day"
      )
        (recurrence.byMonthDay ??= []).push(value);
      else (recurrence.bySetPos ??= []).push(value);
      continue;
    }
    if (recurrence && token.label === Role.DOM) {
      const value = number(token.text);
      if (!Number.isInteger(value) || value < 1 || value > 31)
        fail(token, "invalid-date", "Day of month is out of range.");
      (recurrence.byMonthDay ??= []).push(value);
      continue;
    }
    if (recurrence && token.label === Role.MONTH) {
      const value = month(token.text) ?? number(token.text);
      if (!Number.isInteger(value) || value < 1 || value > 12)
        fail(token, "invalid-date", "Month is out of range.");
      (recurrence.byMonth ??= []).push(value);
      continue;
    }
    if (
      recurrence &&
      token.label === Role.NUM &&
      tokens[index + 1]?.label === Role.COUNT
    ) {
      const count = number(token.text);
      if (!Number.isInteger(count) || count < 1)
        fail(token, "invalid-count", "Occurrence count must be positive.");
      recurrence.count = count;
      index++;
      continue;
    }

    // "three minutes to eight" is a clock, not a three-minute duration.
    const clockOffset =
      ["past", "to"].includes(tokens[index + 2]?.text.toLowerCase() ?? "") &&
      tokens[index + 3]?.label === Role.HOUR;
    const bareDuration =
      !recurrence &&
      token.label === Role.NUM &&
      tokens[index + 1]?.label === Role.UNIT &&
      !clockOffset;
    if (token.label === Role.DUR || bareDuration) {
      let amountIndex = index + (bareDuration ? 0 : 1);
      while (
        tokens[amountIndex] &&
        [Role.O, Role.DEICTIC].includes(tokens[amountIndex].label)
      )
        amountIndex++;
      const amountToken = tokens[amountIndex];
      const quantity = readDuration(tokens, amountIndex);
      if (!quantity)
        fail(
          token,
          "invalid-duration",
          "A duration needs a positive quantity and a time unit.",
        );
      const value = quantity.duration;
      const durationUnit = value.unit;
      // After hours or minutes only an explicit "from" anchors; the glue kind
      // states a start clock, as in "last for 2 hours from 2pm".
      const fromAnchor =
        lower(tokens[quantity.next]) === "from" &&
        (tokens[quantity.next].label === Role.RANGE_START ||
          !["second", "minute", "hour"].includes(durationUnit));
      if (bareDuration && !shift && fromAnchor) {
        // "a week from Tuesday" moves the anchor; it does not span a week.
        shift = { ...value, direction: "after" };
        index = quantity.next;
        continue;
      }
      if (
        recurrence &&
        !["minute", "hour"].includes(durationUnit) &&
        token.text.toLowerCase() !== "lasting"
      ) {
        if (recurrence.span)
          fail(
            token,
            "conflicting-duration",
            "A recurrence has more than one series duration.",
          );
        recurrence.span = value;
      } else {
        if (duration)
          fail(
            token,
            "conflicting-duration",
            "A clause has more than one occurrence duration.",
          );
        duration = value;
      }
      // With an explicit duration, "from" introduces its start, not an open range.
      index = quantity.next - 1 + Number(fromAnchor);
      continue;
    }

    const isWeekdayInterval =
      token.label === Role.NUM &&
      [Role.WEEKDAY, Role.DAYGROUP, Role.UNIT].includes(
        tokens[index + 1]?.label,
      );
    if (recurrence && isWeekdayInterval) {
      const interval = number(token.text);
      if (!Number.isInteger(interval) || interval < 1) {
        fail(
          token,
          "invalid-interval",
          "Recurrence interval must be positive.",
        );
      }
      recurrence.interval = interval;
      continue;
    }

    if (recurrenceBounds.has(token.label)) {
      if (!recurrence && token.label !== Role.BOUND_START)
        fail(token, "unsupported", "This bound requires recurrence.");

      let end = index + 1;
      while (
        end < tokens.length &&
        !recurrenceBounds.has(tokens[end].label) &&
        tokens[end].label !== Role.DUR &&
        !(
          tokens[end].label === Role.NUM &&
          tokens[end + 1]?.label === Role.COUNT
        )
      )
        end++;

      const bound = tokens.slice(index + 1, end);
      if (!bound.length) fail(token, "invalid-bound", "A bound needs a date.");
      const compiled = compileDateAndTime(bound, diagnostics);
      const date = compiled.date;
      // "starting at 8:30" names a clock, not a date; it is the clause's own time.
      if (!date && token.label === Role.BOUND_START && compiled.time?.start) {
        boundTime ??= compiled.time;
        index = end - 1;
        continue;
      }
      if (!date) fail(token, "invalid-bound", "A bound needs a date.");
      // "every Monday until Friday at 5pm" states the series clock inside the
      // bound; keeping only the date used to drop it without a word.
      if (compiled.time) boundTime ??= compiled.time;

      if (token.label === Role.BOUND_START) {
        if (recurrence) recurrence.start = date;
        else startingDate = date;
      } else if (token.label === Role.BOUND_END) recurrence!.until = date;
      else recurrence!.except = [...(recurrence!.except ?? []), date];

      index = end - 1;
      continue;
    }

    body.push(token);
  }

  const hasDateOrTime = body.some((token) => token.label !== Role.O);
  const clause = hasDateOrTime ? compileDateAndTime(body, diagnostics) : {};
  if (shift) clause.shift = shift;
  if (duration) clause.duration = duration;
  if (boundTime) {
    if (clause.time)
      diagnostics.push(
        diagnostic(
          input[0],
          "dropped-constraint",
          "A clock inside a bound was ignored.",
          "warning",
        ),
      );
    else clause.time = boundTime;
  }
  if (startingDate) {
    if (clause.date)
      fail(
        input[0],
        "invalid-date",
        "A one-off clause has conflicting starting dates.",
      );
    clause.date = startingDate;
  }

  const sameTime = input.some((token, index) =>
    sameTimePair(input[index - 1], token),
  );
  if (clause.date?.kind === "relativeUnit" && !clause.date.edge && sameTime) {
    const { modifier, unit } = clause.date;
    if (shift)
      fail(input[0], "conflicting-shift", "A clause has more than one shift.");
    clause.date = { kind: "now" };
    clause.shift = {
      amount: modifier === "this" ? 0 : 1,
      unit,
      direction: modifier === "last" ? "before" : "after",
    };
  }

  if (clause.recurrence)
    recurrence = {
      ...clause.recurrence,
      ...recurrence,
      byDay: recurrence?.byDay ?? clause.recurrence.byDay,
    };
  if (recurrence && clause.date?.kind === "dayGroup" && !clause.date.modifier) {
    recurrence.byDay =
      clause.date.group === "weekday"
        ? weekdays.slice(0, 5)
        : weekdays.slice(5);
    delete clause.date;
  }
  if (recurrence) {
    if (recurrence.count !== undefined && (recurrence.until || recurrence.span))
      fail(
        input[0],
        "conflicting-bounds",
        "Use a count or an end bound, not both.",
      );
    if (clause.date?.kind === "weekday") {
      recurrence.byDay = clause.date.days;
      delete clause.date;
    }
    clause.recurrence = recurrence;
  }

  return clause;
}

// A short run of unknown words between two labelled tokens is an aside
// ("friday, say, around 3"), not the end of the expression.
const asideLimit = 3;

function splitExpressions(tokens: Token[]): Token[][] {
  const expressions: Token[][] = [];
  let current: Token[] = [];
  let aside: Token[] = [];
  let leading: Token[] = [];

  for (let index = 0; index < tokens.length; index++) {
    let token = tokens[index];
    if (token.kind === 3) continue;
    if (
      token.text.toLowerCase() === "until" &&
      [Role.O, Role.GLUE].includes(token.label) &&
      current.some((part) => [Role.RECUR, Role.FREQ].includes(part.label))
    )
      token = { ...token, label: Role.RANGE_END };

    if (!current.length && token.label === Role.O) {
      leading.push(token);
      continue;
    }

    if (token.label !== Role.O || filler.has(token.text.toLowerCase())) {
      if (!current.length && sameTimePair(leading.at(-2), leading.at(-1)))
        current.push(...leading.slice(-2));
      else if (
        !current.length &&
        token.label === Role.DAYPART &&
        lower(leading.at(-1)) === "this"
      )
        current.push(leading.at(-1)!);
      // "about 20 minutes" leads with the qualifier that makes the shift loose.
      else if (
        !current.length &&
        token.label === Role.NUM &&
        approximately.has(lower(leading.at(-1)))
      )
        current.push(leading.at(-1)!);
      leading = [];
      if (aside.length > asideLimit) {
        expressions.push(current);
        current = [];
      } else current.push(...aside);
      aside = [];
      current.push(token);
    } else if (current.length) {
      aside.push(token);
    }
  }

  if (current.length) {
    if (aside.length === 2 && sameTimePair(aside[0], aside[1]))
      current.push(...aside);
    expressions.push(current);
  }

  return expressions.filter((expression) => {
    const startsWithTimeCue = () =>
      sameTimePair(expression[0], expression[1]) ||
      (lower(expression[0]) === "this" &&
        expression[1]?.label === Role.DAYPART) ||
      (approximately.has(lower(expression[0])) &&
        expression[1]?.label === Role.NUM);
    while (
      expression[0] &&
      [Role.O, Role.GLUE, Role.JOIN].includes(expression[0].label) &&
      !startsWithTimeCue()
    )
      expression.shift();
    const endsWithTimeCue = () =>
      sameTimePair(expression.at(-2), expression.at(-1));
    while (
      expression.length &&
      [Role.O, Role.GLUE, Role.JOIN].includes(expression.at(-1)!.label) &&
      !endsWithTimeCue()
    )
      expression.pop();
    return expression.length > 0;
  });
}

function splitClauses(tokens: Token[]): Token[][] {
  const clauses: Token[][] = [[]];

  for (const token of tokens) {
    const current = clauses.at(-1)!;
    const hasMeaning = current.some(
      (part) => ![Role.O, Role.GLUE, Role.JOIN].includes(part.label),
    );
    if (token.clauseStart && hasMeaning) clauses.push([]);
    clauses.at(-1)!.push(token);
  }

  return clauses;
}

function compileGroup(tokens: Token[], diagnostics: Diagnostic[]): Clause[] {
  let clocks = 0;
  for (const token of tokens) {
    if (
      [Role.HOUR, Role.TIME_NAMED, Role.DAYPART].includes(token.label) &&
      ++clocks === 2
    )
      break;
  }
  if (clocks < 2) return [compileClause(tokens, diagnostics)];
  const hasRecurrence = tokens.some((token) =>
    [Role.RECUR, Role.FREQ, Role.DAYGROUP].includes(token.label),
  );
  const separator = tokens.findIndex(
    (token) => token.label === Role.RANGE_END || token.label === Role.BOUND_END,
  );
  const isDate = (token: Token) =>
    [Role.REL_DAY, Role.WEEKDAY, Role.MONTH, Role.DOM, Role.YEAR].includes(
      token.label,
    );
  const isClock = (token: Token) =>
    [Role.HOUR, Role.TIME_NAMED, Role.CLOCK_OFFSET].includes(token.label);
  if (!hasRecurrence && separator > 0) {
    const left = tokens.slice(0, separator);
    const right = tokens.slice(separator + 1);
    if (
      left.some(isDate) &&
      right.some(isDate) &&
      left.some(isClock) &&
      right.some(isClock)
    ) {
      const start = compileDateAndTime(left, diagnostics);
      const end = compileDateAndTime(right, diagnostics);
      if (!start.date || !end.date || !start.time || !end.time)
        fail(
          tokens[separator],
          "incomplete-range",
          "Both endpoints need a date and clock.",
        );
      return [
        {
          date: start.date,
          endDate: end.date,
          time: { start: start.time.start, end: end.time.start },
        },
      ];
    }
  }
  // Conjoined clock points inherit the date and recurrence preceding the first clock.
  if (separator < 0) {
    const groups: Token[][] = [[]];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (
        ["and", ",", "&"].includes(token.text.toLowerCase()) &&
        groups.at(-1)!.some(isClock) &&
        isClock(tokens[index + 1] ?? token)
      ) {
        groups.push([]);
      } else groups.at(-1)!.push(token);
    }
    if (groups.length > 1) {
      const first = compileClause(groups[0], diagnostics);
      return [
        first,
        ...groups.slice(1).map((group) => {
          const next = compileClause(group, diagnostics);
          return { ...structuredClone(first), ...next };
        }),
      ];
    }
  }
  return [compileClause(tokens, diagnostics)];
}

function compileExpression(text: string, tokens: Token[]): Expression {
  const start = tokens[0].start;
  const end = tokens.at(-1)!.end;
  const diagnostics: Diagnostic[] = [];
  let schedule: Expression["schedule"] = null;

  try {
    const clauses = splitClauses(tokens).flatMap((clause) =>
      compileGroup(
        clause
          .filter(
            (token) =>
              token.label !== Role.GLUE ||
              token.kind === 2 ||
              ["past", "to", "and", "a", "an", "from"].includes(
                token.text.toLowerCase(),
              ),
          )
          .map((token) =>
            token.label === Role.GLUE || token.label === Role.JOIN
              ? { ...token, label: Role.O }
              : token,
          ),
        diagnostics,
      ),
    );
    schedule = { clauses };
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    diagnostics.push(error.diagnostic);
  }

  const ignored = tokens.filter(
    (token) =>
      token.label === Role.O &&
      token.kind !== 3 &&
      !filler.has(token.text.toLowerCase()),
  );
  if (ignored.length) {
    diagnostics.push({
      code: "filler-ignored",
      message: `Ignored ${ignored.map((token) => token.text).join(" ")} inside the expression.`,
      start: ignored[0].start,
      end: ignored.at(-1)!.end,
      severity: "warning",
    });
  }

  const scores = tokens
    .filter((token) => ![Role.O, Role.GLUE, Role.JOIN].includes(token.label))
    .map((token) => token.score);
  const confidence = Math.min(...scores);
  if (confidence < 0.5) {
    diagnostics.push(
      diagnostic(
        tokens[0],
        "low-confidence",
        "The model is uncertain about this expression.",
        "warning",
      ),
    );
  }

  return {
    start,
    end,
    text: text.slice(start, end),
    confidence,
    schedule,
    diagnostics,
  };
}

function numericDateOrder(tokens: Token[], order: "MDY" | "DMY"): Token[] {
  const result = [...tokens];
  const separator = (token: Token | undefined) =>
    token &&
    [Role.O, Role.GLUE].includes(token.label) &&
    ["/", ".", "-"].includes(token.text);
  for (let index = 0; index + 2 < tokens.length; index++) {
    const first = tokens[index];
    const second = tokens[index + 2];
    const datePair =
      [Role.MONTH, Role.DOM].includes(first.label) &&
      [Role.MONTH, Role.DOM].includes(second.label);
    if (!datePair || !separator(tokens[index + 1]) || second.clauseStart)
      continue;
    const yearFirst =
      tokens[index - 1]?.label === Role.YEAR ||
      (separator(tokens[index - 1]) && tokens[index - 2]?.label === Role.YEAR);
    if (!/^\d+$/.test(first.text) || !/^\d+$/.test(second.text)) continue;
    if (yearFirst) {
      // A year-first numeric date always uses year/month/day, even when invalid.
      result[index] = { ...first, label: Role.MONTH };
      result[index + 2] = { ...second, label: Role.DOM };
      continue;
    }
    const a = Number(first.text);
    const b = Number(second.text);
    if (a < 1 || a > 31 || b < 1 || b > 31 || (a > 12 && b > 12)) continue;
    const selected = a > 12 ? "DMY" : b > 12 ? "MDY" : order;
    result[index] = {
      ...first,
      label: selected === "MDY" ? Role.MONTH : Role.DOM,
    };
    result[index + 2] = {
      ...second,
      label: selected === "MDY" ? Role.DOM : Role.MONTH,
    };
  }
  return result;
}

function contextualBounds(tokens: Token[]): Token[] {
  if (!tokens.some((token) => [Role.RECUR, Role.FREQ].includes(token.label)))
    return tokens;
  const result = [...tokens];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.label !== Role.RANGE_END || token.text.toLowerCase() !== "until")
      continue;
    const operand = tokens
      .slice(index + 1)
      .find((candidate) => ![Role.O, Role.GLUE].includes(candidate.label));
    if (
      operand &&
      [
        Role.REL_DAY,
        Role.DEICTIC,
        Role.WEEKDAY,
        Role.MONTH,
        Role.DOM,
        Role.YEAR,
        Role.HOLIDAY,
      ].includes(operand.label)
    )
      result[index] = { ...token, label: Role.BOUND_END };
  }
  return result;
}

export function compilePredictions(
  text: string,
  tokens: Token[],
  options: Pick<ParserOptions, "dateOrder"> = {},
): Expression[] {
  return splitExpressions(tokens).map((expression) =>
    compileExpression(
      text,
      numericDateOrder(expression, options.dateOrder ?? "MDY"),
    ),
  );
}

// Oracle and diagnostic tools keep their readable string-label interface.
export function compile(
  text: string,
  tokens: SourceToken[],
  options: Pick<ParserOptions, "dateOrder"> = {},
): Expression[] {
  return compilePredictions(
    text,
    tokens.map((token) => ({ ...token, label: labelId[token.label] as Role })),
    options,
  );
}
