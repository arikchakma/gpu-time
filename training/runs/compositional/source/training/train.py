"""Train the contextual tagger and write measured evaluation/checkpoint artifacts."""
from __future__ import annotations

import argparse
import json
import hashlib
import math
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

from model import PADDING_ROW, ROLE_CLASSES, TimeTagger

ROOT = Path(__file__).resolve().parent.parent


class Dataset:
    def __init__(self, prefix: Path):
        self.rows = np.fromfile(f"{prefix}.rows.bin", dtype=np.uint16).reshape(-1, 17)
        self.labels = np.fromfile(f"{prefix}.labels.bin", dtype=np.uint8)
        self.boundaries = np.fromfile(f"{prefix}.boundaries.bin", dtype=np.uint8)
        self.kinds = np.fromfile(f"{prefix}.kinds.bin", dtype=np.uint8)
        self.neighbors = np.fromfile(f"{prefix}.neighbors.bin", dtype=np.int16).reshape(-1, 2)
        self.offsets = np.fromfile(f"{prefix}.offsets.bin", dtype=np.uint32)
        self.lengths = np.diff(self.offsets)
        self.manifest = json.loads(Path(f"{prefix}.json").read_text())

    def __len__(self):
        return len(self.lengths)

    def batch(self, indices: np.ndarray, device: str):
        length = int(self.lengths[indices].max())
        length = 32 if length <= 32 else 64 if length <= 64 else 128
        rows = np.full((len(indices), length, 17), PADDING_ROW, dtype=np.int64)
        labels = np.full((len(indices), length), -100, dtype=np.int64)
        boundaries = np.zeros((len(indices), length), dtype=np.float32)
        valid = np.zeros((len(indices), length), dtype=np.bool_)
        neighbors = np.full((len(indices), length, 2), -1, dtype=np.int64)
        for destination, index in enumerate(indices):
            start, end = self.offsets[index:index + 2]
            size = int(end - start)
            rows[destination, :size] = self.rows[start:end]
            labels[destination, :size] = np.where(self.kinds[start:end] == 3, -100, self.labels[start:end].astype(np.int64))
            boundaries[destination, :size] = self.boundaries[start:end]
            valid[destination, :size] = True
            neighbors[destination, :size] = self.neighbors[start:end]
        return tuple(torch.from_numpy(value).to(device) for value in (rows, labels, boundaries, valid, neighbors))

    def batches(self, batch_size: int, rng: np.random.Generator | None = None):
        batches = []
        for lower, upper in [(0, 32), (32, 64), (64, 128)]:
            indices = np.flatnonzero((self.lengths > lower) & (self.lengths <= upper))
            if rng is not None:
                rng.shuffle(indices)
            batches.extend(indices[start:start + batch_size] for start in range(0, len(indices), batch_size))
        if rng is not None:
            rng.shuffle(batches)
        return batches


def evaluate(model: TimeTagger, dataset: Dataset, batch_size: int, device: str) -> dict:
    model.eval()
    correct = total = sequences = exact = true_positive = false_positive = false_negative = 0
    with torch.no_grad():
        for indices in dataset.batches(batch_size):
            rows, labels, boundaries, valid, neighbors = dataset.batch(indices, device)
            logits, boundary_logits = model(rows, valid, neighbors)
            roles = logits.argmax(-1)
            predicted_boundaries = boundary_logits >= 0
            mask = labels >= 0
            right = (roles == labels) | ~mask
            boundary_right = (predicted_boundaries == boundaries.bool()) | ~mask
            correct += ((roles == labels) & mask).sum().item()
            total += mask.sum().item()
            exact += (right.all(1) & boundary_right.all(1)).sum().item()
            sequences += len(indices)
            true_positive += (predicted_boundaries & boundaries.bool() & mask).sum().item()
            false_positive += (predicted_boundaries & ~boundaries.bool() & mask).sum().item()
            false_negative += (~predicted_boundaries & boundaries.bool() & mask).sum().item()
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    return {
        "tokens": total, "sequences": sequences, "tokenAccuracy": correct / max(1, total),
        "exactLabelAndBoundarySequence": exact / max(1, sequences),
        "boundaryPrecision": precision, "boundaryRecall": recall,
        "boundaryF1": 2 * precision * recall / max(1e-12, precision + recall),
        "boundaryCounts": {"truePositive": true_positive, "falsePositive": false_positive, "falseNegative": false_negative},
    }


def prepare(split: str, count: int, seed: int, directory: Path) -> Dataset:
    prefix = directory / split
    command = ["uv", "run", "--project", "training", "python", "training/generate.py", "--count", str(count), "--seed", str(seed), "--split", split, "--out", f"{prefix}.jsonl"]
    reserved = directory / "heldout.fingerprints.json"
    if split != "heldout" and reserved.exists():
        command.extend(["--exclude", str(reserved)])
    subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["bun", "training/featurize.ts", f"{prefix}.jsonl", str(prefix)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    return Dataset(prefix)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--samples", type=int, default=300000)
    parser.add_argument("--eval-samples", type=int, default=10000)
    parser.add_argument("--batch", type=int, default=512)
    parser.add_argument("--seed", type=int, default=20260909)
    parser.add_argument("--qat-start", type=int, default=14)
    parser.add_argument("--run", default="main")
    parser.add_argument("--storage", choices=["f16", "f32"], default="f16")
    parser.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    parser.add_argument("--log-every", type=int, default=50)
    parser.add_argument("--warmup-steps", type=int, default=500)
    parser.add_argument("--fresh-each-epoch", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()
    torch.manual_seed(args.seed)
    torch.set_num_threads(8)
    rng = np.random.default_rng(args.seed)
    run = ROOT / "training" / "runs" / args.run
    run.mkdir(parents=True, exist_ok=True)
    directory = ROOT / "data" / "synth" / args.run
    directory.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"stage": "preparing-data", "run": args.run, "device": args.device, "samplesPerEpoch": args.samples}), flush=True)
    heldout = prepare("heldout", args.eval_samples, args.seed + 2, directory)
    validation = prepare("validation", args.eval_samples, args.seed + 1, directory)
    training = prepare("train", args.samples, args.seed, directory)
    if set(training.manifest["fingerprints"]) & set(heldout.manifest["fingerprints"]):
        raise RuntimeError("Training and held-out structural frames overlap")

    model = TimeTagger().to(args.device)
    model.storage_f16 = args.storage == "f16"
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    history = []
    best = -1.0
    step = 0
    tokens_seen = 0
    started = time.perf_counter()
    for epoch in range(args.epochs):
        if epoch > 0 and args.fresh_each_epoch:
            training = prepare("train", args.samples, args.seed + epoch * 101, directory)
        model.train()
        model.qat = epoch >= args.qat_start
        batches = training.batches(args.batch, rng)
        losses = []
        epoch_started = time.perf_counter()
        for batch_index, indices in enumerate(batches):
            step += 1
            progress = (epoch + batch_index / len(batches)) / args.epochs
            learning_rate = (1e-4 + (3e-3 - 1e-4) * (1 + math.cos(math.pi * progress)) / 2) * min(1, step / args.warmup_steps)
            for group in optimizer.param_groups:
                group["lr"] = learning_rate
            rows, labels, boundaries, valid, neighbors = training.batch(indices, args.device)
            logits, boundary_logits = model(rows, valid, neighbors)
            mask = labels >= 0
            role_loss = F.cross_entropy(logits.reshape(-1, ROLE_CLASSES), labels.reshape(-1), ignore_index=-100, label_smoothing=0.05)
            boundary_loss = F.binary_cross_entropy_with_logits(boundary_logits[mask], boundaries[mask], pos_weight=torch.tensor(8.0, device=args.device))
            loss = role_loss + 0.5 * boundary_loss
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(loss.detach())
            tokens_seen += int(training.lengths[indices].sum())
            if batch_index % args.log_every == 0:
                print(json.dumps({"epoch": epoch + 1, "batch": batch_index + 1, "batches": len(batches), "loss": torch.stack(losses[-args.log_every:]).mean().item(), "qat": model.qat, "tokensSeen": tokens_seen}), flush=True)
        training_qat = model.qat
        model.qat = True
        metrics = {"validation": evaluate(model, validation, args.batch, args.device), "heldout": evaluate(model, heldout, args.batch, args.device)}
        model.qat = training_qat
        entry = {"epoch": epoch + 1, "loss": torch.stack(losses).mean().item(), "seconds": time.perf_counter() - epoch_started, "qat": model.qat, "trainingSeed": training.manifest["source"], "trainingTokens": training.manifest["tokens"], **metrics}
        history.append(entry)
        checkpoint = {"model": {name: value.detach().cpu() for name, value in model.state_dict().items()}, "optimizer": optimizer.state_dict(), "config": vars(args), "epoch": epoch + 1, "metrics": metrics, "tokensSeen": tokens_seen, "labelNames": list(training.manifest["labelCounts"])}
        torch.save(checkpoint, run / "last.pt")
        score = metrics["heldout"]["tokenAccuracy"] + metrics["heldout"]["boundaryF1"]
        if score > best:
            best = score
            torch.save(checkpoint, run / "best.pt")
        report = {
            "run": args.run, "parameters": sum(parameter.numel() for parameter in model.parameters()),
            "sourceHashes": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in ["training/model.py", "training/train.py", "training/generate.py", "training/signature.py", "training/featurize.ts", "src/tokenizer.ts", "src/labels.ts"]},
            "config": vars(args), "elapsedSeconds": time.perf_counter() - started, "tokensSeen": tokens_seen,
            "training": training.manifest, "validation": validation.manifest, "heldout": heldout.manifest,
            "history": history, "status": "training" if epoch + 1 < args.epochs else "completed",
            "scope": "Quantized int6 token-role and clause-boundary evaluation on genuinely reordered held-out frames. End-to-end AST/occurrence accuracy is separate.",
        }
        (run / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(entry), flush=True)
    print(json.dumps({"stage": "completed", "checkpoint": str(run / "best.pt"), "seconds": time.perf_counter() - started}), flush=True)


if __name__ == "__main__":
    main()
