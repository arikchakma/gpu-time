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

from model import ROLE_CLASSES, TimeTagger, decode as decode_roles
from train import Dataset, evaluate, featurize
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
GATE_CRITERION = (
    "Exact schedules must not regress in any gold set or family. Reserved-carrier "
    "exact decoded labels and boundaries must improve, or tie an already perfect "
    "baseline, without a family regression. Bare expressions must not regress. Both models are measured "
    "on the same frozen corpora in this run; stored scores are never reused."
)
SYNTHETIC_NOTE = (
    "Regression gates for generated language coverage, not estimates of real-user "
    "accuracy. Scores use the deployed decoder and include filler labels."
)


def checkpoint_path(recorded: str) -> Path:
    # Checkpoints predating the monorepo move used a leading "training".
    candidate = Path(recorded)
    if candidate.parts and candidate.parts[0] == "training":
        candidate = Path(*candidate.parts[1:])
    return candidate if candidate.is_absolute() else ROOT / candidate


def lineage(checkpoint: Path) -> list[dict]:
    """Return unique checkpoint ancestors in deterministic depth-first order."""
    result: list[dict] = []
    seen: set[Path] = set()
    visiting: set[Path] = set()

    def visit(path: Path, expected_hash: str | None = None) -> None:
        path = path.resolve()
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if expected_hash is not None and actual_hash != expected_hash:
            raise ValueError(f"Checkpoint parent hash mismatch: {path}")
        if path in visiting:
            raise ValueError("Checkpoint ancestry contains a cycle")
        if path in seen:
            return
        visiting.add(path)
        saved = torch.load(path, map_location="cpu", weights_only=True)
        result.append(
            {
                "checkpoint": portable(path),
                "sha256": actual_hash,
                "epoch": saved["epoch"],
                "trainingTokens": saved["tokensSeen"],
            }
        )
        parent = saved["config"].get("init")
        if parent:
            visit(checkpoint_path(parent))
        for parent in saved["config"].get("provenanceParents", []):
            visit(checkpoint_path(parent["checkpoint"]), parent["sha256"])
        visiting.remove(path)
        seen.add(path)

    visit(checkpoint)
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
    model = TimeTagger(
        artifact["featureRows"],
        artifact.get("layers", 1),
        artifact.get("transitions", False),
    ).eval()
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


def sequence_scores(
    model: TimeTagger, dataset: Dataset, threshold: float
) -> np.ndarray:
    correct = np.zeros(len(dataset), dtype=bool)
    with torch.no_grad():
        for indices in dataset.batches(256):
            rows, labels, boundaries, valid, neighbors = dataset.batch(indices, "cpu")
            logits, clause_logits = model(rows, valid, neighbors)
            mask = labels >= 0
            roles = ((model.decode(logits, mask) == labels) | ~mask).all(1)
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


# Seed noise moves a few percent of examples, so a group must lose more than
# chance explains. Groups below MINIMUM_SUPPORT warn instead of failing.
MINIMUM_SUPPORT = 10
SIGNIFICANCE = 0.05


def flips(candidate: dict, baseline: dict) -> dict:
    """Examples the update fixed and broke, read from the recorded failures."""
    before = set(baseline.get("failures") or [])
    after = set(candidate.get("failures") or [])
    return {"fixed": sorted(before - after), "broke": sorted(after - before)}


def regressed(fixed: int, broke: int, alpha: float = SIGNIFICANCE) -> bool:
    """One-sided exact sign test over the examples that moved (McNemar)."""
    discordant = fixed + broke
    if discordant == 0 or broke <= fixed:
        return False
    tail = sum(math.comb(discordant, k) for k in range(broke, discordant + 1))
    return tail / (2**discordant) < alpha


def count_guard(candidate: dict, baseline: dict, minimum: int = 0) -> dict:
    support = candidate["total"]
    if support != baseline["total"]:
        return {"passed": False, "reason": "support mismatch", "support": support}
    if support <= 0:
        return {"passed": False, "reason": "empty corpus", "support": support}
    if candidate.get("sha256") != baseline.get("sha256"):
        return {"passed": False, "reason": "corpus mismatch", "support": support}
    lost = baseline["correct"] - candidate["correct"]
    if "failures" in candidate and "failures" in baseline:
        moved = flips(candidate, baseline)
        fixed, broke = len(moved["fixed"]), len(moved["broke"])
    else:
        fixed, broke = 0, max(lost, 0)
    failed = regressed(fixed, broke)
    reason = "regression" if failed else None
    if failed and support < minimum:
        failed, reason = False, "below minimum support"
    return {
        "passed": not failed,
        "reason": reason if failed else None,
        "warning": reason if not failed and reason else None,
        "support": support,
        "delta": lost / support,
        "fixed": fixed,
        "broke": broke,
    }


def family_guards(candidate: dict, baseline: dict) -> list[dict]:
    guards = []
    for family in sorted(set(candidate["families"]) | set(baseline["families"])):
        current = candidate["families"].get(family)
        before = baseline["families"].get(family)
        support = (current or {}).get("total", 0)
        guard = {}
        if not current or not before:
            reason, delta, passed = "support mismatch", None, False
        else:
            guard = count_guard(current, before, minimum=MINIMUM_SUPPORT)
            reason, delta, passed = guard["reason"], guard.get("delta"), guard["passed"]
        guards.append(
            {
                "family": family,
                "support": support,
                "delta": delta,
                "passed": passed,
                "reason": reason,
                "warning": guard.get("warning"),
                "fixed": guard.get("fixed"),
                "broke": guard.get("broke"),
            }
        )
    return guards


def pooled(scores: dict) -> dict:
    return {
        "total": sum(counts["total"] for counts in scores.values()),
        "correct": sum(counts["correct"] for counts in scores.values()),
    }


def decide(candidate: dict, baseline: dict | None, failures: list[str]) -> dict:
    """A pooled gain cannot compensate for losing a set or a family."""
    decision = {
        "criterion": "gold-schedule-accuracy",
        "sets": sorted(candidate),
        "candidate": {**pooled(candidate), "sets": candidate},
        "baseline": None,
        "improvement": None,
        "failures": list(failures),
        "warnings": [],
    }
    if baseline is not None:
        decision["baseline"] = {**pooled(baseline), "sets": baseline}
        if sorted(candidate) != sorted(baseline):
            decision["failures"].append("gold set mismatch")
        else:
            decision["improvement"] = (
                decision["candidate"]["correct"] - decision["baseline"]["correct"]
            ) / max(decision["candidate"]["total"], 1)
            for name, counts in candidate.items():
                before = baseline[name]
                guard = count_guard(counts, before)
                if not guard["passed"]:
                    decision["failures"].append(f"gold {name}: {guard['reason']}")
                elif guard["broke"] > guard["fixed"]:
                    decision["warnings"].append(
                        f"gold {name}: lost {guard['broke']}, gained {guard['fixed']}"
                    )
                for family in family_guards(
                    {"families": counts.get("families", {})},
                    {"families": before.get("families", {})},
                ):
                    if not family["passed"]:
                        decision["failures"].append(
                            f"gold {name}/{family['family']}: {family['reason']}"
                        )
                    elif family["warning"] or (family["broke"] or 0) > 0:
                        decision["warnings"].append(
                            f"gold {name}/{family['family']}: lost {family['broke']}"
                            + (f" ({family['warning']})" if family["warning"] else "")
                        )
    decision["accepted"] = not decision["failures"]
    return decision


def synthetic(candidate: dict, baseline: dict | None, strict: bool = True) -> dict:
    """Require improvement below the ceiling; preserve a perfect baseline."""
    guard = count_guard(candidate, baseline) if baseline else None
    guards = family_guards(candidate, baseline) if baseline else []
    accepted = bool(
        guard and guard["passed"]
        and all(family["passed"] for family in guards)
        and (
            not strict
            or candidate["correct"] > baseline["correct"]
            or baseline["correct"] == baseline["total"]
        )
    )
    return {
        "criterion": "reserved-carrier-exact-sequence",
        "candidate": candidate,
        "baseline": baseline,
        "improvement": (
            (candidate["correct"] - baseline["correct"]) / candidate["total"]
            if baseline and candidate["total"] == baseline["total"]
            else None
        ),
        "guard": guard,
        "guards": guards,
        "accepted": accepted,
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


def answer_scores(built: Path, sets: list[str], directory: Path) -> dict:
    """Exact-schedule accuracy of a built package on the generated corpora."""
    with tempfile.TemporaryDirectory() as out:
        measured = Path(out) / "answers.json"
        subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                str(BENCH / "src/evaluate-model.ts"),
                "--dist",
                str(built / "dist/schedule.js"),
                "--dir",
                str(directory),
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
                "failures": [
                    example["id"]
                    for example in result["examples"]
                    if not example["correct"]
                ],
            }
            for result in json.loads(measured.read_text())["results"]
        }


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
            "families": {
                family: {
                    "total": sum(
                        example.get("family", result["name"]) == family
                        for example in result["examples"]
                    ),
                    "correct": sum(
                        example["correct"]
                        and example.get("family", result["name"]) == family
                        for example in result["examples"]
                    ),
                }
                for family in sorted({
                    example.get("family", result["name"])
                    for example in result["examples"]
                })
            },
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
    for name in GOLD_SETS:
        if name not in sets:
            failures.append(f"missing gold set: {name}")
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
        # Graded on the schedule users receive; token labels only warn.
        generated = [reserved.stem, bare.stem]
        answers = answer_scores(scratch / "candidate", generated, reserved.parent)
        answers_before = (
            answer_scores(scratch / "baseline", generated, reserved.parent)
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
        "blocking": True,
        "note": SYNTHETIC_NOTE,
        "gradedOn": "exact schedule through the built package",
        "reserved": {
            "corpus": corpus,
            "answers": answers.get(reserved.stem),
            "answersBaseline": (answers_before or {}).get(reserved.stem),
            "labels": {"candidate": candidate, "baseline": baseline},
        },
        "bare": {
            "corpus": bare_corpus,
            "answers": answers.get(bare.stem),
            "answersBaseline": (answers_before or {}).get(bare.stem),
            "labels": {"candidate": bare_candidate, "baseline": bare_baseline},
        },
    }
    for name, stem in (("reserved", reserved.stem), ("bare", bare.stem)):
        result = decision["synthetic"][name]
        now, before = result["answers"], result["answersBaseline"]
        if now is None:
            decision["failures"].append(f"{name}: not scored")
            continue
        if before is None:
            decision["failures"].append(f"{name}: no baseline to compare against")
            continue
        guard = count_guard(now, before)
        result["accepted"] = guard["passed"]
        result["guard"] = guard
        if not guard["passed"]:
            decision["failures"].append(
                f"{name}: {guard['broke']} of {guard['support']} schedules regressed"
            )
        elif guard["broke"] > guard["fixed"]:
            decision["warnings"].append(
                f"{name}: lost {guard['broke']} schedules, gained {guard['fixed']}"
            )
        previous_labels = result["labels"]["baseline"]
        label_guard = (
            count_guard(result["labels"]["candidate"], previous_labels)
            if previous_labels
            else {"passed": True}
        )
        if not label_guard["passed"]:
            decision["warnings"].append(
                f"{name}: token labels drifted on {label_guard['broke']} sequences"
            )
    decision["accepted"] = not decision["failures"]
    return decision


def publish(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(text)
    temporary.replace(path)


def parity_texts(data: Path, prefix: Path):
    texts = [json.loads(line)["text"] for line in (data / "heldout.jsonl").read_text().splitlines()]
    publish(Path(f"{prefix}.texts.json"), json.dumps(texts[:10000], ensure_ascii=False) + "\n")


def protected_output(path: Path) -> bool:
    path = path.resolve()
    return path == SHIPPED.resolve() or any(
        path.is_relative_to((ROOT / name).resolve()) for name in ("active", "exports")
    )


def validate_outputs(destination: Path, report: Path, parity: Path | None):
    if destination.resolve() == SHIPPED.resolve():
        if report.resolve() != (ROOT / "active/export-report.json").resolve() or (
            parity is None or parity.resolve() != (ROOT / "active/parity").resolve()
        ):
            raise ValueError("Shipped exports require the active report and parity destinations.")
    else:
        paths = [destination, report]
        sources = destination.with_name(f"{destination.name}.sources").resolve()
        if parity:
            paths.extend(Path(f"{parity}.{suffix}") for suffix in (
                "texts.json", "npz", "json", "rows.bin", "logits.bin",
                "boundaries.bin", "labels.bin", "offsets.bin",
            ))
        if any(protected_output(path) for path in [*paths, sources]):
            raise ValueError("Candidate outputs must stay outside shipped weights, active metadata, and export history.")
        if any(path.resolve().is_relative_to(sources) for path in paths):
            raise ValueError("Export outputs must not overwrite source snapshots.")
        if len({path.resolve() for path in paths}) != len(paths):
            raise ValueError("Export output paths must be distinct.")


def snapshot(destination: Path, artifact_hash: str, derived: bool):
    paths = {
        "training/export.py": TORCH / "export.py",
        "training/calibrate.py": TORCH / "calibrate.py",
        "training/model.py": TORCH / "model.py",
        "training/train.py": TORCH / "train.py",
        "training/uv.lock": ROOT / "uv.lock",
    }
    if derived:
        paths["training/average.py"] = TORCH / "average.py"
    contents = {name: path.read_bytes() for name, path in paths.items()}
    hashes = {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()}
    source_hash = hashlib.sha256(
        json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    parent = (
        ROOT / "exports"
        if destination.resolve() == SHIPPED.resolve()
        else destination.with_name(f"{destination.name}.sources")
    )
    directory = parent / artifact_hash / source_hash / "source"
    if destination.resolve() != SHIPPED.resolve() and protected_output(directory):
        raise ValueError("Candidate source snapshots must stay outside active export history.")
    if directory.exists():
        for name, content in contents.items():
            path = directory / name
            if not path.is_file() or path.read_bytes() != content:
                raise ValueError(f"Export source snapshot differs: {path}")
    else:
        directory.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=directory.parent) as temporary:
            staged = Path(temporary) / "source"
            for name, content in contents.items():
                path = staged / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            staged.rename(directory)
    return directory, hashes


def export(
    checkpoint: Path,
    destination: Path,
    report_path: Path,
    parity_prefix: Path | None,
    reserved: Path,
    bare: Path,
    baseline_report: Path,
    force: bool,
    skip_gate: bool = False,
):
    if skip_gate and destination.resolve() == SHIPPED.resolve():
        raise SystemExit("--skip-gate cannot write the shipped weights module.")
    validate_outputs(destination, report_path, parity_prefix)
    torch.set_num_threads(4)
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    options = {
        "layers": saved["config"].get("layers", 1),
        "transitions": saved["config"].get("transitions", False),
    }
    reference = TimeTagger(
        saved["model"]["embedding"].shape[0], options["layers"], options["transitions"]
    ).eval()
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
        {**wire, "featureRows": reference.feature_rows, "storage": storage, **options}
    )

    data = ROOT / "data/synth" / config.get("evaluation_run", config["run"])
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
        "roleClasses": ROLE_CLASSES,
        "boundaryThreshold": threshold,
        **options,
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

    promotion = (
        {"criterion": "skipped", "accepted": True, "failures": [], "synthetic": None}
        if skip_gate
        else gate(reference, threshold, source, reserved, bare, baseline_report)
    )
    if not promotion["accepted"]:
        if not force:
            raise SystemExit(
                "Export rejected: " + "; ".join(promotion["failures"]) + "\n"
                "Pass --force to override and record the override in the report."
            )
        promotion = override(promotion)
        print("Forcing export despite: " + "; ".join(promotion["overriddenFailures"]))
    if not skip_gate:
        promotion["description"] = GATE_CRITERION

    metrics = {
        "validation": evaluate(reference, validation, 256, "cpu", threshold),
        "heldout": evaluate(reference, heldout, 256, "cpu", threshold),
    }
    ancestry = lineage(checkpoint)
    artifact_hash = hashlib.sha256(source.encode()).hexdigest()
    source_directory, source_hashes = snapshot(
        destination, artifact_hash, "derivation" in saved
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
    report = {
        "checkpoint": portable(checkpoint.resolve()),
        "checkpointSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
        "artifactSha256": artifact_hash,
        "exportSourceDirectory": portable(source_directory.resolve()),
        "exportSourceHashes": source_hashes,
        "boundaryThreshold": threshold,
        "calibration": calibration,
        "epoch": saved["epoch"],
        "tokensSeenAtCheckpoint": sum(item["trainingTokens"] for item in ancestry),
        "lineage": ancestry,
        **({"derivation": saved["derivation"]} if "derivation" in saved else {}),
        "parameters": int(offset),
        "quantizationBits": bits,
        "quantizationScheme": "power-of-two-rows" if row_scales else "tensor",
        "options": {"featureRows": reference.feature_rows, **options},
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
            "reservedCarrier": (
                promotion["synthetic"]["reserved"]["corpus"]["featurizedSha256"]
                if promotion.get("synthetic")
                else None
            ),
        },
        "promotion": promotion,
        "scope": f"Exact decoded int{bits} weights, sequential CPU PyTorch inference with the deployed role decoder and recorded intermediate precision. Training uses the mathematically equivalent parallel affine scan. Heldout metrics share the development split used by calibrate(). Promotion requires reserved-carrier improvement or a perfect-baseline tie, with no family regression, preserved bare expressions, and no gold set or family regression through the built parser. These are development checks, not real-user accuracy. Browser parity is a separate gate.",
    }
    if parity_prefix:
        parity_texts(data, parity_prefix)
        indices = np.arange(min(512, len(heldout)))
        rows, targets, boundaries, valid, neighbors = heldout.batch(indices, "cpu")
        with torch.no_grad():
            logits, clause_logits = reference(rows, valid, neighbors)
            decoded_roles = reference.decode(logits, targets >= 0)
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
        # Decoded roles, so the TypeScript parity test compares Viterbi to
        # Viterbi rather than re-deriving an argmax the model no longer uses.
        wire_labels = decoded_roles.numpy()[valid.numpy()].astype(np.uint8)
        for suffix, values in [
            ("rows", wire_rows),
            ("logits", wire_logits),
            ("boundaries", wire_boundaries),
            ("labels", wire_labels),
            ("offsets", offsets),
        ]:
            values.tofile(f"{parity_prefix}.{suffix}.bin")
        report["parity"] = {
            "prefix": portable(parity_prefix),
            "sequences": len(indices),
            "tokens": int(lengths.sum()),
            "rowsPerToken": 17,
            "rolesPerToken": ROLE_CLASSES,
            "boundaryThreshold": threshold,
            **options,
        }
        publish(
            Path(f"{parity_prefix}.json"),
            json.dumps(report["parity"], indent=2) + "\n",
        )
    staged.replace(destination)
    # Published last: the report's presence is what marks the export committed.
    publish(report_path, json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=SHIPPED)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--parity", type=Path)
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
    parser.add_argument(
        "--skip-gate",
        action="store_true",
        help="Skip promotion scoring. Refused when --out is the shipped module.",
    )
    args = parser.parse_args(argv)
    shipped = args.out.resolve() == SHIPPED.resolve()
    report = args.report or (
        ROOT / "active/export-report.json" if shipped else args.out.with_suffix(".report.json")
    )
    parity = args.parity or (
        ROOT / "active/parity" if shipped else args.out.with_suffix(".parity")
    )
    export(
        args.checkpoint,
        args.out,
        report,
        parity,
        args.reserved,
        args.bare,
        args.baseline,
        args.force,
        args.skip_gate,
    )


if __name__ == "__main__":
    main()
