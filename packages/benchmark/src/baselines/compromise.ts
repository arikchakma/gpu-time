import nlp from "compromise";
import dates from "compromise-dates";
import { reference, timeZone, type Adapter } from "../types.ts";

const extended = nlp.extend(dates);
export function create(): Adapter {
  return {
    parse: (text) =>
      extended(text).dates({ today: reference, timezone: timeZone }).get(),
    normalize: (value) => ({
      occurrences: value,
      rrules: null,
      abstained: value.length === 0,
    }),
  };
}
