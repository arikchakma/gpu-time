import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ParseContext, TimeRange } from "gpu-time";

const root = resolve(import.meta.dirname, "..");
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}.`);
  return value;
};
if (argument("--dist") && !argument("--model-report"))
  throw new Error("An external --dist requires its --model-report.");
const dist = resolve(argument("--dist") ?? join(root, "../core/dist"));
const output = resolve(
  argument("--out") ?? join(root, "results/english-coverage.json"),
);
const modelReport = resolve(
  argument("--model-report") ??
    join(root, "../training/active/export-report.json"),
);
const fixturePath = join(root, "../training/data/gold/english-coverage.jsonl");
const source = await readFile(fixturePath, "utf8");
const fixtures: {
  id: string;
  family: string;
  text: string;
  context: ParseContext;
  occurrences: TimeRange[];
}[] = source
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const { defineParser } = await import(
  pathToFileURL(join(dist, "index.js")).href
);
const parser = await defineParser({ backend: "cpu" });
const cases = [];
try {
  for (const fixture of fixtures) {
    const parsed = await parser.parse(fixture.text, fixture.context);
    const hasError = parsed.diagnostics.some(
      (value: { severity: string }) => value.severity === "error",
    );
    cases.push({
      ...fixture,
      actual: parsed.occurrences,
      diagnostics: parsed.diagnostics,
      correct:
        isDeepStrictEqual(parsed.occurrences, fixture.occurrences) &&
        (fixture.occurrences.length === 0 || !hasError),
    });
  }
} finally {
  parser.dispose();
}
const families = Object.fromEntries(
  [...new Set(fixtures.map((fixture) => fixture.family))]
    .sort()
    .map((family) => {
      const values = cases.filter((value) => value.family === family);
      return [
        family,
        {
          correct: values.filter((value) => value.correct).length,
          total: values.length,
        },
      ];
    }),
);
const correct = cases.filter((value) => value.correct).length;
const model = JSON.parse(await readFile(modelReport, "utf8")).artifactSha256;
await writeFile(
  output,
  `${JSON.stringify(
    {
      model,
      runtimeSha256: createHash("sha256")
        .update(await readFile(join(dist, "index.js")))
        .digest("hex"),
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      runtime: argument("--dist") ? "external-dist" : "packages/core/dist",
      total: cases.length,
      correct,
      accuracy: correct / cases.length,
      families,
      cases,
      scope:
        "Independently authored English schedule regression cases with hand-written expected occurrences. This is targeted coverage, not general-language accuracy.",
    },
    null,
    2,
  )}\n`,
);
console.log(
  `English coverage: ${correct}/${cases.length} (${((100 * correct) / cases.length).toFixed(1)}%)`,
);
for (const value of cases.filter((value) => !value.correct))
  console.log(`${value.id} ${value.family}: ${value.text}`);
if (process.argv.includes("--require-all") && correct !== cases.length)
  process.exitCode = 1;
