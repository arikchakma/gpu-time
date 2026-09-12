import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const started = performance.now();
const refreshCorpus = process.argv.includes("--refresh-corpus");

const here = import.meta.dirname;
const packageRoot = join(here, "..");
const repoRoot = join(packageRoot, "..", "..");
const training = join(repoRoot, "packages", "training");
const synth = join(training, "data", "synth");

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit", cwd: repoRoot });
}
// Sibling package scripts run in their own package; local steps are invoked by
// absolute path so the orchestrator's own working directory never matters.
function node(script: string, args: string[] = []) {
  run(process.execPath, ["--experimental-strip-types", script, ...args]);
}
function python(script: string, args: string[] = []) {
  run("uv", ["run", "--project", training, "python", script, ...args]);
}
function checkSemantic(args: string[] = []) {
  run("pnpm", [
    "--filter",
    "@gpu-time/training",
    "run",
    "check:semantic",
    ...args,
  ]);
}

// Keep the build's size gate visible while allowing development reports to
// explain a missed budget. `pnpm size:gate` remains the strict release command.
run("pnpm", ["--filter", "gpu-time", "run", "build", "--report-only"]);
node(join(here, "evaluate-model.ts"));
node(join(here, "evaluate-results.ts"));
run("pnpm", ["--filter", "gpu-time", "run", "test:browser"]);
if (refreshCorpus || !existsSync(join(synth, "natural-evaluation.jsonl")))
  python(join(training, "torch", "check-natural.py"), [
    "--out",
    join(synth, "natural-evaluation.jsonl"),
  ]);
checkSemantic([
  join(synth, "natural-evaluation.jsonl"),
  "results/natural-roundtrip.json",
]);
node(join(training, "src", "evaluate-semantic.ts"), [
  join(training, "results", "natural-evaluation.json"),
  join(synth, "natural-evaluation.jsonl"),
]);
if (refreshCorpus || !existsSync(join(synth, "natural-reserved.jsonl")))
  python(join(training, "torch", "check-natural.py"), [
    "--reserved",
    "--out",
    join(synth, "natural-reserved.jsonl"),
  ]);
node(join(training, "src", "evaluate-semantic.ts"), [
  join(training, "results", "natural-reserved-evaluation.json"),
  join(synth, "natural-reserved.jsonl"),
]);
if (refreshCorpus || !existsSync(join(synth, "semantic-checks.jsonl")))
  python(join(training, "torch", "generate-semantic.py"));
checkSemantic();
node(join(training, "src", "evaluate-semantic.ts"));
if (!existsSync(join(packageRoot, "data", "recognizers", "cases.jsonl")))
  node(join(here, "fetch-recognizers.ts"));
node(join(here, "external.ts"));
node(join(here, "size.ts"));
const venvPython = join(packageRoot, ".venv", "bin", "python");
if (!existsSync(venvPython))
  run("uv", ["venv", join(packageRoot, ".venv"), "--python", "3.13"]);
run("uv", [
  "pip",
  "install",
  "--python",
  venvPython,
  "-r",
  join(packageRoot, "requirements.lock"),
]);
run("uv", [
  "run",
  "--no-project",
  "--python",
  venvPython,
  "python",
  join(here, "sidecar.py"),
]);
node(join(here, "perf.browser.ts"));
node(join(here, "report.ts"));
const elapsedSeconds = (performance.now() - started) / 1000;
writeFileSync(
  join(packageRoot, "results", "run.json"),
  JSON.stringify(
    {
      command: "pnpm --filter @gpu-time/benchmark benchmark",
      elapsedSeconds,
      withinTenMinutes: elapsedSeconds < 600,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Benchmark finished in ${elapsedSeconds.toFixed(1)} seconds.`);
