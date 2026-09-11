import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalize } from "./recognizers-values.ts";

const root = join(import.meta.dirname, "..", "data", "recognizers");
const repository = "microsoft/Recognizers-Text";
const files = [
  "DateParser",
  "TimeParser",
  "TimePeriodParser",
  "DateTimeParser",
  "DatePeriodParser",
  "DateTimePeriodParser",
  "SetParser",
];
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

interface SourceResult {
  Text: string;
  Start: number;
  Length: number;
  Type: string;
  Value?: {
    Timex?: string;
    FutureResolution?: Record<string, string>;
    PastResolution?: Record<string, string>;
  };
}
interface SourceCase {
  Input: string;
  Context?: { ReferenceDateTime?: string };
  Results: SourceResult[];
}

async function download(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} downloading ${url}`);
  return response.text();
}

await mkdir(join(root, "raw"), { recursive: true });
const previous =
  existsSync(join(root, "manifest.json")) && !process.argv.includes("--refresh")
    ? JSON.parse(await readFile(join(root, "manifest.json"), "utf8"))
    : undefined;
const commit =
  previous?.commit ??
  JSON.parse(
    await download(`https://api.github.com/repos/${repository}/commits/master`),
  ).sha;
const base = `https://raw.githubusercontent.com/${repository}/${commit}`;
const license = await download(`${base}/LICENSE`);
await writeFile(join(root, "LICENSE"), license);
const records = [];
const skipped = [];
const sources = [];
for (const file of files) {
  const url = `${base}/Specs/DateTime/English/${file}.json`;
  const source = await download(url);
  await writeFile(join(root, "raw", `${file}.json`), source);
  const examples: SourceCase[] = JSON.parse(source);
  sources.push({ file, url, sha256: hash(source), cases: examples.length });
  for (const [index, example] of examples.entries()) {
    const id = `${file}-${index + 1}`;
    if (!example.Results.length) {
      skipped.push({
        id,
        reason:
          "Component-specific non-match: absence of a date/period result does not establish absence of any temporal expression",
        text: example.Input,
      });
      continue;
    }
    const expected = example.Results.map((result) =>
      normalize(result.Value?.FutureResolution),
    );
    const past = example.Results.map((result) =>
      normalize(result.Value?.PastResolution),
    );
    const timeOnly = expected.every((value) => value?.precision === "time");
    const reference =
      example.Context?.ReferenceDateTime ??
      (timeOnly ? "2016-11-07T00:00:00" : undefined);
    if (!reference || expected.some((value) => value === null)) {
      skipped.push({
        id,
        reason: !reference
          ? "No explicit reference context"
          : "No concrete future date/interval (for example, symbolic SET or duration)",
        text: example.Input,
      });
      continue;
    }
    const shape = example.Input.toLowerCase()
      .replace(/\d+/g, "#")
      .replace(
        /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/g,
        "WEEKDAY",
      )
      .replace(
        /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/g,
        "MONTH",
      )
      .replace(/\s+/g, " ")
      .trim();
    const group = hash(shape);
    const split =
      parseInt(group.slice(0, 8), 16) % 5 === 0 ? "test" : "development";
    records.push({
      id,
      family: file,
      text: example.Input,
      reference: reference.replace(/Z$/, "") + "Z",
      referenceSource: example.Context?.ReferenceDateTime
        ? "upstream"
        : "fixed-time-only-context",
      timeZone: "UTC",
      expected,
      pastExpected: past.every((value) => value !== null) ? past : undefined,
      split,
      group,
      spans: example.Results.map(({ Text, Start, Length, Type }) => ({
        text: Text,
        start: Start,
        end: Start + Length,
        type: Type,
      })),
    });
  }
}
await writeFile(
  join(root, "cases.jsonl"),
  records.map((record) => JSON.stringify(record)).join("\n") + "\n",
);
await writeFile(
  join(root, "skipped.json"),
  JSON.stringify(skipped, null, 2) + "\n",
);
await writeFile(
  join(root, "manifest.json"),
  JSON.stringify(
    {
      repository,
      commit,
      license: "MIT",
      sources,
      total: sources.reduce((sum, source) => sum + source.cases, 0),
      eligible: records.length,
      skipped: skipped.length,
      development: records.filter((record) => record.split === "development")
        .length,
      test: records.filter((record) => record.split === "test").length,
      policy:
        "Use upstream FutureResolution as the expected civil value. UTC supplies a fixed timezone for timezone-free source contexts. Time-only results compare exact clocks and interval duration, without asserting a source date; absent contexts use 2016-11-07T00:00:00 UTC. Datetime comparisons are exact to the second. No policy differences are excluded. Split by hashed surface frame after masking numbers, weekdays and months; identical frames remain together. The test split is reserved from development evaluation.",
    },
    null,
    2,
  ) + "\n",
);
console.log({
  eligible: records.length,
  skipped: skipped.length,
  development: records.filter((record) => record.split === "development")
    .length,
  test: records.filter((record) => record.split === "test").length,
});
