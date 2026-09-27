import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ParseContext, ParseResult } from "gpu-time";

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
  argument("--out") ?? join(root, "results/spanish-coverage.json"),
);
const modelReport = resolve(
  argument("--model-report") ??
    join(root, "../core/src/model/weights-es.report.json"),
);
const fixturePath = join(root, "../training/data/gold/spanish-coverage.jsonl");
const source = await readFile(fixturePath, "utf8");
const fixtures: {
  id: string;
  family: string;
  text: string;
  source: string;
  context: ParseContext;
  matched?: string;
  spanOnly?: boolean;
  occurrences?: { start: string }[];
}[] = source
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const { defineParser } = await import(
  pathToFileURL(join(dist, "index.js")).href
);
const { default: bundled } = await import(
  pathToFileURL(join(dist, "languages/es.js")).href
);
const es = argument("--weights")
  ? {
      ...bundled,
      model: (await import(pathToFileURL(resolve(argument("--weights")!)).href))
        .weights,
    }
  : bundled;
const parser = await defineParser({ languages: [es], backend: "cpu" });
const score = (
  fixture: (typeof fixtures)[number],
  parsed: ParseResult,
): boolean => {
  if (fixture.spanOnly) {
    const at = fixture.text.indexOf(fixture.matched!);
    const end = at + fixture.matched!.length;
    return parsed.spans.some((span) => span.start < end && span.end > at);
  }
  if (!fixture.occurrences || fixture.occurrences.length === 0)
    return parsed.spans.length === 0;
  return parsed.occurrences[0]?.start === fixture.occurrences[0].start;
};
const cases = [];
try {
  for (const fixture of fixtures) {
    const parsed = await parser.parse(fixture.text, {
      ...fixture.context,
      limit: 5,
    });
    cases.push({
      ...fixture,
      actual: parsed.occurrences,
      spans: parsed.spans,
      diagnostics: parsed.diagnostics,
      correct: score(fixture, parsed),
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
        "Spanish phrases and expected answers drawn from chrono-node's test/es assertions, scored as occurrences or spans. This is targeted coverage, not general-language accuracy.",
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Spanish coverage: ${correct}/${cases.length} (${((100 * correct) / cases.length).toFixed(1)}%)`,
);
for (const value of cases.filter((value) => !value.correct))
  console.log(`${value.id} ${value.family}: ${value.text}`);
if (process.argv.includes("--require-all")) {
  const gaps: string[] = JSON.parse(
    await readFile(
      join(root, "../training/data/gold/spanish-coverage.gaps.json"),
      "utf8",
    ),
  ).open;
  const known = new Set(gaps);
  const unexpected = cases.filter(
    (value) => !value.correct && !known.has(value.id),
  );
  const closed = cases.filter((value) => value.correct && known.has(value.id));
  for (const value of unexpected)
    console.error(`unexpected failure ${value.id}: ${value.text}`);
  for (const value of closed)
    console.error(`${value.id} now passes; remove it from the gaps file`);
  if (unexpected.length || closed.length) process.exitCode = 1;
  else
    console.log(`${known.size} known gaps still open, no unexpected failures.`);
}
