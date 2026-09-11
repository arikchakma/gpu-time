import type { DateSpec, Unit, Weekday } from "./types.js";

export const weekdays: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export const dayNames = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export const quantities: Record<string, number> = {
  zero: 0,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  half: 0.5,
  quarter: 0.25,
  couple: 2,
  few: 3,
  several: 3,
  other: 2,
  once: 1,
  twice: 2,
  thrice: 3,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
  last: -1,
};

// "twenty-first" reaches the compiler as three tokens, so the tens word and the
// ones ordinal are combined rather than listed as thirty more entries.
const tensWords: Record<string, number> = { twenty: 20, thirty: 30 };

export function compoundOrdinal(tens: string, ones: string): number {
  const base = tensWords[tens.toLowerCase()];
  const unit = quantities[ones.toLowerCase()];
  if (base === undefined || unit === undefined || unit < 1 || unit > 9)
    return NaN;
  return base + unit;
}
const unitNames = ["minute", "hour", "day", "week", "month", "year"] as const;
const unitAbbreviations: Record<string, Unit> = {
  min: "minute",
  mins: "minute",
  hr: "hour",
  hrs: "hour",
  wk: "week",
  wks: "week",
  week: "week",
  weeks: "week",
  d: "day",
  m: "minute",
  h: "hour",
  mo: "month",
  yr: "year",
  yrs: "year",
};

export function number(text: string): number {
  const word = text.toLowerCase();
  const spelledOut = Object.hasOwn(quantities, word)
    ? quantities[word]
    : undefined;
  if (spelledOut !== undefined) return spelledOut;
  return /^-?\d+$/.test(text) ? Number(text) : NaN;
}

export function weekday(text: string): Weekday | undefined {
  const word = text.toLowerCase().replace(/\.$/, "").replace(/s$/, "");
  const index = dayNames.findIndex((name) => {
    if (name === word || name.slice(0, 3) === word) return true;
    return name === "thursday" && ["thur", "thurs"].includes(word);
  });

  return weekdays[index];
}

export function month(text: string): number | undefined {
  const word = text.toLowerCase().replace(/\.$/, "");
  const index = monthNames.findIndex((name) => {
    if (name === word || name.slice(0, 3) === word) return true;
    return name === "september" && word === "sept";
  });

  return index < 0 ? undefined : index + 1;
}

export function unit(text: string): Unit | undefined {
  const word = text.toLowerCase();
  const abbreviation = Object.hasOwn(unitAbbreviations, word)
    ? unitAbbreviations[word]
    : undefined;
  if (abbreviation !== undefined) return abbreviation;

  const singular = word.replace(/s$/, "");
  return unitNames.find((name) => name === singular);
}

export const holidayNames: Record<
  string,
  Extract<DateSpec, { kind: "holiday" }>["name"]
> = {
  christmas: "christmas",
  christmaseve: "christmas-eve",
  newyear: "new-year",
  newyearsday: "new-year",
  newyearseve: "new-years-eve",
  halloween: "halloween",
  valentinesday: "valentines",
  valentines: "valentines",
};
