import { createParser as createScheduleParser } from "./schedule.js";
import { resolve } from "./resolve.js";
import { civil, instant } from "./zoned.js";
import type {
  Diagnostic,
  Occurrence,
  ParserOptions as ModelOptions,
  ResolveOptions,
} from "./types.js";

export type ParseContext = ResolveOptions;
export type ParserOptions = Pick<ModelOptions, "backend" | "dateOrder">;
export type TimeRange = Omit<Occurrence, "clause">;
export type { Diagnostic } from "./types.js";

export interface ParseResult {
  occurrences: TimeRange[];
  rrules: string[];
  truncated: boolean;
  diagnostics: Diagnostic[];
  backend: "cpu" | "webgpu";
  timings: { tokenizeMs: number; inferMs: number; resolveMs: number };
  fallbackReason?: string;
}

export async function createParser(options: ParserOptions = {}) {
  const parser = await createScheduleParser(options);

  async function parse(
    text: string,
    context: ParseContext,
  ): Promise<ParseResult> {
    // Context belongs to calendar resolution and never enters the model.
    if (
      !context ||
      typeof context.timeZone !== "string" ||
      !context.timeZone.trim()
    )
      throw new TypeError("timeZone is required.");
    civil(instant(context.reference), context.timeZone);
    const limit = context.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new RangeError("limit must be an integer from 1 through 1000.");
    const parsed = await parser.parse(text);
    const started = performance.now();
    const occurrences: TimeRange[] = [];
    const rrules: string[] = [];
    const diagnostics = parsed.expressions.flatMap(
      (expression) => expression.diagnostics,
    );
    let truncated = false;
    for (const expression of parsed.expressions) {
      if (!expression.schedule) continue;
      try {
        const result = resolve(expression.schedule, context);
        occurrences.push(
          ...result.occurrences.map(({ clause, ...range }) => range),
        );
        rrules.push(...result.rrules);
        diagnostics.push(
          ...result.diagnostics.map((value) => ({
            ...value,
            start: expression.start,
            end: expression.end,
          })),
        );
        truncated ||= result.truncated;
      } catch (error) {
        diagnostics.push({
          code: "resolution-error",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
          start: expression.start,
          end: expression.end,
        });
      }
    }
    occurrences.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return {
      occurrences: occurrences.slice(0, limit),
      rrules,
      truncated: truncated || occurrences.length > limit,
      diagnostics,
      backend: parsed.backend,
      timings: {
        tokenizeMs: parsed.timings.tokenizeMs,
        inferMs: parsed.timings.inferMs,
        resolveMs: parsed.timings.compileMs + performance.now() - started,
      },
      ...(parsed.fallbackReason
        ? { fallbackReason: parsed.fallbackReason }
        : {}),
    };
  }

  return {
    parse,
    parseMany(texts: string[], context: ParseContext): Promise<ParseResult[]> {
      return Promise.all(texts.map((text) => parse(text, context)));
    },
    dispose: parser.dispose,
  };
}

let defaultParser: ReturnType<typeof createParser> | undefined;
export async function parse(
  text: string,
  context: ParseContext,
): Promise<ParseResult> {
  defaultParser ??= createParser();
  return (await defaultParser).parse(text, context);
}
export async function parseMany(
  texts: string[],
  context: ParseContext,
): Promise<ParseResult[]> {
  defaultParser ??= createParser();
  return (await defaultParser).parseMany(texts, context);
}
