import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineParser, type ParseResult, type TimeRange } from "gpu-time";
import { matches, type Expected } from "./recognizers-values.ts";

const packageRoot = join(import.meta.dirname, "..");
const corpus = join(packageRoot, "data", "recognizers");
// Dev-only fixture read across packages, as the migration contract allows.
const exportReport = join(
  packageRoot,
  "..",
  "training",
  "active",
  "export-report.json",
);
interface Example {
  id: string;
  family: string;
  text: string;
  reference: string;
  timeZone: string;
  expected: Expected[];
  pastExpected?: Expected[];
  split: string;
}
const split = process.argv.includes("--test") ? "test" : "development";
const cases: Example[] = (await readFile(join(corpus, "cases.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .filter((example) => example.split === split);
const parser = await defineParser({ backend: "cpu" });
const results: {
  id: string;
  family: string;
  text: string;
  reference: string;
  expected: Expected[];
  actual: TimeRange[];
  correct: boolean;
  stage: string;
  error?: string;
  parsed?: ParseResult;
}[] = [];
try {
  for (const example of cases) {
    let parsed: ParseResult | undefined;
    try {
      parsed = await parser.parse(example.text, {
        reference: example.reference,
        timeZone: example.timeZone,
        limit: 12,
        until: horizon(example.reference),
      });
      const actual = parsed.occurrences;
      actual.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const expected = example.expected;
      const correct = matchResults(actual, expected);
      const matchesPast =
        example.pastExpected && matchResults(actual, example.pastExpected);
      const stage = correct
        ? "correct"
        : matchesPast
          ? "matches-upstream-past"
          : parsed.diagnostics.some(
                (value) => value.code === "resolution-error",
              )
            ? "resolution-error"
            : !actual.length &&
                parsed.diagnostics.some((value) => value.severity === "error")
              ? "interpretation-failed"
              : !actual.length
                ? "no-result"
                : "value-mismatch";
      results.push({
        id: example.id,
        family: example.family,
        text: example.text,
        reference: example.reference,
        expected,
        actual,
        correct,
        stage,
        parsed,
      });
    } catch (error) {
      results.push({
        id: example.id,
        family: example.family,
        text: example.text,
        reference: example.reference,
        expected: example.expected,
        actual: [],
        correct: false,
        stage: parsed ? "resolution-exception" : "parser-exception",
        error: String(error),
        parsed,
      });
    }
  }
} finally {
  parser.dispose();
}
const families = [...new Set(results.map((result) => result.family))].map(
  (family) => {
    const selected = results.filter((result) => result.family === family);
    return {
      family,
      total: selected.length,
      correct: selected.filter((result) => result.correct).length,
    };
  },
);
const correct = results.filter((result) => result.correct).length;
await writeFile(
  join(packageRoot, "results", `recognizers-${split}.json`),
  JSON.stringify(
    {
      model: JSON.parse(await readFile(exportReport, "utf8")).artifactSha256,
      corpus: JSON.parse(await readFile(join(corpus, "manifest.json"), "utf8")),
      split,
      total: cases.length,
      correct,
      accuracy: correct / cases.length,
      families,
      stages: Object.fromEntries(
        [...new Set(results.map((result) => result.stage))].map((stage) => [
          stage,
          results.filter((result) => result.stage === stage).length,
        ]),
      ),
      results,
      scope:
        "Strict match to independent upstream FutureResolution values, including the entire input and returned interval ends. No mismatches are removed as policy differences. This development evaluation is separate from synthetic training metrics; the reserved test split is not evaluated by default.",
    },
    null,
    2,
  ) + "\n",
);
console.table(families);
console.log(
  `Recognizers ${split}: ${correct}/${cases.length} exact resolved results`,
);

if (process.argv.includes("--floor")) {
  const floorPath = join(
    packageRoot,
    "data",
    `recognizers-${split}.floor.json`,
  );
  const floor: { correct: number; families: Record<string, number> } =
    JSON.parse(await readFile(floorPath, "utf8"));
  const drops = [
    ...(correct < floor.correct
      ? [`overall ${correct} < ${floor.correct}`]
      : []),
    ...families
      .filter(({ family, correct }) => correct < (floor.families[family] ?? 0))
      .map(
        ({ family, correct }) =>
          `${family} ${correct} < ${floor.families[family]}`,
      ),
  ];
  if (drops.length) {
    console.error(`Recognizers floor failed:\n  ${drops.join("\n  ")}`);
    console.error(
      `Raise the floor in ${floorPath} only when the drop is understood and recorded.`,
    );
    process.exitCode = 1;
  } else {
    const gains = families.filter(
      ({ family, correct }) => correct > (floor.families[family] ?? 0),
    );
    console.log(
      `Recognizers floor passed${gains.length ? `; ${gains.length} families above floor, raise it` : ""}.`,
    );
  }
}

function matchResults(actual: TimeRange[], expected: Expected[]): boolean {
  if (actual.length !== expected.length) return false;
  const remaining = [...expected];
  return actual.every((value) => {
    const index = remaining.findIndex((wanted) => matches(value, wanted));
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

function horizon(reference: string): string {
  const date = new Date(reference);
  date.setUTCFullYear(date.getUTCFullYear() + 100);
  return date.toISOString();
}
