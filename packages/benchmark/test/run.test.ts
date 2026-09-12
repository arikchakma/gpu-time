import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
}));

const argv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(true);
  process.argv = [process.execPath, "run.ts"];
});
afterEach(() => {
  process.argv = argv;
});

it("reuses frozen corpora and invokes source compiler checks through tsx", async () => {
  await import("../src/run.ts");
  const commands = vi
    .mocked(execFileSync)
    .mock.calls.map(([command, args]) => [command, ...(args as string[])]);
  expect(
    commands.filter((args) => args.includes("check:semantic")),
  ).toHaveLength(2);
  expect(
    commands.some((args) =>
      args.some((arg) => String(arg).endsWith("check-semantic.ts")),
    ),
  ).toBe(false);
  expect(
    commands.some((args) =>
      args.some((arg) => String(arg).endsWith("check-natural.py")),
    ),
  ).toBe(false);
  expect(
    commands.some((args) =>
      args.some((arg) => String(arg).endsWith("generate-semantic.py")),
    ),
  ).toBe(false);
  expect(
    commands.find((args) =>
      args.some((arg) => String(arg).endsWith("sidecar.py")),
    ),
  ).toEqual([
    "uv",
    "run",
    "--no-project",
    "--python",
    expect.stringContaining("/benchmark/.venv/bin/python"),
    "python",
    expect.stringContaining("/benchmark/src/sidecar.py"),
  ]);
});

it("refreshes evaluation corpora only when explicitly requested", async () => {
  process.argv.push("--refresh-corpus");
  await import("../src/run.ts");
  const generators = vi
    .mocked(execFileSync)
    .mock.calls.filter(([, args]) =>
      (args as string[]).some((arg) =>
        /(?:check-natural|generate-semantic)\.py$/.test(arg),
      ),
    );
  expect(generators).toHaveLength(3);
  expect(
    generators.every(
      ([command, args]) =>
        command === "uv" && (args as string[]).includes("--project"),
    ),
  ).toBe(true);
});
