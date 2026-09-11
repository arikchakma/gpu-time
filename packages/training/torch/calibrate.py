"""Select a clause threshold using development data, never the reserved test set."""

import numpy as np
import torch


def calibrate(model, datasets):
    scores = {}
    for name, dataset in datasets.items():
        predictions, targets = [], []
        with torch.no_grad():
            for indices in dataset.batches(256):
                rows, labels, boundaries, valid, neighbors = dataset.batch(
                    indices, "cpu"
                )
                _, logits = model(rows, valid, neighbors)
                mask = labels >= 0
                predictions.extend(logits[mask].tolist())
                targets.extend(boundaries[mask].tolist())
        scores[name] = (np.asarray(predictions), np.asarray(targets, dtype=bool))
    grid = []
    for threshold in np.arange(0, 5.01, 0.25):
        metrics = {}
        for name, (logits, expected) in scores.items():
            actual = logits >= threshold
            tp = int((actual & expected).sum())
            fp = int((actual & ~expected).sum())
            fn = int((~actual & expected).sum())
            metrics[name] = {
                "f1": 2 * tp / max(1, 2 * tp + fp + fn),
                "truePositive": tp,
                "falsePositive": fp,
                "falseNegative": fn,
            }
        grid.append({"threshold": float(threshold), "metrics": metrics})
    selected = max(
        grid, key=lambda row: min(value["f1"] for value in row["metrics"].values())
    )
    return {
        "threshold": selected["threshold"],
        "criterion": "Maximize the worst clause-boundary F1 across same-frame validation and reordered development data. Ties choose the lower threshold. These sets were already used for development and model selection; this is not test-set calibration.",
        "grid": grid,
    }
