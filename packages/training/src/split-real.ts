// Assembles every labelled source into one training mix and one holdout.
//
// Gold texts are dropped: the chat gold set came from the same public corpus, so
// keeping them would train the model on its own benchmark. An existing holdout is
// reused unchanged so scores stay comparable across runs.
import { readFile, writeFile, readdir, access } from "node:fs/promises";
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
// Caps how often one repaired phrase may appear in the training mix. The holdout
// is never capped, so scores stay comparable across runs.
const cap = Number(argument("--cap") ?? 800);
// Real text is nearly all lower case, so a share of rows is recased.
const recase = Number(argument("--recase") ?? 25);

const SOURCES = [
  "agreed",
  "rescued",
  "corrected",
  "recurrence",
  "possessive",
  "duration",
  "negatives",
];
const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

// Rejects rows that label an unambiguous time word as filler. The second parser
// cannot see recurrence, so "every day" outside its span arrives labelled O.
const STRONG =
  /^(every|each|daily|weekly|monthly|yearly|hourly|nightly|annually|tonight|tonite|tomorrow|yesterday|today|noon|midnight|midday|o'clock|oclock)$/i;

type Span = { start: number; end: number; label: string };
type Row = { text: string; source?: string; spans: Span[] };

const phrase = (row: Row) =>
  row.spans
    .filter((one) => one.label !== "O")
    .map((one) => row.text.slice(one.start, one.end))
    .join(" ")
    .toLowerCase();

const callsTimeFiller = (row: Row) =>
  row.spans.some(
    (one) =>
      one.label === "O" && STRONG.test(row.text.slice(one.start, one.end)),
  );

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

const rows: Row[] = [];
for (const source of SOURCES) {
  const path = join(directory, `${source}.jsonl`);
  try {
    await access(path);
  } catch {
    continue;
  }
  const raw = await readFile(path, "utf8");
  for (const line of raw.split("\n").filter(Boolean))
    rows.push({ ...JSON.parse(line), source } as Row);
}

// A sentence the duration rule claims must not also appear labelled as a time.
const durations = new Set(
  rows.filter((row) => row.source === "duration").map((row) => row.text),
);

let frozen = new Set<string>();
try {
  const raw = await readFile(join(directory, "real-holdout.jsonl"), "utf8");
  frozen = new Set(
    raw.split("\n").filter(Boolean).map((line) => JSON.parse(line).text),
  );
} catch {
  frozen = new Set();
}

// Hashes the sentence so a re-harvest keeps rows on the same side.
const bucket = (text: string) =>
  parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16) %
  holdoutShare;

const train: Row[] = [];
const holdout: Row[] = [];
const seen = new Map<string, number>();
let dropped = 0;
let capped = 0;
let mislabelled = 0;
let contradictory = 0;
for (const row of rows) {
  if (gold.has(normal(row.text))) {
    dropped++;
    continue;
  }
  if (frozen.size ? frozen.has(row.text) : bucket(row.text) === 0) {
    holdout.push(row);
    continue;
  }
  if (callsTimeFiller(row)) {
    mislabelled++;
    continue;
  }
  if (row.source !== "duration" && durations.has(row.text)) {
    contradictory++;
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

// Case carries no meaning here, so recased copies teach the same labels on text
// shapes the corpus almost never shows.
const recased: Row[] = [];
train.forEach((row, index) => {
  if (index % recase !== 0) return;
  const text = index % (recase * 2) === 0 ? row.text.toUpperCase() : row.text.toLowerCase();
  if (text === row.text) return;
  recased.push({ ...row, text, source: `${row.source}-case` });
});

const write = (name: string, part: Row[]) =>
  writeFile(
    join(directory, `${name}.jsonl`),
    part.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
await write("real-train", [...train, ...recased]);
if (!frozen.size) await write("real-holdout", holdout);
console.log(
  JSON.stringify(
    {
      read: rows.length,
      droppedAsGold: dropped,
      droppedAsMislabelled: mislabelled,
      droppedAsContradictory: contradictory,
      cappedByPhrase: capped,
      recased: recased.length,
      train: train.length + recased.length,
      holdout: holdout.length,
      holdoutFrozen: frozen.size > 0,
    },
    null,
    2,
  ),
);
