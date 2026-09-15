// Mention replacement: put a rare time expression into real sentence frames it
// never appeared in, keeping the donor's verified labels and schedule.
//
// Repeating rare rows does not work, because repeated samples carry diminishing
// information (Cui et al., CVPR 2019, arXiv:1901.05555) — measured here twice, at
// two floors, both worse. Swapping the mention while keeping a real carrier is
// the augmentation that won for recurrent taggers in low-resource NER
// (Dai and Adel, COLING 2020, arXiv:2010.11683).
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

const directory = resolvePath(argument("--dir") ?? join(training, "data/real"));
const perMention = Number(argument("--per-mention") ?? 40);
const seed = Number(argument("--seed") ?? 20260913);

type Span = { start: number; end: number; label: string; clauseStart: boolean };
type Row = {
  id: string;
  text: string;
  spans: Span[];
  schedule?: unknown;
  source?: string;
};

// A mention rarer than this cannot be learned from its own sentences alone.
const RARE = Number(argument("--rare") ?? 400);

let state = seed;
const random = () => {
  state = (state * 1103515245 + 12345) & 0x7fffffff;
  return state / 0x7fffffff;
};

const rows: Row[] = (
  await readFile(join(directory, "real-train.jsonl"), "utf8")
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

/** The labelled tokens, when they form one unbroken run. */
const run = (row: Row) => {
  const marked = row.spans
    .map((span, index) => ({ span, index }))
    .filter((one) => one.span.label !== "O");
  if (marked.length === 0) return null;
  const first = marked[0]!.index;
  const last = marked[marked.length - 1]!.index;
  if (last - first + 1 !== marked.length) return null;
  return { first, last, spans: marked.map((one) => one.span) };
};

type Mention = {
  text: string;
  labels: string[];
  schedule: unknown;
  key: string;
  shape: string;
};
const mentions = new Map<string, Mention>();
const counts = new Map<string, number>();
// Frames are grouped by the role pattern they were written around. Swapping a
// mention for one of another shape produces "since this tonight".
const frames = new Map<string, { row: Row; first: number; last: number }[]>();

for (const row of rows) {
  const found = run(row);
  if (!found || !row.schedule) continue;
  const text = row.text.slice(
    found.spans[0]!.start,
    found.spans[found.spans.length - 1]!.end,
  );
  if (/[,.;:!?]/.test(text)) continue;
  const key = text.toLowerCase();
  // A possessive only fits a frame where a noun follows it, so it is its own
  // shape: "come on Friday's" is not English.
  const shape =
    found.spans.map((span) => span.label).join("+") +
    (/['\u2019]s$/.test(text) ? "+poss" : "");
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (!mentions.has(key))
    mentions.set(key, {
      text,
      labels: found.spans.map((span) => span.label),
      schedule: row.schedule,
      key,
      shape,
    });
  const group = frames.get(shape) ?? frames.set(shape, []).get(shape)!;
  group.push({ row, first: found.first, last: found.last });
}

const rare = [...mentions.values()].filter(
  (one) => (counts.get(one.key) ?? 0) < RARE,
);

const built: Row[] = [];
for (const mention of rare) {
  const pool = frames.get(mention.shape) ?? [];
  if (pool.length < 4) continue;
  for (let made = 0; made < perMention; made++) {
    const frame = pool[Math.floor(random() * pool.length)]!;
    const { row, first, last } = frame;
    // Never rebuild a frame using its own mention.
    const original = row.text
      .slice(row.spans[first]!.start, row.spans[last]!.end)
      .toLowerCase();
    if (original === mention.key) continue;

    const before = row.text.slice(0, row.spans[first]!.start);
    const after = row.text.slice(row.spans[last]!.end);
    // Match the frame's opening case so a sentence never starts lower case.
    const head = before.trim().length === 0;
    const inserted =
      head && /^[a-z]/.test(mention.text)
        ? mention.text[0]!.toUpperCase() + mention.text.slice(1)
        : mention.text;
    const text = before + inserted + after;

    const spans: Span[] = [];
    for (let index = 0; index < first; index++) spans.push(row.spans[index]!);
    // One span per word of the mention, offsets measured in the new sentence.
    let cursor = before.length;
    const words = inserted.split(/(\s+)/).filter((part) => part.length > 0);
    let labelAt = 0;
    for (const part of words) {
      const start = cursor;
      cursor += part.length;
      if (/^\s+$/.test(part)) continue;
      spans.push({
        start,
        end: cursor,
        label: mention.labels[Math.min(labelAt++, mention.labels.length - 1)]!,
        clauseStart: false,
      });
    }
    const shift =
      inserted.length - (row.spans[last]!.end - row.spans[first]!.start);
    for (let index = last + 1; index < row.spans.length; index++) {
      const span = row.spans[index]!;
      spans.push({ ...span, start: span.start + shift, end: span.end + shift });
    }

    built.push({
      id: `mr-${built.length}`,
      text,
      spans,
      schedule: mention.schedule,
      source: "mention",
    });
  }
}

await writeFile(
  join(directory, "mention.jsonl"),
  built.map((row) => JSON.stringify(row)).join("\n") + "\n",
);
console.log(
  JSON.stringify(
    {
      frameShapes: frames.size,
      mentions: mentions.size,
      rare: rare.length,
      built: built.length,
    },
    null,
    2,
  ),
);
