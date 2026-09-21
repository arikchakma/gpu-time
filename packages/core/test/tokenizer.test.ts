import { expect, it } from "vitest";
import { createHash } from "node:crypto";
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

it(
  "round-trips 10,000 varied Unicode strings with contiguous source offsets",
  { timeout: 30_000 },
  () => {
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

    const hash = createHash("sha256");
    for (let sample = 0; sample < 10_000; sample++) {
      const length = Math.floor(random() * 40);
      const text = Array.from(
        { length },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join("");
      const tokens = tokenize(text);
      hash.update(JSON.stringify(tokens));
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
    // Captured from the original tokenizer before the performance refactor,
    // then recaptured when a four-digit clock joined the zero-padded number
    // bucket. Only change it with a feature change the model retrains on.
    expect(hash.digest("hex")).toBe(
      "3a8ee1eea95c4bd16bb29181f5382b42864797c686f40f5e4ceacf646af3c9c3",
    );
  },
);

it("gives a four-digit clock its own number bucket, and leaves years alone", () => {
  const bucket = (text: string) =>
    featureRows(tokenize(text)[0].features).find(
      (row) => row >= 564 && row < 580,
    );
  const clock = bucket("0930");
  // Times a calendar user types, whatever their leading digit.
  for (const text of ["0930", "1150", "1430", "2200", "2359"])
    expect(bucket(text)).toBe(clock);
  // A year, an impossible clock, and a plain count keep their own buckets.
  for (const text of ["2026", "1995", "2400", "1170", "9999", "730"])
    expect(bucket(text)).not.toBe(clock);
  // An evening inside the year band stays a year: "1930" is unreadable as a
  // clock, which MODEL_CARD.md records as a limitation.
  expect(bucket("1930")).toBe(bucket("2026"));
});
