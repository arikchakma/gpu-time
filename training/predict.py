"""Inspect actual neural predictions on arbitrary text, without the TS compiler."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import torch

from model import PADDING_ROW, TimeTagger

ROOT = Path(__file__).resolve().parent.parent
LABELS = [
    "O",
    "NUM",
    "ORD",
    "UNIT",
    "DIR_BEFORE",
    "DIR_AFTER",
    "NOW",
    "REL_DAY",
    "DEICTIC",
    "WEEKDAY",
    "DAYGROUP",
    "MONTH",
    "DOM",
    "YEAR",
    "HOUR",
    "MINUTE",
    "SECOND",
    "MERIDIEM",
    "TIME_NAMED",
    "DAYPART",
    "RANGE_START",
    "RANGE_END",
    "RECUR",
    "FREQ",
    "TIMES",
    "BOUND_START",
    "BOUND_END",
    "COUNT",
    "DUR",
    "EXCEPT",
    "TZ",
    "HOLIDAY",
]


def threshold_for(checkpoint: Path) -> float:
    path = ROOT / "training/export-report.json"
    if path.exists():
        report = json.loads(path.read_text())
        if (
            report["checkpointSha256"]
            == hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        ):
            return report.get("boundaryThreshold", 0)
    return 0


def featurize(texts: list[str]) -> list[dict]:
    script = """
      import { readFileSync } from 'node:fs';
      import { tokenize, featureRows } from './src/tokenizer.ts';
      const texts = JSON.parse(readFileSync(0, 'utf8'));
      process.stdout.write(JSON.stringify(texts.map(text => ({ text, tokens: tokenize(text).map(token => ({ ...token, rows: featureRows(token.features) })) }))));
    """
    result = subprocess.run(
        ["bun", "-e", script],
        cwd=ROOT,
        input=json.dumps(texts),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


def inputs(tokens: list[dict]):
    rows = torch.full((1, len(tokens), 17), PADDING_ROW, dtype=torch.long)
    neighbors = torch.full((1, len(tokens), 2), -1, dtype=torch.long)
    previous = -1
    for index, token in enumerate(tokens):
        rows[0, index, : len(token["rows"])] = torch.tensor(token["rows"])
        neighbors[0, index, 0] = previous
        if token["kind"] != 3:
            previous = index
    following = -1
    for index in range(len(tokens) - 1, -1, -1):
        neighbors[0, index, 1] = following
        if tokens[index]["kind"] != 3:
            following = index
    valid = torch.ones((1, len(tokens)), dtype=torch.bool)
    return rows, valid, neighbors


def predict(checkpoint: Path, texts: list[str]) -> dict:
    torch.set_num_threads(2)
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    label_names = state.get("labelNames", LABELS)
    boundary_threshold = threshold_for(checkpoint)
    model = TimeTagger(state["model"]["embedding"].shape[0]).eval()
    model.load_state_dict(state["model"])
    model.qat = True
    model.storage_f16 = state["config"].get("storage", "f16") == "f16"
    results = []
    for example in featurize(texts):
        with torch.no_grad():
            logits, boundaries = model(*inputs(example["tokens"]))
            probabilities = logits.softmax(-1)
            top = probabilities.topk(2, dim=-1)
        tokens = []
        for index, token in enumerate(example["tokens"]):
            if token["kind"] == 3:
                continue
            label = top.indices[0, index, 0].item()
            tokens.append(
                {
                    "text": token["text"],
                    "start": token["start"],
                    "end": token["end"],
                    "label": label_names[label]
                    if label < len(label_names)
                    else f"RESERVED_{label}",
                    "clauseStart": bool(boundaries[0, index] >= boundary_threshold),
                    "boundaryScore": round(boundaries[0, index].sigmoid().item(), 4),
                    "margin": round(
                        (top.values[0, index, 0] - top.values[0, index, 1]).item(), 4
                    ),
                }
            )
        results.append({"text": example["text"], "tokens": tokens})
    return {
        "checkpoint": str(checkpoint),
        "epoch": state["epoch"],
        "quantized": True,
        "boundaryThreshold": boundary_threshold,
        "results": results,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--checkpoint", type=Path, default=Path("training/runs/main/best.pt")
    )
    parser.add_argument("--out", type=Path)
    parser.add_argument("texts", nargs="*")
    args = parser.parse_args()
    texts = args.texts or [
        "Sat Sun 1pm-8pm Mon 10pm-12am",
        "10 days before Friday",
        "Monday at 10pm",
        "last Friday",
        "last Friday of every month",
        "from 9 to 5",
        "every Monday from October",
        "May I have your second opinion?",
    ]
    result = predict(args.checkpoint, texts)
    serialized = json.dumps(result, indent=2)
    if args.out:
        args.out.write_text(serialized + "\n")
    print(serialized)
