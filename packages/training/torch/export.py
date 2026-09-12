"""Export a checkpoint as int6 weights and measure the actual exported model."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch

from model import TimeTagger
from train import Dataset, evaluate
from calibrate import calibrate

TORCH = Path(__file__).resolve().parent
ROOT = TORCH.parent
CORE = ROOT.parent / "core"
BENCH = ROOT.parent / "benchmark"
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
SHIPPED = CORE / "src/model/weights.gen.ts"
GOLD = ROOT / "data/gold"
# Hand-authored, not rendered by the training generators. Sets seeded from the
# grammar (labels, grammar, grammar-variations) measure the generator against
# itself and stay out of the gate.
GOLD_SETS = ("chat", "prose", "user-cases", "negatives", "adversarial")
GUARD_Z = 1.96
GUARD_MINIMUM_SUPPORT = 30
GATE_CRITERION = (
    "Pooled exact-schedule accuracy on the hand-authored gold sets "
    f"({', '.join(GOLD_SETS)}), candidate against the shipped baseline, through "
    "the built TypeScript package. The candidate must not be worse beyond a "
    f"two-proportion z={GUARD_Z} tolerance; a tie ships and an improvement is "
    "not required. Both sides are built from their own weights module and "
    "scored by packages/benchmark/src/evaluate-model.ts in this run; stored "
    "scores are never read."
)
SYNTHETIC_NOTE = (
    "Non-blocking telemetry. The reserved-carrier and bare corpora come from "
    "the same renderers as part of training, so they measure the generator "
    "against itself. Recorded for comparison only; promotion is decided by the "
    "gold sets above."
)


def lineage(checkpoint: Path) -> list[dict]:
    result = []
    seen = set()
    while checkpoint:
        key = checkpoint.resolve()
        if key in seen:
            raise ValueError("Checkpoint ancestry contains a cycle")
        seen.add(key)
        saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
        result.append(
            {
                "checkpoint": str(checkpoint),
                "sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                "epoch": saved["epoch"],
                "trainingTokens": saved["tokensSeen"],
            }
        )
        parent = saved["config"].get("init")
        if not parent:
            break
        # Checkpoints predating the monorepo move recorded paths rooted at the
        # old repository, where this package was the "training" directory.
        candidate = Path(parent)
        if candidate.parts and candidate.parts[0] == "training":
            candidate = Path(*candidate.parts[1:])
        checkpoint = candidate if candidate.is_absolute() else ROOT / candidate
    return result


def decode(encoded: str, segments: list[dict]) -> dict[str, torch.Tensor]:
    values = {}
    for segment in segments:
        characters = encoded[segment["offset"] : segment["offset"] + segment["length"]]
        indices = np.array([ALPHABET.index(character) for character in characters])
        integers = np.where(indices % 2 == 0, indices // 2, -((indices + 1) // 2))
        scales = np.float32(segment["scale"])
        if "rowScales" in segment:
            exponents = np.array(
                [[65 - ord(character)] for character in segment["rowScales"]],
                dtype=np.int8,
            )
            scales = (scales * np.power(np.float32(2), exponents)).astype(np.float32)
        shaped = integers.reshape(segment["shape"]).astype(np.float32)
        values[segment["name"]] = torch.from_numpy(shaped * scales)
    return values


def artifact_model(artifact: dict) -> TimeTagger:
    model = TimeTagger(artifact["featureRows"]).eval()
    model.load_state_dict(decode(artifact["q"], artifact["segments"]))
    model.storage_f16 = artifact["storage"] == "f16"
    model.reference_scan = True
    return model


def read_artifact(path: Path) -> dict:
    text = path.read_text()
    return json.loads(text[text.index("{") : text.rindex("}") + 1])


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def portable(path: Path) -> str:
    return str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)


def corpus_digest(prefix: Path) -> str:
    running = hashlib.sha256()
    for suffix in ("rows", "labels", "boundaries", "kinds", "neighbors", "offsets"):
        running.update(Path(f"{prefix}.{suffix}.bin").read_bytes())
    return running.hexdigest()


def featurize(source: Path, prefix: Path):
    subprocess.run(
        # tsx, not node --experimental-strip-types: featurize imports core's
        # source, whose const enums plain type stripping cannot handle.
        ["npx", "tsx", str(ROOT / "src/featurize.ts"), str(source), str(prefix)],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )


def sequence_scores(
    model: TimeTagger, dataset: Dataset, threshold: float
) -> np.ndarray:
    correct = np.zeros(len(dataset), dtype=bool)
    with torch.no_grad():
        for indices in dataset.batches(256):
            rows, labels, boundaries, valid, neighbors = dataset.batch(indices, "cpu")
            logits, clause_logits = model(rows, valid, neighbors)
            mask = labels >= 0
            roles = ((logits.argmax(-1) == labels) | ~mask).all(1)
            clauses = (
                ((clause_logits >= threshold) == boundaries.bool()) | ~mask
            ).all(1)
            correct[indices] = (roles & clauses).numpy()
    return correct


def score(model: TimeTagger, dataset: Dataset, families: list[str], threshold: float):
    correct = sequence_scores(model, dataset, threshold)
    grouped: dict[str, dict] = {}
    for family, right in zip(families, correct):
        counts = grouped.setdefault(family, {"total": 0, "correct": 0})
        counts["total"] += 1
        counts["correct"] += int(right)
    return {
        "boundaryThreshold": threshold,
        "total": len(correct),
        "correct": int(correct.sum()),
        "families": dict(sorted(grouped.items())),
    }


def proportion_guard(candidate: dict, baseline: dict) -> dict:
    support = candidate["total"]
    if support != baseline["total"]:
        return {"passed": False, "reason": "support mismatch", "support": support}
    if support < GUARD_MINIMUM_SUPPORT:
        return {"passed": False, "reason": "insufficient support", "support": support}
    # Add-one smoothed two-proportion tolerance; a handful of examples either
    # way is sampling noise, not a regression.
    pc = (support - candidate["correct"] + 1) / (support + 2)
    pb = (support - baseline["correct"] + 1) / (support + 2)
    delta = (baseline["correct"] - candidate["correct"]) / support
    tolerance = GUARD_Z * math.sqrt((pc * (1 - pc) + pb * (1 - pb)) / support)
    return {
        "passed": delta <= tolerance,
        "reason": None if delta <= tolerance else "regression",
        "support": support,
        "delta": delta,
        "tolerance": tolerance,
    }


def family_guards(candidate: dict, baseline: dict) -> list[dict]:
    guards = []
    for family in sorted(set(candidate["families"]) | set(baseline["families"])):
        current = candidate["families"].get(family)
        before = baseline["families"].get(family)
        support = (current or {}).get("total", 0)
        reason = None
        delta = tolerance = None
        if not current or not before:
            reason = "support mismatch"
        else:
            guard = proportion_guard(current, before)
            reason = guard["reason"]
            delta = guard.get("delta")
            tolerance = guard.get("tolerance")
        guards.append(
            {
                "family": family,
                "support": support,
                "delta": delta,
                "tolerance": tolerance,
                "passed": reason is None,
                "reason": reason,
            }
        )
    return guards


def pooled(scores: dict) -> dict:
    # ponytail: one guard over the pooled sets. Per-set guards are impossible
    # here (user-cases has three rows); split them once a set clears
    # GUARD_MINIMUM_SUPPORT on its own and deserves its own veto.
    return {
        "total": sum(counts["total"] for counts in scores.values()),
        "correct": sum(counts["correct"] for counts in scores.values()),
    }


def decide(candidate: dict, baseline: dict | None, failures: list[str]) -> dict:
    """Blocking rule: hand-authored gold schedules must not regress."""
    decision = {
        "criterion": "gold-schedule-accuracy",
        "sets": sorted(candidate),
        "candidate": {**pooled(candidate), "sets": candidate},
        "baseline": None,
        "guard": None,
        "improvement": None,
        "failures": list(failures),
    }
    if baseline is not None:
        decision["baseline"] = {**pooled(baseline), "sets": baseline}
        if sorted(candidate) != sorted(baseline):
            decision["failures"].append("gold set mismatch")
        else:
            guard = proportion_guard(decision["candidate"], decision["baseline"])
            decision["guard"] = guard
            decision["improvement"] = (
                decision["candidate"]["correct"] - decision["baseline"]["correct"]
            ) / max(decision["candidate"]["total"], 1)
            if not guard["passed"]:
                decision["failures"].append(f"gold schedules: {guard['reason']}")
    decision["accepted"] = not decision["failures"]
    return decision


def synthetic(candidate: dict, baseline: dict | None) -> dict:
    """Reserved-carrier telemetry, recorded but no longer able to block."""
    return {
        "criterion": "reserved-carrier-exact-sequence",
        "candidate": candidate,
        "baseline": baseline,
        "improvement": (
            (candidate["correct"] - baseline["correct"]) / candidate["total"]
            if baseline and candidate["total"] == baseline["total"]
            else None
        ),
        "guards": family_guards(candidate, baseline) if baseline else [],
    }


def override(decision: dict) -> dict:
    return {
        **decision,
        "accepted": True,
        "forced": True,
        "criterion": "explicit-user-override",
        "overriddenCriterion": decision["criterion"],
        "overriddenFailures": decision["failures"],
        "failures": [],
    }


def score_corpus(
    path: Path,
    label: str,
    reference: TimeTagger,
    threshold: float,
    artifact: dict | None,
):
    families = [
        json.loads(line)["family"]
        for line in path.read_text().splitlines()
        if line.strip()
    ]
    with tempfile.TemporaryDirectory() as scratch:
        prefix = Path(scratch) / label
        featurize(path, prefix)
        dataset = Dataset(prefix)
        if dataset.manifest["skipped"] or len(dataset) != len(families):
            raise ValueError(f"{label} corpus did not featurize one-to-one")
        corpus = {
            "path": portable(path),
            "sha256": digest(path),
            "featurizedSha256": corpus_digest(prefix),
            "sequences": len(dataset),
            "families": len(set(families)),
        }
        candidate = score(reference, dataset, families, threshold)
        baseline = None
        if artifact:
            baseline = score(
                artifact_model(artifact),
                dataset,
                families,
                artifact["boundaryThreshold"],
            )
    return corpus, candidate, baseline


def gold_scores(weights_module: Path, scratch: Path, sets: list[str]) -> dict:
    """Exact-schedule accuracy of one weights module on the hand-authored sets.

    Builds the distributed package from that module, because the gold sets are
    scored through the parser users receive, not through core's sources.
    """
    scratch.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(CORE / "scripts/build.ts"),
            "--weights",
            str(weights_module),
            "--outdir",
            str(scratch / "dist"),
            # Size is a separate gate; do not fail promotion on the byte budget.
            "--report-only",
        ],
        cwd=CORE,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    measured = scratch / "gold.json"
    subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(BENCH / "src/evaluate-model.ts"),
            "--dist",
            str(scratch / "dist/schedule.js"),
            "--sets",
            ",".join(sets),
            "--out",
            str(measured),
        ],
        cwd=BENCH,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return {
        result["name"]: {
            "total": result["total"],
            "correct": result["correct"],
            "sha256": result["sha256"],
            "failures": [
                example["id"]
                for example in result["examples"]
                if not example["correct"]
            ],
        }
        for result in json.loads(measured.read_text())["results"]
    }


def gate(
    reference: TimeTagger,
    threshold: float,
    source: str,
    reserved: Path,
    bare: Path,
    baseline_report: Path,
):
    for corpus_path, flag in ((reserved, "--reserved"), (bare, "--bare")):
        if not corpus_path.exists():
            raise FileNotFoundError(
                f"{corpus_path} is missing; run check-natural.py {flag} to build it."
            )
    failures = []
    pinned = None
    artifact = None
    if not baseline_report.exists():
        failures.append(f"no pinned baseline at {baseline_report}")
    else:
        previous = json.loads(baseline_report.read_text())
        pinned = {
            "report": portable(baseline_report),
            "checkpoint": previous["checkpoint"],
            "checkpointSha256": previous["checkpointSha256"],
            "artifactSha256": previous["artifactSha256"],
            "artifact": portable(SHIPPED),
        }
        if not SHIPPED.exists() or digest(SHIPPED) != previous["artifactSha256"]:
            failures.append("shipped weights do not match the pinned baseline")
        else:
            artifact = read_artifact(SHIPPED)

    corpus, candidate, baseline = score_corpus(
        reserved, "reserved", reference, threshold, artifact
    )
    if baseline:
        baseline.update(pinned)
    bare_corpus, bare_candidate, bare_baseline = score_corpus(
        bare, "bare", reference, threshold, artifact
    )

    sets = [name for name in GOLD_SETS if (GOLD / f"{name}.jsonl").exists()]
    if not sets:
        failures.append(f"no gold sets under {portable(GOLD)}")
    with tempfile.TemporaryDirectory() as scratch:
        scratch = Path(scratch)
        module = scratch / "candidate/weights.gen.ts"
        module.parent.mkdir(parents=True, exist_ok=True)
        module.write_text(source)
        gold_candidate = (
            gold_scores(module, scratch / "candidate", sets) if sets else {}
        )
        gold_baseline = (
            gold_scores(SHIPPED, scratch / "baseline", sets)
            if sets and artifact
            else None
        )

    decision = decide(gold_candidate, gold_baseline, failures)
    decision["missingSets"] = [name for name in GOLD_SETS if name not in sets]
    if pinned:
        decision["baselineIdentity"] = pinned
    # Carrier-rich sentences cannot expose an over-splitting regression on terse
    # input: "Mon-Fri" collapsing to two occurrences still scores well in prose.
    decision["synthetic"] = {
        "blocking": False,
        "note": SYNTHETIC_NOTE,
        "reserved": {"corpus": corpus, **synthetic(candidate, baseline)},
        "bare": {"corpus": bare_corpus, **synthetic(bare_candidate, bare_baseline)},
    }
    if bare_baseline:
        decision["synthetic"]["bare"]["guard"] = proportion_guard(
            bare_candidate, bare_baseline
        )
    return decision


def publish(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(text)
    temporary.replace(path)


def export(
    checkpoint: Path,
    destination: Path,
    report_path: Path,
    parity_prefix: Path | None,
    reserved: Path,
    bare: Path,
    baseline_report: Path,
    force: bool,
):
    torch.set_num_threads(4)
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    reference = TimeTagger(saved["model"]["embedding"].shape[0]).eval()
    reference.load_state_dict(saved["model"])
    bits = saved["config"].get("quantization_bits", 6)
    maximum = (1 << (bits - 1)) - 1
    row_scales = saved["config"].get("row_scales", False)
    encoded = []
    segments = []
    offset = 0
    for name, parameter in reference.named_parameters():
        values = parameter.detach().numpy().astype(np.float32)
        scale = np.float32(max(float(np.abs(values).max()) / maximum, 1e-8))
        scales = scale
        exponents = None
        if row_scales and values.ndim == 2:
            row_max = np.maximum(np.abs(values).max(axis=1, keepdims=True), 1e-8)
            exponents = np.clip(
                np.ceil(np.log2(row_max / np.float32(scale * maximum))), -16, 0
            ).astype(np.int8)
            scales = (scale * np.power(np.float32(2), exponents)).astype(np.float32)
        integers = np.clip(np.rint(values / scales), -maximum, maximum).astype(np.int8)
        flat = integers.reshape(-1)
        encoded.extend(
            ALPHABET[int(value) * 2 if value >= 0 else -int(value) * 2 - 1]
            for value in flat
        )
        segments.append(
            {
                "name": name,
                "offset": offset,
                "length": int(flat.size),
                "shape": list(values.shape),
                "scale": float(scale),
                **(
                    {
                        "rowScales": "".join(
                            chr(65 - int(value)) for value in exponents.flat
                        )
                    }
                    if exponents is not None
                    else {}
                ),
            }
        )
        offset += flat.size

    config = saved["config"]
    storage = config.get("storage", "f16")
    # Measure what ships: the reference runs the values decoded back off the wire.
    wire = {"q": "".join(encoded), "segments": segments}
    reference = artifact_model(
        {**wire, "featureRows": reference.feature_rows, "storage": storage}
    )

    data = ROOT / "data/synth" / config["run"]
    validation = Dataset(data / "validation")
    heldout = Dataset(data / "heldout")
    labels = saved.get("labelNames", list(validation.manifest["labelCounts"]))
    calibration = calibrate(
        reference, {"validation": validation, "heldoutDevelopment": heldout}
    )
    threshold = calibration["threshold"]

    artifact = {
        "version": 1,
        "hidden": 32,
        "featureRows": reference.feature_rows,
        "storage": storage,
        "roleClasses": 40,
        "boundaryThreshold": threshold,
        "labels": labels,
        **wire,
    }
    # Built before the gate: the gold sets are scored through a package built
    # from this exact module.
    source = (
        "// Generated by training/export.py. The encoded string is model data, not source logic.\nexport const weights = "
        + json.dumps(artifact, separators=(",", ":"))
        + " as const;\n"
    )

    promotion = gate(reference, threshold, source, reserved, bare, baseline_report)
    if not promotion["accepted"]:
        if not force:
            raise SystemExit(
                "Export rejected: " + "; ".join(promotion["failures"]) + "\n"
                "Pass --force to override and record the override in the report."
            )
        promotion = override(promotion)
        print("Forcing export despite: " + "; ".join(promotion["overriddenFailures"]))
    promotion["description"] = GATE_CRITERION

    destination.parent.mkdir(parents=True, exist_ok=True)
    staged = destination.with_name(f"{destination.name}.{os.getpid()}.tmp")
    staged.write_text(source)
    brotli_script = "import {readFileSync} from 'node:fs';import {brotliCompressSync} from 'node:zlib';process.stdout.write(String(brotliCompressSync(readFileSync(process.argv[1])).length));"
    brotli = int(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", brotli_script, str(staged)],
            cwd=ROOT,
            text=True,
        )
    )
    metrics = {
        "validation": evaluate(reference, validation, 256, "cpu", threshold),
        "heldout": evaluate(reference, heldout, 256, "cpu", threshold),
    }
    ancestry = lineage(checkpoint)
    report = {
        "checkpoint": str(checkpoint),
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        "artifactSha256": hashlib.sha256(source.encode()).hexdigest(),
        "boundaryThreshold": threshold,
        "calibration": calibration,
        "epoch": saved["epoch"],
        "tokensSeenAtCheckpoint": sum(item["trainingTokens"] for item in ancestry),
        "lineage": ancestry,
        "parameters": int(offset),
        "quantizationBits": bits,
        "quantizationScheme": "power-of-two-rows" if row_scales else "tensor",
        "logicalPackedBytes": int(np.ceil(offset * bits / 8)),
        "encodedCharacters": len(encoded),
        "moduleBytes": len(source.encode()),
        "moduleGzipBytes": len(gzip.compress(source.encode(), mtime=0)),
        "moduleBrotliBytes": brotli,
        "labels": labels,
        "metrics": metrics,
        "corpora": {
            "validation": corpus_digest(data / "validation"),
            "heldout": corpus_digest(data / "heldout"),
            "reservedCarrier": promotion["synthetic"]["reserved"]["corpus"][
                "featurizedSha256"
            ],
        },
        "promotion": promotion,
        "scope": f"Exact decoded int{bits} weights, sequential CPU PyTorch inference reference with the recorded intermediate precision. Training uses the mathematically equivalent parallel affine scan. The heldout metrics share the split calibrate() fitted the boundary threshold on and gate nothing, as do the reserved-carrier and bare corpora under promotion.synthetic. Promotion is decided by end-to-end schedule accuracy on the hand-authored gold sets. Browser parity is a separate gate.",
    }
    if parity_prefix:
        indices = np.arange(min(512, len(heldout)))
        rows, targets, boundaries, valid, neighbors = heldout.batch(indices, "cpu")
        with torch.no_grad():
            logits, clause_logits = reference(rows, valid, neighbors)
        parity_prefix.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            f"{parity_prefix}.npz",
            rows=rows.numpy(),
            targets=targets.numpy(),
            boundaries=boundaries.numpy(),
            valid=valid.numpy(),
            neighbors=neighbors.numpy(),
            logits=logits.numpy(),
            clause_logits=clause_logits.numpy(),
        )
        lengths = valid.sum(1).numpy().astype(np.uint32)
        offsets = np.concatenate(
            (np.array([0], dtype=np.uint32), np.cumsum(lengths, dtype=np.uint32))
        )
        wire_rows = rows.numpy()[valid.numpy()].astype(np.uint16)
        wire_logits = logits.numpy()[valid.numpy()].astype(np.float32)
        wire_boundaries = clause_logits.numpy()[valid.numpy()].astype(np.float32)
        for suffix, values in [
            ("rows", wire_rows),
            ("logits", wire_logits),
            ("boundaries", wire_boundaries),
            ("offsets", offsets),
        ]:
            values.tofile(f"{parity_prefix}.{suffix}.bin")
        report["parity"] = {
            "prefix": portable(parity_prefix),
            "sequences": len(indices),
            "tokens": int(lengths.sum()),
            "rowsPerToken": 17,
            "rolesPerToken": 40,
            "boundaryThreshold": threshold,
        }
        publish(
            Path(f"{parity_prefix}.json"),
            json.dumps(report["parity"], indent=2) + "\n",
        )
    source_directory = ROOT / "exports" / report["artifactSha256"] / "source"
    report["exportSourceDirectory"] = str(source_directory.relative_to(ROOT))
    report["exportSourceHashes"] = {}
    # Snapshot names keep the pre-monorepo layout so earlier exports stay
    # comparable; only the sources they are copied from moved.
    for name, path in {
        "training/export.py": TORCH / "export.py",
        "training/calibrate.py": TORCH / "calibrate.py",
        "training/model.py": TORCH / "model.py",
        "training/train.py": TORCH / "train.py",
        "training/uv.lock": ROOT / "uv.lock",
    }.items():
        content = path.read_bytes()
        target = source_directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        report["exportSourceHashes"][name] = hashlib.sha256(content).hexdigest()
    staged.replace(destination)
    # Published last: the report's presence is what marks the export committed.
    publish(report_path, json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=SHIPPED)
    parser.add_argument(
        "--report", type=Path, default=ROOT / "active/export-report.json"
    )
    parser.add_argument("--parity", type=Path, default=ROOT / "active/parity")
    parser.add_argument(
        "--reserved", type=Path, default=ROOT / "data/synth/natural-reserved.jsonl"
    )
    parser.add_argument(
        "--bare", type=Path, default=ROOT / "data/synth/natural-bare.jsonl"
    )
    parser.add_argument(
        "--baseline", type=Path, default=ROOT / "active/export-report.json"
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    export(
        args.checkpoint,
        args.out,
        args.report,
        args.parity,
        args.reserved,
        args.bare,
        args.baseline,
        args.force,
    )
