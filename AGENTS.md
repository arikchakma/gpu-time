# Project context

`gpu-time` is a pnpm workspace. Its layout follows [gpu-lexer](https://github.com/vercel-labs/gpu-lexer). Keep new files consistent with that layout and its kebab-case naming.

## Layout

- `packages/core` — the publishable `gpu-time` package: library source, WGSL kernel, calendar resolver, build, and unit tests. It has zero runtime dependencies. Keep it that way.
- `packages/training` — the model pipeline. `torch/` holds Python (a uv project) and `src/` holds TypeScript drivers. `data/gold/` tracks evaluation corpora and `data/synth/` holds generated data, which Git ignores. `active/` holds the promoted report and parity fixtures. `runs/` and `exports/` hold reports and source snapshots. Checkpoints stay local and ignored.
- `packages/benchmark` — size, browser performance, and cross-library comparisons. It measures the built `packages/core/dist`, never the source.
- `apps/website` — the public Astro site.
- `video` — ManimGL explainer source, with the storyboard in `scenes.md`.

## Validation

```sh
pnpm install
pnpm test           # core tests, authored English, benchmark utils, website checks
pnpm build:core     # emits packages/core/dist
pnpm size:gate      # strict 50,000-byte Brotli release limit
pnpm test:browser   # real WebGPU parity and packaged-shader check
pnpm benchmark      # full benchmark, writes packages/benchmark/results/
```

Node 24 or later runs TypeScript directly through `--experimental-strip-types`. Type stripping does not rewrite `./foo.js` to `foo.ts`, so a relative import in a script run this way must use an explicit `.ts` extension. A script that imports `packages/core/src` directly runs under `tsx` instead, because core's own internal `.js` specifiers make stripping impossible. See `video/render.sh`.

Always call Python through `uv`. Three separate Python environments exist by design: `packages/training/.venv`, `packages/benchmark/.venv`, and `video/.venv`.

## Rules

- Do not lower a release gate. The Brotli budget is 50,000 bytes and `pnpm size:gate` blocks CI.
- Read every score from `packages/training/active/export-report.json`. Never quote a score from this file or from memory. Generated scores share rendering families with training, so they are not language accuracy. See `MODEL_CARD.md`.
- Run `pnpm test` before you believe any promotion. `scoreboard.ts` does not cover the `english-compatibility` and `recognizers-development` floors, and a promotion once shipped that failed the Chrono floor.
- Score a built package with `packages/training/src/scoreboard.ts` instead of one evaluator at a time. A gain on one axis often hides a loss on another.
- Never train on the runtime parser's own output. Supervision comes from the generators in `packages/training/torch/`.
- Accept a teacher label only when the compiler produces the schedule the label claims. Never accept it on the teacher's word. `split-real.ts` reads the files under `data/teacher/` as authored sources and repeats each one `--authored-copies` times, 4 by default.
- Check a hard negative against the model's features, not against the generated string. The tokenizer splits `2027.06.24` into five tokens, and the padding survives as one number bucket. The model learned that a dotted run in prose is filler, and it stopped reading real dates. See `torch/test_negatives.py`.
- Keep `natural.py::RESERVED` unreachable from the training carrier grammar. Those surrounding phrases must stay absent from training.
- Keep timezone out of the model. Calendar arithmetic has exact answers, so resolve it in TypeScript.
- Preserve the benchmark evaluation corpora. `pnpm benchmark` reuses them unless you pass `--refresh-corpus`. A changed training renderer must not silently change comparison inputs.
- Do not hand-edit `packages/core/src/model/weights.gen.ts`. The training export generates it and hash-verifies it against `export-report.json`.
- The release gates tolerate seed noise. A group fails only when chance explains the loss with a probability under one in twenty. A group under ten examples warns instead of failing.

## Training

Train a warm run with the flags that keep the current tensor shapes:

```sh
uv run --project . python torch/train.py \
  --storage f32 --feature-rows 580 --layers 2 --transitions \
  --init runs/<promoted>/best.pt \
  --distill runs/<promoted>/best.pt --distill-alpha 0 --distill-beta 5 --distill-lambda 0.05 \
  --risk-lambda 0.005 --risk-margin 4 \
  --real packages/training/data/real/real-train.jsonl \
  --samples 60000 --epochs 40 --save-epochs
```

- `--storage f32 --feature-rows 580 --layers 2 --transitions` holds the shipped shapes. The defaults use f16 and one layer.
- `--init` warm-starts from the promoted checkpoint. Measured on 15 September 2026, a cold start answered 26 of the 37 reported failures against a warm run's 15. It also dropped the Chrono comparison from 74 to 67, which fails `pnpm test`. Choose deliberately. Do not cold start by accident.
- `--distill` holds the promoted model's answers. Without it, a run that learns a new family flips unrelated cases the promoted model already answers. `architecture.md` records the loss and the paper.
- `--risk-lambda` trains on whole sequences as well as tokens, and only moves sequences the decoder gets wrong. Keep lambda near 0.005, because the penalty swamps `crf_nll` above roughly 0.01.
- `--real` adds labelled real English. Rebuild that file with `pnpm --filter @gpu-time/training harvest`. Without it the model can only learn the generator, which is its own ceiling.
- `--save-epochs` writes every epoch. Find the releasable checkpoint by sweeping all of them. Chat varies by 17 cases between neighbouring epochs at one seed, and `best.pt` selects on validation and once picked noise.

## History

The current model, public API, and performance numbers replace an earlier implementation. Superseded training runs and exports were untracked during the monorepo restructure and remain recoverable from Git history.
