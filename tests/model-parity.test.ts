import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inferRows } from "../src/model/cpu.js";
import { roundHalfFallback } from "../src/model/half.js";
import { weights } from "../src/model/weights.gen.js";
import { LABELS } from "../src/labels.js";

it("exports the current role vocabulary without a timezone role", () => {
  expect(weights.labels).toEqual(LABELS);
  expect(weights.labels).not.toContain("TZ");
});

function bytes(path: string): ArrayBuffer {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

it("matches the exported PyTorch predictions on 512 held-out sequences", () => {
  const rows = new Uint16Array(bytes("training/parity.rows.bin"));
  const offsets = new Uint32Array(bytes("training/parity.offsets.bin"));
  const expected = new Float32Array(bytes("training/parity.logits.bin"));
  const boundaries = new Float32Array(bytes("training/parity.boundaries.bin"));
  let maxError = 0;
  let labelMismatches = 0;
  let boundaryMismatches = 0;
  for (let sequence = 0; sequence < offsets.length - 1; sequence++) {
    const start = offsets[sequence];
    const end = offsets[sequence + 1];
    const result = inferRows(rows.subarray(start * 17, end * 17), true);
    for (let token = start; token < end; token++) {
      if (rows[token * 17] === 3) continue;
      const local = token - start;
      let best = 0;
      for (let label = 0; label < 40; label++) {
        if (expected[token * 40 + label] > expected[token * 40 + best])
          best = label;
        maxError = Math.max(
          maxError,
          Math.abs(
            result.logits![local * 40 + label] - expected[token * 40 + label],
          ),
        );
      }
      labelMismatches += Number(result.labels[local] !== best);
      boundaryMismatches += Number(
        result.clauseStarts[local] !==
          Number(boundaries[token] >= weights.boundaryThreshold),
      );
      maxError = Math.max(
        maxError,
        Math.abs(result.boundaryLogits![local] - boundaries[token]),
      );
    }
  }
  expect({ labelMismatches, boundaryMismatches, maxError }).toEqual({
    labelMismatches: 0,
    boundaryMismatches: 0,
    maxError: expect.any(Number),
  });
  writeFileSync(
    "training/parity-cpu.json",
    JSON.stringify(
      {
        sequences: offsets.length - 1,
        tokens: offsets.at(-1),
        labelMismatches,
        boundaryMismatches,
        maxError,
      },
      null,
      2,
    ) + "\n",
  );
  expect(maxError).toBeLessThan(0.001);
});

it("rounds half precision consistently on ties, subnormals, and overflow", () => {
  const native = (Math as typeof Math & { f16round: (value: number) => number })
    .f16round;
  for (const value of [
    0,
    -0,
    1,
    1.00048828125,
    1.00146484375,
    2 ** -25,
    3 * 2 ** -25,
    65504,
    65520,
    -65520,
    Infinity,
    -Infinity,
    NaN,
  ]) {
    expect(roundHalfFallback(value)).toBe(native(value));
  }
});
