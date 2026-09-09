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
  Recurrence,
  Shift,
  TimeSpec,
  Token,
  Weekday,
  Unit,
  ParserOptions,
} from "./types.js";
import {
  holidayNames,
  month,
  number,
  unit,
  weekday,
  weekdays,
} from "./lexicon.js";

const filler = new Set([
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
};
const dayParts: Record<string, DayPart> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night",
};
const recurrenceBounds = new Set(["BOUND_START", "BOUND_END", "EXCEPT"]);
const modifiers: Record<string, Modifier> = {
  this: "this",
  next: "next",
  coming: "next",
  upcoming: "next",
  last: "last",
  previous: "last",
  past: "last",
};

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
  weekly: "weekly",
  biweekly: "weekly",
  fortnightly: "weekly",
  monthly: "monthly",
  yearly: "yearly",
  annually: "yearly",
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
  let hasMinutes = false;
  let next = index + 1;

  if (tokens[next]?.text === ":" && tokens[next + 1]?.label === "MINUTE") {
    minute = number(tokens[next + 1].text);
    hasMinutes = true;
    next += 2;
  }

  if (tokens[next]?.text === ":" && tokens[next + 1]?.label === "SECOND") {
    second = number(tokens[next + 1].text);
    next += 2;
  }

  while (tokens[next]?.label === "MERIDIEM") {
    const part = tokens[next].text.toLowerCase().replace(/\./g, "");
    meridiem = (meridiem ?? "") + part;
    next++;
  }
  if (meridiem) meridiem = clockPeriods.get(meridiem) ?? meridiem;

  const invalidHour = !Number.isInteger(hour) || hour < 0 || hour > 23;
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
      needsMeridiem: !meridiem && !hasMinutes && hour > 0 && hour <= 12,
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

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const word = token.text.toLowerCase();

    switch (token.label) {
      case "O":
      case "RANGE_START":
        break;

      case "RANGE_END":
        if (calendar && clocks.length === 0) calendarEnd ??= {};
        if (
          days.length &&
          tokens.slice(index + 1).find((token) => token.label !== "O")
            ?.label === "WEEKDAY"
        ) {
          pendingDayRange = true;
          rangedDays = true;
        }
        break;

      case "REL_DAY": {
        let phrase = word;
        while (tokens[index + 1]?.label === "REL_DAY")
          phrase += " " + tokens[++index].text.toLowerCase();
        if (!Object.hasOwn(relativeDays, phrase))
          fail(token, "unsupported", "Unknown relative day.");
        clause.date = { kind: "relativeDay", offset: relativeDays[phrase] };
        break;
      }

      case "EDGE":
        if (!["start", "beginning", "end"].includes(word))
          fail(token, "unsupported", "Unknown calendar edge.");
        edge = word === "end" ? "end" : "start";
        break;

      case "NOW":
        if (!["now", "immediately"].includes(word))
          fail(token, "unsupported", "Unknown immediate-time expression.");
        clause.date = { kind: "now" };
        break;

      case "DEICTIC":
        modifier = Object.hasOwn(modifiers, word) ? modifiers[word] : undefined;
        if (!modifier) fail(token, "unsupported", "Unknown date modifier.");
        break;

      case "UNIT": {
        const value = unit(word);
        if (!value) fail(token, "unsupported", "Unknown calendar unit.");
        const boundary =
          edge ??
          (tokens.some((part) => part.text.toLowerCase() === "end")
            ? "end"
            : undefined);
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

      case "ORD":
        ordinal = number(word);
        if (
          !Number.isInteger(ordinal) ||
          ordinal === 0 ||
          Math.abs(ordinal) > 5
        )
          fail(token, "invalid-ordinal", "Use first through fifth, or last.");
        break;

      case "DAYGROUP": {
        const group = /^(weekend|weekends)$/.test(word)
          ? "weekend"
          : /^(weekday|weekdays|workday|workdays)$/.test(word)
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

      case "TIME_NAMED":
        if (!["noon", "midday", "midnight"].includes(word))
          fail(token, "unsupported", "Unknown named clock time.");
        clocks.push({
          value: { named: word === "midnight" ? "midnight" : "noon" },
          token,
          needsMeridiem: false,
        });
        break;

      case "DAYPART": {
        const part = Object.hasOwn(dayParts, word) ? dayParts[word] : undefined;
        if (!part) fail(token, "unsupported", "Unknown day part.");
        clocks.push({ value: { part }, token, needsMeridiem: false });
        break;
      }

      case "MONTH": {
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

      case "DOM": {
        const value = number(word);
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

      case "YEAR": {
        const value = number(word);
        if (!Number.isInteger(value) || value < 1 || value > 9999)
          fail(token, "invalid-date", "Year is out of range.");
        const year = value < 100 ? 2000 + value : value;
        calendar ??= {};
        if (calendarEnd) calendarEnd.year = year;
        if (!calendarEnd || calendar.year === undefined) calendar.year = year;
        break;
      }

      case "WEEKDAY": {
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

      case "HOLIDAY": {
        let text = word;
        while (tokens[index + 1]?.label === "HOLIDAY")
          text += tokens[++index].text.toLowerCase();
        const key = text.replace(/['’\s-]/g, "");
        if (!Object.hasOwn(holidayNames, key))
          fail(token, "unsupported", "Unknown fixed-date holiday.");
        clause.date = { kind: "holiday", name: holidayNames[key] };
        break;
      }

      case "HOUR": {
        const { clock, next } = readClock(tokens, index);
        clocks.push(clock);
        index = next - 1;
        break;
      }

      default:
        fail(token, "unsupported", `Unsupported token role ${token.label}.`);
    }
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
    clause.date = { kind: "ordinalWeekday", ordinal, day: days[0], of };
    calendar = undefined;
  } else if (days.length) {
    const selected = [...new Set(days)];
    const preceding = tokens.slice(0, firstDayIndex);
    const explicitDateRange =
      rangedDays &&
      preceding.some((token) => token.label === "RANGE_START") &&
      !preceding.some(
        (token) => token.label === "HOUR" || token.label === "TIME_NAMED",
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
    if (days.length || clause.date)
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
      if (from.month === undefined) from.month = to.month;
      if (from.month === undefined || to.month === undefined)
        fail(tokens[0], "invalid-date", "A calendar range needs a month.");
      clause.date = { kind: "calendarRange", from, to };
    } else clause.date = { kind: "calendar", ...calendar };
  }

  if (
    clocks.length === 2 &&
    !tokens.some(
      (token) =>
        token.label === "RANGE_END" &&
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
  if (time) clause.time = time;
  if (!clause.date && !clause.time && !clause.recurrence) {
    fail(tokens[0], "unsupported", "The expression has no date or time.");
  }

  return clause;
}

function extractShift(tokens: Token[]): { tokens: Token[]; shift?: Shift } {
  const directionIndex = tokens.findIndex(
    (token) => token.label === "DIR_BEFORE" || token.label === "DIR_AFTER",
  );
  if (directionIndex < 0) return { tokens };

  const amountIndex = tokens.findIndex((token) => token.label === "NUM");
  const unitIndex = tokens.findIndex((token) => token.label === "UNIT");
  if (amountIndex < 0 || unitIndex < 0) return { tokens };

  const amountToken = tokens[amountIndex];
  const amount = number(amountToken.text);
  const durationUnit = unit(tokens[unitIndex].text);

  if (!durationUnit || !Number.isInteger(amount) || amount < 0) {
    fail(amountToken, "invalid-shift", "Invalid relative quantity.");
  }

  const consumed = new Set([amountIndex, unitIndex, directionIndex]);
  let endAmount: number | undefined;
  const rangeIndex = tokens.findIndex(
    (token, index) =>
      index > amountIndex && index < unitIndex && token.label === "RANGE_END",
  );
  if (rangeIndex >= 0) {
    const endToken = tokens[rangeIndex + 1];
    endAmount = endToken?.label === "NUM" ? number(endToken.text) : NaN;
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
      ...(endAmount === undefined ? {} : { endAmount }),
      unit: durationUnit,
      direction:
        tokens[directionIndex].label === "DIR_BEFORE" ? "before" : "after",
    },
  };
}

function compileClause(input: Token[], diagnostics: Diagnostic[]): Clause {
  const last = input.findLast((token) => token.label !== "O");
  if (last?.label === "RANGE_END")
    fail(last, "incomplete-range", "A range needs an end value.");
  if (
    input.some((token) => token.label === "RECUR") &&
    !input.some((token) =>
      ["UNIT", "FREQ", "WEEKDAY", "DAYGROUP", "MONTH"].includes(token.label),
    )
  )
    fail(
      input[0],
      "incomplete-recurrence",
      "A recurrence needs a frequency or calendar selector.",
    );
  const { tokens, shift } = extractShift(input);
  const body: Token[] = [];
  const implicitOrdinal =
    tokens.some((token) => token.label === "ORD") &&
    tokens.some((token) => token.label === "WEEKDAY") &&
    tokens.some(
      (token) => token.label === "UNIT" && unit(token.text) === "month",
    ) &&
    !tokens.some((token) => token.label === "DEICTIC");
  let recurrence: Recurrence | undefined =
    tokens.some((token) => token.label === "RECUR") || implicitOrdinal
      ? { freq: implicitOrdinal ? "monthly" : "weekly", interval: 1 }
      : undefined;
  let duration: Duration | undefined;
  let startingDate: DateSpec | undefined;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.label === "RECUR") {
      recurrence ??= { freq: "weekly", interval: 1 };
      continue;
    }

    if (token.label === "FREQ") {
      const word = token.text.toLowerCase();
      if (!Object.hasOwn(frequencyWords, word))
        fail(token, "unsupported", "Unknown recurrence frequency.");
      recurrence = {
        ...recurrence,
        freq: frequencyWords[word],
        interval: ["biweekly", "fortnightly"].includes(word)
          ? 2
          : (recurrence?.interval ?? 1),
      };
      continue;
    }

    if (
      token.label === "TIMES" ||
      (token.label === "NUM" && tokens[index + 1]?.label === "TIMES")
    ) {
      const count = number(token.text);
      let period = index + (token.label === "NUM" ? 2 : 1);
      while (tokens[period]?.label === "O" || tokens[period]?.label === "RECUR")
        period++;
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        tokens[period]?.label !== "UNIT"
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

    if (recurrence && token.label === "UNIT") {
      recurrence.freq = frequencyFor(token);
      continue;
    }
    if (recurrence && token.label === "ORD") {
      const value = number(token.text);
      if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 5)
        fail(token, "invalid-ordinal", "Use first through fifth, or last.");
      (recurrence.bySetPos ??= []).push(value);
      continue;
    }
    if (recurrence && token.label === "DOM") {
      const value = number(token.text);
      if (!Number.isInteger(value) || value < 1 || value > 31)
        fail(token, "invalid-date", "Day of month is out of range.");
      (recurrence.byMonthDay ??= []).push(value);
      continue;
    }
    if (recurrence && token.label === "MONTH") {
      const value = month(token.text) ?? number(token.text);
      if (!Number.isInteger(value) || value < 1 || value > 12)
        fail(token, "invalid-date", "Month is out of range.");
      (recurrence.byMonth ??= []).push(value);
      continue;
    }
    if (
      recurrence &&
      token.label === "NUM" &&
      tokens[index + 1]?.label === "COUNT"
    ) {
      const count = number(token.text);
      if (!Number.isInteger(count) || count < 1)
        fail(token, "invalid-count", "Occurrence count must be positive.");
      recurrence.count = count;
      index++;
      continue;
    }

    const bareDuration =
      !recurrence &&
      token.label === "NUM" &&
      tokens[index + 1]?.label === "UNIT";
    if (token.label === "DUR" || bareDuration) {
      let amountIndex = index + (bareDuration ? 0 : 1);
      while (
        tokens[amountIndex] &&
        ["O", "DEICTIC"].includes(tokens[amountIndex].label)
      )
        amountIndex++;
      const amountToken = tokens[amountIndex];
      const unitToken = tokens[amountIndex + 1];
      const amount =
        amountToken?.label === "NUM" ? number(amountToken.text) : NaN;
      const durationUnit =
        unitToken?.label === "UNIT" ? unit(unitToken.text) : undefined;
      if (!Number.isInteger(amount) || amount <= 0 || !durationUnit)
        fail(
          token,
          "invalid-duration",
          "A duration needs a positive number and a time unit.",
        );

      const value = { amount, unit: durationUnit };
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
      index = amountIndex + 1;
      continue;
    }

    const isWeekdayInterval =
      token.label === "NUM" &&
      ["WEEKDAY", "DAYGROUP", "UNIT"].includes(tokens[index + 1]?.label);
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
      if (!recurrence && token.label !== "BOUND_START")
        fail(token, "unsupported", "This bound requires recurrence.");

      let end = index + 1;
      while (
        end < tokens.length &&
        !recurrenceBounds.has(tokens[end].label) &&
        tokens[end].label !== "DUR" &&
        !(tokens[end].label === "NUM" && tokens[end + 1]?.label === "COUNT")
      )
        end++;

      const bound = tokens.slice(index + 1, end);
      if (!bound.length) fail(token, "invalid-bound", "A bound needs a date.");
      const date = compileDateAndTime(bound, diagnostics).date;
      if (!date) fail(token, "invalid-bound", "A bound needs a date.");

      if (token.label === "BOUND_START") {
        if (recurrence) recurrence.start = date;
        else startingDate = date;
      } else if (token.label === "BOUND_END") recurrence!.until = date;
      else recurrence!.except = [...(recurrence!.except ?? []), date];

      index = end - 1;
      continue;
    }

    body.push(token);
  }

  const hasDateOrTime = body.some((token) => token.label !== "O");
  const clause = hasDateOrTime ? compileDateAndTime(body, diagnostics) : {};
  if (shift) clause.shift = shift;
  if (duration) clause.duration = duration;
  if (startingDate) {
    if (clause.date)
      fail(
        input[0],
        "invalid-date",
        "A one-off clause has conflicting starting dates.",
      );
    clause.date = startingDate;
  }

  if (clause.recurrence)
    recurrence = {
      ...clause.recurrence,
      ...recurrence,
      byDay: recurrence?.byDay ?? clause.recurrence.byDay,
    };
  if (clause.date?.kind === "dayGroup" && !clause.date.modifier) {
    recurrence ??= { freq: "weekly", interval: 1 };
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

function splitExpressions(tokens: Token[]): Token[][] {
  const expressions: Token[][] = [];
  let current: Token[] = [];

  for (const token of tokens) {
    if (token.kind === 3) continue;

    if (token.label !== "O" || filler.has(token.text.toLowerCase())) {
      current.push(token);
    } else if (current.length) {
      expressions.push(current);
      current = [];
    }
  }

  if (current.length) expressions.push(current);

  return expressions.filter((expression) => {
    while (expression[0] && ["O", "GLUE", "JOIN"].includes(expression[0].label))
      expression.shift();
    while (
      expression.length &&
      ["O", "GLUE", "JOIN"].includes(expression.at(-1)!.label)
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
      (part) => !["O", "GLUE", "JOIN"].includes(part.label),
    );
    if (token.clauseStart && hasMeaning) clauses.push([]);
    clauses.at(-1)!.push(token);
  }

  return clauses;
}

function compileExpression(text: string, tokens: Token[]): Expression {
  const start = tokens[0].start;
  const end = tokens.at(-1)!.end;
  const diagnostics: Diagnostic[] = [];
  let schedule: Expression["schedule"] = null;

  try {
    const clauses = splitClauses(tokens).map((clause) =>
      compileClause(
        clause
          .filter((token) => token.label !== "GLUE" || token.kind === 2)
          .map((token) =>
            token.label === "GLUE" || token.label === "JOIN"
              ? { ...token, label: "O" }
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

  const scores = tokens
    .filter((token) => !["O", "GLUE", "JOIN"].includes(token.label))
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
    ["O", "GLUE"].includes(token.label) &&
    ["/", ".", "-"].includes(token.text);
  for (let index = 0; index + 2 < tokens.length; index++) {
    const first = tokens[index];
    const second = tokens[index + 2];
    const datePair =
      (first.label === "MONTH" && second.label === "DOM") ||
      (first.label === "DOM" && second.label === "MONTH");
    if (!datePair || !separator(tokens[index + 1]) || second.clauseStart)
      continue;
    const yearFirst =
      tokens[index - 1]?.label === "YEAR" ||
      (separator(tokens[index - 1]) && tokens[index - 2]?.label === "YEAR");
    if (yearFirst || !/^\d+$/.test(first.text) || !/^\d+$/.test(second.text))
      continue;
    const a = Number(first.text);
    const b = Number(second.text);
    if (a < 1 || a > 12 || b < 1 || b > 12) continue;
    result[index] = { ...first, label: order === "MDY" ? "MONTH" : "DOM" };
    result[index + 2] = { ...second, label: order === "MDY" ? "DOM" : "MONTH" };
  }
  return result;
}

export function compile(
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
