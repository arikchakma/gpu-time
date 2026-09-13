// Split the labelled real sentences into a training mix and a holdout, and drop
// anything that is already a gold test sentence. The chat gold set was drawn
// from the same public corpus, so without this the benchmark trains on itself.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve as resolvePath } from "node:path";

const training = join(import.meta.dirname, "..");
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}.`);
  return value;
};

const directory = resolvePath(argument("--dir") ?? join(training, "data/real"));
const goldDirectory = join(training, "data/gold");
const holdoutShare = Number(argument("--holdout") ?? 10);
// One repaired phrase is most of corrected.jsonl. Cap it in the training mix so
// it cannot swamp the rest. The holdout is never capped, so scores stay comparable.
const cap = Number(argument("--cap") ?? 800);

const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const gold = new Set<string>();
for (const name of await readdir(goldDirectory)) {
  if (!name.endsWith(".jsonl") && !name.endsWith(".json")) continue;
  const raw = await readFile(join(goldDirectory, name), "utf8");
  const rows = name.endsWith(".jsonl")
    ? raw.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [JSON.parse(raw)].flat();
  for (const row of rows)
    if (row && typeof row.text === "string") gold.add(normal(row.text));
}

type Span = { start: number; end: number; label: string };
type Row = { text: string; source?: string; spans: Span[] };
const phrase = (row: Row) =>
  row.spans
    .filter((one) => one.label !== "O")
    .map((one) => row.text.slice(one.start, one.end))
    .join(" ")
    .toLowerCase();

const rows: Row[] = [];
for (const source of ["agreed", "rescued", "corrected"]) {
  const raw = await readFile(join(directory, `${source}.jsonl`), "utf8");
  for (const line of raw.split("\n").filter(Boolean))
    rows.push({ ...JSON.parse(line), source } as Row);
}

// Hash the sentence so a re-harvest keeps the same rows on the same side.
const bucket = (text: string) =>
  parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16) %
  holdoutShare;

const train: Row[] = [];
const holdout: Row[] = [];
const seen = new Map<string, number>();
let dropped = 0;
let capped = 0;
for (const row of rows) {
  if (gold.has(normal(row.text))) {
    dropped++;
    continue;
  }
  if (bucket(row.text) === 0) {
    holdout.push(row);
    continue;
  }
  if (row.source === "corrected") {
    const key = phrase(row);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > cap) {
      capped++;
      continue;
    }
  }
  train.push(row);
}

const write = (name: string, part: Row[]) =>
  writeFile(
    join(directory, `${name}.jsonl`),
    part.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
await write("real-train", train);
await write("real-holdout", holdout);
console.log(
  JSON.stringify(
    {
      read: rows.length,
      cappedByPhrase: capped,
      droppedAsGold: dropped,
      train: train.length,
      holdout: holdout.length,
    },
    null,
    2,
  ),
);
