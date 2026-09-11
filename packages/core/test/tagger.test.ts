import { expect, it, vi } from "vitest";
import { Role } from "../src/labels.js";
import { createTagger } from "../src/tagger.js";

vi.mock("../src/compile.js", () => {
  throw new Error("The neural runtime must not import AST assembly.");
});
vi.mock("../src/resolve.js", () => {
  throw new Error("The neural runtime must not import date resolution.");
});

it("returns source-aligned predictions without interpreting calendar values", async () => {
  const tagger = await createTagger({ backend: "cpu" });
  try {
    const text = "27pm";
    const result = await tagger.tag(text);
    expect(
      result.tokens.map((token) => ({
        text: token.text,
        start: token.start,
        end: token.end,
        label: token.label,
      })),
    ).toEqual([
      { text: "27", start: 0, end: 2, label: Role.HOUR },
      { text: "pm", start: 2, end: 4, label: Role.MERIDIEM },
    ]);
    expect(result.unknownLabels).toBe(false);
    expect(result).not.toHaveProperty("expressions");
    expect(result).not.toHaveProperty("schedule");
    expect(result.timings).not.toHaveProperty("compileMs");
  } finally {
    tagger.dispose();
  }
});
