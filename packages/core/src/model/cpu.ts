import { featureRows } from "../tokenizer.js";
import type { RawToken } from "../types.js";
import { decodeWeights, type EncodedWeights } from "./decode.js";
import { storeHalf } from "./half.js";
import { weights } from "./weights.gen.js";
import { diagnostics, fullPrecision } from "./options.js";

const hiddenSize = 32;
const rowsPerToken = 17;
const model: EncodedWeights = weights;
const tensors = decodeWeights(model);
const store = fullPrecision ? Math.fround : storeHalf;
const featureMap =
  model.featureRows === 324
    ? Uint16Array.from({ length: 581 }, (_, row) => compactFeature(row))
    : undefined;

function compactFeature(row: number): number {
  if (row < 140) return row;
  if (row < 396) return 140 + ((row - 140) % 128);
  if (row < 524) return 324;
  return row - 256;
}

export interface Predictions {
  labels: Uint8Array;
  clauseStarts: Uint8Array;
  scores: Float32Array;
  logits?: Float32Array;
  boundaryLogits?: Float32Array;
  trace?: Record<string, Float32Array>;
}

function tensor(name: string): Float32Array {
  const value = tensors.get(name);
  if (!value) throw new Error(`Missing model tensor: ${name}`);
  return value;
}

const embedding = tensor("embedding");
const encoderBias = tensor("encoder_bias");
const convolution = tensor("convolution");
const neighborWeights = tensor("neighbor_weights");
const gateWeight = tensor("gate_weight");
const gateBias = tensor("gate_bias");
const candidateWeight = tensor("candidate_weight");
const candidateBias = tensor("candidate_bias");
const combineWeight = tensor("combine_weight");
const combineBias = tensor("combine_bias");
const globalWeight = tensor("global_weight");
const globalBias = tensor("global_bias");
const headGateWeight = tensor("head_gate_weight");
const headGateBias = tensor("head_gate_bias");
const headHiddenWeight = tensor("head_hidden_weight");
const headHiddenBias = tensor("head_hidden_bias");
const outputWeight = tensor("output_weight");
const outputBias = tensor("output_bias");

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function dot(
  input: Float32Array,
  offset: number,
  matrix: Float32Array,
  row: number,
  width: number,
): number {
  let sum = 0;
  const base = row * width;
  // Network rows have width 32 or 64. Preserve scalar accumulation order.
  for (let index = 0; index < width; index += 4) {
    sum += input[offset + index] * matrix[base + index];
    sum += input[offset + index + 1] * matrix[base + index + 1];
    sum += input[offset + index + 2] * matrix[base + index + 2];
    sum += input[offset + index + 3] * matrix[base + index + 3];
  }
  return Math.fround(sum);
}

function createWorkspace(count: number) {
  return {
    count,
    embedded: new Float32Array(count * hiddenSize),
    encoded: new Float32Array(count * hiddenSize),
    gate: new Float32Array(count * hiddenSize),
    candidate: new Float32Array(count * hiddenSize),
    forward: new Float32Array(count * hiddenSize),
    backward: new Float32Array(count * hiddenSize),
    combined: new Float32Array(count * hiddenSize),
    previous: new Int32Array(count),
    next: new Int32Array(count),
    pooled: new Float32Array(hiddenSize),
    context: new Float32Array(hiddenSize),
    headGate: new Float32Array(16),
    headHidden: new Float32Array(64),
    output: new Float32Array(weights.roleClasses + 1),
  };
}

let scratch: ReturnType<typeof createWorkspace> | undefined;
function getWorkspace(count: number) {
  // Inference is synchronous. Retain at most one normal 128-token window.
  if (count > 128) return createWorkspace(count);
  if (!scratch || scratch.count < count) scratch = createWorkspace(count);
  return scratch;
}

export function inferCPU(tokens: RawToken[], debug = false): Predictions {
  const rows = new Uint16Array(tokens.length * rowsPerToken).fill(
    580, // Canonical feature encoding; compact models remap these rows below.
  );
  tokens.forEach((token, index) =>
    rows.set(featureRows(token.features), index * rowsPerToken),
  );
  return inferRows(rows, debug, tokens);
}

/** Runs the trained network. This module contains no language or calendar rules. */
const embeddingCache = new Map<string, Float32Array>();

export function inferRows(
  rows: Uint16Array,
  debug = false,
  tokens?: RawToken[],
): Predictions {
  debug = diagnostics && debug;
  if (featureMap) rows = rows.map((row) => featureMap[row]);
  if (rows.length % rowsPerToken !== 0)
    throw new RangeError("Invalid feature-row buffer.");
  const count = rows.length / rowsPerToken;
  const labels = new Uint8Array(count);
  const clauseStarts = new Uint8Array(count);
  const scores = new Float32Array(count);
  const logits = debug
    ? new Float32Array(count * weights.roleClasses)
    : undefined;
  const boundaryLogits = debug ? new Float32Array(count) : undefined;
  if (!count) return { labels, clauseStarts, scores, logits, boundaryLogits };

  const workspace = debug ? createWorkspace(count) : getWorkspace(count);
  const {
    embedded,
    encoded,
    gate,
    candidate,
    forward,
    backward,
    combined,
    previous,
    next,
    pooled,
    context,
    headGate,
    headHidden,
    output,
  } = workspace;
  pooled.fill(0);

  let neighbor = -1;
  for (let token = 0; token < count; token++) {
    previous[token] = neighbor;
    if (rows[token * rowsPerToken] !== 3) neighbor = token;
    const key =
      tokens && !debug
        ? `${tokens[token].features[0]}:${tokens[token].features[1]}`
        : undefined;
    const cached = key === undefined ? undefined : embeddingCache.get(key);
    if (cached) {
      embedded.set(cached, token * hiddenSize);
      continue;
    }
    for (let channel = 0; channel < hiddenSize; channel++) {
      let value = 0;
      for (let feature = 0; feature < rowsPerToken; feature++) {
        const row = rows[token * rowsPerToken + feature];
        if (row < weights.featureRows)
          value = Math.fround(value + embedding[row * hiddenSize + channel]);
      }
      embedded[token * hiddenSize + channel] = store(value);
    }
    if (key !== undefined) {
      if (embeddingCache.size >= 2048)
        embeddingCache.delete(embeddingCache.keys().next().value!);
      embeddingCache.set(
        key,
        embedded.slice(token * hiddenSize, (token + 1) * hiddenSize),
      );
    }
  }
  neighbor = -1;
  for (let token = count - 1; token >= 0; token--) {
    next[token] = neighbor;
    if (rows[token * rowsPerToken] !== 3) neighbor = token;
  }

  for (let token = 0; token < count; token++) {
    const offset = token * hiddenSize;
    for (let channel = 0; channel < hiddenSize; channel++) {
      let value = 0;
      for (let tap = 0; tap < 5; tap++) {
        const position = token + tap - 2;
        if (position >= 0 && position < count)
          value +=
            embedded[position * hiddenSize + channel] *
            convolution[tap * hiddenSize + channel];
      }
      value = Math.fround(Math.fround(value) + encoderBias[channel]);
      if (previous[token] >= 0)
        value = Math.fround(
          value +
            Math.fround(
              embedded[previous[token] * hiddenSize + channel] *
                neighborWeights[channel],
            ),
        );
      if (next[token] >= 0)
        value = Math.fround(
          value +
            Math.fround(
              embedded[next[token] * hiddenSize + channel] *
                neighborWeights[hiddenSize + channel],
            ),
        );
      encoded[offset + channel] = store(Math.tanh(value));
    }
  }

  for (let token = 0; token < count; token++) {
    const offset = token * hiddenSize;
    for (let channel = 0; channel < hiddenSize; channel++) {
      const amount = store(
        sigmoid(
          Math.fround(
            gateBias[channel] +
              dot(encoded, offset, gateWeight, channel, hiddenSize),
          ),
        ),
      );
      gate[offset + channel] = amount;
      candidate[offset + channel] = store(
        Math.fround(
          (1 - amount) *
            Math.fround(
              Math.tanh(
                Math.fround(
                  candidateBias[channel] +
                    dot(encoded, offset, candidateWeight, channel, hiddenSize),
                ),
              ),
            ),
        ),
      );
    }
  }

  for (let channel = 0; channel < hiddenSize; channel++) {
    let state = 0;
    for (let token = 0; token < count; token++) {
      const index = token * hiddenSize + channel;
      state = Math.fround(gate[index] * state + candidate[index]);
      forward[index] = store(state);
    }
    state = 0;
    for (let token = count - 1; token >= 0; token--) {
      const index = token * hiddenSize + channel;
      state = Math.fround(gate[index] * state + candidate[index]);
      backward[index] = store(state);
    }
  }

  for (let token = 0; token < count; token++) {
    const offset = token * hiddenSize;
    for (let channel = 0; channel < hiddenSize; channel++) {
      let value = combineBias[channel];
      for (let input = 0; input < hiddenSize; input++) {
        value += forward[offset + input] * combineWeight[channel * 64 + input];
        value +=
          backward[offset + input] * combineWeight[channel * 64 + 32 + input];
      }
      combined[offset + channel] = store(
        Math.tanh(Math.fround(encoded[offset + channel] + Math.fround(value))),
      );
      pooled[channel] += combined[offset + channel];
    }
  }
  for (let channel = 0; channel < hiddenSize; channel++)
    pooled[channel] /= count;

  for (let channel = 0; channel < hiddenSize; channel++)
    context[channel] =
      sigmoid(
        globalBias[channel] + dot(pooled, 0, globalWeight, channel, hiddenSize),
      ) * pooled[channel];

  for (let token = 0; token < count; token++) {
    if (rows[token * rowsPerToken] === 3) continue;
    const offset = token * hiddenSize;
    for (let channel = 0; channel < 16; channel++) {
      let value = headGateBias[channel];
      for (let input = 0; input < hiddenSize; input++) {
        value +=
          combined[offset + input] * headGateWeight[channel * 64 + input];
        value += context[input] * headGateWeight[channel * 64 + 32 + input];
      }
      headGate[channel] = sigmoid(Math.fround(value));
    }
    for (let channel = 0; channel < 64; channel++) {
      let value = headHiddenBias[channel];
      for (let input = 0; input < hiddenSize; input++) {
        value +=
          combined[offset + input] * headHiddenWeight[channel * 80 + input];
        value += context[input] * headHiddenWeight[channel * 80 + 32 + input];
      }
      for (let input = 0; input < 16; input++)
        value += headGate[input] * headHiddenWeight[channel * 80 + 64 + input];
      headHidden[channel] = Math.tanh(Math.fround(value));
    }
    for (let label = 0; label <= weights.roleClasses; label++)
      output[label] =
        outputBias[label] + dot(headHidden, 0, outputWeight, label, 64);

    let best = 0;
    let second = -Infinity;
    for (let label = 1; label < weights.roleClasses; label++) {
      if (output[label] > output[best]) {
        second = output[best];
        best = label;
      } else second = Math.max(second, output[label]);
    }
    let denominator = 0;
    for (let label = 0; label < weights.roleClasses; label++)
      denominator += Math.exp(output[label] - output[best]);
    labels[token] = best;
    clauseStarts[token] = Number(
      output[weights.roleClasses] >= (model.boundaryThreshold ?? 0),
    );
    scores[token] = (1 - Math.exp(second - output[best])) / denominator;
    logits?.set(
      output.subarray(0, weights.roleClasses),
      token * weights.roleClasses,
    );
    if (boundaryLogits) boundaryLogits[token] = output[weights.roleClasses];
  }

  return {
    labels,
    clauseStarts,
    scores,
    logits,
    boundaryLogits,
    trace: debug
      ? {
          embedded,
          encoded,
          gate,
          candidate,
          forward,
          backward,
          combined,
          pooled,
          context,
        }
      : undefined,
  };
}
