import {
  recognizeDateTime,
  Culture,
  DateTimeOptions,
} from "@microsoft/recognizers-text-date-time";
import { reference, type Adapter } from "../types.js";

export function create(): Adapter {
  return {
    parse: (text) =>
      recognizeDateTime(
        text,
        Culture.English,
        DateTimeOptions.None,
        new Date(reference),
      ),
    normalize: (value) => ({
      occurrences: null,
      rrules: null,
      abstained: value.length === 0,
      limitation:
        "Native TIMEX alternatives are retained in raw output. No single interpretation or recurrence is invented by this adapter.",
    }),
  };
}
