# Project context

`gpu-time` is a pnpm workspace. Its structure follows [gpu-lexer](https://github.com/vercel-labs/gpu-lexer); keep new files consistent with that layout and its kebab-case naming.

## Layout

- `packages/core` — the publishable `gpu-time` package. Library source, WGSL kernel, calendar resolver, build, and unit tests. **Zero runtime dependencies; keep it that way.**
- `packages/training` — `torch/` for Python (uv project), `src/` for TypeScript drivers, `data/gold/` for tracked evaluation corpora, `data/synth/` for generated data (ignored), `active/` for the promoted model report, provenance, and parity fixtures, `runs/` and `exports/` for selected current and historical reports and source snapshots. Checkpoints remain local and ignored.
- `packages/benchmark` — size, browser performance, and cross-library comparisons. Measures the **built** `packages/core/dist`, never the source.
- `apps/website` — the Astro site. This is the public-facing site.
- `video` — ManimGL explainer source, storyboard in `scenes.md`.

## Validation

```sh
pnpm install
pnpm test           # core tests, authored English coverage, benchmark utils, website checks
pnpm build:core     # emits packages/core/dist
pnpm size:gate      # strict 50,000-byte Brotli release limit
pnpm test:browser   # real WebGPU parity and packaged-shader check
pnpm benchmark      # full benchmark, writes packages/benchmark/results/
```

Node 24+ runs TypeScript directly via `--experimental-strip-types`; `bun` is gone. Node's type stripping does **not** rewrite `./foo.js` to `foo.ts`, so relative imports in scripts run this way must use explicit `.ts` extensions. The one exception is a script that imports `packages/core/src` directly, where core's own internal `.js` specifiers make that impossible — those run under `tsx` instead (see `video/render.sh`).

Python is always invoked through `uv`. There are three separate Python environments by design: `packages/training/.venv` (a uv project), `packages/benchmark/.venv`, and `video/.venv`.

## Rules

- Do not lower an existing release gate. The Brotli budget is 50,000 bytes; `pnpm size:gate` blocks CI, so a change that breaches it fails the build rather than being waived.
- Preserve benchmark evaluation corpora. `pnpm benchmark` reuses them unless `--refresh-corpus` is passed explicitly. Changing a training renderer must not silently change comparison inputs.
- Never train on the runtime parser's own output. Supervision comes from the generators in `packages/training/torch/`.
- Export is gated. Reserved-carrier labels and boundaries must improve, or tie an already perfect baseline, with no family regression. Gold schedule counts must not regress in any set or family, and bare expressions must not regress. Compare matching frozen corpora with the deployed decoder. Use `--force` only deliberately; it records what it overrode.
- Keep `natural.py::RESERVED` unreachable from the training carrier grammar. Those surrounding phrases must remain absent from training.
- Timezone stays out of the model. Calendar arithmetic has exact answers; resolve it in TypeScript.
- The historical `terse-f32` score is **993/1000 exact schedules on unseen carriers**. The current two-layer export records **1000/1000 exact Viterbi labels and boundaries** and **56/56 authored English regressions**. Earlier CRF reports used argmax for this metric; remeasure both models with the deployed decoder before comparing. Generated scores share rendering families with training and must not be quoted as language accuracy. See `MODEL_CARD.md`.
- Train with `--storage f32 --feature-rows 580 --layers 2 --transitions --init runs/<promoted>/best.pt` to preserve the current model's tensor shapes. The defaults use f16, one layer, and a cold start. A cold start or incompatible feature shape can lose learned forms.
- Add `--distill runs/<promoted>/best.pt --distill-alpha 0 --distill-beta 5 --distill-lambda 0.1` to any warm-started run. Without it a run that learns a new family flips unrelated cases the promoted model already answers; with it the update held every gold and recognizers family. See `architecture.md` for the loss and the paper.
- Add `--risk-lambda 0.005 --risk-margin 4` to train on whole sequences as well as tokens. It only moves sequences the decoder gets wrong. Keep lambda near 0.005; the penalty is averaged per wrong sequence and swamps `crf_nll` above roughly 0.01.
- The release gates tolerate seed noise. A group fails only when losing that many examples by chance is under one in twenty, groups under ten examples warn instead of failing, and the generated corpora are graded on the schedule the built package returns rather than on token labels. Label drift is still reported as a warning.
- Add `--real packages/training/data/real/real-train.jsonl` to train on labelled real English alongside the generated corpus. Rebuild it with `pnpm --filter @gpu-time/training harvest`. Without it the model can only learn the generator, which is its own ceiling.
- `packages/training/src/scoreboard.ts` scores a built package on every benchmark at once. Use it instead of one evaluator at a time; a gain on one axis routinely hides a loss on another.
- `packages/core/src/model/weights.gen.ts` is generated by the training export and hash-verified against `packages/training/active/export-report.json`. Do not hand-edit it.

## History

The retired implementation is on the `archive/legacy-gpu-time` branch. Its model, public AST, and performance numbers do not describe the current library. Superseded training runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.
