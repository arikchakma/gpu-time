import { compilePredictions } from "./compile.js";
import { LABELS } from "./labels.js";
import { createTagger, type TagResult } from "./tagger.js";
import type { ParseResult, ParserOptions } from "./types.js";
import type { Language } from "./languages/language.js";

export * from "./types.js";
export { resolve } from "./resolve.js";

// Existing schedule API, kept separate from the model's token predictions.
export async function defineParser(options: ParserOptions = {}) {
  const tagger = await createTagger({ backend: options.backend });

  function assemble(
    text: string,
    result: TagResult,
    language?: Language,
  ): ParseResult {
    const started = performance.now();
    const expressions = !result.unknownLabels
      ? compilePredictions(text, result.tokens, { ...options, language })
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
      ...(options.tokens
        ? {
            tokens: result.tokens.map((token) => ({
              ...token,
              label: LABELS[token.label],
            })),
          }
        : {}),
      ...(result.fallbackReason
        ? { fallbackReason: result.fallbackReason }
        : {}),
    };
  }

  return {
    async parse(text: string, language?: Language): Promise<ParseResult> {
      return assemble(text, await tagger.tag(text, language?.model), language);
    },
    async parseMany(
      texts: string[],
      language?: Language,
    ): Promise<ParseResult[]> {
      const predictions = await tagger.tagMany(texts, language?.model);
      return predictions.map((result, index) =>
        assemble(texts[index], result, language),
      );
    },
    dispose: tagger.dispose,
  };
}
