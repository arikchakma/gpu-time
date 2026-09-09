import later from "@breejs/later";
import { reference, limit, type Adapter } from "../types.js";

export function create(): Adapter {
  later.date.localTime();
  return {
    parse: (text) => later.parse.text(text),
    normalize(value) {
      if (value.error !== -1)
        return { occurrences: null, rrules: null, abstained: true };
      const next = later.schedule(value).next(limit, new Date(reference));
      return {
        occurrences: Array.isArray(next)
          ? next.map((date: Date) => ({ start: date.toISOString() }))
          : null,
        rrules: null,
        abstained: !next,
        limitation:
          "Native schedule engine enumerates matching instants; it does not return event duration windows.",
      };
    },
  };
}
