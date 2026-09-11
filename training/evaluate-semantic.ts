import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { defineParser } from "../dist/schedule.js";
import type { Schedule } from "../src/types.js";

interface Example {
  id: string;
  family: string;
  text: string;
  schedule: Schedule;
}
const source = process.argv[3] ?? "data/synth/semantic-checks.jsonl";
const contents = await readFile(source, "utf8");
const examples: Example[] = contents
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const parser = await defineParser({ backend: "cpu" });
const families = new Map<string, { total: number; correct: number }>();
const failures = [];
try {
  for (const example of examples) {
    const result = await parser.parse(example.text);
    const correct =
      result.expressions.length === 1 &&
      isDeepStrictEqual(result.expressions[0].schedule, example.schedule);
    const count = families.get(example.family) ?? { total: 0, correct: 0 };
    count.total++;
    count.correct += Number(correct);
    families.set(example.family, count);
    if (!correct && failures.length < 100)
      failures.push({ ...example, actual: result.expressions });
  }
} finally {
  parser.dispose();
}
const model = JSON.parse(
  await readFile("training/export-report.json", "utf8"),
).artifactSha256;
const output = process.argv[2] ?? "training/semantic-evaluation.json";
await writeFile(
  output,
  JSON.stringify(
    {
      model,
      source,
      sourceSha256: createHash("sha256").update(contents).digest("hex"),
      total: examples.length,
      correct: [...families.values()].reduce(
        (sum, count) => sum + count.correct,
        0,
      ),
      families: Object.fromEntries(families),
      failures,
      scope:
        "Exact AST equality from neural predictions against independently sampled specifications. Fresh values use the same rendering families as part of training; this is a synthetic development check, not unseen-language accuracy.",
    },
    null,
    2,
  ) + "\n",
);
console.table(Object.fromEntries(families));
