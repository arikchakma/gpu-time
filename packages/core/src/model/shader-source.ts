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
  // A model with fewer layers has no later block; alias each missing one onto
  // the block before it, so the layer loop compiles whatever the weights hold.
  for (const name of ["GATE", "CANDIDATE", "COMBINE"])
    for (const kind of ["WEIGHT", "BIAS"])
      for (const [later, earlier] of [
        ["2", ""],
        ["3", "2"],
      ])
        if (!offsets.has(`${name}${later}_${kind}_OFFSET`))
          offsets.set(
            `${name}${later}_${kind}_OFFSET`,
            offsets.get(`${name}${earlier}_${kind}_OFFSET`)!,
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
