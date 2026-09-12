import { defineParser } from "../packages/core/src/index.ts";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url).pathname;
const coverage = JSON.parse(
  readFileSync(
    `${root}packages/benchmark/results/english-coverage.json`,
    "utf8",
  ),
);
const baseline = JSON.parse(
  readFileSync(
    `${root}packages/benchmark/results/english-coverage-baseline.json`,
    "utf8",
  ),
);
const report = JSON.parse(
  readFileSync(`${root}packages/training/active/export-report.json`, "utf8"),
);
const recognizersFloor = JSON.parse(
  readFileSync(
    `${root}packages/benchmark/data/recognizers-development.floor.json`,
    "utf8",
  ),
);
const compatibilityFloor = JSON.parse(
  readFileSync(
    `${root}packages/benchmark/data/english-compatibility.floor.json`,
    "utf8",
  ),
);

const ids = [
  "english-001",
  "english-041",
  "english-049",
  "english-045",
  "english-052",
  "english-053",
];
const positives = ids.map((id) => {
  const item = coverage.cases.find((value: { id: string }) => value.id === id);
  assert(item, `Missing English coverage case: ${id}`);
  assert.deepEqual(item.actual, item.occurrences, `Stale result for ${id}`);
  return {
    id: item.id,
    family: item.family,
    text: item.text,
    occurrences: item.actual,
  };
});

const negativeTexts = [
  "Our office is at 15 Baker Street.",
  "She placed 2nd in the race.",
  "May is my sister's name.",
  "The invoice total came to 2400 dollars.",
  "The film is two hours and ten minutes long.",
];
const context = {
  reference: "2026-09-12T12:00:00+06:00",
  timeZone: "Asia/Dhaka",
  limit: 3,
};
const parser = await defineParser({ backend: "cpu" });
assert.equal(coverage.model, report.artifactSha256);
for (const item of positives) {
  const result = await parser.parse(item.text, context);
  assert.deepEqual(result.occurrences, item.occurrences, item.text);
}
const negativeResults = await parser.parseMany(negativeTexts, context);
parser.dispose();
for (const [index, result] of negativeResults.entries())
  assert.equal(
    result.occurrences.length,
    0,
    `Negative example parsed as a schedule: ${negativeTexts[index]}`,
  );

assert.equal(coverage.correct, coverage.total);
assert.equal(coverage.total, baseline.total);
assert.equal(report.promotion.candidate.sets.negatives.total, 192);
assert.equal(recognizersFloor.families.DatePeriodParser, 16);

writeFileSync(
  `${root}video/edge-cases-data.json`,
  JSON.stringify(
    {
      source: {
        model: report.artifactSha256,
        coverage: "packages/benchmark/results/english-coverage.json",
        baseline: "packages/benchmark/results/english-coverage-baseline.json",
      },
      positives,
      negatives: negativeTexts,
      metrics: {
        authoredEnglish: {
          before: baseline.correct,
          after: coverage.correct,
          total: coverage.total,
        },
        nonTemporalNegatives: {
          before: report.promotion.baseline.sets.negatives.correct,
          after: report.promotion.candidate.sets.negatives.correct,
          total: report.promotion.candidate.sets.negatives.total,
        },
        floors: {
          recognizers: recognizersFloor.correct,
          compatibility: compatibilityFloor.passed,
        },
        knownDurationRangeRegressions: 7,
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(
  "Edge-case video data matches the active model and saved evaluations.",
);
