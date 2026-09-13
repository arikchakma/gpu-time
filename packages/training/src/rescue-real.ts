// Recovers sentences the tagger goes silent on, using the second parser for the
// span and our own tagger for the roles.
process.env.TZ = "UTC";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
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

const directory = resolvePath(argument("--dir") ?? join(training, "data/real"));
const referenceIso = argument("--reference") ?? "2026-09-12T12:00:00Z";
const reference = new Date(referenceIso);

const { defineParser } = await import(
  new URL("../../core/dist/schedule.js", import.meta.url).href
);
const { defineParser: defineResolver } = await import(
  new URL("../../core/dist/index.js", import.meta.url).href
);
const parser = await defineParser({ backend: "cpu", tokens: true });
const resolver = await defineResolver({ backend: "cpu" });

const FIELDS = ["year", "month", "day", "hour", "minute"] as const;
const read = (date: Date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
  hour: date.getUTCHours(),
  minute: date.getUTCMinutes(),
});
const agrees = async (phrase: string, known: Record<string, number>) => {
  try {
    const result = await resolver.parse(phrase, {
      reference: referenceIso,
      timeZone: "UTC",
    });
    const first = result.occurrences?.[0];
    if (!first) return false;
    const mine = read(new Date(first.start));
    return FIELDS.every((field) => !(field in known) || known[field] === mine[field]);
  } catch {
    return false;
  }
};

type Token = { start: number; end: number; text: string; label: string };

// A span of "morning" inside "every morning" would label "every" as filler and
// cost us recurrence.
const MODIFIER = /(?:^|\W)(every|each|last|next|this|coming|past)\W*$/i;

const rows = (await readFile(join(directory, "disputed.jsonl"), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { text: string; reason: string });

const rescued: unknown[] = [];
const tally = {
  silent: 0,
  truncated: 0,
  phraseDisagreed: 0,
  tokenMismatch: 0,
  rescued: 0,
};

for (const [index, row] of rows.entries()) {
  if (row.reason !== "ours-silent") continue;
  tally.silent++;

  const found = chrono.parse(row.text, reference, { forwardDate: false });
  if (found.length !== 1) continue;
  const span = found[0]!;
  const start = span.index;
  const end = start + span.text.length;
  const phrase = row.text.slice(start, end);
  if (MODIFIER.test(row.text.slice(0, start))) {
    tally.truncated++;
    continue;
  }

  if (!(await agrees(phrase, span.start.knownValues as Record<string, number>))) {
    tally.phraseDisagreed++;
    continue;
  }

  const alone = await parser.parse(phrase);
  const whole = await parser.parse(row.text);
  const inside: Token[] = whole.tokens.filter(
    (token: Token) => token.start >= start && token.end <= end,
  );
  if (inside.length !== alone.tokens.length) {
    tally.tokenMismatch++;
    continue;
  }

  const labels = new Map<number, string>();
  inside.forEach((token, position) => {
    labels.set(token.start, alone.tokens[position]!.label);
  });

  tally.rescued++;
  rescued.push({
    id: `rescue-${index}`,
    template: "real/tatoeba-rescued",
    text: row.text,
    spans: whole.tokens.map((token: Token) => ({
      start: token.start,
      end: token.end,
      label: labels.get(token.start) ?? "O",
      clauseStart: false,
    })),
    schedule: alone.expressions[0]?.schedule ?? null,
  });
}

await writeFile(
  join(directory, "rescued.jsonl"),
  rescued.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
console.log(JSON.stringify(tally, null, 2));
