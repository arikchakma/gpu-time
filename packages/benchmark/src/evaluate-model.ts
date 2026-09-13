import { readFile, writeFile, mkdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Schedule } from "../../core/src/types.ts";

const packageRoot = join(import.meta.dirname, "..");
// Dev-only fixtures read across packages, as the migration contract allows.
const training = join(packageRoot, "..", "training");
const gold = join(training, "data", "gold");
const exportReport = join(training, "active", "export-report.json");

// The export gate points these at a build of a candidate's weights; the default
// is the checked-out dist that `pnpm evaluate` reports on.
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}.`);
  return value;
};
const dist = argument("--dist");

// Evaluate the distributed parser. Importing source here would bypass the shader
// bundler and would not test the package users actually receive.
const { defineParser } = await import(
  dist
    ? pathToFileURL(resolve(dist)).href
    : new URL("../../core/dist/schedule.js", import.meta.url).href
);
const parser = await defineParser({ backend: "cpu", tokens: true });
// The generated corpora share the gold {text, schedule} shape.
const directory = argument("--dir") ? resolve(argument("--dir")!) : gold;
const sets = argument("--sets")?.split(",") ?? [
  "adversarial",
  "user-cases",
  "labels",
  "grammar",
  "negatives",
  "grammar-variations",
  "prose",
  "chat",
];
const results = [];
try {
  for (const name of sets) {
    const source = await readFile(join(directory, `${name}.jsonl`), "utf8");
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
const output =
  argument("--out") ?? join(packageRoot, "results", "model-structure.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      scope:
        "Exact AST equality from trained CPU predictions. Development fixtures overlap across sets; do not combine totals or describe these as untouched test data.",
      model:
        dist ?? JSON.parse(await readFile(exportReport, "utf8")).artifactSha256,
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
