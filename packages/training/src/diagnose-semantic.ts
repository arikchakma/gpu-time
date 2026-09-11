import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { defineParser } from "../../core/src/schedule.ts";
import { compile } from "../../core/src/compile.ts";
import type {
  Expression,
  Label,
  Schedule,
  Token,
} from "../../core/src/types.ts";

// Recorded paths stay relative to this package so the reports stay portable.
const root = new URL("../", import.meta.url);

interface Example {
  id: string;
  family: string;
  text: string;
  schedule: Schedule;
  spans: { start: number; end: number; label: Label; clauseStart: boolean }[];
}

const evaluation = JSON.parse(
  await readFile(new URL("results/expanded-after.json", root), "utf8"),
);
const contents = await readFile(new URL(evaluation.source, root), "utf8");
const sourceSha256 = createHash("sha256").update(contents).digest("hex");
if (sourceSha256 !== evaluation.sourceSha256)
  throw new Error("The evaluated corpus has changed.");
const model = JSON.parse(
  await readFile(new URL("active/export-report.json", root), "utf8"),
).artifactSha256;
if (model !== evaluation.model)
  throw new Error("Re-evaluate the selected model first.");
const ids = new Set<string>(
  evaluation.failures.map((value: Example) => value.id),
);
const examples: Example[] = contents
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .filter((value) => ids.has(value.id));
const correct = (expressions: Expression[], schedule: Schedule) =>
  expressions.length === 1 &&
  isDeepStrictEqual(expressions[0].schedule, schedule);

function oracle(example: Example, tokens: Token[]): Token[] {
  let position = 0;
  return tokens.map((token) => {
    if (token.kind === 3)
      return { ...token, label: "O", clauseStart: false, score: 1 };
    while (example.spans[position]?.end <= token.start) position++;
    const span = example.spans[position];
    if (!span || token.start < span.start || token.end > span.end)
      throw new Error(`Unaligned supervision in ${example.id}`);
    return {
      ...token,
      label: span.label,
      clauseStart: span.clauseStart && span.start === token.start,
      score: 1,
    };
  });
}

const parser = await defineParser({ backend: "cpu", tokens: true });
const failures: {
  id: string;
  family: string;
  text: string;
  stage: string;
  oracleCorrect: boolean;
  boundariesCorrect: boolean;
  rolesCorrect: boolean;
  expected: Schedule;
  actual: Expression[];
  differences: {
    text: string;
    start: number;
    predictedRole: Label;
    expectedRole: Label;
    predictedBoundary: boolean;
    expectedBoundary: boolean;
  }[];
}[] = [];
try {
  for (const example of examples) {
    const parsed = await parser.parse(example.text);
    const predicted = parsed.tokens!;
    const expected = oracle(example, predicted);
    const assemble = (tokens: Token[]) => compile(example.text, tokens);
    const oracleCorrect = correct(assemble(expected), example.schedule);
    const boundariesCorrect = correct(
      assemble(
        predicted.map((token, index) => ({
          ...token,
          clauseStart: expected[index].clauseStart,
        })),
      ),
      example.schedule,
    );
    const rolesCorrect = correct(
      assemble(
        predicted.map((token, index) => ({
          ...token,
          label: expected[index].label,
        })),
      ),
      example.schedule,
    );
    const stage = correct(parsed.expressions, example.schedule)
      ? "already-correct"
      : !oracleCorrect
        ? "oracle-mismatch"
        : boundariesCorrect && rolesCorrect
          ? "either-intervention"
          : boundariesCorrect
            ? "boundary-sensitive"
            : rolesCorrect
              ? "role-sensitive"
              : "roles-and-boundaries";
    failures.push({
      id: example.id,
      family: example.family,
      text: example.text,
      stage,
      oracleCorrect,
      boundariesCorrect,
      rolesCorrect,
      expected: example.schedule,
      actual: parsed.expressions,
      differences: predicted.flatMap((token, index) =>
        token.kind !== 3 &&
        (token.label !== expected[index].label ||
          token.clauseStart !== expected[index].clauseStart)
          ? [
              {
                text: token.text,
                start: token.start,
                predictedRole: token.label,
                expectedRole: expected[index].label,
                predictedBoundary: token.clauseStart,
                expectedBoundary: expected[index].clauseStart,
              },
            ]
          : [],
      ),
    });
  }
} finally {
  parser.dispose();
}
const stages = Object.fromEntries(
  [...new Set(failures.map((value) => value.stage))].map((stage) => [
    stage,
    failures.filter((value) => value.stage === stage).length,
  ]),
);
await writeFile(
  new URL("results/failure-diagnosis.json", root),
  JSON.stringify(
    {
      model,
      source: evaluation.source,
      sourceSha256,
      totalFailures: evaluation.total - evaluation.correct,
      inspected: failures.length,
      stages,
      failures,
      scope:
        "Counterfactual checks on the evaluation's captured failures (at most 100). Replacing roles or boundaries identifies sensitivity, not proof that the model is wrong: equivalent semantic roles and harmless filler still require compiler-contract review. No weights or runtime predictions are changed.",
    },
    null,
    2,
  ) + "\n",
);
console.table(stages);
