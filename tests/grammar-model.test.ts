import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { defineParser } from "../src/schedule.js";
import type { Schedule } from "../src/types.js";

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
  readFileSync(`data/gold/${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)),
);
let parser: Awaited<ReturnType<typeof defineParser>>;
beforeAll(async () => {
  parser = await defineParser({ backend: "cpu" });
});
afterAll(() => parser.dispose());

it.each(examples)("$id: $text", async (example) => {
  const result = await parser.parse(example.text);
  if (example.schedule === null) {
    expect(result.expressions).toEqual([]);
  } else {
    expect(result.expressions).toHaveLength(1);
    expect(result.expressions[0].schedule).toEqual(example.schedule);
  }
});

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
