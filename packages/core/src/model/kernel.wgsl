// One workgroup evaluates one expression. All language decisions come from weights.
struct Parameters {
  tokenCount: u32,
  streamCount: u32,
  debug: u32,
  padding: u32,
}
struct Stream { start: u32, count: u32 }

@group(0) @binding(0) var<storage, read> features: array<vec2<u32>>;
@group(0) @binding(1) var<storage, read> streams: array<Stream>;
@group(0) @binding(2) var<uniform> parameters: Parameters;
@group(0) @binding(3) var<storage, read> modelWeights: array<f32>;
@group(0) @binding(4) var<storage, read_write> stateData: array<STATE_TYPE>;
@group(0) @binding(5) var<storage, read_write> packedLabels: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> scores: array<f32>;
@group(0) @binding(7) var<storage, read_write> debugData: array<f32>;

var<workgroup> streamInfo: vec2<u32>;
var<workgroup> pooled: array<f32, 32>;
var<workgroup> context: array<f32, 32>;
var<workgroup> headGate: array<f32, 16>;
var<workgroup> headHidden: array<f32, 64>;
var<workgroup> output: array<f32, 41>;

fn rounded(value: f32) -> f32 { ROUND_BODY }
fn sigmoid(value: f32) -> f32 { return 1.0 / (1.0 + exp(-value)); }
// Four buffers follow tensor lifetimes: embedding -> forward, encoded,
// gate -> combined, candidate -> backward. Barriers precede cross-lane reads.
fn readState(stage: u32, token: u32, channel: u32) -> f32 {
  return f32(stateData[(stage * parameters.tokenCount + token) * 32u + channel]);
}
fn writeState(stage: u32, token: u32, channel: u32, value: f32) {
  stateData[(stage * parameters.tokenCount + token) * 32u + channel] = STATE_TYPE(rounded(value));
}
fn embeddingRow(row: u32, channel: u32) -> f32 {
  var index = row;
  if (COMPACT_FEATURES) {
    if (row >= 140u && row < 396u) { index = 140u + ((row - 140u) & 127u); }
    else if (row >= 396u && row < 524u) { return 0.0; }
    else if (row >= 524u) { index = row - 256u; }
  }
  return modelWeights[EMBEDDING_OFFSET + index * 32u + channel];
}
fn embed(token: u32, channel: u32) -> f32 {
  let identity = features[token].x;
  let detail = features[token].y;
  var value = embeddingRow(identity & 3u, channel);
  value += embeddingRow(4u + ((identity >> 2u) & 7u), channel);
  value += embeddingRow(12u + ((identity >> 5u) & 63u), channel);
  value += embeddingRow(76u + ((identity >> 11u) & 63u), channel);
  value += embeddingRow(140u + ((identity >> 17u) & 255u), channel);
  value += embeddingRow(396u + (detail & 127u), channel);
  value += embeddingRow(532u + ((detail >> 15u) & 15u), channel);
  value += embeddingRow(548u + ((detail >> 19u) & 15u), channel);
  value += embeddingRow(564u + ((identity >> 25u) & 15u), channel);
  let flags = (detail >> 7u) & 255u;
  for (var bit = 0u; bit < 8u; bit++) {
    if ((flags & (1u << bit)) != 0u) { value += embeddingRow(524u + bit, channel); }
  }
  return value;
}

@compute @workgroup_size(32)
fn classify(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>) {
  let streamIndex = group.x + group.y * 65535u;
  if (streamIndex >= parameters.streamCount) { return; }
  let lane = local.x;
  if (lane == 0u) { streamInfo = vec2<u32>(streams[streamIndex].start, streams[streamIndex].count); }
  workgroupBarrier();
  let info = workgroupUniformLoad(&streamInfo);
  let start = info.x;
  let count = info.y;

  for (var position = 0u; position < count; position++) {
    writeState(0u, start + position, lane, embed(start + position, lane));
  }
  storageBarrier();
  workgroupBarrier();

  for (var position = 0u; position < count; position++) {
    var value = modelWeights[ENCODER_BIAS_OFFSET + lane];
    for (var tap = 0u; tap < 5u; tap++) {
      let neighbor = i32(position) + i32(tap) - 2;
      if (neighbor >= 0 && neighbor < i32(count)) {
        value += readState(0u, start + u32(neighbor), lane) * modelWeights[CONVOLUTION_OFFSET + tap * 32u + lane];
      }
    }
    for (var previous = i32(position) - 1; previous >= 0; previous--) {
      if ((features[start + u32(previous)].x & 3u) != 3u) {
        value += readState(0u, start + u32(previous), lane) * modelWeights[NEIGHBOR_WEIGHTS_OFFSET + lane];
        break;
      }
    }
    for (var following = position + 1u; following < count; following++) {
      if ((features[start + following].x & 3u) != 3u) {
        value += readState(0u, start + following, lane) * modelWeights[NEIGHBOR_WEIGHTS_OFFSET + 32u + lane];
        break;
      }
    }
    writeState(1u, start + position, lane, tanh(value));
  }
  storageBarrier();
  workgroupBarrier();

  var state = 0.0;
  for (var position = 0u; position < count; position++) {
    let token = start + position;
    var gateValue = modelWeights[GATE_BIAS_OFFSET + lane];
    var candidateValue = modelWeights[CANDIDATE_BIAS_OFFSET + lane];
    for (var channel = 0u; channel < 32u; channel++) {
      let encoded = readState(1u, token, channel);
      gateValue += encoded * modelWeights[GATE_WEIGHT_OFFSET + lane * 32u + channel];
      candidateValue += encoded * modelWeights[CANDIDATE_WEIGHT_OFFSET + lane * 32u + channel];
    }
    let gate = rounded(sigmoid(gateValue));
    let candidate = rounded((1.0 - gate) * tanh(candidateValue));
    writeState(2u, token, lane, gate);
    writeState(3u, token, lane, candidate);
    state = gate * state + candidate;
    writeState(0u, token, lane, state);
  }
  state = 0.0;
  for (var position = i32(count) - 1; position >= 0; position--) {
    let token = start + u32(position);
    state = readState(2u, token, lane) * state + readState(3u, token, lane);
    writeState(3u, token, lane, state);
  }
  storageBarrier();
  workgroupBarrier();

  var sum = 0.0;
  for (var position = 0u; position < count; position++) {
    let token = start + position;
    var value = modelWeights[COMBINE_BIAS_OFFSET + lane];
    for (var channel = 0u; channel < 32u; channel++) {
      value += readState(0u, token, channel) * modelWeights[COMBINE_WEIGHT_OFFSET + lane * 64u + channel];
      value += readState(3u, token, channel) * modelWeights[COMBINE_WEIGHT_OFFSET + lane * 64u + 32u + channel];
    }
    let combined = rounded(tanh(readState(1u, token, lane) + value));
    writeState(2u, token, lane, combined);
    sum += combined;
  }
  pooled[lane] = sum / f32(count);
  storageBarrier();
  workgroupBarrier();

  var globalGate = modelWeights[GLOBAL_BIAS_OFFSET + lane];
  for (var channel = 0u; channel < 32u; channel++) {
    globalGate += pooled[channel] * modelWeights[GLOBAL_WEIGHT_OFFSET + lane * 32u + channel];
  }
  context[lane] = sigmoid(globalGate) * pooled[lane];
  workgroupBarrier();

  for (var position = 0u; position < count; position++) {
    let token = start + position;
    let hasToken = (features[token].x & 3u) != 3u;
    if (hasToken && lane < 16u) {
      var value = modelWeights[HEAD_GATE_BIAS_OFFSET + lane];
      for (var channel = 0u; channel < 32u; channel++) {
        value += readState(2u, token, channel) * modelWeights[HEAD_GATE_WEIGHT_OFFSET + lane * 64u + channel];
        value += context[channel] * modelWeights[HEAD_GATE_WEIGHT_OFFSET + lane * 64u + 32u + channel];
      }
      headGate[lane] = sigmoid(value);
    }
    workgroupBarrier();

    if (hasToken) {
      for (var side = 0u; side < 2u; side++) {
        let hidden = lane + side * 32u;
        var value = modelWeights[HEAD_HIDDEN_BIAS_OFFSET + hidden];
        for (var channel = 0u; channel < 32u; channel++) {
          value += readState(2u, token, channel) * modelWeights[HEAD_HIDDEN_WEIGHT_OFFSET + hidden * 80u + channel];
          value += context[channel] * modelWeights[HEAD_HIDDEN_WEIGHT_OFFSET + hidden * 80u + 32u + channel];
        }
        for (var channel = 0u; channel < 16u; channel++) {
          value += headGate[channel] * modelWeights[HEAD_HIDDEN_WEIGHT_OFFSET + hidden * 80u + 64u + channel];
        }
        headHidden[hidden] = tanh(value);
      }
    }
    workgroupBarrier();

    if (hasToken) {
      for (var label = lane; label < 41u; label += 32u) {
        var value = modelWeights[OUTPUT_BIAS_OFFSET + label];
        for (var channel = 0u; channel < 64u; channel++) {
          value += headHidden[channel] * modelWeights[OUTPUT_WEIGHT_OFFSET + label * 64u + channel];
        }
        output[label] = value;
        if (parameters.debug != 0u) { debugData[token * 41u + label] = value; }
      }
    }
    workgroupBarrier();

    if (lane == 0u) {
      if (hasToken) {
        var best = 0u;
        var second = -1e30;
        for (var label = 1u; label < 40u; label++) {
          if (output[label] > output[best]) { second = output[best]; best = label; }
          else { second = max(second, output[label]); }
        }
        var denominator = 0.0;
        for (var label = 0u; label < 40u; label++) { denominator += exp(output[label] - output[best]); }
        let code = best | select(0u, 128u, output[40u] >= BOUNDARY_THRESHOLD);
        atomicOr(&packedLabels[token / 4u], code << ((token & 3u) * 8u));
        scores[token] = (1.0 - exp(second - output[best])) / denominator;
      } else { scores[token] = 0.0; }
    }
    workgroupBarrier();
  }
}
