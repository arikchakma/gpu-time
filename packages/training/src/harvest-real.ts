// Labels real sentences that two independent parsers agree on.
process.env.TZ = "UTC";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import * as chrono from "chrono-node";

const training = join(import.meta.dirname, "..");
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}.`);
  return value;
};

const source = resolvePath(
  argument("--in") ?? join(training, "data/prose/timed.txt"),
);
const outDirectory = resolvePath(
  argument("--out") ?? join(training, "data/real"),
);
const limit = Number(argument("--limit") ?? 100000);
// The corpus has no timestamps, so one reference clock is used throughout.
const referenceIso = argument("--reference") ?? "2026-09-12T12:00:00Z";
const reference = new Date(referenceIso);

// schedule.js tags without a timezone; index.js resolves to an instant.
const { defineParser } = await import(
  new URL("../../core/dist/schedule.js", import.meta.url).href
);
const { defineParser: defineResolver } = await import(
  new URL("../../core/dist/index.js", import.meta.url).href
);
const parser = await defineParser({ backend: "cpu", tokens: true });
const resolver = await defineResolver({ backend: "cpu" });

// Normalizes away preposition and ordinal-suffix conventions, which differ
// between the parsers without disagreeing on meaning.
const LEADING = /^(?:on|at|in|by|from|until|till|before|after|during)\s+/i;
const shape = (span: string) =>
  span.replace(LEADING, "").replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1").toLowerCase();

const trim = (text: string, start: number, end: number) => {
  while (start < end && /[\s,.;:!?"')(]/.test(text[start]!)) start++;
  while (end > start && /[\s,.;:!?"')(]/.test(text[end - 1]!)) end--;
  return [start, end] as const;
};

const resolveOurs = async (text: string) => {
  try {
    const result = await resolver.parse(text, {
      reference: referenceIso,
      timeZone: "UTC",
    });
    const first = result.occurrences?.[0];
    return first ? new Date(first.start) : null;
  } catch {
    return null;
  }
};

// Compares only the fields the sentence states; the rest are implied defaults.
const FIELDS = ["year", "month", "day", "hour", "minute"] as const;
const read = (date: Date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
  hour: date.getUTCHours(),
  minute: date.getUTCMinutes(),
});
const conflict = (known: Record<string, number>, date: Date) => {
  const mine = read(date);
  return FIELDS.filter(
    (field) => field in known && known[field] !== mine[field],
  );
};

const sentences = (await readFile(source, "utf8"))
  .split("\n")
  .filter(Boolean)
  .slice(0, limit);

const agreed: unknown[] = [];
const disputed: unknown[] = [];
const negatives: unknown[] = [];
const tally = {
  read: 0,
  chronoSilent: 0,
  oursSilent: 0,
  multiple: 0,
  spanMismatch: 0,
  valueMismatch: 0,
  agreed: 0,
  negatives: 0,
};

for (const [index, text] of sentences.entries()) {
  tally.read++;
  const theirs = chrono.parse(text, reference, { forwardDate: false });
  const ours = await parser.parse(text);
  const expressions = ours.expressions.filter(
    (one: { schedule: unknown }) => one.schedule,
  );

  if (theirs.length === 0) {
    tally.chronoSilent++;
    // Neither parser sees a time, so these time-shaped words are not times.
    if (expressions.length === 0) {
      tally.negatives++;
      negatives.push({
        id: `negative-${index}`,
        template: "real/tatoeba-negative",
        text,
        spans: ours.tokens.map((token: { start: number; end: number }) => ({
          start: token.start,
          end: token.end,
          label: "O",
          clauseStart: false,
        })),
      });
    }
    continue;
  }
  if (expressions.length === 0) {
    tally.oursSilent++;
    disputed.push({ text, reason: "ours-silent", chrono: theirs[0]!.text });
    continue;
  }
  if (theirs.length > 1 || expressions.length > 1) {
    tally.multiple++;
    continue;
  }

  const mine = expressions[0]!;
  const [theirStart, theirEnd] = trim(
    text,
    theirs[0]!.index,
    theirs[0]!.index + theirs[0]!.text.length,
  );
  const [myStart, myEnd] = trim(text, mine.start, mine.end);
  const theirSpan = text.slice(theirStart, theirEnd);
  const mySpan = text.slice(myStart, myEnd);
  if (shape(theirSpan) !== shape(mySpan)) {
    tally.spanMismatch++;
    disputed.push({
      text,
      reason: "span",
      chrono: theirSpan,
      ours: mySpan,
    });
    continue;
  }

  const known = theirs[0]!.start.knownValues as Record<string, number>;
  const mineResolved = await resolveOurs(text);
  const differing = mineResolved ? conflict(known, mineResolved) : FIELDS;
  if (differing.length > 0) {
    tally.valueMismatch++;
    disputed.push({
      text,
      reason: "value",
      fields: differing,
      chrono: known,
      ours: mineResolved ? read(mineResolved) : null,
    });
    continue;
  }

  tally.agreed++;
  agreed.push({
    id: `real-${index}`,
    template: "real/tatoeba-agreed",
    text,
    spans: ours.tokens.map(
      (token: { start: number; end: number; label: string }) => ({
        start: token.start,
        end: token.end,
        label: token.label,
        clauseStart: false,
      }),
    ),
    schedule: mine.schedule,
  });
}

await mkdir(outDirectory, { recursive: true });
const line = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
await writeFile(join(outDirectory, "agreed.jsonl"), line(agreed));
await writeFile(join(outDirectory, "disputed.jsonl"), line(disputed));
await writeFile(join(outDirectory, "negatives.jsonl"), line(negatives));
console.log(JSON.stringify(tally, null, 2));
