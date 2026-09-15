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
- Quote scores from `packages/training/active/export-report.json`, never from this file or from memory. The current export (`runs/sweep/epoch-33`) records **973/1000 reserved-carrier schedules**, **981/1000 bare expressions**, **71/71 authored English**, **74/85 Chrono comparison**, and **299/331 chat**. The older **1000/1000** figures were measured before `compile.ts` changed and were stale for days without anyone noticing; re-measure both models in the same run before comparing. Generated scores share rendering families with training and must not be quoted as language accuracy. See `MODEL_CARD.md`.
- Train with `--storage f32 --feature-rows 580 --layers 2 --transitions --init runs/<promoted>/best.pt` to preserve the current model's tensor shapes. The defaults use f16, one layer, and a cold start. Measured on 15 Sep 2026: a cold start learns the corpus better and answers 26 of the 37 reported user failures against a warm run's 15, but it forgets forms the warm chain accumulated and drops the Chrono comparison from 74 to 67, which fails `pnpm test`. The anchor that holds the gates is the same anchor that costs real English. Choose deliberately; do not cold start by accident.
- Add `--samples 60000 --epochs 40 --save-epochs`. Chat varies by 17 cases and authored English by 3 between neighbouring epochs of one run at one seed, so the releasable checkpoint is found by sweeping, not by trusting `best.pt`, which selects on validation and picked epoch 10 out of noise. At 60,000 rows every terse-syntax gold set held, both carrier gates broke nothing, and real English gained 79 cases. The rows we removed were copies of shapes the corpus already held. Raise the epochs so the model still sees a similar number of tokens. Nobody has swept this ratio.
- Add `--distill runs/<promoted>/best.pt --distill-alpha 0 --distill-beta 5 --distill-lambda 0.05` to any warm-started run. Without it a run that learns a new family flips unrelated cases the promoted model already answers; with it the update held every gold and recognizers family. See `architecture.md` for the loss and the paper.
- Add `--risk-lambda 0.005 --risk-margin 4` to train on whole sequences as well as tokens. It only moves sequences the decoder gets wrong. Keep lambda near 0.005; the penalty is averaged per wrong sequence and swamps `crf_nll` above roughly 0.01.
- The release gates tolerate seed noise. A group fails only when losing that many examples by chance is under one in twenty, groups under ten examples warn instead of failing, and the generated corpora are graded on the schedule the built package returns rather than on token labels. Label drift is still reported as a warning.
- Add `--real packages/training/data/real/real-train.jsonl` to train on labelled real English alongside the generated corpus. Rebuild it with `pnpm --filter @gpu-time/training harvest`. Without it the model can only learn the generator, which is its own ceiling.
- `packages/training/data/teacher/teacher.jsonl` holds written sentences, so Git tracks it. Git ignores `data/real/`. `split-real.ts` reads it as the `teacher` source and repeats it `--authored-copies` times, 4 by default. Agreement harvesting cannot reach what chrono-node cannot read, which is why `every <month>` had no correct label. Propose labels with a teacher. Accept them with the compiler, never with the teacher alone. See `todos/14-09-2026-teacher-labelling.md`.
- `scoreboard.ts` does not cover every gate. `english-compatibility` and `recognizers-development` have their own floor files and are only reached by `pnpm test`. Nine rounds of scoring on 15 Sep 2026 missed the Chrono floor and promoted a model that failed it. Run `pnpm test` before believing any promotion.
- A hard negative must be checked against the model's FEATURES, not against the generated strings. The padded stamp `2027.06.24` cannot be rendered by the positive grammar, which is why it looked safe, but the tokenizer splits it into five tokens and the padding survives only as one number bucket. The model learned "a dotted run in prose is filler" and stopped reading real dates. See `torch/test_negatives.py`.
- `packages/training/src/scoreboard.ts` scores a built package on every benchmark at once. Use it instead of one evaluator at a time; a gain on one axis routinely hides a loss on another.
- `packages/core/src/model/weights.gen.ts` is generated by the training export and hash-verified against `packages/training/active/export-report.json`. Do not hand-edit it.

## History

The retired implementation is on the `archive/legacy-gpu-time` branch. Its model, public AST, and performance numbers do not describe the current library. Superseded training runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.
