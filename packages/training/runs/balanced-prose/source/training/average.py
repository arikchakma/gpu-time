"""Create a reproducible weighted average of two compatible checkpoints."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import torch


TORCH = Path(__file__).resolve().parent
ROOT = TORCH.parent
ARCHITECTURE_KEYS = (
    "feature_rows",
    "layers",
    "transitions",
    "storage",
    "quantization_bits",
    "row_scales",
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def portable(path: Path) -> str:
    resolved = path.resolve()
    return str(resolved.relative_to(ROOT) if resolved.is_relative_to(ROOT) else resolved)


def load(path: Path) -> dict:
    return torch.load(path, map_location="cpu", weights_only=True)


def validate(base: dict, checkpoint: dict) -> None:
    if base.get("labelNames") != checkpoint.get("labelNames"):
        raise ValueError("Checkpoint label vocabularies differ")
    for key in ARCHITECTURE_KEYS:
        if base["config"].get(key) != checkpoint["config"].get(key):
            raise ValueError(f"Checkpoint architecture differs: {key}")
    if set(base["model"]) != set(checkpoint["model"]):
        raise ValueError("Checkpoint tensor names differ")
    for name, left in base["model"].items():
        right = checkpoint["model"][name]
        if left.shape != right.shape:
            raise ValueError(f"Checkpoint tensor shape differs: {name}")
        if left.dtype != right.dtype or not left.is_floating_point():
            raise ValueError(f"Checkpoint tensor type is incompatible: {name}")


def average(base_path: Path, checkpoint_path: Path, fraction: float, run_name: str) -> Path:
    if not 0 < fraction < 1:
        raise ValueError("--fraction must be greater than 0 and less than 1")
    base_path = base_path.resolve()
    checkpoint_path = checkpoint_path.resolve()
    base = load(base_path)
    checkpoint = load(checkpoint_path)
    validate(base, checkpoint)

    run = ROOT / "runs" / run_name
    if run.exists():
        raise FileExistsError(f"Run already exists: {run}")
    source = run / "source/training/average.py"
    source.parent.mkdir(parents=True)
    content = Path(__file__).read_bytes()
    source.write_bytes(content)

    parents = [
        {
            "checkpoint": portable(base_path),
            "sha256": digest(base_path),
            "coefficient": 1 - fraction,
        },
        {
            "checkpoint": portable(checkpoint_path),
            "sha256": digest(checkpoint_path),
            "coefficient": fraction,
        },
    ]
    config = {
        **checkpoint["config"],
        "epochs": 0,
        "run": run_name,
        "evaluation_run": checkpoint["config"].get(
            "evaluation_run", checkpoint["config"]["run"]
        ),
        "init": None,
        "provenanceParents": parents,
    }
    derived = {
        "model": {
            name: left * (1 - fraction) + checkpoint["model"][name] * fraction
            for name, left in base["model"].items()
        },
        "config": config,
        "epoch": 0,
        "metrics": {},
        "tokensSeen": 0,
        "labelNames": base["labelNames"],
        "derivation": {
            "method": "weighted-checkpoint-average",
            "parents": parents,
        },
    }
    output = run / "best.pt"
    torch.save(derived, output)
    report = {
        "run": run_name,
        "status": "completed",
        "selectionCriterion": "Derived checkpoint; evaluation and promotion are performed by export.py.",
        "sourceHashes": {"training/average.py": hashlib.sha256(content).hexdigest()},
        "datasetHashes": {},
        "config": config,
        "tokensSeen": 0,
        "derivation": derived["derivation"],
        "checkpointSha256": digest(output),
    }
    (run / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--fraction", type=float, required=True)
    parser.add_argument("--run", required=True)
    args = parser.parse_args()
    print(average(args.base, args.checkpoint, args.fraction, args.run))


if __name__ == "__main__":
    main()
