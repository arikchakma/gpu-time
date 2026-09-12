import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { inferRows } from "../src/model/cpu.js";
import { roundHalfFallback } from "../src/model/half.js";
import { weights } from "../src/model/weights.gen.js";
import { LABELS } from "../src/labels.js";

const activePath = (name: string) =>
  `${import.meta.dirname}/../../training/active/${name}`;

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
  const rows = new Uint16Array(bytes(activePath("parity.rows.bin")));
  const offsets = new Uint32Array(bytes(activePath("parity.offsets.bin")));
  const expected = new Float32Array(bytes(activePath("parity.logits.bin")));
  const boundaries = new Float32Array(
    bytes(activePath("parity.boundaries.bin")),
  );
  // Fixtures written before role transitions shipped carry no decoded labels;
  // for those the emission argmax is what PyTorch predicted.
  const roles = weights.roleClasses;
  const decoded = existsSync(activePath("parity.labels.bin"))
    ? new Uint8Array(bytes(activePath("parity.labels.bin")))
    : undefined;
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
      for (let label = 0; label < roles; label++) {
        if (expected[token * roles + label] > expected[token * roles + best])
          best = label;
        maxError = Math.max(
          maxError,
          Math.abs(
            result.logits![local * roles + label] -
              expected[token * roles + label],
          ),
        );
      }
      labelMismatches += Number(
        result.labels[local] !== (decoded?.[token] ?? best),
      );
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
    `${import.meta.dirname}/../../training/results/parity-cpu.json`,
    JSON.stringify(
      {
        model: createHash("sha256")
          .update(
            readFileSync(`${import.meta.dirname}/../src/model/weights.gen.ts`),
          )
          .digest("hex"),
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
