import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  defineParser,
  type ParseContext,
  type TimeRange,
} from "../src/index.js";

const goldPath = (name: string) =>
  `${import.meta.dirname}/../../training/data/gold/${name}.jsonl`;

const cases: {
  id: string;
  text: string;
  context: ParseContext;
  occurrences: TimeRange[];
  error?: string;
}[] = readFileSync(goldPath("results"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
let parser: Awaited<ReturnType<typeof defineParser>>;
beforeAll(async () => {
  parser = await defineParser({ backend: "cpu" });
});
afterAll(() => parser.dispose());
it.each(cases)("$id: $text", async (example) => {
  const actual = await parser.parse(example.text, example.context);
  expect(actual.occurrences).toEqual(example.occurrences);
  if (example.error)
    expect(
      actual.diagnostics.some((value) => value.code === example.error),
    ).toBe(true);
  else
    expect(
      actual.diagnostics.filter((value) => value.severity === "error"),
    ).toEqual([]);
});
