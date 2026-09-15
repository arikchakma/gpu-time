// Repairs spans where our tagger drops a leading modifier such as "last".
process.env.TZ = "UTC";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import * as chrono from "chrono-node";
import { compile } from "../../core/src/compile.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
import { resolve } from "../../core/src/resolve.ts";
import type { Token } from "../../core/src/types.ts";

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
const referenceIso = argument("--reference") ?? "2026-09-12T12:00:00Z";
const reference = new Date(referenceIso);

const { defineParser } = await import(
  new URL("../../core/dist/schedule.js", import.meta.url).href
);
const parser = await defineParser({ backend: "cpu", tokens: true });

const MODIFIERS = new Set([
  "last",
  "next",
  "this",
  "past",
  "previous",
  "coming",
  "upcoming",
]);
const FIELDS = ["year", "month", "day", "hour", "minute"] as const;
const read = (date: Date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
  hour: date.getUTCHours(),
  minute: date.getUTCMinutes(),
});

const rows = (await readFile(join(directory, "disputed.jsonl"), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { text: string; reason: string });

const corrected: unknown[] = [];
const tally = {
  span: 0,
  notLeading: 0,
  tokenMismatch: 0,
  unverified: 0,
  kept: 0,
};

for (const [index, row] of rows.entries()) {
  if (row.reason !== "span") continue;
  tally.span++;

  const found = chrono.parse(row.text, reference, { forwardDate: false });
  if (found.length !== 1) continue;
  const span = found[0]!;
  const start = span.index;
  const end = start + span.text.length;
  const phrase = row.text.slice(start, end);

  const words = tokenize(phrase).filter((token) => token.kind !== 3);
  if (words.length < 2 || !MODIFIERS.has(words[0]!.text.toLowerCase())) {
    tally.notLeading++;
    continue;
  }

  // Tags the phrase, then forces the modifier our tagger missed.
  const alone = await parser.parse(phrase);
  const tagged: Token[] = alone.tokens;
  const taggedWords = tagged.filter((token) => token.kind !== 3);
  if (taggedWords.length !== words.length) {
    tally.tokenMismatch++;
    continue;
  }
  const labels = taggedWords.map((token, position) =>
    position === 0 ? "DEICTIC" : token.label,
  );

  const raw = tokenize(phrase);
  const order = raw.filter((token) => token.kind !== 3);
  const forced = raw.map((token) => {
    const position = order.indexOf(token);
    return {
      ...token,
      label: (position >= 0 ? labels[position] : "O") as Token["label"],
      clauseStart: false,
      score: 1,
    };
  });

  let schedule = null;
  try {
    const built = compile(phrase, forced);
    schedule = built.length === 1 ? built[0]!.schedule : null;
  } catch {
    schedule = null;
  }
  if (!schedule) {
    tally.unverified++;
    continue;
  }

  // Rejects a guess that does not reproduce what the sentence states.
  let matches = false;
  try {
    const occurrence = resolve(schedule, {
      reference: referenceIso,
      timeZone: "UTC",
    }).occurrences?.[0];
    if (occurrence) {
      const mine = read(new Date(occurrence.start));
      const known = span.start.knownValues as Record<string, number>;
      matches = FIELDS.every(
        (field) => !(field in known) || known[field] === mine[field],
      );
    }
  } catch {
    matches = false;
  }
  if (!matches) {
    tally.unverified++;
    continue;
  }

  const whole = await parser.parse(row.text);
  const position = new Map<number, string>();
  const insideWords = (whole.tokens as Token[]).filter(
    (token) => token.kind !== 3 && token.start >= start && token.end <= end,
  );
  if (insideWords.length !== labels.length) {
    tally.tokenMismatch++;
    continue;
  }
  insideWords.forEach((token, at) => position.set(token.start, labels[at]!));

  tally.kept++;
  corrected.push({
    id: `span-${index}`,
    template: "real/tatoeba-corrected",
    text: row.text,
    spans: (whole.tokens as Token[]).map((token) => ({
      start: token.start,
      end: token.end,
      label: position.get(token.start) ?? "O",
      clauseStart: false,
    })),
    schedule,
  });
}

await writeFile(
  join(directory, "corrected.jsonl"),
  corrected.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
console.log(JSON.stringify(tally, null, 2));
