import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { initialize, minify } from "wgslender";
import type { TsdownPlugin } from "tsdown";
import { buildShader } from "../src/model/shader-source.ts";
import type { EncodedWeights } from "../src/model/decode.js";

const weightsModule = /[/\\]model[/\\]weights\.gen\.ts$/;
const shaderModule = /[/\\]model[/\\]shader\.ts$/;

/** f16 storage ships two variants, with and without native half support. */
async function compileShaders(
  kernelPath: string,
  weights: EncodedWeights,
): Promise<string[]> {
  await initialize();
  const kernel = await readFile(kernelPath, "utf8");
  const variants = weights.storage === "f32" ? [false] : [false, true];
  return variants.map((nativeHalf) => {
    const result = minify(buildShader(kernel, weights, nativeHalf), {
      keepNames: ["classify"],
      mangleExternalBindings: true,
    });
    if (result.errors.length) throw new Error(JSON.stringify(result.errors));
    return result.code;
  });
}

function shaderSource(shaders: string[]): string {
  const [standard, nativeHalf] = shaders;
  const body = nativeHalf
    ? `nativeHalf ? ${JSON.stringify(nativeHalf)} : ${JSON.stringify(standard)}`
    : JSON.stringify(standard);
  return `export function shader(nativeHalf) { return ${body}; }`;
}

/**
 * Replaces two modules that also work outside the bundle: `shader.ts` reads
 * `kernel.wgsl?raw` and specializes at runtime, which is what tests and the
 * training scripts use. The bundle takes precomputed constants instead, so the
 * WGSL text and the full weight export never ship. Removing this does not fall
 * back to the dev path: rolldown cannot resolve a `?raw` import.
 */
export async function inlineModel(
  packageRoot: string,
  weights: EncodedWeights,
  weightsPath?: string,
): Promise<TsdownPlugin> {
  const shaders = await compileShaders(
    join(packageRoot, "src/model/kernel.wgsl"),
    weights,
  );
  return {
    name: "gpu-time:inline-model",
    load: (id: string) => {
      if (shaderModule.test(id)) return shaderSource(shaders);
      // A variant build points the runtime at another weight set. Without it
      // the bundle pairs the shipped weights with a specialized shader: it
      // builds and tests clean, then mistags every input.
      if (weightsPath && weightsModule.test(id) && resolve(weightsPath) !== id)
        return `export * from ${JSON.stringify(resolve(weightsPath))};`;
    },
  };
}
