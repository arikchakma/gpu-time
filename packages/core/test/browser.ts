import { chromium } from "playwright";
import { createServer } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { RawToken } from "../src/types.js";

// The Vite dev server is rooted at the workspace root so that one URL space
// covers packages/core (src, dist, test) and packages/training (parity data).
const workspaceRoot = resolve(import.meta.dirname, "../../..");
const trainingRoot = `${workspaceRoot}/packages/training`;

const report = JSON.parse(
  await readFile(`${trainingRoot}/active/export-report.json`, "utf8"),
);
const selectedRun = report.checkpoint.split("/").at(-2);
const fixturePath = `${trainingRoot}/active/parity.texts.json`;
let texts: string[];
if (existsSync(fixturePath)) {
  texts = JSON.parse(await readFile(fixturePath, "utf8")).slice(0, 10_000);
} else {
  const selectedConfig = JSON.parse(
    await readFile(`${trainingRoot}/runs/${selectedRun}/report.json`, "utf8"),
  ).config;
  const run = selectedConfig.evaluation_run ?? selectedRun;
  const dataPath = `${trainingRoot}/data/synth/${run}/heldout.jsonl`;
  if (!existsSync(dataPath)) {
    const config = JSON.parse(
      await readFile(`${trainingRoot}/runs/${run}/report.json`, "utf8"),
    ).config;
    execFileSync(
      "uv",
      [
        "run",
        "--project",
        trainingRoot,
        "python",
        `${trainingRoot}/runs/${run}/source/training/generate.py`,
        "--count",
        String(config.eval_samples),
        "--seed",
        String(config.seed + 2),
        "--split",
        "heldout",
        "--out",
        dataPath,
      ],
      { stdio: "inherit" },
    );
  }
  texts = (await readFile(dataPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).text as string)
    .slice(0, 10_000);
}
const server = await createServer({
  configFile: false,
  root: workspaceRoot,
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/runner.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Model parity</title>",
    }),
  );
  await page.goto(server.resolvedUrls!.local[0] + "runner.html");
  const result = await page.evaluate(async (texts) => {
    const root = "/packages/core/src";
    const { GPUModel } = await import(root + "/model/gpu.ts");
    const { inferCPU } = await import(root + "/model/cpu.ts");
    const { tokenize } = await import(root + "/tokenizer.ts");
    const binary = async (name: string) =>
      (
        await fetch(`/packages/training/active/parity.${name}.bin`)
      ).arrayBuffer();
    const expected = new Float32Array(await binary("logits"));
    const expectedBoundaries = new Float32Array(await binary("boundaries"));
    const offsets = new Uint32Array(await binary("offsets"));
    // Fixtures older than role transitions carry no decoded labels; for those
    // the emission argmax is what PyTorch predicted.
    const labelFile = await fetch(
      "/packages/training/active/parity.labels.bin",
    );
    const decoded = labelFile.ok
      ? new Uint8Array(await labelFile.arrayBuffer())
      : undefined;
    const { boundaryThreshold = 0, rolesPerToken: roles } = await (
      await fetch("/packages/training/active/parity.json")
    ).json();
    const inputs: RawToken[][] = texts
      .map((text): RawToken[] => tokenize(text))
      .filter((tokens) => tokens.length > 0 && tokens.length <= 128);
    const gpu = await GPUModel.create();
    let maxError = 0;
    let pythonMaxError = 0;
    let labelMismatches = 0;
    let boundaryMismatches = 0;
    let pythonLabelMismatches = 0;
    let pythonBoundaryMismatches = 0;
    let tokensCompared = 0;
    try {
      for (let start = 0; start < inputs.length; start += 128) {
        const batch = inputs.slice(start, start + 128);
        const actual = await gpu.inferMany(batch, true);
        for (let index = 0; index < batch.length; index++) {
          const sequence = start + index;
          const cpu = inferCPU(batch[index], true);
          if (
            sequence < offsets.length - 1 &&
            batch[index].length !== offsets[sequence + 1] - offsets[sequence]
          )
            throw new Error(
              `Python fixture ${sequence} has different token offsets`,
            );
          for (let token = 0; token < batch[index].length; token++) {
            if (batch[index][token].kind === 3) continue;
            tokensCompared++;
            const prediction = actual[index];
            labelMismatches += Number(
              cpu.labels[token] !== prediction.labels[token],
            );
            boundaryMismatches += Number(
              cpu.clauseStarts[token] !== prediction.clauseStarts[token],
            );
            let bestPython = 0;
            for (let label = 0; label < roles; label++) {
              const value = prediction.logits[token * roles + label];
              maxError = Math.max(
                maxError,
                Math.abs(value - cpu.logits[token * roles + label]),
              );
              if (sequence < offsets.length - 1) {
                const position = offsets[sequence] + token;
                pythonMaxError = Math.max(
                  pythonMaxError,
                  Math.abs(value - expected[position * roles + label]),
                );
                if (
                  expected[position * roles + label] >
                  expected[position * roles + bestPython]
                )
                  bestPython = label;
              }
            }
            maxError = Math.max(
              maxError,
              Math.abs(
                prediction.boundaryLogits[token] - cpu.boundaryLogits[token],
              ),
            );
            if (sequence < offsets.length - 1) {
              const position = offsets[sequence] + token;
              const boundary = expectedBoundaries[position];
              pythonLabelMismatches += Number(
                prediction.labels[token] !==
                  (decoded?.[position] ?? bestPython),
              );
              pythonBoundaryMismatches += Number(
                prediction.clauseStarts[token] !==
                  Number(boundary >= boundaryThreshold),
              );
              pythonMaxError = Math.max(
                pythonMaxError,
                Math.abs(prediction.boundaryLogits[token] - boundary),
              );
            }
          }
        }
      }
      // Destroy a real device and exercise the documented one-time recovery.
      const lost = gpu.device.lost;
      gpu.device.destroy();
      await lost;
      const recovered = await gpu.inferMany([inputs[0]]);
      const cpu = inferCPU(inputs[0]);
      const recoveryCorrect = Array.from(recovered[0].labels).every(
        (label, index) => label === cpu.labels[index],
      );
      return {
        sequences: inputs.length,
        pythonSequences: offsets.length - 1,
        tokensCompared,
        maxError,
        pythonMaxError,
        labelMismatches,
        boundaryMismatches,
        pythonLabelMismatches,
        pythonBoundaryMismatches,
        recoveryCorrect,
        recoveries: gpu.stats.recoveries,
      };
    } finally {
      gpu.dispose();
    }
  }, texts);
  const lifecycle = await page.evaluate(async () => {
    const path = "/packages/core/test/browser-lifecycle.ts";
    return (await import(path)).lifecycleChecks();
  });
  const packaged = await page.evaluate(
    async (texts) => {
      const sourcePath = "/packages/core/src/schedule.ts";
      const packagePath = "/packages/core/dist/schedule.js";
      const cpu = await (
        await import(sourcePath)
      ).defineParser({ backend: "cpu", tokens: true });
      const gpu = await (
        await import(packagePath)
      ).defineParser({ backend: "webgpu", tokens: true });
      let tokenMismatches = 0;
      let scheduleMismatches = 0;
      try {
        const [expected, actual] = await Promise.all([
          cpu.parseMany(texts),
          gpu.parseMany(texts),
        ]);
        for (let index = 0; index < texts.length; index++) {
          const a = expected[index];
          const b = actual[index];
          if (b.backend !== "webgpu")
            throw new Error("Packaged inference did not use WebGPU");
          if (a.tokens.length !== b.tokens.length)
            throw new Error("Packaged tokenizer changed token count");
          for (let token = 0; token < a.tokens.length; token++) {
            const left = a.tokens[token];
            const right = b.tokens[token];
            tokenMismatches += Number(
              left.start !== right.start ||
                left.end !== right.end ||
                left.label !== right.label ||
                left.clauseStart !== right.clauseStart,
            );
          }
          scheduleMismatches += Number(
            JSON.stringify(
              a.expressions.map(
                (value: { schedule: unknown }) => value.schedule,
              ),
            ) !==
              JSON.stringify(
                b.expressions.map(
                  (value: { schedule: unknown }) => value.schedule,
                ),
              ),
          );
        }
      } finally {
        cpu.dispose();
        gpu.dispose();
      }
      if (tokenMismatches || scheduleMismatches)
        throw new Error(
          `Packaged shader parity failed: ${tokenMismatches} token and ${scheduleMismatches} schedule mismatches`,
        );
      return { sequences: texts.length, tokenMismatches, scheduleMismatches };
    },
    texts.slice(0, 1000),
  );
  await writeFile(
    `${trainingRoot}/results/parity-gpu.json`,
    JSON.stringify(
      {
        model: report.artifactSha256,
        browser: browser.version(),
        lifecycle,
        packaged,
        ...result,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  console.log("WebGPU lifecycle:", lifecycle);
  console.log("Packaged shader:", packaged);
  if (
    result.sequences < 10_000 ||
    result.labelMismatches ||
    result.boundaryMismatches ||
    result.pythonLabelMismatches ||
    result.pythonBoundaryMismatches ||
    result.maxError > 0.001 ||
    result.pythonMaxError > 0.001 ||
    !result.recoveryCorrect ||
    result.recoveries !== 1
  )
    throw new Error(
      "Browser parity or device recovery failed; see packages/training/results/parity-gpu.json",
    );
} finally {
  await browser.close();
  await server.close();
}
