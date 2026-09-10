# Project context

This `gpu-time` repository is the authoritative implementation. The former
`gpu-time-rewrite` directory is a compatibility symlink to this directory, not a
second project. Do not create a separate copy or restart the archived app.

- Library: `src/`. Latest UI: `playground/`.
- Current behavior and limitations: `README.md` and `PROJECT_STATUS.md`.
- Selected model and provenance: `training/export-report.json`.
- Start the playground with `npm run dev` at `http://127.0.0.1:5173/`. The port is
  strict; investigate conflicts instead of silently using another port.
- Use `npm run check`, `npm test`, and `npm run build:playground` for validation.
  `npm run test:browser` checks the model and packaged runtime on real WebGPU.
- Benchmarks live under `bench/`. Preserve their evaluation corpora unless the
  user explicitly requests regeneration. Do not lower existing release gates.

The old implementation is preserved on `archive/legacy-gpu-time` for historical
reference only. Its model, public AST, and performance results do not describe
the current library.

Existing `video/` assets depict that old implementation. They are retained as
archival work, with frozen data and a documented provenance. Do not treat their
19,599-parameter model or AST narrative as current product claims. Updating the
launch video requires a new storyboard and data adapter for the latest runtime.
