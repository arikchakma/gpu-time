import { Role } from "./labels.js";
import type { Duration, PredictionToken as Token } from "./types.js";
import { fold, type Language } from "./languages/language.js";

/** Read the numeric pieces selected by the model, preserving their source tokens. */
export function readNumber(
  tokens: Token[],
  language: Language,
  index: number,
  label = Role.NUM,
) {
  const number = (text: string) => language.number(text);
  const word = (at: number) => fold(tokens[at]?.text.toLowerCase() ?? "");
  // "a few" and "a couple" carry the article as its own number token.
  if (
    language.articles.has(word(index)) &&
    tokens[index + 1]?.label === label &&
    Number.isFinite(number(tokens[index + 1].text))
  )
    index += 1;
  let value = number(tokens[index]?.text ?? "");
  let next = index + 1;
  if (tokens[next]?.text === "." && tokens[next + 1]?.label === label) {
    value = Number(`${value}.${tokens[next + 1].text}`);
    next += 2;
  } else {
    if (tokens[next]?.text === "-" && tokens[next + 1]?.label === label) next++;
    if (language.ofWords.has(word(next)) && tokens[next]?.label === label)
      next++;
    const suffix =
      tokens[next]?.label === label ? number(tokens[next].text) : NaN;
    if (value >= 20 && value % 10 === 0 && suffix > 0 && suffix < 10) {
      value += suffix;
      next++;
    }
  }
  return { value, next };
}

export function readDuration(
  tokens: Token[],
  language: Language,
  index: number,
): { duration: Duration; next: number } | undefined {
  const unit = (text: string) => language.unit(text);
  const word = (at: number) => fold(tokens[at]?.text.toLowerCase() ?? "");
  const components = [];
  let next = index;
  while (tokens[next]?.label === Role.NUM) {
    const quantity = readNumber(tokens, language, next);
    next = quantity.next;
    // "half an hour": the article belongs to the same quantity.
    if (quantity.value < 1 && language.articles.has(word(next))) next++;
    const durationUnit =
      tokens[next]?.label === Role.UNIT ? unit(tokens[next].text) : undefined;
    if (
      !durationUnit ||
      !Number.isFinite(quantity.value) ||
      quantity.value <= 0
    )
      return;
    let amount = quantity.value;
    if (language.fortnightWords.has(word(next))) amount *= 2;
    next++;
    if (language.andWords.has(word(next))) {
      let tail = next + 1;
      if (language.articles.has(word(tail))) tail++;
      if (
        tokens[tail]?.label === Role.NUM &&
        language.number(tokens[tail].text) === 0.5
      ) {
        amount += 0.5;
        next = tail + 1;
      }
    }
    // Fractions of calendar months/days need a separate policy. Clock units are exact.
    if (
      !Number.isInteger(amount) &&
      !["hour", "minute", "second"].includes(durationUnit)
    )
      return;
    components.push({ amount, unit: durationUnit });
    const candidate = language.andWords.has(word(next)) ? next + 1 : next;
    if (tokens[candidate]?.label !== Role.NUM) break;
    const following = readNumber(tokens, language, candidate).next;
    if (tokens[following]?.label !== Role.UNIT) break;
    next = candidate;
  }
  if (!components.length) return;
  const [first, ...rest] = components;
  return {
    duration: { ...first, ...(rest.length ? { components: rest } : {}) },
    next,
  };
}
