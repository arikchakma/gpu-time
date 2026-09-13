// Labels recurrence sentences, which agreement cannot reach because the second
// parser has no recurrence support. Our tagger reads these phrases correctly in
// isolation, so each is tagged alone and checked by compiling.
process.env.TZ = "UTC";
import { readFile, writeFile } from "node:fs/promises";
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

const source = resolvePath(
  argument("--in") ?? join(training, "data/prose/timed.txt"),
);
const outDirectory = resolvePath(
  argument("--out") ?? join(training, "data/real"),
);

const { defineParser } = await import(
  new URL("../../core/dist/schedule.js", import.meta.url).href
);
const parser = await defineParser({ backend: "cpu", tokens: true });

const RECURRENCE =
  /\b(?:every|each)\s+(?:day|morning|afternoon|evening|night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:daily|weekly|monthly|yearly|hourly|nightly|annually)\b/i;

type Token = { start: number; end: number; kind: number; label: string };

const sentences = (await readFile(source, "utf8")).split("\n").filter(Boolean);
const rows: unknown[] = [];
const tally = {
  candidates: 0,
  noSchedule: 0,
  notRecurrence: 0,
  tokenMismatch: 0,
  kept: 0,
};

for (const [index, text] of sentences.entries()) {
  const found = RECURRENCE.exec(text);
  if (!found) continue;
  tally.candidates++;
  const start = found.index;
  const end = start + found[0].length;
  const phrase = text.slice(start, end);

  const alone = await parser.parse(phrase);
  const schedule = alone.expressions[0]?.schedule;
  if (!schedule || alone.expressions.length !== 1) {
    tally.noSchedule++;
    continue;
  }
  // Requires a repeating event, not a single date.
  if (!schedule.clauses?.[0]?.recurrence) {
    tally.notRecurrence++;
    continue;
  }

  const whole = await parser.parse(text);
  const inside = (whole.tokens as Token[]).filter(
    (token) => token.kind !== 3 && token.start >= start && token.end <= end,
  );
  const words = (alone.tokens as Token[]).filter((token) => token.kind !== 3);
  if (inside.length !== words.length) {
    tally.tokenMismatch++;
    continue;
  }

  const labels = new Map<number, string>();
  inside.forEach((token, position) => labels.set(token.start, words[position]!.label));

  tally.kept++;
  rows.push({
    id: `recur-${index}`,
    template: "real/tatoeba-recurrence",
    text,
    spans: (whole.tokens as Token[]).map((token) => ({
      start: token.start,
      end: token.end,
      label: labels.get(token.start) ?? "O",
      clauseStart: false,
    })),
    schedule,
  });
}

await writeFile(
  join(outDirectory, "recurrence.jsonl"),
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
console.log(JSON.stringify(tally, null, 2));
