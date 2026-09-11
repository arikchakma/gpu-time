import source from "./kernel.wgsl?raw";
import { weights } from "./weights.gen.js";
import { buildShader } from "./shader-source.js";

export function shader(nativeHalf: boolean): string {
  return buildShader(source, weights, nativeHalf);
}
