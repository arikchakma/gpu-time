import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Schedule } from "../../core/src/types.ts";

// Recorded paths stay relative to this package so the reports stay portable.
const root = new URL("../", import.meta.url);
const { values, positionals } = parseArgs({
  options: { dist: { type: "string" } },
  allowPositionals: true,
});
const { defineParser } = await import(
  values.dist
    ? pathToFileURL(resolve(values.dist)).href
    : new URL("../../core/dist/schedule.js", import.meta.url).href
);

interface Example {
  id: string;
  family: string;
  text: string;
  schedule: Schedule;
}
const source = positionals[1] ?? "data/synth/semantic-checks.jsonl";
const contents = await readFile(new URL(source, root), "utf8");
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
const model =
  values.dist ??
  JSON.parse(await readFile(new URL("active/export-report.json", root), "utf8"))
    .artifactSha256;
const output = positionals[0] ?? "results/semantic-evaluation.json";
await writeFile(
  new URL(output, root),
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
