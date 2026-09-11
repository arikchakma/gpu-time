import { expect, it } from "vitest";
import { inferCPU } from "../src/model/cpu.js";
import { tokenize } from "../src/tokenizer.js";

it("keeps cached embeddings and reused workspace equivalent to fresh inference", () => {
  const phrases = [
    "tomorrow",
    "Sat Sun 1pm-8pm Mon 10pm-12am",
    "17 August 2013 2pm - 19 August 2013 2pm",
    "",
    "a longer message about every other Monday at nine am and five pm",
  ];
  const first = inferCPU(tokenize(phrases[0]));
  const original = structuredClone(first);
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const text of phrases) {
      const tokens = tokenize(text);
      const cached = inferCPU(tokens);
      const fresh = inferCPU(tokens, true);
      expect(cached.labels).toEqual(fresh.labels);
      expect(cached.clauseStarts).toEqual(fresh.clauseStarts);
      expect(cached.scores).toEqual(fresh.scores);
    }
  }
  expect(first).toEqual(original);
});

it("decodes compact power-of-two row scales exactly", async () => {
  const { decodeWeights } = await import("../src/model/decode.js");
  const encoded = {
    featureRows: 324,
    roleClasses: 40,
    labels: [],
    q: "CDEF",
    segments: [
      {
        name: "matrix",
        offset: 0,
        length: 4,
        scale: 0.5,
        shape: [2, 2],
        rowScales: "AB",
      },
    ],
  };
  expect([...decodeWeights(encoded).get("matrix")!]).toEqual([
    0.5, -1, 0.5, -0.75,
  ]);
  expect(() =>
    decodeWeights({
      ...encoded,
      segments: [{ ...encoded.segments[0], rowScales: "AAA" }],
    }),
  ).toThrow("row scale");
  expect(() =>
    decodeWeights({
      ...encoded,
      segments: [{ ...encoded.segments[0], rowScales: "AZ" }],
    }),
  ).toThrow("row scale");
});
