import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { Schedule } from "../src/types.js";

// Evaluate the distributed parser. Importing source here would bypass the shader
// bundler and would not test the package users actually receive.
const { createParser } = await import(
  new URL("../dist/schedule.js", import.meta.url).href
);
const parser = await createParser({ backend: "cpu", tokens: true });
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
    const source = await readFile(`data/gold/${name}.jsonl`, "utf8");
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
await mkdir("bench/results", { recursive: true });
await writeFile(
  "bench/results/model-structure.json",
  JSON.stringify(
    {
      scope:
        "Exact AST equality from trained CPU predictions. Development fixtures overlap across sets; do not combine totals or describe these as untouched test data.",
      model: JSON.parse(await readFile("training/export-report.json", "utf8"))
        .artifactSha256,
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
