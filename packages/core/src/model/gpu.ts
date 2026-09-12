import { shader } from "./shader.js";
import { diagnostics, fullPrecision } from "./options.js";
import { weights } from "./weights.gen.js";
import { decodeWeights, type EncodedWeights } from "./decode.js";
import type { RawToken } from "../types.js";
import { viterbiDecode, type Predictions } from "./cpu.js";

interface ModelWeights extends EncodedWeights {
  storage?: "f16" | "f32";
}
interface BufferSlot {
  buffer: GPUBuffer;
  capacity: number;
}
const model: ModelWeights = weights;
const roles = model.roleClasses;
const outputs = roles + 1;
// ponytail: Viterbi runs here over the emissions the kernel already produces,
// not in WGSL. A workgroup-resident 40x40 chain would need a fifth state stage
// and a second pass; upgrade if the extra readback ever shows up in a profile.
const chain = model.transitions
  ? decodeWeights(model).get("transition")!
  : undefined;

export class GPUModel {
  readonly stats = { submissions: 0, recoveries: 0 };
  private device?: GPUDevice;
  private pipeline?: GPUComputePipeline;
  private weightBuffer?: GPUBuffer;
  private buffers = new Map<string, BufferSlot>();
  private group?: GPUBindGroup;
  private groupKey = "";
  private generation = 0;
  private stateBytes = 4;
  private closed = false;
  private lost = false;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private emulateF16: boolean) {}

  static async create(
    options: { emulateF16?: boolean } = {},
  ): Promise<GPUModel> {
    const runtime = new GPUModel(options.emulateF16 ?? false);
    await runtime.initialize();
    return runtime;
  }

  private async initialize(): Promise<void> {
    if (this.closed) throw new Error("The GPU model is disposed.");
    const adapter = await globalThis.navigator?.gpu?.requestAdapter();
    if (!adapter) throw new Error("WebGPU is unavailable.");
    const nativeHalf =
      !fullPrecision && !this.emulateF16 && adapter.features.has("shader-f16");
    const device = await adapter.requestDevice({
      requiredFeatures: nativeHalf ? ["shader-f16"] : [],
      requiredLimits: {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      },
    });
    try {
      if (this.closed) {
        throw new Error("The GPU model is disposed.");
      }
      const code = shader(nativeHalf);
      const module = device.createShaderModule({ code });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter(
        (message) => message.type === "error",
      );
      if (errors.length) {
        throw new Error(
          errors
            .map((message) => `${message.lineNum}: ${message.message}`)
            .join("\n"),
        );
      }
      if (this.closed) throw new Error("The GPU model is disposed.");
      const pipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "classify" },
      });
      if (this.closed) throw new Error("The GPU model is disposed.");
      const decoded = decodeWeights(model);
      const values = new Float32Array(model.q.length);
      for (const segment of model.segments)
        values.set(decoded.get(segment.name)!, segment.offset);
      const weightBuffer = device.createBuffer({
        size: values.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(weightBuffer, 0, values);

      this.device = device;
      this.pipeline = pipeline;
      this.weightBuffer = weightBuffer;
      this.stateBytes = nativeHalf ? 2 : 4;
      this.lost = false;
      this.buffers.clear();
      this.group = undefined;
      this.generation++;
      void device.lost.then(() => {
        if (this.device === device && !this.closed) {
          this.lost = true;
          this.device = undefined;
          this.buffers.clear();
        }
      });
    } catch (error) {
      device.destroy();
      throw error;
    }
  }

  inferMany(inputs: RawToken[][], debug = false): Promise<Predictions[]> {
    debug = diagnostics && debug;
    const result = this.queue.then(async () => {
      try {
        return await this.run(inputs, debug);
      } catch (error) {
        if (this.closed || !this.lost || this.stats.recoveries >= 1)
          throw error;
        // Retry the failed batch after one confirmed device loss. A shader,
        // validation or capacity error must not consume the recovery budget.
        return this.run(inputs, debug);
      }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private buffer(name: string, size: number, usage: number): GPUBuffer {
    const device = this.device!;
    if (
      size > device.limits.maxBufferSize ||
      (usage & GPUBufferUsage.STORAGE &&
        size > device.limits.maxStorageBufferBindingSize)
    ) {
      throw new RangeError(
        "The inference batch exceeds the GPU buffer limits.",
      );
    }
    const existing = this.buffers.get(name);
    if (existing && existing.capacity >= size) return existing.buffer;
    existing?.buffer.destroy();
    let capacity = 256;
    while (capacity < size && capacity <= device.limits.maxBufferSize / 2)
      capacity *= 2;
    if (capacity < size) capacity = Math.ceil(size / 4) * 4;
    const buffer = device.createBuffer({ size: capacity, usage });
    this.buffers.set(name, { buffer, capacity });
    this.generation++;
    return buffer;
  }

  private async run(
    inputs: RawToken[][],
    debug: boolean,
  ): Promise<Predictions[]> {
    if (this.closed) throw new Error("The GPU model is disposed.");
    if (this.lost) {
      if (this.stats.recoveries >= 1)
        throw new Error("The GPU device was lost again after recovery.");
      this.stats.recoveries++;
      await this.initialize();
    }
    const streams = inputs.filter((tokens) => tokens.length > 0);
    if (streams.some((tokens) => tokens.length > 128))
      throw new RangeError("A model stream supports at most 128 tokens.");
    const count = streams.reduce((total, tokens) => total + tokens.length, 0);
    if (!count)
      return inputs.map(() => ({
        labels: new Uint8Array(),
        clauseStarts: new Uint8Array(),
        scores: new Float32Array(),
      }));

    const features = new Uint32Array(count * 2);
    const streamTable = new Uint32Array(streams.length * 2);
    let offset = 0;
    streams.forEach((tokens, index) => {
      streamTable.set([offset, tokens.length], index * 2);
      tokens.forEach((token, position) =>
        features.set(token.features, (offset + position) * 2),
      );
      offset += tokens.length;
    });

    const device = this.device!;
    const packedBytes = Math.ceil(count / 4) * 4;
    const scoreBytes = count * 4;
    // Viterbi needs every emission, so a chained model always reads them back.
    const wantLogits = debug || chain !== undefined;
    const debugBytes = wantLogits ? count * outputs * 4 : 4;
    const stateSize = count * 32 * 4 * this.stateBytes;
    const sizes = [
      features.byteLength,
      streamTable.byteLength,
      16,
      this.weightBuffer!.size,
      stateSize,
      packedBytes,
      scoreBytes,
      debugBytes,
    ];
    const buffers = [
      this.buffer(
        "features",
        sizes[0],
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      ),
      this.buffer(
        "streams",
        sizes[1],
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      ),
      this.buffer(
        "parameters",
        sizes[2],
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      ),
      this.weightBuffer!,
      this.buffer("states", sizes[4], GPUBufferUsage.STORAGE),
      this.buffer(
        "labels",
        sizes[5],
        GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      ),
      this.buffer(
        "scores",
        sizes[6],
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      ),
      this.buffer(
        "debug",
        sizes[7],
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      ),
    ];
    const readbackSize =
      packedBytes + scoreBytes + (wantLogits ? debugBytes : 0);
    const readback = this.buffer(
      "readback",
      readbackSize,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    );
    const groupKey = `${this.generation}:${sizes.join(",")}`;
    if (!this.group || this.groupKey !== groupKey) {
      this.group = device.createBindGroup({
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({
          binding,
          resource: { buffer, size: sizes[binding] },
        })),
      });
      this.groupKey = groupKey;
    }

    device.queue.writeBuffer(buffers[0], 0, features);
    device.queue.writeBuffer(buffers[1], 0, streamTable);
    device.queue.writeBuffer(
      buffers[2],
      0,
      Uint32Array.of(count, streams.length, Number(wantLogits), 0),
    );
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(buffers[5], 0, packedBytes);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.group);
    const width = Math.min(65535, streams.length);
    pass.dispatchWorkgroups(width, Math.ceil(streams.length / width));
    pass.end();
    encoder.copyBufferToBuffer(buffers[5], 0, readback, 0, packedBytes);
    encoder.copyBufferToBuffer(
      buffers[6],
      0,
      readback,
      packedBytes,
      scoreBytes,
    );
    if (wantLogits)
      encoder.copyBufferToBuffer(
        buffers[7],
        0,
        readback,
        packedBytes + scoreBytes,
        debugBytes,
      );
    device.queue.submit([encoder.finish()]);
    this.stats.submissions++;
    await readback.mapAsync(GPUMapMode.READ);

    try {
      const mapped = readback.getMappedRange(0, readbackSize);
      const packed = new Uint8Array(mapped, 0, count);
      const margins = new Float32Array(mapped, packedBytes, count);
      const rawLogits = wantLogits
        ? new Float32Array(mapped, packedBytes + scoreBytes, count * outputs)
        : undefined;
      offset = 0;
      return inputs.map((tokens) => {
        const labels = new Uint8Array(tokens.length);
        const clauseStarts = new Uint8Array(tokens.length);
        const scores = margins.slice(offset, offset + tokens.length);
        const logits = debug
          ? new Float32Array(tokens.length * roles)
          : undefined;
        const boundaryLogits = debug
          ? new Float32Array(tokens.length)
          : undefined;
        const scored: number[] = [];
        for (let token = 0; token < tokens.length; token++) {
          labels[token] = packed[offset + token] & 63;
          clauseStarts[token] = packed[offset + token] >>> 7;
          if (rawLogits && tokens[token].kind !== 3) {
            scored.push((offset + token) * outputs);
            logits?.set(
              rawLogits.subarray(
                (offset + token) * outputs,
                (offset + token) * outputs + roles,
              ),
              token * roles,
            );
            if (boundaryLogits)
              boundaryLogits[token] =
                rawLogits[(offset + token) * outputs + roles];
          }
        }
        if (chain && rawLogits) {
          const { path, confidence } = viterbiDecode(
            rawLogits,
            scored,
            roles,
            chain,
          );
          let step = 0;
          for (let token = 0; token < tokens.length; token++)
            if (tokens[token].kind !== 3) {
              labels[token] = path[step];
              scores[token] = confidence[step++];
            }
        }
        offset += tokens.length;
        return { labels, clauseStarts, scores, logits, boundaryLogits };
      });
    } finally {
      if (readback.mapState === "mapped") readback.unmap();
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.device?.destroy();
    this.device = undefined;
    this.pipeline = undefined;
    this.weightBuffer = undefined;
    this.group = undefined;
    this.buffers.clear();
  }
}
