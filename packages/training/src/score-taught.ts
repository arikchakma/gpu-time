// Scores a built package against teacher-labelled sentences the model was not trained on.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { compile } from "../../core/src/compile.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
import type { Token } from "../../core/src/types.ts";

const file = process.argv[process.argv.indexOf("--in") + 1]!;
const rows = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const { defineParser } = await import("../../core/dist/schedule.js");
const parser = await defineParser({ backend: "cpu", tokens: true });

let correct = 0;
let silent = 0;
const misses: string[] = [];
for (const row of rows) {
  const raw = tokenize(row.text);
  const gold = compile(
    row.text,
    raw.map((token, index): Token => ({
      ...token,
      ...row.spans[index],
      score: 1,
    })),
  ).filter((one) => one.schedule)[0]?.schedule;
  const ours = await parser.parse(row.text);
  const mine = ours.expressions.filter(
    (one: { schedule: unknown }) => one.schedule,
  )[0]?.schedule;
  if (!mine) silent++;
  if (gold && mine && isDeepStrictEqual(gold, mine)) correct++;
  else if (misses.length < 8) misses.push(row.text);
}
console.log(
  JSON.stringify({
    rows: rows.length,
    correct,
    silent,
    accuracy: +(correct / rows.length).toFixed(4),
  }),
);
for (const miss of misses)
  console.log("  miss:", JSON.stringify(miss).slice(0, 90));
