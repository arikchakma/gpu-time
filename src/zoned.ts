export interface Civil {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

type CivilDate = Pick<Civil, "year" | "month" | "day">;

interface ZonedInstant {
  epochMs: number;
  kind: "exact" | "gap" | "overlap";
}

const millisecondsPerDay = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function utc(fields: CivilDate & Partial<Civil>): number {
  const date = new Date(0);
  date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  date.setUTCHours(fields.hour ?? 0, fields.minute ?? 0, fields.second ?? 0, 0);
  return date.getTime();
}

export function fromUTC(epoch: number): Civil {
  const date = new Date(epoch);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  if (formatters.size >= 128) formatters.clear();
  formatters.set(timeZone, formatter);
  return formatter;
}

export function civil(epoch: number, timeZone: string): Civil {
  const fields: Civil = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
  };

  for (const part of getFormatter(timeZone).formatToParts(epoch)) {
    switch (part.type) {
      case "year":
      case "month":
      case "day":
      case "hour":
      case "minute":
      case "second":
        fields[part.type] = Number(part.value);
        break;
    }
  }

  return fields;
}

export function offsetAt(epoch: number, timeZone: string): number {
  const local = utc(civil(epoch, timeZone));
  const wholeSeconds = Math.floor(epoch / 1000) * 1000;
  return local - wholeSeconds;
}

export function zonedToEpoch(fields: Civil, timeZone: string): ZonedInstant {
  const local = utc(fields);
  const offsets = new Set<number>();

  // Both sides of a transition matter, including half-hour and skipped-day changes.
  for (const daysAway of [-2, -1, 0, 1, 2]) {
    offsets.add(offsetAt(local + daysAway * millisecondsPerDay, timeZone));
  }

  const candidates = [...offsets]
    .map((offset) => local - offset)
    .sort((left, right) => left - right);
  const matches = candidates.filter(
    (epoch) => utc(civil(epoch, timeZone)) === local,
  );

  if (matches.length > 0) {
    return {
      epochMs: matches[0],
      kind: matches.length > 1 ? "overlap" : "exact",
    };
  }

  const afterGap = candidates.find(
    (epoch) => utc(civil(epoch, timeZone)) > local,
  );
  return { epochMs: afterGap ?? candidates.at(-1)!, kind: "gap" };
}

export function dayNumber(date: CivilDate): number {
  return Math.floor(
    utc({ ...date, hour: 0, minute: 0, second: 0 }) / millisecondsPerDay,
  );
}

export function dayOfWeek(date: CivilDate): number {
  return (new Date(utc(date)).getUTCDay() + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function inRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function valid(fields: Civil): boolean {
  return (
    inRange(fields.year, 1, 9999) &&
    inRange(fields.month, 1, 12) &&
    inRange(fields.day, 1, daysInMonth(fields.year, fields.month)) &&
    inRange(fields.hour, 0, 23) &&
    inRange(fields.minute, 0, 59) &&
    inRange(fields.second, 0, 59)
  );
}

export function addDays(date: Civil, days: number): Civil {
  return fromUTC(utc(date) + days * millisecondsPerDay);
}

export function addMonths(date: Civil, months: number): Civil {
  const target = fromUTC(utc({ ...date, day: 1, month: date.month + months }));
  const day = Math.min(date.day, daysInMonth(target.year, target.month));
  return { ...target, day };
}

export function startOfDay(date: Civil): Civil {
  return { ...date, hour: 0, minute: 0, second: 0 };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function iso(epoch: number, timeZone: string): string {
  const local = civil(epoch, timeZone);
  const offsetMinutes = offsetAt(epoch, timeZone) / 60_000;
  const offsetSign = offsetMinutes < 0 ? "-" : "+";
  const offsetHours = twoDigits(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRemainder = twoDigits(Math.abs(offsetMinutes) % 60);
  const year = String(local.year).padStart(4, "0");
  const date = `${year}-${twoDigits(local.month)}-${twoDigits(local.day)}`;
  const time = [local.hour, local.minute, local.second]
    .map(twoDigits)
    .join(":");

  return `${date}T${time}${offsetSign}${offsetHours}:${offsetRemainder}`;
}

export function instant(text: string): number {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new RangeError(
      "reference must be an ISO instant with Z or an explicit offset.",
    );
  }

  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch))
    throw new RangeError("Invalid reference instant.");
  return epoch;
}
