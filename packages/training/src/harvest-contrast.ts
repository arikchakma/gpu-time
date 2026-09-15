// The teacher pool was picked by searching for hours, so it teaches "at six"
// and not "in six hours". This harvests the opposite sense from the same text:
// a number before a time unit is an amount, and 12 before noon carries nothing.
// Labels are mechanical, so no teacher is needed; the compiler still decides.
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { compile } from "../../core/src/compile.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
import type { Label, Schedule, Token } from "../../core/src/types.ts";

const training = join(import.meta.dirname, "..");
const source = join(training, "data/prose/timed.txt");
const out = join(training, "data/teacher/contrast.jsonl");

// 135 of these sentences are already taught, 5 of them with a different
// schedule. split-real.ts matches text this way, so dedupe the same way.
const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const taught = new Set(
  readFileSync(join(training, "data/teacher/taught.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => normal(JSON.parse(line).text)),
);

const words = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const units = ["second", "minute", "hour", "day", "week", "month", "year"];
const amount = `(?:${words.join("|")}|\\d{1,3})`;
const unitWord = `(?:${units.map((one) => `${one}s?`).join("|")})`;
// One clause only: a second time word would need a second label we cannot guess.
const quantity = new RegExp(
  `\\b(in|for|after)\\s+(${amount})\\s+(${unitWord})\\b`,
  "i",
);
const named = new RegExp(`\\b(12)\\s+(noon|midnight)\\b`, "i");

const value = (text: string) =>
  words.indexOf(text.toLowerCase()) + 1 || Number(text);

const rows: unknown[] = [];
const tally = { read: 0, taught: 0, quantity: 0, named: 0, rejected: 0 };

for (const line of readFileSync(source, "utf8").split("\n")) {
  const text = line.trim();
  if (!text) continue;
  tally.read++;
  const clock = /\b(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm)|o'clock)\b/i.test(text);
  const found = !clock && quantity.exec(text);
  const noon = named.exec(text);
  if (!found && !noon) continue;
  if (taught.has(normal(text))) {
    tally.taught++;
    continue;
  }

  const spans: Record<number, Label> = {};
  let schedule: Schedule;
  if (found) {
    const [, direction, count, unit] = found;
    const start = found.index;
    const place = (needle: string, label: Label, from: number) => {
      const at = text.toLowerCase().indexOf(needle.toLowerCase(), from);
      spans[at] = label;
      return at + needle.length;
    };
    let cursor = place(
      direction!,
      direction!.toLowerCase() === "for" ? "DUR" : "DIR_AFTER",
      start,
    );
    cursor = place(count!, "NUM", cursor);
    place(unit!, "UNIT", cursor);
    const single = {
      amount: value(count!),
      unit: unit!.toLowerCase().replace(/s$/, "") as never,
    };
    schedule = {
      clauses: [
        direction!.toLowerCase() === "for"
          ? { duration: single }
          : { shift: { ...single, direction: "after" } },
      ],
    };
    tally.quantity++;
  } else {
    const at = noon!.index;
    spans[at] = "O";
    spans[at + noon![1]!.length + 1] = "TIME_NAMED";
    schedule = {
      clauses: [
        { time: { start: { named: noon![2]!.toLowerCase() as never } } },
      ],
    };
    tally.named++;
  }

  const raw = tokenize(text);
  const tokens = raw.map((token): Token => ({
    ...token,
    label: spans[token.start] ?? "O",
    clauseStart: false,
    score: 1,
  }));
  let compiled;
  try {
    compiled = compile(text, tokens).filter((one) => one.schedule);
  } catch {
    tally.rejected++;
    continue;
  }
  if (
    compiled.length !== 1 ||
    !isDeepStrictEqual(compiled[0]!.schedule, schedule)
  ) {
    tally.rejected++;
    continue;
  }
  rows.push({
    id: `contrast-${rows.length}`,
    template: "teacher/contrast",
    text,
    spans: tokens.map(({ start, end, label }) => ({
      start,
      end,
      label,
      clauseStart: false,
    })),
    schedule,
  });
}

writeFileSync(out, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
console.log(JSON.stringify({ ...tally, kept: rows.length }, null, 2));
