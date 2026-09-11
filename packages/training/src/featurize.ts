import {
  createReadStream,
  closeSync,
  mkdirSync,
  openSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";
import { featureRows, tokenize } from "../../core/src/tokenizer.ts";
import { LABELS, labelId, type Label } from "../../core/src/labels.ts";

interface Span {
  start: number;
  end: number;
  label: Label;
  clauseStart: boolean;
}
interface Example {
  id: string;
  template?: string;
  fingerprint?: string;
  text: string;
  spans: Span[];
}

const input = process.argv[2];
const prefix = process.argv[3];
if (!input || !prefix)
  throw new Error(
    "Usage: node --experimental-strip-types src/featurize.ts input.jsonl output-prefix",
  );
mkdirSync(dirname(prefix), { recursive: true });
const files = Object.fromEntries(
  ["rows", "labels", "boundaries", "kinds", "neighbors"].map((name) => [
    name,
    openSync(`${prefix}.${name}.bin`, "w"),
  ]),
);
const offsets = [0];
const counts = Object.fromEntries(LABELS.map((label) => [label, 0]));
const templates = new Set<string>();
const fingerprints = new Set<string>();
let skipped = 0;
let positiveBoundaries = 0;
let longest = 0;

try {
  const lines = createInterface({
    input: createReadStream(input),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const example: Example = JSON.parse(line);
    const tokens = tokenize(example.text);
    if (tokens.length === 0 || tokens.length > 128) {
      skipped++;
      continue;
    }

    const rows = new Uint16Array(tokens.length * 17).fill(580);
    const labels = new Uint8Array(tokens.length);
    const boundaries = new Uint8Array(tokens.length);
    const kinds = new Uint8Array(tokens.length);
    const neighbors = new Int16Array(tokens.length * 2).fill(-1);
    let spanIndex = 0;
    let previous = -1;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      rows.set(featureRows(token.features), index * 17);
      kinds[index] = token.kind;
      neighbors[index * 2] = previous;
      if (token.kind !== 3) previous = index;
      if (token.kind === 3) continue;

      while (example.spans[spanIndex]?.end <= token.start) spanIndex++;
      const span = example.spans[spanIndex];
      if (!span || token.start < span.start || token.end > span.end) {
        throw new Error(
          `Unaligned supervision in ${example.id}: ${JSON.stringify(token)}`,
        );
      }
      const label = labelId[span.label];
      if (label === undefined)
        throw new Error(`Unknown label ${span.label} in ${example.id}`);
      labels[index] = label;
      boundaries[index] = Number(
        span.clauseStart && token.start === span.start,
      );
      positiveBoundaries += boundaries[index];
      counts[span.label]++;
    }
    let next = -1;
    for (let index = tokens.length - 1; index >= 0; index--) {
      neighbors[index * 2 + 1] = next;
      if (tokens[index].kind !== 3) next = index;
    }

    for (const [name, values] of Object.entries({
      rows,
      labels,
      boundaries,
      kinds,
      neighbors,
    })) {
      writeSync(files[name], new Uint8Array(values.buffer));
    }
    offsets.push(offsets.at(-1)! + tokens.length);
    longest = Math.max(longest, tokens.length);
    if (example.template) templates.add(example.template);
    if (example.fingerprint) fingerprints.add(example.fingerprint);
  }
} finally {
  for (const file of Object.values(files)) closeSync(file);
}

writeFileSync(
  `${prefix}.offsets.bin`,
  new Uint8Array(Uint32Array.from(offsets).buffer),
);
const manifest = {
  source: input,
  sequences: offsets.length - 1,
  tokens: offsets.at(-1),
  nonSpaceTokens: Object.values(counts).reduce((sum, count) => sum + count, 0),
  maxLength: longest,
  skipped,
  labelCounts: counts,
  positiveBoundaries,
  templates: [...templates].sort(),
  fingerprints: [...fingerprints].sort(),
  format: {
    rows: "uint16[17]",
    labels: "uint8",
    boundaries: "uint8",
    kinds: "uint8",
    neighbors: "int16[2]",
    offsets: "uint32",
  },
};
writeFileSync(`${prefix}.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest));
