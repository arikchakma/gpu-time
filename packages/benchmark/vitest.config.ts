import { defineConfig } from "vitest/config";

// Vitest's default include looks for `tests/`; this package uses `test/`.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
