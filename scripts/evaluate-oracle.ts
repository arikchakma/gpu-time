import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { compile } from "../src/compile.js";
import { LABELS, type Label } from "../src/labels.js";
import { tokenize } from "../src/tokenizer.js";
import type { Schedule, Token } from "../src/types.js";

interface OracleCase {
  id: string;
  text: string;
  schedule: Schedule;
  tokens: Pick<Token, "start" | "end" | "label" | "clauseStart">[];
}

const cases: OracleCase[] = readFileSync("data/gold/labels.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const labelCounts = Object.fromEntries(
  LABELS.map((label) => [label, 0]),
) as Record<Label, number>;
const results = cases.map((example) => {
  const raw = tokenize(example.text);
  const tokens = raw.map((token, index): Token => {
    const annotation = example.tokens[index];
    if (
      !annotation ||
      token.start !== annotation.start ||
      token.end !== annotation.end
    )
      throw new Error(`Stale token offsets in ${example.id}`);
    if (token.kind !== 3) labelCounts[annotation.label]++;
    return { ...token, ...annotation, score: 1 };
  });

  const expressions = compile(example.text, tokens);
  const correct =
    expressions.length === 1 &&
    isDeepStrictEqual(expressions[0].schedule, example.schedule);
  return {
    id: example.id,
    text: example.text,
    correct,
    expected: example.schedule,
    actual: expressions,
  };
});

const correct = results.filter((result) => result.correct).length;
writeFileSync(
  "data/gold/oracle-baseline.json",
  JSON.stringify(
    { total: results.length, correct, labelCounts, results },
    null,
    2,
  ) + "\n",
);
console.log(
  `Oracle compiler: ${correct}/${results.length} exact schedules. This is not a model evaluation.`,
);
console.log(
  "Pending:",
  results
    .filter((result) => !result.correct)
    .map((result) => result.id)
    .join(", "),
);
if (process.argv.includes("--require-all") && correct !== results.length)
  process.exitCode = 1;
