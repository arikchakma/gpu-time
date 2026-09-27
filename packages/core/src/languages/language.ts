import type { EncodedWeights } from "../model/decode.js";
import type {
  DayPart,
  Modifier,
  Recurrence,
  Unit,
  Weekday,
  DateSpec,
} from "../types.js";

/**
 * Everything the compiler needs to read one language. Morphology is a function
 * because plural and abbreviation rules differ; vocabulary is a table.
 */
export interface Language {
  code: string;
  /** How a bare numeric date like 3/4 is read when nothing else settles it. */
  dateOrder: "MDY" | "DMY";
  model?: EncodedWeights;

  weekday(text: string): Weekday | undefined;
  month(text: string): number | undefined;
  unit(text: string): Unit | undefined;
  /** Spelled-out or digit value, NaN when the token is not a number. */
  number(text: string): number;
  /** Tens word plus ones ordinal, as in "twenty-first". NaN when unsupported. */
  compoundOrdinal(tens: string, ones: string): number;
  /** A number spelled over several words, as in "dos mil diecisiete". */
  spokenNumber?(words: string[]): number;
  /** Cheap check that input mentions time at all, for the no-expression hint. */
  mentionsTime(text: string): boolean;
  /**
   * A weekday written as a repeating plural: "tuesdays" yes, "tues" no. Needed
   * because an abbreviation can also end in the plural letter.
   */
  isPluralWeekday(text: string): boolean;
  /**
   * A plural definite article ("los"/"las") that marks a weekday as
   * recurring when the noun itself does not inflect for number (Spanish
   * "lunes" is both singular and plural). Empty where the noun always
   * carries its own plural marker, as in English.
   */
  pluralArticles: ReadonlySet<string>;
  dayGroup(text: string): "weekday" | "weekend" | undefined;
  /** True when first+second read as "same/this time", carrying a prior clock forward. */
  isSameTimeCue(first: string, second: string): boolean;

  /** Words carrying no value of their own, dropped between roles. */
  filler: ReadonlySet<string>;
  approximately: ReadonlySet<string>;
  relativeDays: Readonly<Record<string, number>>;
  dayParts: Readonly<Record<string, DayPart>>;
  modifiers: Readonly<Record<string, Modifier>>;
  frequencyWords: Readonly<Record<string, Recurrence["freq"]>>;
  frequencyIntervals: Readonly<Record<string, number>>;
  holidays: Readonly<
    Record<string, Extract<DateSpec, { kind: "holiday" }>["name"]>
  >;

  now: ReadonlySet<string>;
  edges: Readonly<Record<string, "start" | "end">>;
  /** Abbreviations that also carry an end edge, like "eod"/"eow"/"eom". */
  endAbbreviations: ReadonlySet<string>;
  timeNamed: Readonly<Record<string, "noon" | "midnight">>;
  /**
   * Keys join a run of MERIDIEM tokens with no separator, as in "atnight".
   * "night" reads as pm but turns 12 into midnight.
   */
  meridiemPhrases: Readonly<Record<string, "am" | "pm" | "o'clock" | "night">>;
  smallHoursAtNight?: boolean;
  /** A MERIDIEM-role lead word that is harmless right before an hour, like "at". */
  meridiemLead: ReadonlySet<string>;
  clockFractions: Readonly<Record<string, number>>;
  /**
   * English puts the fraction first ("quarter past six"). Spanish puts the
   * hour first ("seis y media"). The compiler tries both orders.
   */
  clockDirections: Readonly<Record<string, "past" | "to">>;
  /** Ordinal suffix marks glued after a digit under the same role: "st" "º" "ª". */
  ordinalMarks: ReadonlySet<string>;
  /** Words that act as an implicit deadline separator, like "until"/"hasta". */
  deadlineWords: ReadonlySet<string>;
  /** "tonight" / "tonite": a bare relative day that also names the night. */
  tonightWords: ReadonlySet<string>;
  /** A two-week unit word, like "fortnight(s)"; doubles the amount. */
  fortnightWords: ReadonlySet<string>;
  /** Marks an explicit start anchor for a duration, like "from". */
  fromWords: ReadonlySet<string>;
  /** Forces an occurrence duration (not a series span) even under a recurrence. */
  lastingWords: ReadonlySet<string>;
  /** Joins a list of clock points, like "and" or "&". */
  conjunctions: ReadonlySet<string>;
  /** GLUE-role words that must survive the filler pass because a later stage reads them. */
  keepGlue: ReadonlySet<string>;
  /** Indefinite articles used inside a quantity, like "a"/"an" in "a few". */
  articles: ReadonlySet<string>;
  /** The linking word in "one of five", when it carries a numeric role. */
  ofWords: ReadonlySet<string>;
  /** Joins duration components, like "and" in "an hour and a half". */
  andWords: ReadonlySet<string>;
}

/** Accents are spelling, not structure, so lookups fold them away. ASCII text is unaffected. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "");
}
