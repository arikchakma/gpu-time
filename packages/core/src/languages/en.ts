import {
  compoundOrdinal,
  dayNames,
  holidayNames,
  mentionsTime,
  month,
  number,
  unit,
  weekday,
} from "../lexicon.js";
import type { Language } from "./language.js";

const approximately = new Set(["about", "around", "roughly"]);

// Punctuation carries no language, but it is filler wherever a role is expected,
// so it stays in the same set rather than becoming a second lookup.
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

const dayGroup = (text: string): "weekday" | "weekend" | undefined => {
  if (/^weekends?$/.test(text)) return "weekend";
  if (/^((week|work)(day|night)s?|businessdays?)$/.test(text)) return "weekday";
};

const isSameTimeCue = (first: string, second: string) =>
  ["same", "this"].includes(first) && second === "time";

const english: Language = {
  code: "en",
  dateOrder: "MDY",

  weekday,
  month,
  unit,
  number,
  compoundOrdinal,
  mentionsTime,
  // Only the full name pluralizes: "tuesdays" recurs, "tues" is an abbreviation.
  isPluralWeekday: (text) =>
    dayNames.includes(text.toLowerCase().replace(/s$/, "")) && /s$/i.test(text),
  pluralArticles: new Set(),
  dayGroup,
  isSameTimeCue,

  filler,
  approximately,
  relativeDays: {
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
  },
  dayParts: {
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night",
  },
  modifiers: {
    this: "this",
    next: "next",
    nxt: "next",
    coming: "next",
    upcoming: "next",
    last: "last",
    previous: "last",
    past: "last",
  },
  frequencyWords: {
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
  },
  frequencyIntervals: {
    biweekly: 2,
    fortnightly: 2,
    bimonthly: 2,
    quarterly: 3,
  },
  holidays: holidayNames,

  now: new Set(["now", "immediately"]),
  edges: {
    start: "start",
    beginning: "start",
    end: "end",
    rest: "end",
    remainder: "end",
  },
  endAbbreviations: new Set(["eod", "eow", "eom"]),
  timeNamed: { noon: "noon", midday: "noon", midnight: "midnight" },
  meridiemPhrases: {
    inmorning: "am",
    inthemorning: "am",
    inafternoon: "pm",
    intheafternoon: "pm",
    inevening: "pm",
    intheevening: "pm",
    atnight: "night",
    inthenight: "night",
    oclock: "o'clock",
  },
  meridiemLead: new Set(["at"]),
  clockFractions: { half: 30, quarter: 15 },
  clockDirections: { past: "past", to: "to" },
  ordinalMarks: new Set(["st", "nd", "rd", "th"]),
  deadlineWords: new Set(["until"]),
  tonightWords: new Set(["tonight", "tonite"]),
  fortnightWords: new Set(["fortnight", "fortnights"]),
  fromWords: new Set(["from"]),
  lastingWords: new Set(["lasting"]),
  conjunctions: new Set(["and"]),
  keepGlue: new Set(["past", "to", "and", "a", "an", "from"]),
  articles: new Set(["a", "an"]),
  ofWords: new Set(["of"]),
  andWords: new Set(["and"]),
};

export default english;
