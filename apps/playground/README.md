# @gpu-time/playground

Vite developer/debug UI for the `gpu-time` parser. Not the marketing site — that
is `apps/website`. This app exists for the capability the website does not have:

- parsing in a Web Worker (`worker.ts`), so the main thread stays honest
- an Auto / CPU / WebGPU backend selector, with the backend actually used reported back
- an editable timezone and reference for calendar math
- a Compare tab that runs `chrono-node` and `rrule` live against the same phrase
- an interpretation-rules grid (date order, bare weekdays, week start, …)
- a model + benchmark disclosure panel, fed by `packages/training/active/export-report.json`
  and `packages/benchmark/results/summary.json`, which warns when the benchmarked
  `model` hash no longer matches the promoted `artifactSha256`

```sh
pnpm --filter @gpu-time/playground dev      # http://127.0.0.1:5173/
pnpm --filter @gpu-time/playground qa       # Playwright pass against a running dev server
```

Port 5173 is `--strictPort` on purpose: if it is taken, find out what is holding
it rather than letting the playground move and the QA script miss it.
