import { GPUModel } from "../src/model/gpu.js";
import { inferCPU, type Predictions } from "../src/model/cpu.js";
import { tokenize } from "../src/tokenizer.js";

function deviceOf(model: GPUModel): GPUDevice {
  return (model as unknown as { device: GPUDevice }).device;
}

function equal(actual: Predictions, expected: Predictions): boolean {
  return (
    actual.labels.length === expected.labels.length &&
    actual.labels.every((label, index) => label === expected.labels[index]) &&
    actual.clauseStarts.every(
      (boundary, index) => boundary === expected.clauseStarts[index],
    )
  );
}

export async function lifecycleChecks() {
  const inputs = [
    "one day after",
    "Sat Sun 1pm-8pm Mon 10pm-12am",
    "",
    "every other Tuesday",
  ].map(tokenize);
  const expected = inputs.map((tokens) => inferCPU(tokens));
  const gpu = await GPUModel.create();
  let concurrent = false;
  let inFlightRecovery = false;
  let secondLossRejected = false;
  try {
    const results = await Promise.all(
      inputs.map((tokens) => gpu.inferMany([tokens])),
    );
    concurrent = results.every((result, index) =>
      equal(result[0], expected[index]),
    );
    const device = deviceOf(gpu);
    const submit = device.queue.submit.bind(device.queue);
    device.queue.submit = (commands) => {
      submit(commands);
      device.destroy();
    };
    const recovered = await gpu.inferMany([inputs[0], inputs[1]]);
    inFlightRecovery =
      recovered.every((result, index) => equal(result, expected[index])) &&
      gpu.stats.recoveries === 1;
    const replacement = deviceOf(gpu);
    replacement.destroy();
    await replacement.lost;
    const afterSecondLoss = await Promise.allSettled([
      gpu.inferMany([inputs[0]]),
      gpu.inferMany([inputs[1]]),
    ]);
    secondLossRejected = afterSecondLoss.every(
      (result) =>
        result.status === "rejected" &&
        String(result.reason).includes("lost again"),
    );
  } finally {
    gpu.dispose();
  }

  const disposed = await GPUModel.create();
  const device = deviceOf(disposed);
  const submit = device.queue.submit.bind(device.queue);
  device.queue.submit = (commands) => {
    submit(commands);
    disposed.dispose();
  };
  let disposalRejected = false;
  try {
    await disposed.inferMany([inputs[0]]);
  } catch {
    disposalRejected = true;
  } finally {
    disposed.dispose();
  }

  const compilationCleanup = await initializationFailure();
  const results = {
    concurrent,
    inFlightRecovery,
    secondLossRejected,
    disposalRejected,
    compilationCleanup,
  };
  if (Object.values(results).some((value) => !value))
    throw new Error(
      `WebGPU lifecycle checks failed: ${JSON.stringify(results)}`,
    );
  return results;
}

async function initializationFailure(): Promise<boolean> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU unavailable during lifecycle checks");
  const originalAdapter = navigator.gpu.requestAdapter;
  const originalDevice = adapter.requestDevice;
  let device: GPUDevice | undefined;
  navigator.gpu.requestAdapter = async () => adapter;
  adapter.requestDevice = async (descriptor) => {
    device = await originalDevice.call(adapter, descriptor);
    device.createComputePipelineAsync = async () => {
      throw new Error("Injected compilation failure");
    };
    return device;
  };
  try {
    let rejected = false;
    try {
      await GPUModel.create();
    } catch (error) {
      rejected = String(error).includes("Injected compilation failure");
    }
    if (!device || !rejected) return false;
    return await Promise.race([
      device.lost.then((info) => info.reason === "destroyed"),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
  } finally {
    navigator.gpu.requestAdapter = originalAdapter;
    adapter.requestDevice = originalDevice;
    device?.destroy();
  }
}
