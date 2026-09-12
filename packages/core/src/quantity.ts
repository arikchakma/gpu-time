import { Role } from "./labels.js";
import { number, unit } from "./lexicon.js";
import type { Duration, PredictionToken as Token } from "./types.js";

/** Read the numeric pieces selected by the model, preserving their source tokens. */
export function readNumber(tokens: Token[], index: number, label = Role.NUM) {
  // "a few" and "a couple" carry the article as its own number token.
  if (
    /^an?$/i.test(tokens[index]?.text ?? "") &&
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
    if (/^of$/i.test(tokens[next]?.text ?? "") && tokens[next]?.label === label)
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
  index: number,
): { duration: Duration; next: number } | undefined {
  const components = [];
  let next = index;
  while (tokens[next]?.label === Role.NUM) {
    const quantity = readNumber(tokens, next);
    next = quantity.next;
    // "half an hour": the article belongs to the same quantity.
    if (quantity.value < 1 && /^(a|an)$/i.test(tokens[next]?.text ?? ""))
      next++;
    const durationUnit =
      tokens[next]?.label === Role.UNIT ? unit(tokens[next].text) : undefined;
    if (
      !durationUnit ||
      !Number.isFinite(quantity.value) ||
      quantity.value <= 0
    )
      return;
    let amount = quantity.value;
    if (/^fortnights?$/i.test(tokens[next].text)) amount *= 2;
    next++;
    if (tokens[next]?.text.toLowerCase() === "and") {
      let tail = next + 1;
      if (/^(a|an)$/i.test(tokens[tail]?.text ?? "")) tail++;
      if (
        tokens[tail]?.label === Role.NUM &&
        tokens[tail].text.toLowerCase() === "half"
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
    const candidate =
      tokens[next]?.text.toLowerCase() === "and" ? next + 1 : next;
    if (tokens[candidate]?.label !== Role.NUM) break;
    const following = readNumber(tokens, candidate).next;
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
