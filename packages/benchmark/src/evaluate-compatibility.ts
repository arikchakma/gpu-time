import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineParser } from "gpu-time";
import { en } from "chrono-node";
import {
  matches,
  type CompatibilityCase,
  type Window,
} from "./compatibility.ts";

// Chrono's calendar operations must not inherit the machine's timezone or DST.
process.env.TZ = "UTC";
const root = join(import.meta.dirname, "..");
const source = await readFile(
  join(root, "data/english-compatibility.jsonl"),
  "utf8",
);
const fixtures: CompatibilityCase[] = source
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const parsers = {
  MDY: await defineParser({ backend: "cpu", dateOrder: "MDY" }),
  DMY: await defineParser({ backend: "cpu", dateOrder: "DMY" }),
};
const cases = [];
try {
  for (const fixture of fixtures) {
    const order = fixture.dateOrder ?? "MDY";
    let gpuActual: Window[] = [],
      chronoActual: Window[] = [];
    let gpuError: string | undefined, chronoError: string | undefined;
    let diagnostics: unknown[] = [];
    let gpuPass = false,
      chronoPass = false;
    try {
      const result = await parsers[order].parse(fixture.text, fixture.context);
      gpuActual = result.occurrences;
      diagnostics = result.diagnostics;
      gpuPass =
        matches(gpuActual, fixture.expected, fixture.context.timeZone, true) &&
        !result.truncated &&
        result.rrules.length === 0 &&
        (!fixture.expected.length ||
          !result.diagnostics.some((item) => item.severity === "error"));
    } catch (error) {
      gpuError = String(error);
    }
    const chronoExpected = fixture.chronoExpected ?? fixture.expected;
    try {
      const parser = order === "DMY" ? en.GB : en.casual;
      const result = parser.parse(
        fixture.text,
        {
          instant: new Date(fixture.context.reference),
          timezone: fixture.chronoTimezone ?? 0,
        },
        { forwardDate: fixture.chronoForwardDate ?? true },
      );
      chronoActual = result.map((item) => ({
        start: item.start.date().toISOString(),
        ...(item.end ? { end: item.end.date().toISOString() } : {}),
      }));
      chronoPass = matches(
        chronoActual,
        chronoExpected,
        fixture.context.timeZone,
      );
    } catch (error) {
      chronoError = String(error);
    }
    cases.push({
      ...fixture,
      gpuTime: {
        passed: gpuPass,
        actual: gpuActual,
        diagnostics,
        ...(gpuError ? { error: gpuError } : {}),
      },
      chrono: {
        passed: chronoPass,
        expected: chronoExpected,
        actual: chronoActual,
        ...(chronoError ? { error: chronoError } : {}),
      },
    });
  }
} finally {
  parsers.MDY.dispose();
  parsers.DMY.dispose();
}

const counts = (rows: typeof cases) => ({
  total: rows.length,
  gpuTimePassed: rows.filter((row) => row.gpuTime.passed).length,
  chronoPassed: rows.filter((row) => row.chrono.passed).length,
  bothPassed: rows.filter((row) => row.gpuTime.passed && row.chrono.passed)
    .length,
  gpuTimeGaps: rows
    .filter((row) => !row.gpuTime.passed && row.chrono.passed)
    .map((row) => row.id),
  chronoGaps: rows
    .filter((row) => row.gpuTime.passed && !row.chrono.passed)
    .map((row) => row.id),
  bothFailed: rows
    .filter((row) => !row.gpuTime.passed && !row.chrono.passed)
    .map((row) => row.id),
});
const active = JSON.parse(
  await readFile(join(root, "../training/active/export-report.json"), "utf8"),
);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
if (
  hash(await readFile(join(root, "../core/src/model/weights.gen.ts"))) !==
  active.artifactSha256
)
  throw new Error("The active model report does not match the weights.");
const report = {
  model: active.artifactSha256,
  runtimeSha256: hash(await readFile(join(root, "../core/dist/index.js"))),
  sourceSha256: hash(source),
  chronoVersion: JSON.parse(
    await readFile(join(root, "node_modules/chrono-node/package.json"), "utf8"),
  ).version,
  scope:
    "Independently authored API behavior checks inspired by Chrono's English coverage, not copied upstream tests. Both parsers face hand-written expectations. Shared cases measure the same intended behavior; policy cases have explicit separate expectations. Date-only checks ignore implied clock defaults but enforce date, result count and endpoint presence. Explicit times are compared as exact instants. gpu-time also checks allDay, errors, truncation and absence of recurrence. This is a targeted compatibility sample, not full Chrono parity or general language accuracy.",
  configuration:
    "English casual with forwardDate=true except explicitly past cases; MDY uses en.casual and DMY uses en.GB. Every input has an explicit reference. The host timezone is pinned to UTC; caller offsets and weekday options are recorded per case. No training or runtime changes are made by this evaluator.",
  sources: [
    "en_time_exp",
    "en_relative",
    "en_inter_std",
    "en_timezone_exp",
    "en_slash",
    "en_month_name_little_endian",
    "negative_cases",
    "en_merging_relative_dates",
  ]
    .map(
      (file) =>
        `https://github.com/wanasit/chrono/blob/v2.10.1/test/en/${file}.test.ts`,
    )
    .concat([
      "https://github.com/wanasit/chrono/blob/v2.10.1/src/calculation/duration.ts",
      "https://github.com/wanasit/chrono/blob/v2.10.1/src/common/parsers/SlashDateFormatParser.ts",
    ]),
  shared: counts(cases.filter((row) => row.comparison === "shared")),
  policy: counts(cases.filter((row) => row.comparison === "policy")),
  families: Object.fromEntries(
    [...new Set(cases.map((row) => row.family))]
      .sort()
      .map((family) => [
        family,
        counts(cases.filter((row) => row.family === family)),
      ]),
  ),
  cases,
};
await writeFile(
  join(root, "results/english-compatibility.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Shared behavior: gpu-time ${report.shared.gpuTimePassed}/${report.shared.total}, Chrono ${report.shared.chronoPassed}/${report.shared.total}, both correct ${report.shared.bothPassed}/${report.shared.total}.`,
);
console.log(
  `Policy/representation cases: gpu-time ${report.policy.gpuTimePassed}/${report.policy.total}, Chrono ${report.policy.chronoPassed}/${report.policy.total}.`,
);
for (const row of cases.filter((row) => !row.gpuTime.passed))
  console.log(`${row.id} ${row.family}: ${row.text}`);
if (
  process.argv.includes("--require-all") &&
  cases.some((row) => !row.gpuTime.passed)
)
  process.exitCode = 1;
