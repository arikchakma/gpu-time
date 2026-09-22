import { defineParser as defineScheduleParser } from "./schedule.js";
import { createResolver } from "./resolve.js";
import { civil, instant } from "./zoned.js";
import english from "./languages/en.js";
import { detectLanguage } from "./languages/detect.js";
import type { Language } from "./languages/language.js";
import type {
  Diagnostic,
  Occurrence,
  ParserOptions as ModelOptions,
  ResolveOptions,
  ParseResult as ScheduleResult,
} from "./types.js";

/** A pack code loaded by `defineParser`. Omitted, the text decides. */
export type ParseContext = ResolveOptions & { language?: string };
export type ParserOptions = Pick<ModelOptions, "backend" | "dateOrder"> & {
  languages?: Language[];
};
export type TimeRange = Omit<Occurrence, "clause">;
export type { Diagnostic } from "./types.js";
export type { Language } from "./languages/language.js";
export { default as en } from "./languages/en.js";
export { detectLanguage } from "./languages/detect.js";

/** Character offsets of a resolved expression. Role names stay internal. */
export interface TimeSpan {
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface ParseResult {
  occurrences: TimeRange[];
  rrules: string[];
  spans: TimeSpan[];
  truncated: boolean;
  diagnostics: Diagnostic[];
  backend: "cpu" | "webgpu";
  timings: { tokenizeMs: number; inferMs: number; resolveMs: number };
  fallbackReason?: string;
}

export async function defineParser(options: ParserOptions = {}) {
  const parser = await defineScheduleParser(options);
  const languages = options.languages?.length ? options.languages : [english];

  // Text that fits both packs equally falls back to the first, not a coin flip.
  function select(code: string | undefined, text: string): Language {
    if (code === undefined)
      return detectLanguage(text, languages) ?? languages[0];
    const found = languages.find((language) => language.code === code);
    if (!found)
      throw new RangeError(
        `Language ${JSON.stringify(code)} is not loaded. Loaded: ${languages
          .map((language) => language.code)
          .join(", ")}.`,
      );
    return found;
  }

  function validate(context: ParseContext): number {
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
    return limit;
  }

  function finish(
    parsed: ScheduleResult,
    resolveSchedule: ReturnType<typeof createResolver>,
    limit: number,
    text: string,
    language: Language,
  ): ParseResult {
    const started = performance.now();
    const occurrences: TimeRange[] = [];
    const rrules: string[] = [];
    const spans: TimeSpan[] = [];
    const diagnostics = parsed.expressions.flatMap(
      (expression) => expression.diagnostics,
    );
    let truncated = false;
    if (!parsed.expressions.length && language.mentionsTime(text))
      diagnostics.push({
        code: "no-expression",
        severity: "warning",
        message: `No time expression was recognized in ${JSON.stringify(text)}.`,
        start: 0,
        end: text.length,
      });
    for (const expression of parsed.expressions) {
      if (!expression.schedule) continue;
      try {
        const result = resolveSchedule(expression.schedule);
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
        spans.push({
          start: expression.start,
          end: expression.end,
          text: expression.text,
          confidence: expression.confidence,
        });
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
    if (parsed.expressions.length > 1)
      occurrences.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return {
      occurrences: occurrences.slice(0, limit),
      rrules,
      // Not sliced: spans describe the input, not the expansion.
      spans,
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
    async parse(text: string, context: ParseContext): Promise<ParseResult> {
      const limit = validate(context);
      const language = select(context.language, text);
      return finish(
        await parser.parse(text, language),
        createResolver(context),
        limit,
        text,
        language,
      );
    },
    async parseMany(
      texts: string[],
      context: ParseContext,
    ): Promise<ParseResult[]> {
      if (!texts.length) return [];
      const limit = validate(context);
      const language = select(context.language, texts.join("\n"));
      const parsed = await parser.parseMany(texts, language);
      const resolveSchedule = createResolver(context);
      return parsed.map((result, index) =>
        finish(result, resolveSchedule, limit, texts[index], language),
      );
    },
    dispose: parser.dispose,
  };
}

let defaultParser: ReturnType<typeof defineParser> | undefined;
export async function parse(
  text: string,
  context: ParseContext,
): Promise<ParseResult> {
  defaultParser ??= defineParser();
  return (await defaultParser).parse(text, context);
}
export async function parseMany(
  texts: string[],
  context: ParseContext,
): Promise<ParseResult[]> {
  defaultParser ??= defineParser();
  return (await defaultParser).parseMany(texts, context);
}
