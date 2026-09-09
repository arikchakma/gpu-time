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
  last: -1,
};
const unitNames = ["minute", "hour", "day", "week", "month", "year"] as const;
const unitAbbreviations: Record<string, Unit> = {
  min: "minute",
  mins: "minute",
  hr: "hour",
  hrs: "hour",
  wk: "week",
  wks: "week",
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
