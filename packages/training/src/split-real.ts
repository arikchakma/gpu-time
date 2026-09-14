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
// One word can dominate a source: 69% of the harvested negatives say "may", which
// taught the tagger to ignore it even in "every may". Caps rows per trigger word.
// Measured at 2,000: it did not fix "every may" and cost 5 gold cases, so off.
const perWord = Number(argument("--per-word") ?? 100000);
// Repeats small sources up to this floor. Measured at 2,200 and 4,000: both cost
// more on the gold sets than they returned, so it is off by default.
const floor = Number(argument("--floor") ?? 0);

const SOURCES = [
  "agreed",
  "rescued",
  "corrected",
  "recurrence",
  "possessive",
  "duration",
  "negatives",
  "teacher",
  "taught",
];
const authored = join(training, "data/teacher");
// Written or teacher-labelled rather than harvested, so they live in a tracked
// directory: data/real is ignored and a clean clone must still rebuild this mix.
const authoredSources = new Set(["teacher", "taught"]);
// 824 authored rows against 76,000 harvested ones teach nothing at 1:1. Measured
// at 4 copies, which fixed "every may" and held every gate. 1 and 2 are untried.
const authoredCopies = Number(argument("--authored-copies") ?? 4);
// Mention replacement is built by augment-mentions.ts but left out by default:
// measured at 2,509 rows it fixed "last night" and cost 4 pooled gold cases.
// Dai and Adel report the same shape, gains shrinking as the corpus grows.
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
  const path = join(authoredSources.has(source) ? authored : directory, `${source}.jsonl`);
  try {
    await access(path);
  } catch {
    continue;
  }
  const raw = await readFile(path, "utf8");
  const parsed = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ ...JSON.parse(line), source }) as Row);
  for (let round = 0; round < (authoredSources.has(source) ? authoredCopies : 1); round++)
    rows.push(...parsed);
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
// A sentence a teacher relabelled must not also arrive with its old labels.
const taught = new Set(
  rows.filter((row) => row.source === "taught").map((row) => normal(row.text)),
);
let dropped = 0;
let relabelled = 0;
let capped = 0;
let mislabelled = 0;
let contradictory = 0;
for (const row of rows) {
  if (gold.has(normal(row.text))) {
    dropped++;
    continue;
  }
  if (row.source !== "taught" && taught.has(normal(row.text))) {
    relabelled++;
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
  if (row.source === "negatives") {
    const word = /\b(may|march|august|day|year|minute|hour|week|month)\b/i.exec(
      row.text,
    )?.[1]?.toLowerCase();
    if (word) {
      const count = (seen.get(`w:${word}`) ?? 0) + 1;
      seen.set(`w:${word}`, count);
      if (count > perWord) {
        capped++;
        continue;
      }
    }
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

// Repeat the sources that are too small to compete with the generated corpus.
const bySource = new Map<string, Row[]>();
for (const row of train) {
  const key = row.source ?? "";
  (bySource.get(key) ?? bySource.set(key, []).get(key)!).push(row);
}
const repeated: Row[] = [];
for (const [key, part] of bySource) {
  if (key === "agreed" || part.length === 0 || part.length >= floor) continue;
  const copies = Math.min(5, Math.ceil(floor / part.length)) - 1;
  for (let round = 0; round < copies; round++) repeated.push(...part);
}
train.push(...repeated);

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
      droppedAsRelabelled: relabelled,
      droppedAsMislabelled: mislabelled,
      droppedAsContradictory: contradictory,
      cappedByPhrase: capped,
      repeated: repeated.length,
      recased: recased.length,
      train: train.length + recased.length,
      holdout: holdout.length,
      holdoutFrozen: frozen.size > 0,
    },
    null,
    2,
  ),
);
