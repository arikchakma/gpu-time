// Scores one built package on every benchmark at once, so a gain on one axis
// cannot hide a loss on another. Reads the already-built dist; build first.
import { execFileSync } from "node:child_process";
import { join, resolve as resolvePath } from "node:path";

const root = resolvePath(join(import.meta.dirname, "..", "..", ".."));
const label = process.argv[2] ?? "current";

const run = (file: string, args: string[]) => {
  try {
    return execFileSync("npx", ["tsx", join(root, file), ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const out = (error as { stdout?: string }).stdout;
    if (out) return out;
    throw error;
  }
};

const number = (text: string, pattern: RegExp) => {
  const found = pattern.exec(text);
  return found ? Number(found[1]) : NaN;
};

const real = run("packages/benchmark/src/evaluate-model.ts", [
  "--dir",
  join(root, "packages/training/data/real"),
  "--sets",
  "real-holdout",
]);
const gold = run("packages/benchmark/src/evaluate-model.ts", []);
const english = run("packages/benchmark/src/evaluate-english.ts", []);
const recognizers = run("packages/benchmark/src/external.ts", []);

const sets: Record<string, number> = {};
for (const line of gold.split("\n")) {
  const found =
    /^(\S+): (\d+)\/(\d+) (?:exact schedules|correct abstentions)/.exec(
      line.trim(),
    );
  if (found) sets[found[1]!] = Number(found[2]);
}
const pooled = Object.values(sets).reduce((total, one) => total + one, 0);

const board = {
  label,
  realEnglish: number(real, /real-holdout: (\d+)\//),
  pooled,
  ...sets,
  englishCoverage: number(english, /English coverage: (\d+)\//),
  recognizers: number(recognizers, /Recognizers development: (\d+)\//),
};
console.log(JSON.stringify(board));
