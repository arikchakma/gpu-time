import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { defineParser } from "../src/schedule.js";
import type { Schedule } from "../src/types.js";

const goldPath = (name: string) =>
  `${import.meta.dirname}/../../training/data/gold/${name}.jsonl`;

interface Example {
  id: string;
  text: string;
  schedule: Schedule | null;
}
const examples: Example[] = [
  "adversarial",
  "grammar",
  "negatives",
  "grammar-variations",
  "prose",
].flatMap((name) =>
  readFileSync(goldPath(name), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)),
);
let parser: Awaited<ReturnType<typeof defineParser>>;
beforeAll(async () => {
  parser = await defineParser({ backend: "cpu" });
});
afterAll(() => parser.dispose());

// Gold is right, model is behind. Runs under it.fails so a retrain that
// closes one turns red and the id comes off the list.
// 034, 136 and 138 are one construction: "in N units" meaning how long a
// thing took, read as how far ahead it is. Three of its four gold rows are
// here; 138 has flipped in and out three times today, so treat the whole
// class as unstable rather than these ids as settled. 096 is a person named
// Wednesday, which the warm chain has never answered.
const knownGaps = new Set([
  "negative-034",
  "negative-096",
  "negative-136",
  "negative-138",
]);
const isGap = (example: Example) => knownGaps.has(example.id);

const check = async (example: Example) => {
  const result = await parser.parse(example.text);
  if (example.schedule === null) {
    expect(result.expressions).toEqual([]);
  } else {
    expect(result.expressions).toHaveLength(1);
    expect(result.expressions[0].schedule).toEqual(example.schedule);
  }
};

it.each(examples.filter((example) => !isGap(example)))("$id: $text", check);
it.fails.each(examples.filter(isGap))("known gap — $id: $text", check);

it.each([
  ["27pm", "invalid-time"],
  ["2:99pm", "invalid-time"],
  ["2026-13-01", "invalid-date"],
  ["every Monday until", "invalid-bound"],
])("rejects malformed or ambiguous input: %s", async (text, code) => {
  const result = await parser.parse(text);
  expect(result.expressions).toHaveLength(1);
  expect(result.expressions[0].schedule).toBeNull();
  expect(
    result.expressions[0].diagnostics.map((diagnostic) => diagnostic.code),
  ).toContain(code);
});
