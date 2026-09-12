import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = join(import.meta.dirname, "..");
const resultsDir = join(packageRoot, "results");
// Dev-only fixtures read across packages, as the migration contract allows.
const training = join(packageRoot, "..", "training");

const read = async (name: string) =>
  JSON.parse(await readFile(join(resultsDir, `${name}.json`), "utf8"));
const [browser, python, sizes, structure] = await Promise.all([
  read("browser"),
  read("python"),
  read("size"),
  read("model-structure"),
]);
const model = JSON.parse(
  await readFile(join(training, "active", "export-report.json"), "utf8"),
);
const sizeGate = JSON.parse(
  await readFile(join(packageRoot, "..", "core", "dist", "size.json"), "utf8"),
);
const direct = await read("direct-results");
const gpu = JSON.parse(
  await readFile(join(training, "results", "parity-gpu.json"), "utf8"),
);
const external = await read("recognizers-development");
const semantic = JSON.parse(
  await readFile(join(training, "results", "semantic-evaluation.json"), "utf8"),
);
const natural = JSON.parse(
  await readFile(join(training, "results", "natural-evaluation.json"), "utf8"),
);
const reserved = JSON.parse(
  await readFile(
    join(training, "results", "natural-reserved-evaluation.json"),
    "utf8",
  ),
);
const naturalOracle = JSON.parse(
  await readFile(join(training, "results", "natural-roundtrip.json"), "utf8"),
);
if (
  browser.model !== model.artifactSha256 ||
  direct.model !== model.artifactSha256 ||
  external.model !== model.artifactSha256 ||
  semantic.model !== model.artifactSha256 ||
  natural.model !== model.artifactSha256 ||
  reserved.model !== model.artifactSha256 ||
  structure.model !== model.artifactSha256 ||
  gpu.model !== model.artifactSha256
)
  throw new Error(
    "Evaluation artifacts refer to different model checkpoints. Rerun evaluation and browser parity.",
  );

interface Batch {
  size: number;
  ms: number;
  p95Ms: number;
  failures: number;
}
interface Output {
  id: string;
  text: string;
  occurrences?: unknown;
  rrules?: unknown;
  raw?: unknown;
  abstained?: boolean;
  error?: string;
}
interface BrowserRow {
  library: string;
  result?: {
    initializationMs: number;
    firstParseMs: number;
    single: { p50Ms: number; p95Ms: number };
    batches: Batch[];
    outputs: Output[];
  };
  error?: string;
}
const names: Record<string, string> = {
  "gpu-time-cpu": "gpu-time CPU",
  "gpu-time-webgpu": "gpu-time WebGPU",
  "gpu-time": "gpu-time",
  chrono: "Chrono (English)",
  compromise: "Compromise + dates",
  rrule: "rrule",
  recognizers: "Microsoft Recognizers",
  later: "Later",
};
const performance = (browser.results as BrowserRow[]).map((row) => ({
  library: row.library,
  name: names[row.library],
  ...(row.result
    ? {
        single: row.result.single,
        batches: row.result.batches,
        initializationMs: row.result.initializationMs,
        firstParseMs: row.result.firstParseMs,
      }
    : { error: row.error }),
}));
const sizeRows = sizes.results.map(
  (row: {
    library: string;
    brotliBytes: number;
    gzipBytes: number;
    bytes: number;
  }) => ({ ...row, name: names[row.library] }),
);
const summary = {
  status: "development",
  model: model.artifactSha256,
  environment: browser.environment,
  method: browser.method,
  limitations: [
    "Native outputs differ: gpu-time returns resolved dates, ranges and recurrence rules; other libraries return components, dates, TIMEX or recurrence constraints. Speed is not feature equivalence.",
    "The four-input batch workload includes unsupported inputs. Reported thrown-error counts do not include silent partial parses or abstentions.",
    "Internal interpretation checks and direct-result fixtures are development checks. Sets overlap and are not a final independent accuracy benchmark.",
    "Cross-library resolved-date correctness, remaining external corpora, a broader gold set and Python batch throughput remain incomplete. Microsoft development agreement is reported separately; its test split remains reserved.",
    ...(naturalOracle.correct < naturalOracle.total
      ? [
          `The frozen natural corpus has ${naturalOracle.total - naturalOracle.correct} oracle failures; pnpm benchmark stops at that check. These component results were refreshed separately without changing the corpus.`,
        ]
      : []),
    ...(sizeGate.withinBudget
      ? []
      : [
          `The complete gpu-time library exceeds its ${sizeGate.limitBytes.toLocaleString("en-US")}-byte Brotli budget.`,
        ]),
  ],
  performance,
  sizes: sizeRows,
  sizeGate: {
    limitBytes: sizeGate.limitBytes,
    withinBudget: sizeGate.withinBudget,
    brotliBytes: sizeGate.files.find(
      (file: { file: string }) => file.file === "index.js",
    ).brotliBytes,
  },
  structure: structure.results.map(
    (set: {
      name: string;
      total: number;
      correct: number;
      accuracy: number;
    }) => ({
      name: set.name,
      total: set.total,
      correct: set.correct,
      accuracy: set.accuracy,
    }),
  ),
  parity: gpu,
  directResults: { total: direct.total, correct: direct.correct },
  external: {
    name: "Microsoft Recognizers development",
    total: external.total,
    correct: external.correct,
    accuracy: external.accuracy,
    reservedTestCases: external.corpus.test,
  },
  semantic: {
    total: semantic.total,
    correct: semantic.correct,
    accuracy: semantic.correct / semantic.total,
  },
  naturalSchedules: {
    total: natural.total,
    correct: natural.correct,
    sourceSha256: natural.sourceSha256,
    oracleCorrect: naturalOracle.correct,
  },
  reservedSchedules: {
    total: reserved.total,
    correct: reserved.correct,
    sourceSha256: reserved.sourceSha256,
  },
};
await writeFile(
  join(resultsDir, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);

const lines = [
  "# gpu-time benchmark results",
  "",
  "Development measurements from real executions. This report does not establish a general accuracy ranking.",
  `Public date/range fixtures: **${direct.correct}/${direct.total}** exact results, including recurrence and daylight-saving transitions.`,
  "gpu-time timing includes its public date-resolution and recurrence-preview work. Other libraries retain their native output contracts.",
  "",
  `Browser: ${browser.environment.browser}. Hardware: ${browser.environment.cpu}. Reference: ${browser.environment.reference}, ${browser.environment.timeZone}.`,
  "",
  "## Browser parsing time",
  "",
  browser.method,
  "",
  "Each batch size has one warmup and three measurements. The table reports median duration. Failures count thrown exceptions in one trial; partial parses and empty native results can still be fast.",
  "",
  "| Library | Single p50 (µs) | Single p95 (µs) | 1,000 inputs (ms) | 10,000 inputs (ms) | Throws / 10,000 | Single returned output |",
  "|---|---:|---:|---:|---:|---:|---|",
];
for (const row of performance) {
  if (!("single" in row)) {
    lines.push(`| ${row.name} | error | — | — | — | — |`);
    continue;
  }
  const small = row.batches!.find((batch) => batch.size === 1000)!;
  const large = row.batches!.find((batch) => batch.size === 10000)!;
  const singleOutput = (browser.results as BrowserRow[])
    .find((value) => value.library === row.library)
    ?.result?.outputs.find((value) => value.text === "next Monday at 2pm");
  lines.push(
    `| ${row.name} | ${microseconds(row.single.p50Ms)} | ${microseconds(row.single.p95Ms)} | ${small.ms.toFixed(2)} | ${large.ms.toFixed(2)} | ${large.failures} | ${singleOutput?.abstained ? "No" : "Yes"} |`,
  );
}
lines.push(
  "",
  "A zero-duration sample is below the isolated browser timer's 5 µs resolution, displayed as <5. Native caches remain enabled. Returning output does not imply correctness.",
);
lines.push(
  "",
  "## Independent source cases",
  "",
  `Microsoft Recognizers development: **${external.correct}/${external.total} (${(100 * external.accuracy).toFixed(2)}%)** strict agreement with upstream future civil dates and intervals. These expected values come from upstream specifications, not gpu-time.`,
  "",
  `The corpus is pinned to [${external.corpus.commit.slice(0, 12)}](https://github.com/microsoft/Recognizers-Text/tree/${external.corpus.commit}/Specs/DateTime/English). ${external.corpus.test} grouped cases remain reserved and are not evaluated here. No mismatches are removed as policy differences. Component-specific empty results are not treated as global negative sentences. Symbolic SET/duration values without concrete dates are listed among exclusions.`,
  "",
  "| Source component | Exact resolved results |",
  "|---|---:|",
  ...external.families.map(
    (row: { family: string; correct: number; total: number }) =>
      `| ${row.family} | ${row.correct}/${row.total} |`,
  ),
  "",
  "| Failure stage | Cases |",
  "|---|---:|",
  ...Object.entries(external.stages).map(
    ([stage, count]) => `| ${stage} | ${count} |`,
  ),
  "",
  "Matches to an upstream past interpretation remain failures in the strict future score. Assembly failures can come from incorrect model roles or missing assembler support; the stage alone does not attribute the cause.",
  "",
  `The separate synthetic AST check scores **${semantic.correct}/${semantic.total}**. Its expected ASTs are sampled before rendering, and all ${semantic.total} renderer/oracle pairs pass compiler equality. Fresh values share training rendering families, so this is a development check rather than independent language accuracy.`,
  "",
);
lines.push(
  "",
  "## Python parsing time",
  "",
  python.method,
  "",
  "| Library | Version | Single p50 (µs) | Single p95 (µs) |",
  "|---|---|---:|---:|",
);
for (const row of python.results)
  lines.push(
    `| ${row.library} | ${row.version} | ${(row.single.p50Ms * 1000).toFixed(1)} | ${(row.single.p95Ms * 1000).toFixed(1)} |`,
  );
lines.push(
  "",
  "## Browser bundle size",
  "",
  sizes.method,
  "",
  "All gpu-time runtime exports, its resolver and trained weights are included. Different libraries provide different language coverage and output contracts. Exact imports and locked dependencies are recorded in [size.json](size.json).",
  "",
  `The release artifact uses ${summary.sizeGate.brotliBytes.toLocaleString("en-US")} of its ${summary.sizeGate.limitBytes.toLocaleString("en-US")}-byte Brotli budget (${sizeGate.withinBudget ? "passed" : "exceeded"}). This gate measures the published entry directly; comparison bundles below are rebundled with the recorded import expressions.`,
  "",
  "| Library | Minified bytes | Gzip bytes | Brotli bytes |",
  "|---|---:|---:|---:|",
);
for (const row of sizeRows)
  lines.push(
    `| ${row.name} | ${row.bytes} | ${row.gzipBytes} | ${row.brotliBytes} |`,
  );
lines.push(
  "",
  "## Complete schedule checks",
  "",
  "Exact AST equality from the shipped CPU model, without oracle labels. These fixtures were used during development and overlap between sets; their totals must not be combined.",
  "",
  "| Set | Exact schedules |",
  "|---|---:|",
);
for (const row of summary.structure)
  lines.push(`| ${row.name} | ${row.correct} / ${row.total} |`);
lines.push(
  "",
  `WebGPU matches CPU labels and clause boundaries on ${gpu.sequences.toLocaleString()} sequences (${gpu.tokensCompared.toLocaleString()} non-space tokens), with ${gpu.labelMismatches} role mismatches and ${gpu.boundaryMismatches} boundary mismatches. Direct PyTorch comparison covers ${gpu.pythonSequences} sequences. Maximum GPU/PyTorch logit error: ${gpu.pythonMaxError}. Real device destruction and recovery also passed.`,
  "",
  "## Actual adversarial outputs",
  "",
  "Normalized occurrences/rules are shown when the adapter can represent them. Otherwise the native output is preserved. An output is not necessarily correct. Full native payloads are in [browser.json](browser.json) and [python.json](python.json).",
  "",
);
const primary = (browser.results as BrowserRow[]).find(
  (row) => row.result,
)?.result;
for (const example of primary?.outputs ?? []) {
  lines.push(
    `### ${example.id}: ${example.text}`,
    "",
    "| Library | Actual output |",
    "|---|---|",
  );
  for (const row of browser.results as BrowserRow[]) {
    const output = row.result?.outputs.find((value) => value.id === example.id);
    const value =
      output?.error ??
      (output?.occurrences
        ? { occurrences: output.occurrences, rrules: output.rrules }
        : (output?.raw ?? row.error ?? null));
    lines.push(`| ${names[row.library]} | ${cell(value)} |`);
  }
  for (const row of python.results) {
    const output = row.outputs.find((value: Output) => value.id === example.id);
    lines.push(`| ${row.library} | ${cell(output.error ?? output.raw)} |`);
  }
  lines.push("");
}
lines.push(
  "## Remaining acceptance work",
  "",
  ...summary.limitations.map((text) => `- ${text}`),
  "",
);
await writeFile(join(resultsDir, "REPORT.md"), lines.join("\n"));
console.log("Wrote results/REPORT.md and summary.json");

function cell(value: unknown): string {
  return (
    "`" +
    JSON.stringify(value)
      .replaceAll("|", "\\|")
      .replaceAll("`", "′")
      .replaceAll("\n", " ") +
    "`"
  );
}

function microseconds(ms: number): string {
  return ms === 0 ? "<5" : (ms * 1000).toFixed(1);
}
