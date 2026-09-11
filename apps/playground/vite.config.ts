import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  // main.ts imports JSON from packages/training and packages/benchmark, which
  // live outside the app root and behind pnpm symlinks, so Vite's dev-server
  // file allowlist has to include the workspace root.
  server: { fs: { allow: ["../.."] } },
});
