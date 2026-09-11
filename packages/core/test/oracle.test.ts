import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { tokenize } from "../src/tokenizer.js";
import type { Schedule, Token } from "../src/types.js";

const goldPath = (name: string) =>
  `${import.meta.dirname}/../../training/data/gold/${name}.jsonl`;

interface OracleCase {
  id: string;
  text: string;
  schedule: Schedule;
  tokens: Pick<Token, "label" | "clauseStart" | "start" | "end">[];
}

const cases: OracleCase[] = readFileSync(goldPath("labels"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

function expectOracle(id: string): void {
  const example = cases.find((example) => example.id === id)!;
  const tokens = tokenize(example.text).map((token, index): Token => ({
    ...token,
    ...example.tokens[index],
    score: 1,
  }));
  const expressions = compile(example.text, tokens);
  expect(expressions, example.text).toHaveLength(1);
  expect(
    expressions[0].schedule,
    JSON.stringify(expressions[0].diagnostics),
  ).toEqual(example.schedule);
}

it("preserves the modifier on a weekday instead of resolving it during parsing", () => {
  expectOracle("oracle-006");
  expectOracle("oracle-010");
});

it("assembles explicit calendar fields and shared-month ranges from their token roles", () => {
  expectOracle("oracle-017");
  expectOracle("oracle-018");
  expectOracle("oracle-019");
});

it("keeps a fixed holiday as the anchor of a relative shift", () => {
  expectOracle("oracle-022");
});

it("joins split timezone tokens and normalizes unambiguous abbreviations", () => {
  expectOracle("oracle-023");
  expectOracle("oracle-024");
});

it("distinguishes a duration from an occurrence count and keeps its starting date", () => {
  expectOracle("oracle-020");
  expectOracle("oracle-021");
});

it("distinguishes recurrence intervals from the number of times per period", () => {
  expectOracle("oracle-012");
  expectOracle("oracle-013");
  expectOracle("oracle-014");
});

it.each(cases)("assembles the full oracle contract: $id $text", (example) => {
  expectOracle(example.id);
});
