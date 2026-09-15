// Separates the two readings of "in N <unit>": a future moment ("the meeting
// starts in five minutes") from how long something took ("he ran a mile in four
// minutes"). Only the first is schedulable.
//
// Neither parser can tell them apart, so the rule below comes from three
// independent language judgements and is scored against their labels before use.
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
const verdicts = argument("--verdicts");
const outDirectory = resolvePath(
  argument("--out") ?? join(training, "data/real"),
);

const PHRASE =
  /\bin\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\b/i;

// An ability modal with a punctual verb is a request, not a measured span.
const REQUEST =
  /\b(?:can|could)\s+(?:you|we|i)\b[^.?!]*\b(?:meet|call|come|be|see|join|bring|pick)\b/i;
// "have to" is an obligation, not perfect aspect, so the participle is required.
const PERFECT =
  /\b(?:has|have|had|hasn't|haven't|hadn't)\s+(?:not\s+|never\s+|ever\s+|already\s+|just\s+)?(?:been|gone|seen|done|made|read|written|eaten|taken|given|found|heard|left|lost|come|become|run|built|grown|risen|fallen|doubled|tripled|[a-z]+ed)\b/i;
const ABILITY =
  /\b(?:can|can't|cannot|could|couldn't|able to|unable to|impossible|out of the question)\b|\btoo\s+\w+\s+to\b/i;
const QUANTITY =
  /\bhow\s+(?:many|much|long|to)\b|\bthere\s+(?:are|is|were|was)\b/i;
const FIRST_TIME =
  /\bfor the first time\b|\bthe (?:worst|best|biggest|largest|coldest|hottest)\b/i;
const FUTURE =
  /\b(?:will|'ll|won't|shall|going to|gonna|let's|have to|has to|planning to)\b|\b(?:am|is|are)\s+\w+ing\b/i;
const SCHEDULED =
  /\b(?:starts?|leaves?|arrives?|departs?|begins?|expires?|takes off|opens?|closes?|goes)\b/i;
// Irregular pasts a "-ed" test cannot see.
const IRREGULAR =
  /\b(?:ate|made|drove|read|saw|took|gave|went|came|got|found|wrote|ran|built|won|lost|left|spent|sold|bought|taught|caught|brought|thought|told|held|grew|drew|flew|knew|threw|beat|broke|chose|rose|fell|felt|kept|slept|met|sat|stood|understood|became|began|drank|sang|swam)\b/i;
const PAST = /\b(?:was|were|did|didn't)\b|\b\w+ed\b/i;

/** Returns the reading of the "in N <unit>" phrase in one sentence. */
export function reading(text: string): "shift" | "duration" {
  if (REQUEST.test(text)) return "shift";
  if (
    PERFECT.test(text) ||
    ABILITY.test(text) ||
    QUANTITY.test(text) ||
    FIRST_TIME.test(text)
  )
    return "duration";
  if (FUTURE.test(text) || SCHEDULED.test(text)) return "shift";
  if (IRREGULAR.test(text) || PAST.test(text)) return "duration";
  return "shift";
}

if (verdicts) {
  const judged = (await readFile(resolvePath(verdicts), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { text: string; reading: string });
  let agree = 0;
  const wrong: string[] = [];
  for (const one of judged) {
    if (one.reading === "neither") continue;
    if (reading(one.text) === one.reading) agree++;
    else wrong.push(`${one.reading} -> ${reading(one.text)}: ${one.text}`);
  }
  console.log(
    JSON.stringify({
      judged: judged.length,
      agree,
      accuracy: agree / judged.length,
    }),
  );
  for (const line of wrong.slice(0, 12)) console.log("  x", line);
}

const { defineParser } = await import(
  new URL("../../core/dist/schedule.js", import.meta.url).href
);
const parser = await defineParser({ backend: "cpu", tokens: true });

type Token = { start: number; end: number; kind: number };
const sentences = (await readFile(source, "utf8")).split("\n").filter(Boolean);
const rows: unknown[] = [];
let shift = 0;

for (const [index, text] of sentences.entries()) {
  if (!PHRASE.test(text)) continue;
  if (reading(text) === "shift") {
    shift++;
    continue;
  }
  // A measured span is not a schedulable event, so nothing here carries a role.
  const whole = await parser.parse(text);
  rows.push({
    id: `duration-${index}`,
    template: "real/tatoeba-duration",
    text,
    spans: (whole.tokens as Token[]).map((token) => ({
      start: token.start,
      end: token.end,
      label: "O",
      clauseStart: false,
    })),
  });
}

await writeFile(
  join(outDirectory, "duration.jsonl"),
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
console.log(JSON.stringify({ duration: rows.length, shift }, null, 2));
