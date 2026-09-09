import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { compile } from "../src/compile.js";
import { tokenize } from "../src/tokenizer.js";
import type { Label, Schedule, Token } from "../src/types.js";

interface Example {
  id: string;
  family: string;
  text: string;
  schedule: Schedule;
  spans: { start: number; end: number; label: Label; clauseStart: boolean }[];
}
const source = process.argv[2] ?? "data/synth/semantic-checks.jsonl";
const examples: Example[] = (await readFile(source, "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const failures = [];
for (const example of examples) {
  let position = 0;
  const tokens = tokenize(example.text).map((token): Token => {
    if (token.kind === 3)
      return { ...token, label: "O", clauseStart: false, score: 1 };
    while (example.spans[position]?.end <= token.start) position++;
    const span = example.spans[position];
    if (!span || token.start < span.start || token.end > span.end)
      throw new Error(`Unaligned slot in ${example.id}`);
    return {
      ...token,
      label: span.label,
      clauseStart: span.clauseStart && span.start === token.start,
      score: 1,
    };
  });
  const expressions = compile(example.text, tokens);
  if (
    expressions.length !== 1 ||
    !isDeepStrictEqual(expressions[0].schedule, example.schedule)
  )
    failures.push({ ...example, actual: expressions });
}
await writeFile(
  "training/semantic-roundtrip.json",
  JSON.stringify(
    {
      source,
      total: examples.length,
      correct: examples.length - failures.length,
      failures,
      scope:
        "Compiler equality using independently sampled ASTs and renderer slot labels. This validates training supervision, not neural prediction accuracy.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Semantic round trip: ${examples.length - failures.length}/${examples.length}`,
);
if (failures.length) process.exitCode = 1;
