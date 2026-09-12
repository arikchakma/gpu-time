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
  const offsets = new Map(
    model.segments.map((segment) => [
      `${segment.name.toUpperCase()}_OFFSET`,
      segment.offset,
    ]),
  );
  // A single-layer model has no second block; alias its offsets onto the first
  // so the layer loop compiles without branching on which tensors exist.
  for (const name of ["GATE", "CANDIDATE", "COMBINE"])
    for (const kind of ["WEIGHT", "BIAS"])
      if (!offsets.has(`${name}2_${kind}_OFFSET`))
        offsets.set(
          `${name}2_${kind}_OFFSET`,
          offsets.get(`${name}_${kind}_OFFSET`)!,
        );
  const constants = [...offsets]
    .map(([name, offset]) => `const ${name}: u32 = ${offset}u;`)
    .join("\n");
  return `${nativeHalf ? "enable f16;\n" : ""}${constants}
const BOUNDARY_THRESHOLD: f32 = ${model.boundaryThreshold ?? 0};
const COMPACT_FEATURES: bool = ${model.featureRows === 324};
const SCAN_LAYERS: u32 = ${model.layers ?? 1}u;
const ROLE_CLASSES: u32 = ${model.roleClasses}u;
const OUTPUTS: u32 = ${model.roleClasses + 1}u;
${source.replaceAll("STATE_TYPE", nativeHalf ? "f16" : "f32").replace("ROUND_BODY", roundBody)}`;
}
