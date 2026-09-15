"""Train the contextual tagger and write measured evaluation/checkpoint artifacts."""

from __future__ import annotations

import argparse
import json
import hashlib
import math
import subprocess
import time
from functools import cache
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

from model import PADDING_ROW, ROLE_CLASSES, TimeTagger, crf_nll

LABEL_O = 0
LABEL_GLUE = 32

TORCH = Path(__file__).resolve().parent
ROOT = TORCH.parent
CORE = ROOT.parent / "core"


def featurize(source: Path, prefix: Path):
    subprocess.run(
        [
            # tsx, not node --experimental-strip-types: featurize imports core's
            # source, whose internal ".js" specifiers and const enum Node cannot
            # handle. See AGENTS.md.
            "npx",
            "tsx",
            str(ROOT / "src" / "featurize.ts"),
            str(source),
            str(prefix),
        ],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )


def merge_manifests(first: dict, second: dict) -> dict:
    """What featurize.ts would have written had both inputs been one file."""
    merged = dict(first)
    for key in ("sequences", "tokens", "nonSpaceTokens", "skipped", "positiveBoundaries"):
        merged[key] = first[key] + second[key]
    merged["maxLength"] = max(first["maxLength"], second["maxLength"])
    merged["labelCounts"] = {
        label: count + second["labelCounts"][label]
        for label, count in first["labelCounts"].items()
    }
    for key in ("templates", "fingerprints"):
        merged[key] = sorted(set(first[key]) | set(second[key]))
    return merged


class Dataset:
    def __init__(self, prefix: Path):
        self.rows = np.fromfile(f"{prefix}.rows.bin", dtype=np.uint16).reshape(-1, 17)
        self.labels = np.fromfile(f"{prefix}.labels.bin", dtype=np.uint8)
        self.boundaries = np.fromfile(f"{prefix}.boundaries.bin", dtype=np.uint8)
        self.kinds = np.fromfile(f"{prefix}.kinds.bin", dtype=np.uint8)
        self.neighbors = np.fromfile(f"{prefix}.neighbors.bin", dtype=np.int16).reshape(
            -1, 2
        )
        self.offsets = np.fromfile(f"{prefix}.offsets.bin", dtype=np.uint32)
        self.lengths = np.diff(self.offsets)
        self.manifest = json.loads(Path(f"{prefix}.json").read_text())

    def __len__(self):
        return len(self.lengths)

    def extend(self, other: "Dataset"):
        """Append another dataset's rows. Neighbors index within a sequence, so they carry over."""
        tokens = np.uint32(len(self.labels))
        for name in ("rows", "labels", "boundaries", "kinds", "neighbors"):
            setattr(self, name, np.concatenate((getattr(self, name), getattr(other, name))))
        self.offsets = np.concatenate((self.offsets, other.offsets[1:] + tokens))
        self.lengths = np.diff(self.offsets)
        self.manifest = merge_manifests(self.manifest, other.manifest)

    def batch(self, indices: np.ndarray, device: str):
        length = int(self.lengths[indices].max())
        length = 32 if length <= 32 else 64 if length <= 64 else 128
        rows = np.full((len(indices), length, 17), PADDING_ROW, dtype=np.int64)
        labels = np.full((len(indices), length), -100, dtype=np.int64)
        boundaries = np.zeros((len(indices), length), dtype=np.float32)
        valid = np.zeros((len(indices), length), dtype=np.bool_)
        neighbors = np.full((len(indices), length, 2), -1, dtype=np.int64)
        for destination, index in enumerate(indices):
            start, end = self.offsets[index : index + 2]
            size = int(end - start)
            rows[destination, :size] = self.rows[start:end]
            labels[destination, :size] = np.where(
                self.kinds[start:end] == 3,
                -100,
                self.labels[start:end].astype(np.int64),
            )
            boundaries[destination, :size] = self.boundaries[start:end]
            valid[destination, :size] = True
            neighbors[destination, :size] = self.neighbors[start:end]
        return tuple(
            torch.from_numpy(value).to(device)
            for value in (rows, labels, boundaries, valid, neighbors)
        )

    def batches(self, batch_size: int, rng: np.random.Generator | None = None):
        batches = []
        for lower, upper in [(0, 32), (32, 64), (64, 128)]:
            indices = np.flatnonzero((self.lengths > lower) & (self.lengths <= upper))
            if rng is not None:
                rng.shuffle(indices)
            batches.extend(
                indices[start : start + batch_size]
                for start in range(0, len(indices), batch_size)
            )
        if rng is not None:
            rng.shuffle(batches)
        return batches


def evaluate(
    model: TimeTagger,
    dataset: Dataset,
    batch_size: int,
    device: str,
    boundary_threshold: float = 0,
) -> dict:
    model.eval()
    correct = total = sequences = exact = true_positive = false_positive = (
        false_negative
    ) = 0
    with torch.no_grad():
        for indices in dataset.batches(batch_size):
            rows, labels, boundaries, valid, neighbors = dataset.batch(indices, device)
            logits, boundary_logits = model(rows, valid, neighbors)
            mask = labels >= 0
            roles = model.decode(logits, mask)
            predicted_boundaries = boundary_logits >= boundary_threshold
            right = (roles == labels) | ~mask
            boundary_right = (predicted_boundaries == boundaries.bool()) | ~mask
            correct += ((roles == labels) & mask).sum().item()
            total += mask.sum().item()
            exact += (right.all(1) & boundary_right.all(1)).sum().item()
            sequences += len(indices)
            true_positive += (
                (predicted_boundaries & boundaries.bool() & mask).sum().item()
            )
            false_positive += (
                (predicted_boundaries & ~boundaries.bool() & mask).sum().item()
            )
            false_negative += (
                (~predicted_boundaries & boundaries.bool() & mask).sum().item()
            )
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    return {
        "tokens": total,
        "sequences": sequences,
        "tokenAccuracy": correct / max(1, total),
        "exactLabelAndBoundarySequence": exact / max(1, sequences),
        "boundaryPrecision": precision,
        "boundaryRecall": recall,
        "boundaryF1": 2 * precision * recall / max(1e-12, precision + recall),
        "boundaryCounts": {
            "truePositive": true_positive,
            "falsePositive": false_positive,
            "falseNegative": false_negative,
        },
    }


def viterbi_on_device(emissions, transition, mask):
    """Best path per sequence, float32 and on the training device.

    Mirrors model.decode; training does not need its float64 tie-breaking.
    """
    roles = torch.zeros_like(mask, dtype=torch.long)
    best = torch.zeros_like(emissions[:, 0])
    started = torch.zeros_like(mask[:, 0])
    pointers = []
    for step in range(emissions.shape[1]):
        scores, previous = (best.unsqueeze(2) + transition).max(dim=1)
        scores = torch.where(started.unsqueeze(1), scores, torch.zeros_like(scores))
        scores = scores + emissions[:, step]
        best = torch.where(mask[:, step, None], scores, best)
        started = started | mask[:, step]
        pointers.append(previous)
    current = best.argmax(-1)
    for step in reversed(range(emissions.shape[1])):
        roles[:, step] = torch.where(mask[:, step], current, torch.zeros_like(current))
        previous = pointers[step].gather(1, current.unsqueeze(1)).squeeze(1)
        current = torch.where(mask[:, step], previous, current)
    return roles


def path_score(emissions, transition, path, mask):
    """Score of one label path under the CRF, over scored tokens only."""
    zero = emissions.new_zeros(())
    started = mask[:, 0]
    score = torch.where(
        mask[:, 0], emissions[:, 0].gather(1, path[:, :1]).squeeze(1), zero
    )
    previous = path[:, 0]
    for step in range(1, emissions.shape[1]):
        live = mask[:, step]
        current = path[:, step]
        step_score = emissions[:, step].gather(1, current.unsqueeze(1)).squeeze(1)
        step_score = step_score + torch.where(started, transition[previous, current], zero)
        score = score + torch.where(live, step_score, zero)
        previous = torch.where(live, current, previous)
        started = started | live
    return score


@cache
def featurize_real(real: Path, directory: Path) -> Dataset:
    """Featurize the real corpus once per run. Its sha256 is the cache key."""
    prefix = directory / "real"
    with real.open("rb") as handle:
        key = hashlib.file_digest(handle, "sha256").hexdigest()
    stamp = directory / "real.key"
    if not (stamp.exists() and stamp.read_text() == key):
        featurize(real, prefix)
        stamp.write_text(key)
    return Dataset(prefix)


def prepare(
    split: str, count: int, seed: int, directory: Path, real: Path | None = None
) -> Dataset:
    prefix = directory / split
    command = [
        "uv",
        "run",
        "--project",
        str(ROOT),
        "python",
        str(TORCH / "generate.py"),
        "--count",
        str(count),
        "--seed",
        str(seed),
        "--split",
        split,
        "--out",
        f"{prefix}.jsonl",
    ]
    # Evaluation splits are drawn first and fixed; every training epoch avoids them.
    for name in ("heldout", "validation"):
        if name != split and (directory / f"{name}.fingerprints.json").exists():
            command.extend(
                ["--exclude", str(directory / f"{name}.fingerprints.json")]
            )
    subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    featurize(Path(f"{prefix}.jsonl"), prefix)
    dataset = Dataset(prefix)
    if split == "train" and real is not None:
        # The real corpus is identical every epoch; join the cached features instead.
        dataset.extend(featurize_real(real, directory))
    return dataset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--quantization-bits", type=int, choices=[4, 5, 6], default=6)
    parser.add_argument("--row-scales", action="store_true")
    parser.add_argument("--samples", type=int, default=300000)
    parser.add_argument("--eval-samples", type=int, default=10000)
    parser.add_argument("--batch", type=int, default=512)
    parser.add_argument("--seed", type=int, default=20260909)
    parser.add_argument("--qat-start", type=int, default=14)
    parser.add_argument("--run", default="main")
    parser.add_argument(
        "--init",
        type=Path,
        help="Initialize weights from an earlier checkpoint; optimizer starts fresh.",
    )
    parser.add_argument("--learning-rate", type=float, default=3e-3)
    parser.add_argument("--storage", choices=["f16", "f32"], default="f16")
    parser.add_argument("--feature-rows", type=int, choices=[324, 580], default=580)
    parser.add_argument("--layers", type=int, choices=[1, 2, 3], default=1)
    parser.add_argument(
        "--transitions",
        action="store_true",
        help="Learn a role transition matrix and train the roles as a CRF.",
    )
    parser.add_argument(
        "--freeze-transitions",
        action="store_true",
        help="Keep a warm-started CRF transition matrix fixed while training emissions.",
    )
    parser.add_argument(
        "--distill",
        type=Path,
        help="Reference checkpoint for focal distillation against negative flips.",
    )
    parser.add_argument("--distill-lambda", type=float, default=1.0)
    parser.add_argument("--distill-alpha", type=float, default=1.0)
    parser.add_argument("--distill-beta", type=float, default=5.0)
    parser.add_argument(
        "--device", default="mps" if torch.backends.mps.is_available() else "cpu"
    )
    parser.add_argument(
        "--real",
        type=Path,
        help="Labelled real sentences appended to every training epoch.",
    )
    parser.add_argument(
        "--risk-lambda",
        type=float,
        default=0.0,
        help="Weight on the sequence-level ranking loss. 0 disables it.",
    )
    parser.add_argument("--risk-margin", type=float, default=4.0)
    parser.add_argument("--identity-dropout", type=float, default=0.0)
    parser.add_argument(
        "--role-weighting", choices=["sqrt", "sqrt-keep-o", "none"], default="sqrt"
    )
    parser.add_argument("--log-every", type=int, default=50)
    parser.add_argument("--heldout-every", type=int, default=5)
    parser.add_argument(
        "--save-epochs",
        action="store_true",
        help="Also retain each epoch checkpoint for external gate selection.",
    )
    parser.add_argument("--warmup-steps", type=int, default=500)
    parser.add_argument(
        "--fresh-each-epoch", action=argparse.BooleanOptionalAction, default=True
    )
    args = parser.parse_args()
    torch.manual_seed(args.seed)
    torch.set_num_threads(8)
    rng = np.random.default_rng(args.seed)
    run = ROOT / "runs" / args.run
    run.mkdir(parents=True, exist_ok=True)
    directory = ROOT / "data" / "synth" / args.run
    directory.mkdir(parents=True, exist_ok=True)
    print(
        json.dumps(
            {
                "stage": "preparing-data",
                "run": args.run,
                "device": args.device,
                "samplesPerEpoch": args.samples,
            }
        ),
        flush=True,
    )
    heldout = prepare("heldout", args.eval_samples, args.seed + 2, directory)
    validation = prepare("validation", args.eval_samples, args.seed + 1, directory)
    training = prepare("train", args.samples, args.seed, directory, args.real)
    seen = set(training.manifest["fingerprints"])
    for name, split in (("held-out", heldout), ("validation", validation)):
        if seen & set(split.manifest["fingerprints"]):
            raise RuntimeError(f"Training and {name} structural frames overlap")

    model = TimeTagger(args.feature_rows, args.layers, args.transitions).to(
        args.device
    )
    if args.init:
        initial = torch.load(args.init, map_location="cpu", weights_only=False)
        previous_labels = initial["labelNames"]
        current_labels = list(training.manifest["labelCounts"])
        if previous_labels != current_labels:
            # Preserve each role by name when the public label vocabulary changes.
            weights = initial["model"]["output_weight"].clone()
            biases = initial["model"]["output_bias"].clone()
            initial["model"]["output_weight"][:ROLE_CLASSES].zero_()
            initial["model"]["output_bias"][:ROLE_CLASSES].fill_(
                biases[:ROLE_CLASSES].min().item()
            )
            for index, label in enumerate(current_labels):
                if label in previous_labels:
                    source = previous_labels.index(label)
                    initial["model"]["output_weight"][index] = weights[source]
                    initial["model"]["output_bias"][index] = biases[source]
        # Load by name and shape; tensors the checkpoint lacks (a second scan
        # layer, the transition matrix) keep their fresh initialization.
        current = model.state_dict()
        usable = {
            name: value
            for name, value in initial["model"].items()
            if name in current and value.shape == current[name].shape
        }
        missing = sorted(set(current) - set(usable))
        if missing:
            print(json.dumps({"stage": "fresh-tensors", "names": missing}), flush=True)
        model.load_state_dict(usable, strict=False)
        args.init = str(args.init)
    if args.freeze_transitions:
        if not args.transitions or not args.init:
            raise ValueError("--freeze-transitions requires --transitions and --init")
        model.transition.requires_grad_(False)
    reference = None
    if args.distill:
        # Focal distillation (Yan et al., CVPR 2021): match the reference's
        # emissions, weighting the tokens it already gets right.
        reference = TimeTagger(args.feature_rows, args.layers, args.transitions).to(
            args.device
        )
        saved = torch.load(args.distill, map_location=args.device)["model"]
        reference.load_state_dict(
            {
                name: value
                for name, value in saved.items()
                if name in reference.state_dict()
                and value.shape == reference.state_dict()[name].shape
            },
            strict=False,
        )
        reference.eval()
        reference.requires_grad_(False)
        args.distill = str(args.distill)
    role_weights = None
    if args.role_weighting != "none":
        # COUNT and BOUND_START see ~2,000 tokens against O's ~2,000,000. Weight
        # by 1/sqrt(count), normalised so the mean weight over labels is 1.
        counts = np.array(
            [max(count, 1) for count in training.manifest["labelCounts"].values()],
            dtype=np.float64,
        )
        named = 1 / np.sqrt(counts)
        if args.role_weighting == "sqrt-keep-o":
            # Pin O at 1.0; plain sqrt makes abstaining the cheapest label.
            named[LABEL_O] = 0
            named /= named[named > 0].mean()
            named[LABEL_O] = 1.0
        else:
            named /= named.mean()
        # The reserved output slots are never a target; leave them at the mean
        # so they cannot skew the normalisation.
        weights = np.ones(ROLE_CLASSES, dtype=np.float64)
        weights[: len(named)] = named
        role_weights = torch.tensor(weights, dtype=torch.float32, device=args.device)
    model.quantization_bits = args.quantization_bits
    model.row_scales = args.row_scales
    model.storage_f16 = args.storage == "f16"
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=0.01
    )
    # The snapshot names stay on the pre-monorepo layout so that the Python
    # files keep landing side by side in source/training/ (their intra-directory
    # imports depend on it) and older runs stay readable by the same consumers.
    sources = {
        "training/model.py": TORCH / "model.py",
        "training/train.py": TORCH / "train.py",
        "training/generate.py": TORCH / "generate.py",
        "training/semantic.py": TORCH / "semantic.py",
        "training/natural.py": TORCH / "natural.py",
        "training/background.py": TORCH / "background.py",
        "training/signature.py": TORCH / "signature.py",
        "training/featurize.ts": ROOT / "src" / "featurize.ts",
        "src/tokenizer.ts": CORE / "src" / "tokenizer.ts",
        "src/labels.ts": CORE / "src" / "labels.ts",
    }
    source_hashes = {}
    for name, path in sources.items():
        content = path.read_bytes()
        target = run / "source" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        source_hashes[name] = hashlib.sha256(content).hexdigest()
    # Borrowed prose is training input but too large to snapshot. Its hash goes
    # beside sourceHashes, which audit-model reads as files under source/.
    dataset_hashes = {}
    prose = ROOT / "data" / "prose" / "sentences.txt"
    if prose.exists():
        dataset_hashes["data/prose/sentences.txt"] = hashlib.sha256(
            prose.read_bytes()
        ).hexdigest()
    history = []
    best = -1.0
    step = 0
    tokens_seen = 0
    started = time.perf_counter()
    for epoch in range(args.epochs):
        if epoch > 0 and args.fresh_each_epoch:
            training = prepare(
                "train", args.samples, args.seed + epoch * 101, directory, args.real
            )
        model.train()
        model.qat = epoch >= args.qat_start
        batches = training.batches(args.batch, rng)
        losses = []
        epoch_started = time.perf_counter()
        for batch_index, indices in enumerate(batches):
            step += 1
            progress = (epoch + batch_index / len(batches)) / args.epochs
            learning_rate = (
                1e-4
                + (args.learning_rate - 1e-4) * (1 + math.cos(math.pi * progress)) / 2
            ) * min(1, step / args.warmup_steps)
            for group in optimizer.param_groups:
                group["lr"] = learning_rate
            rows, labels, boundaries, valid, neighbors = training.batch(
                indices, args.device
            )
            if args.identity_dropout > 0:
                # Filler only: "half past" and "quarter to" need their words.
                filler = (labels == LABEL_O) | (labels == LABEL_GLUE)
                identity = (rows >= 140) & (rows < 524)
                hidden = (
                    identity
                    & filler.unsqueeze(-1)
                    & (
                        torch.rand(rows.shape, device=rows.device)
                        < args.identity_dropout
                    )
                )
                rows = rows.masked_fill(hidden, PADDING_ROW)
            logits, boundary_logits = model(rows, valid, neighbors)
            mask = labels >= 0
            role_loss = (
                # ponytail: CRF path ignores --role-weighting; per-class weights
                # would have to reweight the whole sequence NLL. Add if rare
                # roles regress under --transitions.
                crf_nll(logits, model.weight("transition"), labels, mask)
                if args.transitions
                else F.cross_entropy(
                    logits.reshape(-1, ROLE_CLASSES),
                    labels.reshape(-1),
                    weight=role_weights,
                    ignore_index=-100,
                    label_smoothing=0.05,
                )
            )
            boundary_loss = F.binary_cross_entropy_with_logits(
                boundary_logits[mask],
                boundaries[mask],
                pos_weight=torch.tensor(8.0, device=args.device),
            )
            loss = role_loss + 0.5 * boundary_loss
            if args.risk_lambda and args.transitions:
                # Where the decoded path is wrong, lift the gold path above it.
                transition = model.weight("transition")
                with torch.no_grad():
                    predicted = viterbi_on_device(logits.detach(), transition.detach(), mask)
                wrong = ((predicted != labels) & mask).any(1)
                if wrong.any():
                    gold_path = path_score(logits, transition, labels.clamp_min(0), mask)
                    best_path = path_score(logits, transition, predicted, mask)
                    penalty = F.softplus(best_path + args.risk_margin - gold_path)
                    loss = loss + args.risk_lambda * (
                        (penalty * wrong.float()).sum() / wrong.float().sum()
                    )
            if reference is not None:
                reference.qat = model.qat
                with torch.no_grad():
                    reference_logits, _ = reference(rows, valid, neighbors)
                kept = mask.unsqueeze(-1).expand_as(logits)
                right = (reference_logits.argmax(-1) == labels) & mask
                weight = args.distill_alpha + args.distill_beta * right.float()
                squared = 0.5 * ((logits - reference_logits) ** 2).sum(-1)
                loss = loss + args.distill_lambda * (
                    (weight * mask.float() * squared).sum()
                    / mask.sum().clamp(min=1)
                    / (args.distill_alpha + args.distill_beta)
                )
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(loss.detach())
            tokens_seen += int(training.lengths[indices].sum())
            if batch_index % args.log_every == 0:
                print(
                    json.dumps(
                        {
                            "epoch": epoch + 1,
                            "batch": batch_index + 1,
                            "batches": len(batches),
                            "loss": torch.stack(losses[-args.log_every :])
                            .mean()
                            .item(),
                            "qat": model.qat,
                            "tokensSeen": tokens_seen,
                        }
                    ),
                    flush=True,
                )
        training_qat = model.qat
        model.qat = True
        # Only validation picks the saved epoch; heldout is reporting, and
        # decoding it every epoch costs about a sixth of the run.
        last = epoch + 1 == args.epochs
        metrics = {"validation": evaluate(model, validation, args.batch, args.device)}
        if last or (epoch + 1) % args.heldout_every == 0:
            metrics["heldout"] = evaluate(model, heldout, args.batch, args.device)
        model.qat = training_qat
        entry = {
            "epoch": epoch + 1,
            "loss": torch.stack(losses).mean().item(),
            "seconds": time.perf_counter() - epoch_started,
            "qat": model.qat,
            "trainingSeed": training.manifest["source"],
            "trainingTokens": training.manifest["tokens"],
            **metrics,
        }
        history.append(entry)
        checkpoint = {
            "model": {
                name: value.detach().cpu() for name, value in model.state_dict().items()
            },
            "optimizer": optimizer.state_dict(),
            # Paths here would need an allowlist to load with weights_only.
            "config": {
                key: str(value) if isinstance(value, Path) else value
                for key, value in vars(args).items()
            },
            "epoch": epoch + 1,
            "metrics": metrics,
            "tokensSeen": tokens_seen,
            "labelNames": list(training.manifest["labelCounts"]),
        }
        torch.save(checkpoint, run / "last.pt")
        if args.save_epochs:
            torch.save(checkpoint, run / f"epoch-{epoch + 1}.pt")
        score = (
            metrics["validation"]["tokenAccuracy"]
            + metrics["validation"]["exactLabelAndBoundarySequence"]
        )
        if score > best:
            best = score
            torch.save(checkpoint, run / "best.pt")
        report = {
            "selectionCriterion": "Validation token accuracy plus exact label-and-boundary sequence accuracy; final acceptance uses resolved results.",
            "run": args.run,
            "parameters": sum(parameter.numel() for parameter in model.parameters()),
            "sourceHashes": source_hashes,
            "datasetHashes": dataset_hashes,
            "config": vars(args),
            "elapsedSeconds": time.perf_counter() - started,
            "tokensSeen": tokens_seen,
            "training": training.manifest,
            "validation": validation.manifest,
            "heldout": heldout.manifest,
            "history": history,
            "status": "training" if epoch + 1 < args.epochs else "completed",
            "scope": f"Quantized int{args.quantization_bits} token-role and clause-boundary evaluation on genuinely reordered held-out frames. End-to-end AST/occurrence accuracy is separate.",
        }
        # config carries Path values for --init, --distill and --real.
        (run / "report.json").write_text(
            json.dumps(report, indent=2, default=str) + "\n"
        )
        print(json.dumps(entry, default=str), flush=True)
    print(
        json.dumps(
            {
                "stage": "completed",
                "checkpoint": str(run / "best.pt"),
                "seconds": time.perf_counter() - started,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
