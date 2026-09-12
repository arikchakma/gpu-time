import { beforeEach, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), writeFile: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it.each([40_000, 50_001])(
  "reports the actual release budget for a %i-byte artifact",
  async (bytes) => {
    const artifacts: Record<string, unknown> = {
      "browser.json": { model: "same", environment: {}, results: [] },
      "python.json": { results: [] },
      "size.json": { results: [] },
      "model-structure.json": { model: "same", results: [] },
      "export-report.json": { artifactSha256: "same" },
      "direct-results.json": { model: "same", total: 1, correct: 1 },
      "parity-gpu.json": { model: "same", sequences: 1, tokensCompared: 1 },
      "recognizers-development.json": {
        model: "same",
        total: 1,
        correct: 1,
        accuracy: 1,
        corpus: { commit: "abc", test: 1 },
        families: [],
        stages: {},
      },
      "semantic-evaluation.json": { model: "same", total: 1, correct: 1 },
      "natural-evaluation.json": { model: "same", total: 1, correct: 1 },
      "natural-reserved-evaluation.json": {
        model: "same",
        total: 1,
        correct: 1,
      },
      "natural-roundtrip.json": { total: 1, correct: 0 },
    };
    vi.mocked(readFile).mockImplementation(async (path) =>
      JSON.stringify(
        String(path).endsWith("/core/dist/size.json")
          ? {
              limitBytes: 50_000,
              withinBudget: bytes <= 50_000,
              files: [{ file: "index.js", brotliBytes: bytes }],
            }
          : artifacts[String(path).split("/").at(-1)!],
      ),
    );
    await import("../src/report.ts");
    const writes = vi.mocked(writeFile).mock.calls;
    const summary = JSON.parse(
      String(
        writes.find(([path]) => String(path).endsWith("/summary.json"))![1],
      ),
    );
    expect(summary.sizeGate).toEqual({
      limitBytes: 50_000,
      withinBudget: bytes <= 50_000,
      brotliBytes: bytes,
    });
    expect(
      summary.limitations.some((text: string) =>
        text.includes("Brotli budget"),
      ),
    ).toBe(bytes > 50_000);
    const markdown = String(
      writes.find(([path]) => String(path).endsWith("/REPORT.md"))![1],
    );
    expect(markdown).toContain("50,000-byte Brotli budget");
    expect(markdown).not.toContain("30,000-byte");
    expect(
      summary.limitations.some((text: string) =>
        text.includes("1 oracle failures"),
      ),
    ).toBe(true);
  },
);
