import { en } from "chrono-node";
import { reference, type Adapter } from "../types.ts";

export function create(): Adapter {
  return {
    parse: (text) =>
      en.casual.parse(
        text,
        { instant: new Date(reference), timezone: 360 },
        { forwardDate: true },
      ),
    normalize: (value) => ({
      occurrences: value.map(
        (part: ReturnType<typeof en.casual.parse>[number]) => ({
          start: part.start.date().toISOString(),
          ...(part.end ? { end: part.end.date().toISOString() } : {}),
        }),
      ),
      rrules: null,
      abstained: value.length === 0,
    }),
  };
}
