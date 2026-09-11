import { defineParser, type ParseResult } from "gpu-time";
import { reference, timeZone, limit, type Adapter } from "../types.ts";

export async function create(backend: "cpu" | "webgpu"): Promise<Adapter> {
  const parser = await defineParser({ backend });
  const context = { reference, timeZone, limit };
  return {
    parse: (text) => parser.parse(text, context),
    parseMany: (texts) => parser.parseMany(texts, context),
    normalize(value: ParseResult) {
      return {
        occurrences: value.occurrences,
        rrules: value.rrules,
        abstained: value.occurrences.length === 0,
      };
    },
    dispose: parser.dispose,
  };
}
