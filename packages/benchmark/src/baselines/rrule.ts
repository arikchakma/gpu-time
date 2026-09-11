import { RRule } from "rrule";
import { reference, timeZone, limit, type Adapter } from "../types.ts";

export function create(): Adapter {
  return {
    parse: (text) => RRule.parseText(text),
    normalize(value) {
      if (!value || Object.keys(value).length === 0)
        return { occurrences: null, rrules: null, abstained: true };
      const rule = new RRule({
        ...value,
        dtstart: new Date(reference.slice(0, 19) + "Z"),
        tzid: timeZone,
      });
      return {
        occurrences: rule
          .all((_date, index) => index < limit)
          .map((date) => ({ start: date.toISOString() })),
        rrules: [rule.toString()],
        abstained: false,
        limitation:
          "Unspecified DTSTART uses the fixed reference wall clock; natural-language parsing and expansion are measured separately.",
      };
    },
  };
}
