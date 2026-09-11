# gpu-time

A compact neural parser for English schedules. One small trained model reads a natural-language time expression and returns concrete dates, time ranges, and RFC 5545 recurrence rules. The public API returns dates and rules without internal token labels or syntax trees.

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

`parse(text, context)` and `parseMany(texts, context)` are the convenience entry points. `context` must carry a `reference` instant and a `timeZone`; an unknown timezone rejects the call. The result holds `occurrences` (ISO `start`, optional `end`, `allDay`), `rrules`, `truncated`, `diagnostics`, the `backend` that ran, and `timings`. Diagnostics report known problems, but model errors can still produce incorrect dates.

For a reusable instance or explicit backend selection, use `defineParser({ backend })` and release its GPU resources with `dispose()`:

```js
import { defineParser } from "gpu-time";

const parser = await defineParser({ backend: "webgpu" });
const results = await parser.parseMany(texts, context);
parser.dispose();
```

Automatic mode tries WebGPU at 32 inputs or 512 tokens per batch. Smaller batches use the CPU. If WebGPU fails in automatic mode, the parser uses CPU and reports a `fallbackReason`. Explicit `backend: "webgpu"` requests reject on failure. GPU calls reuse the device, pipelines, and weights.

The model can return incorrect dates, even without a diagnostic. Before you use a result, make sure that its dates match the intended schedule. See the project repository for architecture, benchmarks, and model limitations.