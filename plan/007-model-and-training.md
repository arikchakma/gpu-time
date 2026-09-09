# 007 — Model and training

Current workflow correction: do not respond to every end-to-end failure with a
fine-tuning run. First distinguish a supervision error, a composition error,
a resolver-policy difference, and a genuine model error. The primary acceptance
gate is the resulting AST and resolved values. Token and boundary metrics are
diagnostic; the training script's `best.pt` is only a candidate until it passes
end-to-end checks. Size and speed optimization follow correctness.

Goal: a sequence tagger mirroring gpu-lexer's design, sized for short inputs, trained on 006's data, exported as int6 with exact parity to the browser kernels.

Effort: 3 days (model.py + train.py 1.5, QAT + export + parity 1.5). Training run: ~10–20 min on the M4 Max per config.

## 1. Architecture (config M, H = 32 = one GPU lane per hidden unit)

| Stage | Computation | Params |
|---|---|---|
| Feature-bag embedding | sum of 10 rows from a 580×32 table (fields of 004 §1) | 18,560 |
| Token encoder | bias + 5-tap per-lane conv (positions −2..+2) + per-lane weights for prev/next non-space token → tanh | 256 |
| Bidirectional diagonal linear RNN | `a=σ(Wz h+bz)`, `b=(1−a)·tanh(Wy h+by)`, `s_t=a·s_{t−1}+b`, both directions, then `tanh(h + W[32×64]·[fwd;bwd] + b)` | 4,192 |
| Global context | mean-pool of the combined states → `g = σ(Wg p + bg)`, token ctx = `g ⊙ p` (cheap stand-in for gpu-lexer's tree; inputs are short) | 1,056 |
| Head | gate 16 = σ(W16×64 [tok;ctx]); hidden 64 = tanh(W64×80 [tok;ctx;gate]); logits 40 labels + 1 clauseStart | 1,040 + 5,184 + 2,665 |
| **Total** | | **32,953** |

Config S (drop hash2, halve hash1 → 324 rows): 24,761 params. Config L (H = 64, 64 lanes): ≈ 95K params. Start with M; try S only if M is well under budget and accuracy holds.

Space tokens are embedded (they carry `spaceBefore/After` context) but excluded from the loss and from the head at inference, as in gpu-lexer.

## 2. Weights on the wire

int6 zig-zag, one base64-alphabet char per weight, per-tensor fp32 scale: 32,953 chars ≈ 24.7 KB raw in the bundle → ≈ 14 KB brotli (gpu-lexer measured 0.50 B/param). Decode to Float32Array at init (< 1 ms).

## 3. Training recipe (`training/train.py`, PyTorch, MPS)

- Data: streaming shards from 006, fresh seed per epoch; batch 512 × 64 tokens; 20 epochs ≈ 54M tokens.
- Loss: cross-entropy on labels (non-space tokens, label smoothing 0.05) + BCE on clauseStart, weighted 1 : 0.5.
- Optimizer: AdamW lr 3e-3, weight decay 0.01, cosine to 1e-4, 500 warmup steps, grad clip 1.0.
- **QAT** from epoch 14: fake-quantize every weight tensor to int6 with a per-tensor scale (straight-through estimator); simulate f16 rounding on the stored per-token states (`x.half().float()`), matching the kernel's `f32(f16(x))`.
- Early stopping on `heldout-templates` token accuracy; keep best.
- `model.py` is written so each op maps 1:1 to a line in `kernel.wgsl` and `cpu.ts` (same names, same order). No layers that the kernel does not have.

## 4. Export (`training/export.py`)

Writes `src/model/weights.gen.ts`: `{ q: '<int6 string>', scales: number[], segments: [[offset, count], …] }` in the fixed order the kernels read, plus `training/report.json` (seed, config, params, per-set metrics, label confusion top-10). Also dumps `training/parity.npz`: 512 sequences with features, per-token logits, and labels for `tests/parity.test.ts`.

## 5. Metrics (report.json)

| Set | Metric | Target |
|---|---|---|
| heldout-templates | token accuracy / clauseStart F1 / **exact schedule match** after compile | ≥ 99% / ≥ 0.98 / ≥ 95% |
| gold-labels + gold-families | exact schedule match | ≥ 95% |
| gold-adversarial | fully correct | ≥ 22/25 |
| paraphrase-eval | exact schedule match | ≥ 85% (this is the "real language" number; report it honestly) |
| external (resolved values) | agreement excluding `policy-diff` | ≥ 85% Recognizers, ≥ 90% Duckling, span F1 ≥ 0.9 PATE |
| Negatives | false expressions per 1,000 prose sentences | ≤ 5 |

Error analysis loop: `bun training/errors.ts` prints the top failing (template, label) pairs → fix generator coverage or label rule → regenerate → retrain. Expect 3–5 loops.

## 6. Acceptance criteria

- `report.json` committed with params = 32,953 and all targets met or explicitly marked missed.
- `cpu.ts` reproduces exported logits within 1e-3 on all 512 parity sequences; argmax identical.
- Bundle weights ≤ 16 KB brotli.
