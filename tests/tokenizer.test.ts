import { expect, it } from "vitest";
import { tokenize, featureRows } from "../src/tokenizer.js";
it("preserves every character and splits attached clock components", () => {
  const text = "Sat Sun 1pm-8pm Mon 10pm-12am";
  const tokens = tokenize(text);
  expect(tokens.map((t) => t.text)).toEqual([
    "Sat",
    " ",
    "Sun",
    " ",
    "1",
    "pm",
    "-",
    "8",
    "pm",
    " ",
    "Mon",
    " ",
    "10",
    "pm",
    "-",
    "12",
    "am",
  ]);
  expect(tokens.map((t) => t.text).join("")).toBe(text);
  for (const token of tokens) {
    expect(text.slice(token.start, token.end)).toBe(token.text);
    expect(featureRows(token.features).every((n) => n >= 0 && n < 580)).toBe(
      true,
    );
  }
});

it("round-trips 10,000 varied Unicode strings with contiguous source offsets", () => {
  const alphabet = [
    "Mon",
    "Sat",
    "1",
    "23",
    " ",
    "\n",
    "\t",
    "é",
    "世",
    "🙂",
    "–",
    "—",
    "'",
    "’",
    ":",
    "_",
    "\u0301",
    "\r\n",
  ];
  let seed = 20260909;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  }

  for (let sample = 0; sample < 10_000; sample++) {
    const length = Math.floor(random() * 40);
    const text = Array.from(
      { length },
      () => alphabet[Math.floor(random() * alphabet.length)],
    ).join("");
    const tokens = tokenize(text);
    expect(tokens.map((token) => token.text).join("")).toBe(text);
    let offset = 0;
    for (const token of tokens) {
      expect(token.start).toBe(offset);
      expect(token.end).toBe(token.start + token.text.length);
      expect(
        featureRows(token.features).every((row) => row >= 0 && row < 580),
      ).toBe(true);
      offset = token.end;
    }
    expect(offset).toBe(text.length);
  }
});
