import { expect, it } from "vitest";
import { viterbiDecode } from "../src/model/cpu.js";

function reference(
  emissions: Float32Array,
  offsets: number[],
  classes: number,
  chain: Float32Array,
) {
  const paths = Array.from({ length: classes }, (_, label) => [label]);
  let scores = Float32Array.from(
    { length: classes },
    (_, label) => emissions[offsets[0] + label],
  );
  for (const offset of offsets.slice(1)) {
    const next = new Float32Array(classes);
    const previousPaths = paths.map((path) => [...path]);
    for (let label = 0; label < classes; label++) {
      let previous = 0;
      for (let candidate = 1; candidate < classes; candidate++)
        if (
          scores[candidate] + chain[candidate * classes + label] >
          scores[previous] + chain[previous * classes + label]
        )
          previous = candidate;
      next[label] =
        scores[previous] +
        chain[previous * classes + label] +
        emissions[offset + label];
      paths[label] = [...previousPaths[previous], label];
    }
    scores = next;
  }
  let best = 0;
  for (let label = 1; label < classes; label++)
    if (scores[label] > scores[best]) best = label;
  return Uint8Array.from(paths[best]);
}

it("matches scalar Viterbi across class counts, offsets, ties, and f32 rounding", () => {
  let seed = 90210;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const classes of [1, 2, 4, 5, 8, 9, 35, 40]) {
    for (let trial = 0; trial < 30; trial++) {
      const steps = 1 + Math.floor(random() * 20);
      const stride = classes + 2;
      const offsets = Array.from({ length: steps }, (_, step) => step * stride);
      const scale = trial % 3 === 0 ? 2 ** 22 : 1;
      const emissions = Float32Array.from(
        { length: steps * stride },
        () => Math.floor(random() * 16 - 8) * scale,
      );
      const chain = Float32Array.from(
        { length: classes * classes },
        () => Math.floor(random() * 16 - 8) / 7,
      );
      const actual = viterbiDecode(emissions, offsets, classes, chain);
      expect(actual.path).toEqual(
        reference(emissions, offsets, classes, chain),
      );
      for (let step = 0; step < steps; step++) {
        const row = emissions.subarray(offsets[step], offsets[step] + classes);
        const peak = Math.max(...row);
        const denominator = [...row].reduce(
          (sum, value) => sum + Math.exp(value - peak),
          0,
        );
        expect(actual.confidence[step]).toBe(
          Math.fround(Math.exp(row[actual.path[step]] - peak) / denominator),
        );
      }
    }
  }
});

it("chooses the earliest label on tied paths and handles no scored tokens", () => {
  expect(
    viterbiDecode(
      new Float32Array(120),
      [0, 40, 80],
      40,
      new Float32Array(1600),
    ),
  ).toEqual({
    path: new Uint8Array(3),
    confidence: new Float32Array(3).fill(1 / 40),
  });
  expect(
    viterbiDecode(new Float32Array(), [], 40, new Float32Array(1600)),
  ).toEqual({
    path: new Uint8Array(),
    confidence: new Float32Array(),
  });
});

it("retains a lower-scoring predecessor when its transition ties the bound", () => {
  const emissions = new Float32Array(80);
  emissions.fill(-100, 0, 40);
  emissions[0] = 0;
  emissions[39] = 10;
  const chain = new Float32Array(1600).fill(-100);
  chain.fill(0, 0, 40);
  chain.fill(-10, 39 * 40);
  expect(viterbiDecode(emissions, [0, 40], 40, chain).path).toEqual(
    Uint8Array.of(0, 0),
  );
});

it("preserves tiny transition differences and rounding near f32 boundaries", () => {
  for (const scale of [2 ** -120, 2 ** -23, 1, 2 ** 23]) {
    const emissions = Float32Array.from([
      scale,
      scale * (1 + 2 ** -23),
      -scale,
      -scale * (1 + 2 ** -23),
      scale,
      scale,
    ]);
    const chain = Float32Array.from([
      -scale,
      -scale * (1 + 2 ** -23),
      -scale * (1 - 2 ** -24),
      -scale,
    ]);
    expect(viterbiDecode(emissions, [0, 2, 4], 2, chain).path).toEqual(
      reference(emissions, [0, 2, 4], 2, chain),
    );
  }
});
