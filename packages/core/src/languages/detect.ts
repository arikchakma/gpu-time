import { tokenize } from "../tokenizer.js";
import { fold, type Language } from "./language.js";

/** Word tokens this pack recognizes. Digits are skipped: every language reads them. */
function score(text: string, language: Language): number {
  let hits = 0;
  for (const token of tokenize(text)) {
    if (token.kind !== 0) continue;
    const word = fold(token.text.toLowerCase());
    if (
      language.weekday(token.text) !== undefined ||
      language.month(token.text) !== undefined ||
      language.unit(token.text) !== undefined ||
      Number.isFinite(language.number(token.text)) ||
      language.dayGroup(word) !== undefined ||
      Object.hasOwn(language.relativeDays, word) ||
      Object.hasOwn(language.dayParts, word) ||
      Object.hasOwn(language.modifiers, word) ||
      Object.hasOwn(language.frequencyWords, word) ||
      Object.hasOwn(language.timeNamed, word) ||
      Object.hasOwn(language.holidays, word) ||
      language.filler.has(word) ||
      language.now.has(word) ||
      language.deadlineWords.has(word)
    )
      hits++;
  }
  return hits;
}

/**
 * The loaded pack whose vocabulary best fits, or undefined when nothing
 * separates them: "25/12/2026" reads the same in every language.
 */
export function detectLanguage(
  text: string,
  languages: readonly Language[],
): Language | undefined {
  if (languages.length < 2) return languages[0];
  let best: Language | undefined;
  let bestScore = 0;
  let tied = false;
  for (const language of languages) {
    const value = score(text, language);
    if (value > bestScore) {
      bestScore = value;
      best = language;
      tied = false;
    } else if (value === bestScore && bestScore > 0) tied = true;
  }
  return tied ? undefined : best;
}
