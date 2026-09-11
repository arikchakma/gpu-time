export interface EncodedWeights {
  featureRows: number;
  roleClasses: number;
  storage?: "f16" | "f32";
  boundaryThreshold?: number;
  labels: readonly string[];
  q: string;
  segments: readonly {
    name: string;
    offset: number;
    length: number;
    scale: number;
    rowScales?: string;
    shape: readonly number[];
  }[];
}

export function decodeWeights(
  encoded: EncodedWeights,
): Map<string, Float32Array> {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const codes = new Uint8Array(128).fill(255);
  for (let index = 0; index < alphabet.length; index++)
    codes[alphabet.charCodeAt(index)] = index;

  const values = new Float32Array(encoded.q.length);
  const tensors = new Map<string, Float32Array>();
  let offset = 0;
  for (const segment of encoded.segments) {
    if (
      segment.offset !== offset ||
      !Number.isFinite(segment.scale) ||
      segment.scale <= 0
    )
      throw new Error("Invalid model tensor metadata.");
    const rows = segment.rowScales?.length ?? 1;
    const width = segment.length / rows;
    if (!Number.isInteger(width) || rows < 1)
      throw new Error("Invalid model row scale.");
    for (let row = 0; row < rows; row++) {
      const exponent = segment.rowScales
        ? segment.rowScales.charCodeAt(row) - 65
        : 0;
      if (exponent < 0 || exponent > 16)
        throw new Error("Invalid model row scale.");
      const scale = segment.scale * 2 ** -exponent;
      const start = offset + row * width;
      for (let index = start; index < start + width; index++) {
        const code = codes[encoded.q.charCodeAt(index)];
        if (code === undefined || code > 63)
          throw new Error("Invalid quantized model data.");
        const value = code & 1 ? -(code + 1) / 2 : code / 2;
        values[index] = value * scale;
      }
    }
    tensors.set(segment.name, values.subarray(offset, offset + segment.length));
    offset += segment.length;
  }
  if (offset !== encoded.q.length)
    throw new Error("Model length does not match its tensor metadata.");
  return tensors;
}
