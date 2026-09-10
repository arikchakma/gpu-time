"""The 32,953-parameter sequence tagger used by gpu-time.

Inputs are feature-row IDs from the shared TypeScript tokenizer. Calendar dates
and reference time never enter this model. The two outputs are contextual token
roles and clause-start logits.
"""

from __future__ import annotations

import torch
from torch import Tensor, nn
from torch.nn import functional as F

HIDDEN = 32
FEATURE_ROWS = 580
PADDING_ROW = FEATURE_ROWS
ROLE_CLASSES = 40


def affine_scan(gate: Tensor, candidate: Tensor) -> Tensor:
    """Inclusive scan for state[t] = gate[t] * state[t-1] + candidate[t]."""
    width = gate.shape[1]
    stride = 1
    while stride < width:
        next_gate = gate[:, stride:] * gate[:, :-stride]
        next_candidate = (
            candidate[:, stride:] + gate[:, stride:] * candidate[:, :-stride]
        )
        gate = torch.cat((gate[:, :stride], next_gate), dim=1)
        candidate = torch.cat((candidate[:, :stride], next_candidate), dim=1)
        stride *= 2
    return candidate


def sequential_scan(gate: Tensor, candidate: Tensor) -> Tensor:
    state = torch.zeros_like(candidate[:, 0])
    states = []
    for index in range(gate.shape[1]):
        state = gate[:, index] * state + candidate[:, index]
        states.append(state)
    return torch.stack(states, dim=1)


def quantize(weight: Tensor, bits: int = 6) -> Tensor:
    maximum = (1 << (bits - 1)) - 1
    scale = (weight.detach().abs().max() / maximum).clamp_min(1e-8)
    quantized = (weight / scale).round().clamp(-maximum, maximum) * scale
    return weight + (quantized - weight).detach()


def half_storage(value: Tensor) -> Tensor:
    rounded = value.half().float()
    return value + (rounded - value).detach()


class TimeTagger(nn.Module):
    def __init__(self, feature_rows: int = FEATURE_ROWS) -> None:
        super().__init__()
        if feature_rows not in (324, 580):
            raise ValueError("Feature rows must be 324 (S) or 580 (M)")
        self.feature_rows = feature_rows
        mapping = torch.arange(FEATURE_ROWS + 1)
        if feature_rows == 324:
            mapping[140:396] = 140 + torch.arange(256) % 128
            mapping[396:524] = 324
            mapping[524:580] = 268 + torch.arange(56)
            mapping[580] = 324
        self.register_buffer("row_map", mapping, persistent=False)
        self.embedding = nn.Parameter(torch.empty(feature_rows, HIDDEN))
        self.encoder_bias = nn.Parameter(torch.zeros(HIDDEN))
        self.convolution = nn.Parameter(torch.empty(5, HIDDEN))
        self.neighbor_weights = nn.Parameter(torch.empty(2, HIDDEN))
        self.gate_weight = nn.Parameter(torch.empty(HIDDEN, HIDDEN))
        self.gate_bias = nn.Parameter(torch.zeros(HIDDEN))
        self.candidate_weight = nn.Parameter(torch.empty(HIDDEN, HIDDEN))
        self.candidate_bias = nn.Parameter(torch.zeros(HIDDEN))
        self.combine_weight = nn.Parameter(torch.empty(HIDDEN, HIDDEN * 2))
        self.combine_bias = nn.Parameter(torch.zeros(HIDDEN))
        self.global_weight = nn.Parameter(torch.empty(HIDDEN, HIDDEN))
        self.global_bias = nn.Parameter(torch.zeros(HIDDEN))
        self.head_gate_weight = nn.Parameter(torch.empty(16, HIDDEN * 2))
        self.head_gate_bias = nn.Parameter(torch.zeros(16))
        self.head_hidden_weight = nn.Parameter(torch.empty(64, HIDDEN * 2 + 16))
        self.head_hidden_bias = nn.Parameter(torch.zeros(64))
        self.output_weight = nn.Parameter(torch.empty(ROLE_CLASSES + 1, 64))
        self.output_bias = nn.Parameter(torch.zeros(ROLE_CLASSES + 1))
        self.quantization_bits = 6
        self.qat = False
        self.storage_f16 = True
        self.reference_scan = False
        self.record_trace = False
        self.trace = {}

        for name, parameter in self.named_parameters():
            if parameter.ndim >= 2:
                nn.init.xavier_uniform_(parameter)
        nn.init.normal_(self.embedding, std=0.08)
        nn.init.normal_(self.convolution, std=0.15)
        nn.init.normal_(self.neighbor_weights, std=0.1)
        # Give different lanes short and long memories from the start.
        with torch.no_grad():
            self.gate_bias.copy_(torch.linspace(0.0, 4.0, HIDDEN))
        assert (
            sum(parameter.numel() for parameter in self.parameters())
            == feature_rows * HIDDEN + 14393
        )

    def weight(self, name: str) -> Tensor:
        value = getattr(self, name)
        return quantize(value, self.quantization_bits) if self.qat else value

    def store(self, value: Tensor) -> Tensor:
        return half_storage(value) if self.storage_f16 else value

    def linear(self, value: Tensor, name: str) -> Tensor:
        return F.linear(
            value, self.weight(f"{name}_weight"), self.weight(f"{name}_bias")
        )

    def forward(
        self, rows: Tensor, valid: Tensor, neighbors: Tensor
    ) -> tuple[Tensor, Tensor]:
        if self.feature_rows == 324:
            rows = self.row_map[rows]
        row_mask = (rows != self.feature_rows).unsqueeze(-1)
        embedded = F.embedding(
            rows.clamp_max(self.feature_rows - 1), self.weight("embedding")
        )
        embedded = self.store((embedded * row_mask).sum(dim=2))
        embedded = embedded * valid.unsqueeze(-1)

        channels = embedded.transpose(1, 2)
        kernel = self.weight("convolution").transpose(0, 1).unsqueeze(1)
        encoded = F.conv1d(channels, kernel, padding=2, groups=HIDDEN).transpose(1, 2)
        encoded = encoded + self.weight("encoder_bias")
        for side in range(2):
            indices = neighbors[:, :, side]
            gathered = embedded.gather(
                1, indices.clamp_min(0).unsqueeze(-1).expand(-1, -1, HIDDEN)
            )
            encoded = (
                encoded
                + gathered
                * (indices >= 0).unsqueeze(-1)
                * self.weight("neighbor_weights")[side]
            )
        encoded = self.store(torch.tanh(encoded)) * valid.unsqueeze(-1)

        gate = self.store(torch.sigmoid(self.linear(encoded, "gate")))
        candidate = self.store(
            (1 - gate) * torch.tanh(self.linear(encoded, "candidate"))
        )
        gate = torch.where(valid.unsqueeze(-1), gate, torch.ones_like(gate))
        candidate = candidate * valid.unsqueeze(-1)
        scan = sequential_scan if self.reference_scan else affine_scan
        forward = self.store(scan(gate, candidate))
        backward = self.store(scan(gate.flip(1), candidate.flip(1)).flip(1))
        combined = self.store(
            torch.tanh(
                encoded + self.linear(torch.cat((forward, backward), dim=-1), "combine")
            )
        )
        combined = combined * valid.unsqueeze(-1)

        pooled = combined.sum(dim=1) / valid.sum(dim=1, keepdim=True).clamp_min(1)
        context = torch.sigmoid(self.linear(pooled, "global")) * pooled
        joined = torch.cat((combined, context.unsqueeze(1).expand_as(combined)), dim=-1)
        head_gate = torch.sigmoid(self.linear(joined, "head_gate"))
        hidden = torch.tanh(
            self.linear(torch.cat((joined, head_gate), dim=-1), "head_hidden")
        )
        if self.record_trace:
            self.trace = {
                name: value.detach()
                for name, value in {
                    "embedded": embedded,
                    "encoded": encoded,
                    "gate": gate,
                    "candidate": candidate,
                    "forward": forward,
                    "backward": backward,
                    "combined": combined,
                    "pooled": pooled,
                    "context": context,
                }.items()
            }
        output = self.linear(hidden, "output")
        return output[..., :ROLE_CLASSES], output[..., ROLE_CLASSES]
