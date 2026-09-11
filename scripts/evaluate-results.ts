import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  defineParser,
  type ParseContext,
  type TimeRange,
} from "../dist/index.js";

const source = await readFile("data/gold/results.jsonl", "utf8");
const examples: {
  id: string;
  text: string;
  context: ParseContext;
  occurrences: TimeRange[];
  error?: string;
}[] = source
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const parser = await defineParser({ backend: "cpu" });
const cases = [];
try {
  for (const example of examples) {
    const actual = await parser.parse(example.text, example.context);
    const correct =
      isDeepStrictEqual(actual.occurrences, example.occurrences) &&
      (example.error
        ? actual.diagnostics.some((value) => value.code === example.error)
        : !actual.diagnostics.some((value) => value.severity === "error"));
    cases.push({ ...example, actual, correct });
  }
} finally {
  parser.dispose();
}
const correct = cases.filter((value) => value.correct).length;
await writeFile(
  "bench/results/direct-results.json",
  JSON.stringify(
    {
      model: JSON.parse(await readFile("training/export-report.json", "utf8"))
        .artifactSha256,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      total: cases.length,
      correct,
      cases,
      scope:
        "Hand-authored final date/range expectations through the packaged public API, including recurrence and DST. A development gate, not a general-language accuracy claim.",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Direct date results: ${correct}/${cases.length}`);
for (const example of cases.filter((value) => !value.correct))
  console.log(JSON.stringify(example));
if (correct !== cases.length) process.exitCode = 1;
