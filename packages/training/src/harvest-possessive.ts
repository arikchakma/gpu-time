// Labels possessive time words such as "today's meeting". The tokenizer keeps
// "today's" as one word, so the role is read from the bare word parsed alone and
// checked by compiling before it is transplanted.
process.env.TZ = "UTC";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { compile } from "../../core/src/compile.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
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

const POSSESSIVE =
  /\b(today|tomorrow|yesterday|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)['’]s\b/i;

const sentences = (await readFile(source, "utf8")).split("\n").filter(Boolean);
const rows: unknown[] = [];
const tally = { candidates: 0, noRole: 0, unverified: 0, kept: 0 };

for (const [index, text] of sentences.entries()) {
  const found = POSSESSIVE.exec(text);
  if (!found) continue;
  tally.candidates++;

  const bare = found[1]!;
  const alone = await parser.parse(bare);
  const role = (alone.tokens as Token[]).find((token) => token.kind !== 3)?.label;
  if (!role || role === "O") {
    tally.noRole++;
    continue;
  }

  const whole = await parser.parse(text);
  const target = (whole.tokens as Token[]).find(
    (token) => token.start === found.index,
  );
  if (!target) {
    tally.unverified++;
    continue;
  }
  const spans = (whole.tokens as Token[]).map((token) => ({
    start: token.start,
    end: token.end,
    label: token.start === target.start ? role : "O",
    clauseStart: false,
  }));

  const raw = tokenize(text);
  const forced = raw.map((token) => {
    const span = spans.find((one) => one.start === token.start);
    return {
      ...token,
      label: (span?.label ?? "O") as Token["label"],
      clauseStart: false,
      score: 1,
    };
  });
  let schedule = null;
  try {
    const built = compile(text, forced);
    schedule = built.length === 1 ? built[0]!.schedule : null;
  } catch {
    schedule = null;
  }
  if (!schedule) {
    tally.unverified++;
    continue;
  }

  tally.kept++;
  rows.push({
    id: `poss-${index}`,
    template: "real/tatoeba-possessive",
    text,
    spans,
    schedule,
  });
}

await writeFile(
  join(outDirectory, "possessive.jsonl"),
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
console.log(JSON.stringify(tally, null, 2));
