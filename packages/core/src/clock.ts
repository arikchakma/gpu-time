import type { ClockTime, DayPart, ResolveOptions, TimeSpec } from "./types.js";

const defaultParts: Record<DayPart, [string, string]> = {
  morning: ["06:00", "12:00"],
  afternoon: ["12:00", "17:00"],
  evening: ["17:00", "21:00"],
  night: ["21:00", "24:00"],
};

function configuredClock(value: string): ClockTime {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match)
    throw new RangeError("A day-part boundary must use HH:MM or HH:MM:SS.");
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? 0),
  };
}

export function clockSeconds(
  clock: ClockTime,
  options: ResolveOptions,
  end = false,
): number {
  if ("named" in clock) return clock.named === "noon" ? 43_200 : 0;
  if ("part" in clock) {
    const window = options.dayParts?.[clock.part] ?? defaultParts[clock.part];
    return clockSeconds(configuredClock(window[end ? 1 : 0]), options, end);
  }

  const { hour, minute, second = 0 } = clock;
  const validHour =
    Number.isInteger(hour) &&
    hour >= 0 &&
    (hour < 24 || (end && hour === 24 && minute === 0 && second === 0));
  const validMinute = Number.isInteger(minute) && minute >= 0 && minute < 60;
  const validSecond = Number.isInteger(second) && second >= 0 && second < 60;
  if (!validHour || !validMinute || !validSecond)
    throw new RangeError("Clock components are out of range.");

  return hour * 3600 + minute * 60 + second;
}

export function resolveTime(
  time: TimeSpec,
  options: ResolveOptions,
): { start: number; end?: number } {
  const start = clockSeconds(time.start, options);
  let end: number | undefined;
  if (time.end) end = clockSeconds(time.end, options, true);
  else if (time.open !== "end" && "part" in time.start)
    end = clockSeconds(time.start, options, true);

  // Ordering is validated after the endpoint dates and timezone are resolved.
  return { start, end };
}
