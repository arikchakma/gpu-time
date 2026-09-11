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
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
SHIPPED = CORE / "src/model/weights.gen.ts"
GUARD_Z = 1.96
GUARD_MINIMUM_SUPPORT = 30
GATE_CRITERION = (
    "Strict improvement in exact label-and-boundary sequences on the reserved "
    "carrier corpus, with no per-family regression beyond a two-proportion "
    f"z={GUARD_Z} tolerance. Both sides are decoded from their wire artifacts and "
    "re-scored in this process on this corpus; stored scores are never read. "
    "The heldout split is excluded because calibrate() fits the boundary "
    "threshold on it."
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
        checkpoint = ROOT / parent
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


def family_guards(candidate: dict, baseline: dict) -> list[dict]:
    guards = []
    for family in sorted(set(candidate["families"]) | set(baseline["families"])):
        current = candidate["families"].get(family)
        before = baseline["families"].get(family)
        support = (current or {}).get("total", 0)
        reason = None
        delta = tolerance = None
        if not current or not before or current["total"] != before["total"]:
            reason = "support mismatch"
        elif support < GUARD_MINIMUM_SUPPORT:
            reason = "insufficient support"
        else:
            # Add-one smoothed two-proportion tolerance; at n~62 a handful of
            # examples either way is sampling noise, not a regression.
            pc = (support - current["correct"] + 1) / (support + 2)
            pb = (support - before["correct"] + 1) / (support + 2)
            delta = (before["correct"] - current["correct"]) / support
            tolerance = GUARD_Z * math.sqrt((pc * (1 - pc) + pb * (1 - pb)) / support)
            if delta > tolerance:
                reason = "regression"
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


def decide(candidate: dict, baseline: dict | None, failures: list[str]) -> dict:
    decision = {
        "criterion": "reserved-carrier-exact-sequence",
        "candidate": candidate,
        "baseline": baseline,
        "improvement": None,
        "guards": [],
        "failures": list(failures),
    }
    if baseline:
        if candidate["total"] != baseline["total"]:
            decision["failures"].append("evaluation support mismatch")
        else:
            decision["improvement"] = (
                candidate["correct"] - baseline["correct"]
            ) / candidate["total"]
            if candidate["correct"] <= baseline["correct"]:
                decision["failures"].append(
                    "reserved-carrier exact sequences did not improve"
                )
        decision["guards"] = family_guards(candidate, baseline)
        decision["failures"].extend(
            f"{guard['family']}: {guard['reason']}"
            for guard in decision["guards"]
            if not guard["passed"]
        )
    decision["accepted"] = not decision["failures"]
    return decision


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


def gate(
    reference: TimeTagger, threshold: float, reserved: Path, baseline_report: Path
):
    if not reserved.exists():
        raise FileNotFoundError(
            f"{reserved} is missing; run check-natural.py --reserved to build it."
        )
    families = [
        json.loads(line)["family"]
        for line in reserved.read_text().splitlines()
        if line.strip()
    ]
    with tempfile.TemporaryDirectory() as scratch:
        prefix = Path(scratch) / "reserved"
        featurize(reserved, prefix)
        dataset = Dataset(prefix)
        if dataset.manifest["skipped"] or len(dataset) != len(families):
            raise ValueError("Reserved carrier corpus did not featurize one-to-one")
        corpus = {
            "path": portable(reserved),
            "sha256": digest(reserved),
            "featurizedSha256": corpus_digest(prefix),
            "sequences": len(dataset),
            "families": len(set(families)),
        }
        candidate = score(reference, dataset, families, threshold)
        failures = []
        baseline = None
        pinned = None
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
                baseline = score(
                    artifact_model(artifact),
                    dataset,
                    families,
                    artifact["boundaryThreshold"],
                )
                baseline.update(pinned)
    decision = decide(candidate, baseline, failures)
    if baseline is None and pinned:
        decision["baselineIdentity"] = pinned
    decision["corpus"] = corpus
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

    promotion = gate(reference, threshold, reserved, baseline_report)
    if not promotion["accepted"]:
        if not force:
            raise SystemExit(
                "Export rejected: " + "; ".join(promotion["failures"]) + "\n"
                "Pass --force to override and record the override in the report."
            )
        promotion = override(promotion)
        print("Forcing export despite: " + "; ".join(promotion["overriddenFailures"]))
    promotion["description"] = GATE_CRITERION

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
    source = (
        "// Generated by training/export.py. The encoded string is model data, not source logic.\nexport const weights = "
        + json.dumps(artifact, separators=(",", ":"))
        + " as const;\n"
    )
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
            "reservedCarrier": promotion["corpus"]["featurizedSha256"],
        },
        "promotion": promotion,
        "scope": f"Exact decoded int{bits} weights, sequential CPU PyTorch inference reference with the recorded intermediate precision. Training uses the mathematically equivalent parallel affine scan. The heldout metrics share the split calibrate() fitted the boundary threshold on and gate nothing. Browser parity and end-to-end schedule accuracy are separate gates.",
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
        args.baseline,
        args.force,
    )
