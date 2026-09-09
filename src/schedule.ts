import { compile } from "./compile.js";
import { createTagger } from "./tagger.js";
import type { ParseResult, ParserOptions } from "./types.js";

export * from "./types.js";
export { resolve } from "./resolve.js";

// Existing schedule API, kept separate from the model's token predictions.
export async function createParser(options: ParserOptions = {}) {
  const tagger = await createTagger({ backend: options.backend });

  async function parse(text: string): Promise<ParseResult> {
    const result = await tagger.tag(text);
    const started = performance.now();
    const expressions = !result.unknownLabels
      ? compile(text, result.tokens, options)
      : [
          {
            start: 0,
            end: text.length,
            text,
            confidence: 0,
            schedule: null,
            diagnostics: [
              {
                code: "unknown-model-label",
                message: "The model returned an unsupported role.",
                start: 0,
                end: text.length,
                severity: "error" as const,
              },
            ],
          },
        ];
    return {
      expressions,
      backend: result.backend,
      timings: { ...result.timings, compileMs: performance.now() - started },
      ...(options.tokens ? { tokens: result.tokens } : {}),
      ...(result.fallbackReason
        ? { fallbackReason: result.fallbackReason }
        : {}),
    };
  }

  return {
    parse,
    parseMany(texts: string[]): Promise<ParseResult[]> {
      return Promise.all(texts.map(parse));
    },
    dispose: tagger.dispose,
  };
}

let defaultParser: ReturnType<typeof createParser> | undefined;
export async function parse(text: string): Promise<ParseResult> {
  defaultParser ??= createParser();
  return (await defaultParser).parse(text);
}
export async function parseMany(texts: string[]): Promise<ParseResult[]> {
  defaultParser ??= createParser();
  return (await defaultParser).parseMany(texts);
}
