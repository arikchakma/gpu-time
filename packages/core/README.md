# gpu-time

A compact neural parser for English schedules. One small trained model reads a natural-language time expression and returns concrete dates, time ranges, and RFC 5545 recurrence rules. There is no grammar pack and no token or AST step for consumers.

```sh
pnpm add gpu-time
```

```js
import { parse } from "gpu-time";

const result = await parse("Sat Sun 1pm-8pm Mon 10pm-12am", {
  reference: "2026-09-09T12:00:00+06:00",
  timeZone: "Asia/Dhaka",
});

console.log(result.occurrences);
// Saturday and Sunday: 13:00–20:00
// Monday: 22:00–Tuesday 00:00
console.log(result.rrules);
console.log(result.diagnostics);
```

`parse(text, context)` and `parseMany(texts, context)` are the convenience entry points. `context` must carry a `reference` instant and a `timeZone`; an unknown timezone rejects the call. The result holds `occurrences` (ISO `start`, optional `end`, `allDay`), `rrules`, `truncated`, `diagnostics`, the `backend` that ran, and `timings`. Expressions the model cannot ground return diagnostics instead of invented dates.

For a reusable instance or explicit backend selection, use `defineParser({ backend })` and release its GPU resources with `dispose()`:

```js
import { defineParser } from "gpu-time";

const parser = await defineParser({ backend: "webgpu" });
const results = await parser.parseMany(texts, context);
parser.dispose();
```

Inference runs on WebGPU in a secure browser context when one is available; otherwise it falls back to CPU and reports `backend: "cpu"` with a `fallbackReason`. The first call acquires a device, compiles the pipeline, and uploads the model; later calls reuse those resources.

The output is probabilistic. It is not a parser, compiler, linter, or validator, and it should not be trusted as one — check `diagnostics` and treat low-confidence output as such. See the project repository for architecture, benchmarks, and model limitations.
