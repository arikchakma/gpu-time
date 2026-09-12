import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../../core/src/compile.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
import type { Label, Schedule, Token } from "../../core/src/types.ts";

// Recorded paths stay relative to this package so the reports stay portable.
const root = new URL("../", import.meta.url);

interface Example {
  id: string;
  family: string;
  text: string;
  schedule: Schedule;
  spans: { start: number; end: number; label: Label; clauseStart: boolean }[];
}
const source = process.argv[2] ?? "data/synth/semantic-checks.jsonl";
const sourceUrl = new URL(source, root);
const examples: Example[] = (await readFile(sourceUrl, "utf8"))
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
  new URL(process.argv[3] ?? "results/semantic-roundtrip.json", root),
  JSON.stringify(
    {
      source: relative(fileURLToPath(root), fileURLToPath(sourceUrl)),
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
