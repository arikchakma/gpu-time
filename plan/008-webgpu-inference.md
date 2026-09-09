# 008 — WebGPU inference and CPU fallback

Goal: run the 007 model in the browser: one WGSL kernel for batches of expressions, gpu-lexer-style microtask batching, and an identical-output CPU path.

Effort: 3 days.

## 1. Kernel design (`src/model/kernel.wgsl`, one entry point)

gpu-lexer needs 7 kernels and a cross-chunk tree because source files are long. Our inputs are ≤ 128 tokens, so **one workgroup handles one expression end to end**:

- Workgroup = 32 threads = 32 hidden lanes. `@workgroup_size(32)`, one dispatch of N workgroups for N expressions (2D split above 65,535).
- Steps inside the workgroup: embed all tokens (each lane sums its column over the 10 feature rows) → encoder → forward scan (sequential loop over ≤ 128 tokens; cheap) → backward scan → combine → mean-pool (workgroup shared reduce) → head (the two small matmuls use shared memory; 8 tokens in parallel × ceil(n/8) rounds as gpu-lexer does) → `atomicOr` label byte + clauseStart bit into the packed output.
- Per-token intermediates live in a storage buffer (f16, 32 × n) to stay clear of the 16 KB workgroup-memory limit; the head's scratch (≤ 3 KB) is in workgroup memory.
- Weights: one storage buffer (≈ 132 KB f32), uploaded once. Uniform: `{streams, tokens}`. Stream table: `{tokenStart, tokenCount}` per expression.
- `enable f16` when `shader-f16` is available; otherwise the source is rewritten `f16→f32` at pipeline creation (gpu-lexer's trick). Compute is always f32.

## 2. Runtime (`src/model/gpu.ts`)

- `createParser({backend})`: request adapter/device, decode weights, create pipeline; ≤ 30 ms cold.
- Batching: all `parse()`/`parseMany()` calls in the same microtask are appended to one pending batch (stream table), flushed with one `writeBuffer` + `dispatch` + `copyBufferToBuffer` + `mapAsync`; also flushed early at 16K tokens. Each expression is its own stream, so context never leaks.
- Buffers grow by powers of two, are cached, bind groups rebuilt lazily; check `maxBufferSize`.
- Readback: labels 4 per u32; clauseStart bits in a parallel bitset buffer.
- Device loss → recreate once, then fall back to CPU with `fallbackReason`.

## 3. CPU path (`src/model/cpu.ts`)

Plain Float32Array loops, same op order as the kernel, `Math.f16round` on stored states to match f16 storage. ≈ 150 lines. Used when WebGPU is unavailable (Firefox/Safari without the flag, Node, SSR) and by default for small single inputs because a GPU round-trip costs ~0.2–1 ms while the CPU path costs ~20–50 µs for 10 tokens.

Backend policy (`auto`): GPU when available **and** the pending batch has ≥ 32 expressions or ≥ 512 total tokens; else CPU. The user can force either. `result.backend` reports the truth. This is the honest framing: like gpu-lexer, the GPU wins on large inputs (bulk parsing, tagging every time expression in a document), not on one short string.

## 4. Tests

- `tests/parity.test.ts` (Playwright, Chrome): GPU labels === CPU labels on 10K generated inputs incl. the f16-rewrite path; GPU logits within 1e-2 of CPU.
- `cpu.ts` vs PyTorch dump (007 §6).
- Batching: 1,000 concurrent `parse()` calls → exactly one submit.
- Device-loss simulation → CPU fallback with reason.

## 5. Acceptance criteria

- Zero label mismatches CPU vs GPU on the parity set.
- Cold start ≤ 30 ms, batched throughput ≥ 100K expressions/s on the M4 Max in Chrome, single CPU parse ≤ 50 µs.
- gpu runtime + WGSL ≤ 5 KB brotli.
