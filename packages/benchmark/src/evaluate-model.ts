import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Schedule } from "../../core/src/types.ts";

const packageRoot = join(import.meta.dirname, "..");
// Dev-only fixtures read across packages, as the migration contract allows.
const training = join(packageRoot, "..", "training");
const gold = join(training, "data", "gold");
const exportReport = join(training, "active", "export-report.json");

// Evaluate the distributed parser. Importing source here would bypass the shader
// bundler and would not test the package users actually receive.
const { defineParser } = await import(
  new URL("../../core/dist/schedule.js", import.meta.url).href
);
const parser = await defineParser({ backend: "cpu", tokens: true });
const sets = [
  "adversarial",
  "user-cases",
  "labels",
  "grammar",
  "negatives",
  "grammar-variations",
  "prose",
];
const results = [];
try {
  for (const name of sets) {
    const source = await readFile(join(gold, `${name}.jsonl`), "utf8");
    const cases = source
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            id: string;
            text: string;
            family?: string;
            schedule: Schedule | null;
          },
      );
    const examples = [];
    for (const example of cases) {
      const actual = await parser.parse(example.text);
      examples.push({
        id: example.id,
        text: example.text,
        family: example.family,
        correct:
          example.schedule === null
            ? actual.expressions.length === 0
            : actual.expressions.length === 1 &&
              isDeepStrictEqual(
                actual.expressions[0].schedule,
                example.schedule,
              ),
        expected: example.schedule,
        actual: actual.expressions,
        tokens: actual.tokens?.filter(
          (token: { kind: number }) => token.kind !== 3,
        ),
      });
    }
    const correct = examples.filter((example) => example.correct).length;
    results.push({
      name,
      sha256: createHash("sha256").update(source).digest("hex"),
      total: examples.length,
      correct,
      accuracy: correct / examples.length,
      examples,
    });
    console.log(
      `${name}: ${correct}/${examples.length} ${name === "negatives" ? "correct abstentions" : "exact schedules"}`,
    );
    console.log(
      "Failures:",
      examples
        .filter((example) => !example.correct)
        .map((example) => example.id)
        .join(", "),
    );
  }
} finally {
  parser.dispose();
}
await mkdir(join(packageRoot, "results"), { recursive: true });
await writeFile(
  join(packageRoot, "results", "model-structure.json"),
  JSON.stringify(
    {
      scope:
        "Exact AST equality from trained CPU predictions. Development fixtures overlap across sets; do not combine totals or describe these as untouched test data.",
      model: JSON.parse(await readFile(exportReport, "utf8")).artifactSha256,
      results,
    },
    null,
    2,
  ) + "\n",
);
if (
  process.argv.includes("--require-all") &&
  results.some((set) => set.correct !== set.total)
)
  process.exitCode = 1;
