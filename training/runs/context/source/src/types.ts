import type { Label } from "./labels.js";
export type { Label };
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type Unit = "minute" | "hour" | "day" | "week" | "month" | "year";
export type Modifier = "this" | "next" | "last";
export interface CalendarDate {
  year?: number;
  month?: number;
  day?: number;
}
export type MonthRef =
  | { kind: "calendar"; year?: number; month?: number }
  | { kind: "relativeUnit"; unit: "month" | "year"; modifier: Modifier };
export type DateSpec =
  | { kind: "now" }
  | { kind: "relativeDay"; offset: number }
  | { kind: "weekday"; days: Weekday[]; modifier?: Modifier }
  | { kind: "weekdayRange"; from: Weekday; to: Weekday }
  | { kind: "dayGroup"; group: "weekday" | "weekend"; modifier?: Modifier }
  | ({ kind: "calendar" } & CalendarDate)
  | { kind: "calendarRange"; from: CalendarDate; to: CalendarDate }
  | {
      kind: "relativeUnit";
      unit: Unit;
      modifier: Modifier;
      edge?: "start" | "end";
    }
  | { kind: "ordinalWeekday"; ordinal: number; day: Weekday; of: MonthRef }
  | {
      kind: "holiday";
      name:
        | "christmas"
        | "christmas-eve"
        | "new-year"
        | "new-years-eve"
        | "halloween"
        | "valentines";
    };
export type DayPart = "morning" | "afternoon" | "evening" | "night";
export type ClockTime =
  | { hour: number; minute: number; second?: number }
  | { named: "noon" | "midnight" }
  | { part: DayPart };
export interface TimeSpec {
  start: ClockTime;
  end?: ClockTime;
}
export interface Shift {
  amount: number;
  unit: Unit;
  direction: "before" | "after";
  endAmount?: number;
  approximate?: boolean;
}
export interface Duration {
  amount: number;
  unit: Unit;
}
export interface Recurrence {
  freq: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  byDay?: Weekday[];
  byMonthDay?: number[];
  bySetPos?: number[];
  byMonth?: number[];
  timesPer?: number;
  count?: number;
  until?: DateSpec;
  start?: DateSpec;
  except?: DateSpec[];
  /** A bound on the entire series, distinct from the duration of each occurrence. */
  span?: Duration;
}
export interface Clause {
  date?: DateSpec;
  time?: TimeSpec;
  shift?: Shift;
  duration?: Duration;
  recurrence?: Recurrence;
  timeZone?: string;
}
export interface Schedule {
  clauses: Clause[];
}
export interface RawToken {
  start: number;
  end: number;
  text: string;
  kind: 0 | 1 | 2 | 3;
  features: [number, number];
}
export interface Token extends RawToken {
  label: Label;
  clauseStart: boolean;
  score: number;
}
export interface Diagnostic {
  code: string;
  message: string;
  start: number;
  end: number;
  severity: "error" | "warning";
}
export interface Expression {
  start: number;
  end: number;
  text: string;
  confidence: number;
  schedule: Schedule | null;
  diagnostics: Diagnostic[];
}
export interface ParseResult {
  expressions: Expression[];
  backend: "webgpu" | "cpu";
  timings: { tokenizeMs: number; inferMs: number; compileMs: number };
  tokens?: Token[];
  fallbackReason?: string;
}
export interface ParserOptions {
  backend?: "auto" | "webgpu" | "cpu";
  tokens?: boolean;
  dateOrder?: "MDY" | "DMY";
}
export interface ResolveOptions {
  reference: string;
  timeZone: string;
  weekStart?: "MO" | "SU";
  bareWeekday?: "future" | "nearest" | "thisWeek";
  bareWeekdays?: "once" | "weekly";
  nextWeekday?: "immediate" | "nextWeek";
  dayParts?: Partial<Record<DayPart, [string, string]>>;
  until?: string;
  limit?: number;
}
export interface Occurrence {
  start: string;
  end?: string;
  allDay: boolean;
  clause: number;
}
export interface Resolved {
  occurrences: Occurrence[];
  rrules: string[];
  truncated: boolean;
  diagnostics: Diagnostic[];
}
