import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "gpu-time-consumer-"));
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], {
      encoding: "utf8",
    }),
  );
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(temporary, packed[0].filename),
    ],
    { cwd: temporary, stdio: "pipe" },
  );
  await writeFile(
    join(temporary, "consumer.ts"),
    `
import { createParser, type ParseResult } from "gpu-time";
const parser = await createParser({ backend: "cpu" });
const result: ParseResult = await parser.parse("one day after", { reference: "2026-09-09T12:00:00+06:00", timeZone: "Asia/Dhaka" });
if (result.occurrences[0].start !== "2026-09-10T12:00:00+06:00") throw new Error("Packaged parser returned the wrong date.");
if ("expressions" in result || "tokens" in result) throw new Error("Internal predictions leaked into the public result.");
const context = { reference: "2026-09-09T00:00:00Z", timeZone: "UTC" };
for (const [text, start, end] of [
  ["seven o'clock", "2026-09-09T07:00:00+00:00"],
  ["quarter to six", "2026-09-09T05:45:00+00:00"],
  ["for an hour and a half", "2026-09-09T00:00:00+00:00", "2026-09-09T01:30:00+00:00"],
  ["17 August 2013 2pm - 19 August 2013 2pm", "2013-08-17T14:00:00+00:00", "2013-08-19T14:00:00+00:00"],
]) {
  const parsed = await parser.parse(text, context);
  if (parsed.occurrences.length !== 1 || parsed.occurrences[0].start !== start || parsed.occurrences[0].end !== end || parsed.diagnostics.some(value => value.severity === "error")) throw new Error("Packaged natural-language result differs: " + text);
}
parser.dispose();
console.log("Installed package and public declarations passed.");
`,
  );
  execFileSync(
    "node",
    [
      resolve("node_modules/typescript/bin/tsc"),
      "consumer.ts",
      "--strict",
      "--skipLibCheck",
      "--target",
      "es2022",
      "--module",
      "nodenext",
    ],
    { cwd: temporary, stdio: "inherit" },
  );
  execFileSync("node", ["consumer.js"], { cwd: temporary, stdio: "inherit" });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
