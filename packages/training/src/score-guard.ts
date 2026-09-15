// Minimal pairs for an ambiguous word: both senses must survive together.
import { readFileSync } from "node:fs";
const rows = readFileSync(
  process.argv[process.argv.indexOf("--in") + 1]!,
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const { defineParser } = await import("../../core/dist/schedule.js");
const parser = await defineParser({ backend: "cpu", tokens: true });
let month = 0,
  monthTotal = 0,
  modal = 0,
  modalTotal = 0;
for (const row of rows) {
  if (row.wants === "skip") continue;
  const fired = (await parser.parse(row.text)).expressions.some(
    (one: { schedule: unknown }) => one.schedule,
  );
  if (row.wants === "time") {
    monthTotal++;
    if (fired) month++;
    else console.log("  lost month:", row.text);
  } else {
    modalTotal++;
    if (!fired) modal++;
    else console.log("  false fire:", row.text);
  }
}
console.log(
  JSON.stringify({
    monthSense: `${month}/${monthTotal}`,
    modalSense: `${modal}/${modalTotal}`,
  }),
);
