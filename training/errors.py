"""Measure model errors by family, role, and boundary on a fixed dataset."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch

from model import TimeTagger
from train import Dataset
from predict import featurize, threshold_for


def analyze(checkpoint: Path, prefix: Path, output: Path):
    torch.set_num_threads(4)
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model = TimeTagger(saved["model"]["embedding"].shape[0]).eval()
    model.load_state_dict(saved["model"])
    model.qat = True
    model.storage_f16 = saved["config"].get("storage", "f16") == "f16"
    threshold = threshold_for(checkpoint)
    dataset = Dataset(prefix)
    labels = saved.get("labelNames", list(dataset.manifest["labelCounts"]))
    examples = [
        json.loads(line)
        for line in Path(dataset.manifest["source"]).read_text().splitlines()
    ]
    if len(examples) != len(dataset):
        raise RuntimeError("Analysis requires an unskipped evaluation dataset")
    confusion = Counter()
    families = defaultdict(lambda: Counter())
    failures = []
    for indices in dataset.batches(256):
        rows, targets, boundaries, valid, neighbors = dataset.batch(indices, "cpu")
        with torch.no_grad():
            role_logits, boundary_logits = model(rows, valid, neighbors)
        predicted = role_logits.argmax(-1).numpy()
        predicted_boundaries = (boundary_logits >= threshold).numpy()
        gold = targets.numpy()
        gold_boundaries = boundaries.numpy().astype(bool)
        for row, index in enumerate(indices):
            example = examples[index]
            family = example["template"].split("/")[0]
            mask = gold[row] >= 0
            semantic = mask & (gold[row] > 0) & (gold[row] < 32)
            mismatches = (predicted[row] != gold[row]) & mask
            boundary_errors = (predicted_boundaries[row] != gold_boundaries[row]) & mask
            families[family].update(
                {
                    "tokens": int(mask.sum()),
                    "correct": int((~mismatches & mask).sum()),
                    "semanticTokens": int(semantic.sum()),
                    "semanticCorrect": int(
                        ((predicted[row] == gold[row]) & semantic).sum()
                    ),
                    "sequences": 1,
                    "exact": int(not mismatches.any() and not boundary_errors.any()),
                    "boundaryErrors": int(boundary_errors.sum()),
                }
            )
            for position in np.flatnonzero(mismatches):
                actual = int(predicted[row, position])
                confusion[
                    (
                        labels[int(gold[row, position])],
                        labels[actual]
                        if actual < len(labels)
                        else f"RESERVED_{actual}",
                    )
                ] += 1
            if (mismatches.any() or boundary_errors.any()) and len(failures) < 100:
                size = int(dataset.lengths[index])
                failures.append(
                    {
                        "text": example["text"],
                        "family": family,
                        "expected": gold[row, :size].tolist(),
                        "predicted": predicted[row, :size].tolist(),
                        "expectedBoundaries": gold_boundaries[row, :size].tolist(),
                        "predictedBoundaries": predicted_boundaries[
                            row, :size
                        ].tolist(),
                    }
                )
    raw = featurize([failure["text"] for failure in failures])
    for failure, example in zip(failures, raw):
        failure["tokens"] = []
        for index, token in enumerate(example["tokens"]):
            expected = failure["expected"][index]
            predicted_role = failure["predicted"][index]
            if expected < 0:
                continue
            failure["tokens"].append(
                {
                    "text": token["text"],
                    "expected": labels[expected],
                    "predicted": labels[predicted_role]
                    if predicted_role < len(labels)
                    else f"RESERVED_{predicted_role}",
                    "expectedBoundary": failure["expectedBoundaries"][index],
                    "predictedBoundary": failure["predictedBoundaries"][index],
                }
            )
        for key in [
            "expected",
            "predicted",
            "expectedBoundaries",
            "predictedBoundaries",
        ]:
            del failure[key]
    result = {
        "checkpoint": str(checkpoint),
        "epoch": saved["epoch"],
        "families": {name: dict(counts) for name, counts in sorted(families.items())},
        "confusions": [
            {"expected": pair[0], "predicted": pair[1], "count": count}
            for pair, count in confusion.most_common(30)
        ],
        "failures": failures,
    }
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                "epoch": result["epoch"],
                "families": result["families"],
                "confusions": result["confusions"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    analyze(args.checkpoint, args.data, args.out)
