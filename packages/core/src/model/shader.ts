import source from "./kernel.wgsl?raw";
import { weights } from "./weights.gen.js";
import { buildShader } from "./shader-source.js";
import type { EncodedWeights } from "./decode.js";

export function shader(nativeHalf: boolean, model: EncodedWeights = weights) {
  return buildShader(source, model, nativeHalf);
}
