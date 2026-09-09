# gpu-time

A small trained model that reads natural-language time expressions and returns
actual dates, time ranges and recurrence rules. Inference runs locally on CPU or
WebGPU. The caller supplies the reference instant and timezone.

The public API returns results directly. There is no AST or token-label step for
consumers. Calendar normalization stays separate from neural inference internally.

## Use

```js
import { parse } from "gpu-time";

const result = await parse("Sat Sun 1pm-8pm Mon 10pm-12am", {
  reference: "2026-09-09T12:00:00+06:00",
  timeZone: "Asia/Dhaka",
  limit: 12,
});

console.log(result.occurrences);
// Saturday and Sunday: 13:00–20:00
// Monday: 22:00–Tuesday 00:00
console.log(result.rrules);
console.log(result.diagnostics);
```

`occurrences` contains ISO start/end strings and an `allDay` flag. Explicit
recurrence produces a bounded preview plus RFC 5545 properties in `rrules`.
`truncated` indicates that more occurrences exist beyond the preview. Invalid
expressions return diagnostics rather than fabricated dates. Invalid caller
context, such as an unknown timezone, rejects the call.

Use `parseMany(texts, context)` for several inputs. For explicit backend selection
or a reusable instance, use `await createParser({ backend: "webgpu" })`, then
`parser.parse(text, context)` and `parser.dispose()` when finished.

The package is not published yet; local builds are in `dist/index.js`.
The playground runs at port 5174 and displays dates and the returned result.

## Interpretation

- Bare weekday lists are upcoming one-off dates. Explicit recurrence and
  conventional day groups such as weekdays produce repeated occurrences.
- Each time window applies to the days in its group. An earlier end clock crosses
  midnight.
- Missing AM/PM uses the partner endpoint where possible: `9am to 5` is 09:00–17:00.
- Timezone, daylight-saving transitions, reference dates and expansion limits are
  handled by calendar code. They are not model inputs.
- `reference` is an ISO string, for example `new Date().toISOString()`.
- `until` restricts a preview. Without it, recurrence has a one-year preview horizon.
- Optional context policies control bare weekdays, next weekdays and week starts.
  `dateOrder` is a parser option for ambiguous numeric dates.

The current stage is correctness. Efficiency, speed and size come afterward.
The model is trained, but broader accuracy and release requirements remain open.

## Results

The [benchmark report](bench/results/REPORT.md) contains measured browser and
Python parsing times, bundle sizes, and actual outputs for all 25 adversarial
inputs. Different parsers return different structures, so speed does not imply
equivalent capability.

The exported model passes the [adversarial development checks](bench/results/model-structure.json).
These fixtures influenced implementation and training. They are not an untouched
accuracy test. [WebGPU parity](training/parity-gpu.json) checks 10,000 sequences
against CPU inference and 512 sequences directly against PyTorch.

The report also includes independent Microsoft date/time specifications. Current
agreement is far below the release target. Its reserved test split is not used
for model selection. The separate generated-schedule test shares rendering
families with training and must not be presented as independent language accuracy.

The [model card](training/export-report.json) includes the checkpoint hash,
training ancestry, weight size, and measured token metrics.
The [completion audit](PROJECT_STATUS.md) lists the remaining release work.

## Develop and reproduce

The development tools are Node.js, Bun, uv, Python 3.13, and Chrome with WebGPU.

```sh
npm ci
npm run dev
npm test
npm run check
npm run test:browser
npm run bench
```

`npm run dev` opens the workbench server on port 5174. Browser parity and the
benchmark start their own temporary servers. The benchmark installs its pinned
Python dependencies in `bench/.venv` and writes `bench/results/REPORT.md` and
`summary.json`.

```sh
# Build even when investigating a missed size target.
bun scripts/build.ts --report-only

# Strict release build: fails above 30,000 bytes Brotli.
npm run build

# Train from generated supervision.
npm run train -- --run experiment --storage f32 --batch 1024

# Export a trained checkpoint, then rebuild and evaluate it.
uv run --project training python training/export.py \
  --checkpoint training/runs/experiment/best.pt
bun scripts/build.ts --report-only
npm run evaluate
```

Training uses generated labeled spans, not labels from the runtime parser.
Current semantic generation covers 26 phrase families. Run folders contain checkpoints,
measured reports, and source snapshots. Large training data and checkpoints are
kept outside the distribution bundle.
