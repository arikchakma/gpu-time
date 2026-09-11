import { defineParser } from "../packages/core/src/index.ts";
import { createTagger } from "../packages/core/src/tagger.ts";
import { tokenize, featureRows } from "../packages/core/src/tokenizer.ts";
import { inferCPU } from "../packages/core/src/model/cpu.ts";
import { weights } from "../packages/core/src/model/weights.gen.ts";
import { decodeWeights } from "../packages/core/src/model/decode.ts";
import { LABELS } from "../packages/core/src/labels.ts";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// Resolve against the repository root so the exporter runs from anywhere.
const root = new URL("../", import.meta.url).pathname;

const text = "every Monday from 8pm to 10pm";
const context = {
  reference: "2026-10-24T12:00:00-04:00",
  timeZone: "America/New_York",
  limit: 3,
};
const parser = await defineParser({ backend: "cpu" });
const result = await parser.parse(text, context);
parser.dispose();
const tagger = await createTagger({ backend: "cpu" });
const tagged = await tagger.tag(text);
tagger.dispose();
const tokens = tokenize(text);
const prediction = inferCPU(tokens, true);
assert(prediction.trace && prediction.logits && prediction.boundaryLogits);
assert.deepEqual(
  Array.from(prediction.labels),
  tagged.tokens.map((token) => token.label),
);
assert.equal(result.occurrences.length, 3);
assert.equal(result.rrules.length, 1);
const tensors = decodeWeights(weights);
const dot = (x: number[], name: string, row: number, width: number) => {
  const matrix = tensors.get(name)!;
  let sum = 0;
  for (let i = 0; i < width; i++) sum += x[i] * matrix[row * width + i];
  return Math.fround(sum);
};
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const model = tokens.map((token, i) => {
  const trace = Object.fromEntries(
    Object.entries(prediction.trace!).map(([key, values]) => [
      key,
      Array.from(
        key === "pooled" || key === "context"
          ? values
          : values.slice(i * 32, (i + 1) * 32),
      ),
    ]),
  );
  const x = [...trace.combined, ...trace.context];
  const gateBias = tensors.get("head_gate_bias")!;
  const hiddenBias = tensors.get("head_hidden_bias")!;
  const headGate = Array.from({ length: 16 }, (_, row) => {
    const matrix = tensors.get("head_gate_weight")!;
    let v = gateBias[row];
    for (let k = 0; k < 32; k++) {
      v += x[k] * matrix[row * 64 + k];
      v += x[32 + k] * matrix[row * 64 + 32 + k];
    }
    return sigmoid(Math.fround(v));
  });
  const headHidden = Array.from({ length: 64 }, (_, row) => {
    const matrix = tensors.get("head_hidden_weight")!;
    let v = hiddenBias[row];
    for (let k = 0; k < 32; k++) {
      v += x[k] * matrix[row * 80 + k];
      v += x[32 + k] * matrix[row * 80 + 32 + k];
    }
    for (let k = 0; k < 16; k++) v += headGate[k] * matrix[row * 80 + 64 + k];
    return Math.tanh(Math.fround(v));
  });
  const logits = Array.from(
    prediction.logits!.slice(
      i * weights.roleClasses,
      (i + 1) * weights.roleClasses,
    ),
  );
  if (token.kind !== 3) {
    for (let slot = 0; slot < weights.roleClasses; slot++) {
      const reconstructed =
        tensors.get("output_bias")![slot] +
        dot(headHidden, "output_weight", slot, 64);
      assert(
        Math.abs(reconstructed - logits[slot]) < 0.00001,
        `Head trace mismatch: ${i}:${slot}`,
      );
    }
  }
  return {
    ...token,
    label: LABELS[prediction.labels[i]],
    featureRows: featureRows(token.features),
    ...trace,
    headGate,
    headHidden,
    logits,
    boundaryLogit: prediction.boundaryLogits![i],
    clauseStart: Boolean(prediction.clauseStarts[i]),
  };
});
const report = JSON.parse(
  readFileSync(`${root}packages/training/active/export-report.json`, "utf8"),
);
const hash = createHash("sha256");
for (const file of readdirSync(`${root}packages/core/src`, { recursive: true })
  .map(String)
  .sort()) {
  if (/\.(ts|wgsl)$/.test(file))
    hash.update(file).update(readFileSync(`${root}packages/core/src/${file}`));
}
const rule = result.rrules[0].split("\n");
writeFileSync(
  `${root}video/data.json`,
  JSON.stringify(
    {
      provenance: {
        source:
          "packages/core/src/index.ts + packages/core/src/model/cpu.ts diagnostic trace",
        sourceSha256: hash.digest("hex"),
        checkpointSha256: report.checkpointSha256,
        artifactSha256: report.artifactSha256,
      },
      text,
      context,
      parameters: report.parameters,
      architecture: {
        embeddingRows: weights.featureRows,
        channels: 32,
        headGate: 16,
        headHidden: 64,
        roleSlots: weights.roleClasses,
        namedRoles: LABELS.length,
        boundaryThreshold: weights.boundaryThreshold,
      },
      labels: Array.from(
        { length: weights.roleClasses },
        (_, i) => LABELS[i] ?? `reserved_${i}`,
      ),
      model: model.filter((t) => t.kind !== 3),
      allTokens: model,
      expansion: {
        occurrences: result.occurrences.map((t) => ({
          ...t,
          instant: new Date(t.start).toISOString(),
        })),
      },
      rules: [{ dtstart: rule[0], dtend: rule[1], rrule: rule[2] }],
      result,
    },
    null,
    2,
  ) + "\n",
);
