import type { EncodedWeights } from "./decode.js";

/** Resolve model constants before shader compilation or build-time minification. */
export function buildShader(
  source: string,
  model: EncodedWeights,
  nativeHalf: boolean,
): string {
  const roundBody =
    model.storage === "f32"
      ? "return value;"
      : nativeHalf
        ? "return f32(f16(value));"
        : "return unpack2x16float(pack2x16float(vec2<f32>(value, 0.0))).x;";
  const constants = model.segments
    .map(
      (segment) =>
        `const ${segment.name.toUpperCase()}_OFFSET: u32 = ${segment.offset}u;`,
    )
    .join("\n");
  return `${nativeHalf ? "enable f16;\n" : ""}${constants}
const BOUNDARY_THRESHOLD: f32 = ${model.boundaryThreshold ?? 0};
const COMPACT_FEATURES: bool = ${model.featureRows === 324};
${source.replaceAll("STATE_TYPE", nativeHalf ? "f16" : "f32").replace("ROUND_BODY", roundBody)}`;
}
