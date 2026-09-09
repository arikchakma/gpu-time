import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const started = performance.now();

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}

// Keep the build's size gate visible while allowing development reports to
// explain a missed budget. `npm run build` remains the strict release command.
run("bun", ["scripts/build.ts", "--report-only"]);
run("bun", ["scripts/evaluate-model.ts"]);
run("bun", ["scripts/evaluate-results.ts"]);
run("bun", ["tests/browser.ts"]);
run("uv", [
  "run",
  "--project",
  "training",
  "python",
  "training/check-natural.py",
]);
run("bun", [
  "training/check-semantic.ts",
  "data/synth/natural-evaluation.jsonl",
]);
run("bun", [
  "training/evaluate-semantic.ts",
  "training/natural-evaluation.json",
  "data/synth/natural-evaluation.jsonl",
]);
run("uv", [
  "run",
  "--project",
  "training",
  "python",
  "training/check-natural.py",
  "--reserved",
  "--out",
  "data/synth/natural-reserved.jsonl",
]);
run("bun", [
  "training/evaluate-semantic.ts",
  "training/natural-reserved-evaluation.json",
  "data/synth/natural-reserved.jsonl",
]);
run("uv", [
  "run",
  "--project",
  "training",
  "python",
  "training/generate-semantic.py",
]);
run("bun", ["training/check-semantic.ts"]);
run("bun", ["training/evaluate-semantic.ts"]);
if (!existsSync("data/external/recognizers/cases.jsonl"))
  run("bun", ["scripts/import-recognizers.ts"]);
run("bun", ["bench/external.ts"]);
run("bun", ["bench/size.ts"]);
if (!existsSync("bench/.venv/bin/python"))
  run("uv", ["venv", "bench/.venv", "--python", "3.13"]);
run("uv", [
  "pip",
  "install",
  "--python",
  "bench/.venv/bin/python",
  "-r",
  "bench/requirements.lock",
]);
run("bench/.venv/bin/python", ["bench/sidecar.py"]);
run("bun", ["bench/perf.browser.ts"]);
run("bun", ["bench/report.ts"]);
const elapsedSeconds = (performance.now() - started) / 1000;
writeFileSync(
  "bench/results/run.json",
  JSON.stringify(
    {
      command: "npm run bench",
      elapsedSeconds,
      withinTenMinutes: elapsedSeconds < 600,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Benchmark finished in ${elapsedSeconds.toFixed(1)} seconds.`);
