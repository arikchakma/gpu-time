process.env.TZ = "UTC";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as chrono from "chrono-node";
import { compile } from "../../core/src/compile.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
import spanish from "../../core/src/languages/es.ts";

const training = join(import.meta.dirname, "..");
const output = join(training, "data/real/es");
const referenceIso = "2026-09-12T12:00:00Z";
const reference = new Date(referenceIso);

const dist = (path: string) =>
  import(new URL(`../../core/dist/${path}`, import.meta.url).href);
const { defineParser: defineTagger } = await dist("schedule.js");
const { defineParser: defineResolver } = await dist("index.js");
const { default: es } = await dist("languages/es.js");
const tagger = await defineTagger({ backend: "cpu", tokens: true });
const resolver = await defineResolver({ backend: "cpu", languages: [es] });

const BEFORE = new Set([
  "todos",
  "todas",
  "cada",
  "los",
  "las",
  "la",
  "este",
  "esta",
  "próximo",
  "próxima",
  "pasado",
  "pasada",
  "hasta",
  "desde",
  "antes",
  "después",
  "partir",
  "dentro",
  "hace",
  "entre",
  "salvo",
  "excepto",
  "menos",
  "sobre",
  "hacia",
  "eso",
  "de",
  "del",
  "para",
  "por",
  "en",
  "al",
]);
const AFTER = new Set([
  "que",
  "pasado",
  "pasada",
  "próximo",
  "próxima",
  "siguiente",
  "entrante",
  "de",
  "del",
  "y",
  "a",
  "al",
  "hasta",
  "antes",
  "después",
  "por",
  "en",
  "o",
  "mismo",
  "misma",
]);
const word = (text: string) => text.toLowerCase().replace(/[^\p{L}]/gu, "");
const neighbour = (text: string, side: "before" | "after") => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return word((side === "before" ? words.at(-1) : words[0]) ?? "");
};

const FIELDS = ["year", "month", "day", "hour", "minute", "weekday"] as const;
const CAP = 300;
const agrees = async (phrase: string, known: Record<string, number>) => {
  if (!FIELDS.some((field) => field in known)) return false;
  const result = await resolver.parse(phrase, {
    reference: referenceIso,
    timeZone: "UTC",
    language: "es",
  });
  const first = result.occurrences?.[0];
  if (!first) return false;
  const date = new Date(first.start);
  const mine: Record<string, number> = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    weekday: date.getUTCDay(),
  };
  return FIELDS.every(
    (field) => !(field in known) || known[field] === mine[field],
  );
};

const gold = new Set(
  (await readFile(join(training, "data/gold/spanish-coverage.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).text.trim().toLowerCase()),
);
const sentences = (
  await readFile(join(training, "data/prose/timed.es.txt"), "utf8")
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

type Token = {
  start: number;
  end: number;
  text: string;
  label: string;
  clauseStart: boolean;
};
const tally: Record<string, number> = {};
const count = (reason: string) => (tally[reason] = (tally[reason] ?? 0) + 1);
const kept = new Map<string, { text: string; row: string }[]>();

for (const [index, text] of sentences.entries()) {
  if (gold.has(text.toLowerCase())) {
    count("gold");
    continue;
  }
  const found = chrono.es.parse(text, reference, { forwardDate: false });
  if (found.length !== 1) {
    count(found.length ? "several" : "chronoSilent");
    continue;
  }
  const start = found[0]!.index;
  const end = start + found[0]!.text.length;
  const phrase = text.slice(start, end);
  if (
    BEFORE.has(neighbour(text.slice(0, start), "before")) ||
    AFTER.has(neighbour(text.slice(end), "after"))
  ) {
    count("neighbour");
    continue;
  }

  const alone = await tagger.parse(phrase, es);
  const schedule = alone.expressions.find(
    (expression: { schedule: unknown }) => expression.schedule,
  )?.schedule;
  if (!schedule || alone.expressions.length !== 1) {
    count("phraseUnread");
    continue;
  }
  if (
    !(await agrees(
      phrase,
      found[0]!.start.knownValues as Record<string, number>,
    ))
  ) {
    count("chronoDisagrees");
    continue;
  }

  const phraseTokens: Token[] = alone.tokens.filter(
    (token: Token) => word(token.text) || /\S/.test(token.text),
  );
  const whole = tokenize(text).filter((token) => token.kind !== 3);
  const inside = whole.filter(
    (token) => token.start >= start && token.end <= end,
  );
  const straddles = whole.some(
    (token) =>
      token.start < end &&
      token.end > start &&
      !(token.start >= start && token.end <= end),
  );
  if (
    straddles ||
    inside.length !== phraseTokens.length ||
    inside.some(
      (token, position) => token.text !== phraseTokens[position]!.text,
    )
  ) {
    count("tokenMismatch");
    continue;
  }

  const roles = new Map(
    inside.map((token, position) => [token.start, phraseTokens[position]!]),
  );
  const spans = whole.map((token) => ({
    start: token.start,
    end: token.end,
    label: roles.get(token.start)?.label ?? "O",
    clauseStart: roles.get(token.start)?.clauseStart ?? false,
  }));
  const labelled = tokenize(text).map((token) => {
    const span = spans.find((part) => part.start === token.start);
    return {
      ...token,
      label: span?.label ?? "O",
      clauseStart: span?.clauseStart ?? false,
    };
  });
  const compiled = compile(text, labelled as never, { language: spanish }).find(
    (expression) => expression.schedule,
  )?.schedule;
  if (!isDeepStrictEqual(compiled, schedule)) {
    count("sentenceDisagrees");
    continue;
  }

  count("kept");
  const signature = spans
    .filter((span) => span.label !== "O")
    .map(
      (span) =>
        `${text.slice(span.start, span.end).toLowerCase()}/${span.label}`,
    )
    .join(" ");
  const group = kept.get(signature) ?? [];
  group.push({
    text,
    row: JSON.stringify({
      id: `real-es-${index}`,
      template: "real/tatoeba-es",
      source: "tatoeba-es",
      text,
      spans,
      schedule,
    }),
  });
  kept.set(signature, group);
}

const digest = (text: string) => createHash("sha256").update(text).digest();
const train: string[] = [];
const holdout: string[] = [];
for (const group of kept.values()) {
  group.sort((a, b) => Buffer.compare(digest(a.text), digest(b.text)));
  for (const { text, row } of group.slice(0, CAP))
    (digest(text)[0]! % 20 === 0 ? holdout : train).push(row);
  if (group.length > CAP)
    tally.capped = (tally.capped ?? 0) + group.length - CAP;
}
await tagger.dispose();
await resolver.dispose();

await mkdir(output, { recursive: true });
await writeFile(join(output, "real-train.jsonl"), train.join("\n") + "\n");
await writeFile(join(output, "real-holdout.jsonl"), holdout.join("\n") + "\n");
console.log(
  JSON.stringify(
    {
      sentences: sentences.length,
      train: train.length,
      holdout: holdout.length,
      tally,
    },
    null,
    2,
  ),
);
