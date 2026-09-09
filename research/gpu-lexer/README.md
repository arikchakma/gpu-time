# gpu-lexer runtime study

Inspected the [live demo](https://gpu-lexer.vercel.app/) and the published
[`gpu-lexer@0.0.2` package](https://registry.npmjs.org/gpu-lexer/-/gpu-lexer-0.0.2.tgz)
on September 9, 2026. The linked X post returned 403, and the expected
`vercel-labs/gpu-lexer` GitHub repository returned 404. The npm package contains
the runtime, declarations and package metadata; it does not contain the trainer.

## What the browser downloads

The initial load fetches the app's JavaScript and CSS, a font, and a React source
file used as an example. A separate JavaScript chunk contains the model and GPU
runtime. There is no separate model binary or inference API call in this capture.
The weights in that live chunk exactly match the npm package's encoded weights.
Their decoded float32 bytes also match the observed WebGPU weight-buffer upload
byte for byte, verified by SHA-256 in `manifest.json`.

- `network.json`: observed requests and their resource types.
- `manifest.json`: source URLs, checksums, versions and verification scope.
- `runtime.js` and `runtime.d.ts`: unmodified published runtime and public API.
- `model.json`: extracted encoded weights, tensor offsets and scales.
- `model.f32.bin`: those weights decoded as 41,321 little-endian float32 values.

## The actual contract

```js
import { parse } from 'gpu-lexer';
const spans = await parse(source);
// [{ type: 'keyword', start: 0, end: 6 }, ...]
```

The model predicts nine token classes. The runtime combines adjacent predictions
of the same class into spans. It does not construct an AST. Source offsets are
preserved, including whitespace spans.

## Implementation details worth reusing

1. One shared tokenizer creates compact numeric features for words, whitespace,
   newlines and symbols. No per-language grammar is downloaded at inference time.
2. One contextual model predicts token classes. The neural network contains
   feature embeddings, local context, bidirectional state and whole-file context.
   Its public output remains simple despite those internal operations.
3. Weights use signed int6 values, encoded as one alphabet character per weight,
   with a scale per tensor. They are decoded once into GPU-ready float32 values.
4. Calls made together share a queued GPU submission; each input retains its own
   context and offsets. Token arrays and GPU buffers are reused.
5. A lazy shared runtime backs the single public `parse()` function. Initialization
   and batching stay inside the library rather than becoming caller setup.
6. The demo reports agreement with Shiki and describes the evaluation's scope.
   Agreement between labels is not proof of exact syntax or parser correctness.

The extracted weights classify programming-language syntax. For gpu-time, the
same approach means training temporal labels and returning useful spans. Dates,
timezone policy and recurrence expansion can be separate consumer responsibilities.
The precise training procedure cannot be verified from this published runtime.

The package declares the MIT license. These files are reference artifacts and
are not included in gpu-time's published `dist` files.
