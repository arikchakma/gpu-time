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

// Open model gaps, kept running with it.fails so a retrain that closes one
// turns this red and the id comes off the list. Gold is right in every case:
// the model reads a bare ordinal, a numbered thing, a measurement, or an
// "N to M" score as a date or a clock range.
// Rewritten for the step3-580b weights. That retrain closed nine of the older
// gaps (017, 044, 052, 076, 081, 089, 095, 104, 110) and opened thirteen more,
// a net loss of four on negatives.jsonl traded for +59 on the pooled gold sets.
// The new gaps cluster on counted objects ("Pack 4 shirts and 2 pairs") and on
// "second"/"minute" used as an ordinal or an adjective.
const knownGaps = new Set([
  "negative-034",
  "negative-041",
  "negative-050",
  "negative-053",
  "negative-059",
  "negative-064",
  "negative-065",
  "negative-067",
  "negative-068",
  "negative-073",
  "negative-074",
  "negative-086",
  "negative-091",
  "negative-096",
  "negative-098",
  "negative-100",
  "negative-102",
  "negative-106",
  "negative-120",
  "negative-122",
  "negative-124",
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
