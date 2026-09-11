import { readFileSync, writeFileSync } from "node:fs";
import type { Schedule } from "../../core/src/types.ts";

const gold = new URL("../data/gold/", import.meta.url);

interface Case {
  id: string;
  text: string;
  family: string;
  schedule: Schedule;
}
const base: Case[] = readFileSync(new URL("grammar.jsonl", gold), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const seen = new Set(base.map((example) => example.text));
const cases = [];
for (const example of base) {
  // IANA identifiers keep their spelling; casing only changes language words.
  const parts = example.text.split(/(America\/New_York)/);
  const alternatives = [
    {
      kind: "lowercase",
      text: parts
        .map((part) => (part.includes("/") ? part : part.toLowerCase()))
        .join(""),
    },
    {
      kind: "uppercase",
      text: parts
        .map((part) => (part.includes("/") ? part : part.toUpperCase()))
        .join(""),
    },
    {
      kind: "spacing",
      text: " \t" + example.text.replace(/\s+/g, "  ") + "\n",
    },
    {
      kind: "abbreviated",
      text: example.text.replace(
        /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|June|July|August|September|October|November|December)(s?)\b/gi,
        (_word, name: string) => name.slice(0, 3),
      ),
    },
  ];
  for (const alternative of alternatives) {
    if (seen.has(alternative.text)) continue;
    seen.add(alternative.text);
    cases.push({
      ...example,
      id: `${example.id}-${alternative.kind}`,
      text: alternative.text,
      sourceId: example.id,
      variation: alternative.kind,
    });
  }
}
writeFileSync(
  new URL("grammar-variations.jsonl", gold),
  cases.map((value) => JSON.stringify(value)).join("\n") + "\n",
);
console.log(
  `Derived ${cases.length} casing, spacing and abbreviation checks from the authored grammar cases.`,
);
