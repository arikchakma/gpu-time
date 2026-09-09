import { featureRows } from "../tokenizer.js";
import type { RawToken } from "../types.js";
import { decodeWeights, type EncodedWeights } from "./decode.js";
import { storeHalf } from "./half.js";
import { weights } from "./weights.gen.js";

const hiddenSize = 32;
const rowsPerToken = 17;
const model: EncodedWeights = weights;
const tensors = decodeWeights(model);
const store = model.storage === "f32" ? Math.fround : storeHalf;
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
  for (let index = 0; index < width; index++)
    sum += input[offset + index] * matrix[row * width + index];
  return Math.fround(sum);
}

export function inferCPU(tokens: RawToken[], debug = false): Predictions {
  const rows = new Uint16Array(tokens.length * rowsPerToken).fill(
    580, // Canonical feature encoding; compact models remap these rows below.
  );
  tokens.forEach((token, index) =>
    rows.set(featureRows(token.features), index * rowsPerToken),
  );
  return inferRows(rows, debug);
}

/** Runs the trained network. This module contains no language or calendar rules. */
export function inferRows(rows: Uint16Array, debug = false): Predictions {
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

  const embedded = new Float32Array(count * hiddenSize);
  const encoded = new Float32Array(embedded.length);
  const gate = new Float32Array(embedded.length);
  const candidate = new Float32Array(embedded.length);
  const forward = new Float32Array(embedded.length);
  const backward = new Float32Array(embedded.length);
  const combined = new Float32Array(embedded.length);
  const previous = new Int32Array(count).fill(-1);
  const next = new Int32Array(count).fill(-1);

  let neighbor = -1;
  for (let token = 0; token < count; token++) {
    previous[token] = neighbor;
    if (rows[token * rowsPerToken] !== 3) neighbor = token;
    for (let channel = 0; channel < hiddenSize; channel++) {
      let value = 0;
      for (let feature = 0; feature < rowsPerToken; feature++) {
        const row = rows[token * rowsPerToken + feature];
        if (row < weights.featureRows)
          value = Math.fround(value + embedding[row * hiddenSize + channel]);
      }
      embedded[token * hiddenSize + channel] = store(value);
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

  const pooled = new Float32Array(hiddenSize);
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

  const context = new Float32Array(hiddenSize);
  for (let channel = 0; channel < hiddenSize; channel++)
    context[channel] =
      sigmoid(
        globalBias[channel] + dot(pooled, 0, globalWeight, channel, hiddenSize),
      ) * pooled[channel];

  const headGate = new Float32Array(16);
  const headHidden = new Float32Array(64);
  const output = new Float32Array(weights.roleClasses + 1);
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
