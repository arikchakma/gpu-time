import { readFileSync } from "node:fs";
import { tokenize } from "../../core/src/tokenizer.ts";
const rows = readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
console.log(JSON.stringify(rows.map((r) => tokenize(r.text))));
