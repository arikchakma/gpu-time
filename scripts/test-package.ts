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
