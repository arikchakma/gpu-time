# 010 — Playground and release

Effort: 2 days.

## Playground (`playground/`, Vite, mirrors gpu-lexer.vercel.app)

- Input box with live parsing in a Web Worker (never blocks the main thread); toggle backend CPU / WebGPU; shows `backend`, timings.
- Panels: token labels as colored spans over the text (like syntax highlighting; this *is* the gpu-lexer visual); Schedule JSON; resolved occurrences on a mini calendar; RRULE lines; diagnostics.
- Reference date / timezone / policy option controls.
- Compare tab: type an input, see chrono-node / compromise / rrule outputs side by side (from `bench/results/summary.json` for the gold sets; live for chrono and rrule since they run in-browser).
- Model card: params, bundle size, training tokens, metrics from `training/report.json`.
- Deploy: Vercel static.

## Release

- `npm publish` `gpu-time@0.1.0`: `dist/index.js`, `dist/index.d.ts`, `dist/resolve.js`; zero deps; `files: ["dist"]`.
- README: API, supported phrase table (002 §1), interpretation rules, benchmark tables linked to `bench/results/REPORT.md`, honest limits (synthetic training; GPU wins only on batches), reproduction commands.
- `training/report.json` and `bench/results/` committed per release.

## Acceptance

Playground handles all adversarial-25 live; Lighthouse performance ≥ 95; total library ≤ 30 KB brotli as reported by `dist/size.json`.
