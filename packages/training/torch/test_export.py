import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

import export as exporter
from model import PADDING_ROW, TimeTagger


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.training = self.root / "training"
        self.sources = self.training / "torch"
        self.sources.mkdir(parents=True)
        for name in ("export.py", "calibrate.py", "model.py", "train.py", "average.py"):
            (self.sources / name).write_text(f"original {name}\n")
        (self.training / "uv.lock").write_text("locked\n")
        self.shipped = self.root / "core/weights.gen.ts"
        self.shipped.parent.mkdir()
        self.shipped.write_text("original weights\n")
        active = self.training / "active"
        active.mkdir()
        for name in ("export-report.json", "parity.json", "parity.rows.bin"):
            (active / name).write_text("original active file\n")
        for name, value in (("ROOT", self.training), ("TORCH", self.sources), ("SHIPPED", self.shipped)):
            patcher = patch.object(exporter, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def tree(self, directory):
        return {str(path.relative_to(directory)): path.read_bytes()
                for path in directory.rglob("*") if path.is_file()}

    def test_cli_defaults_follow_the_weights_destination(self):
        with patch.object(exporter, "export") as call:
            exporter.main(["--checkpoint", "example.pt"])
            args = call.call_args.args
            self.assertEqual(args[1:4], (
                self.shipped, self.training / "active/export-report.json",
                self.training / "active/parity",
            ))
            target = self.root / "candidate.ts"
            exporter.main(["--checkpoint", "example.pt", "--out", str(target), "--skip-gate"])
            args = call.call_args.args
            self.assertEqual(args[1:4], (
                target, target.with_suffix(".report.json"), target.with_suffix(".parity"),
            ))

    def test_mixed_candidate_and_active_outputs_fail_before_loading(self):
        target = self.root / "candidate.ts"
        report = self.root / "candidate.json"
        active = self.training / "active"
        for destination, report_path, parity in (
            (target, active / "export-report.json", None),
            (target, report, active / "parity"),
            (active / "candidate.ts", report, None),
            (target, self.training / "exports/report.json", None),
            (self.shipped, report, None),
        ):
            with self.subTest(destination=destination, report=report_path, parity=parity):
                with patch.object(exporter.torch, "load") as load:
                    with self.assertRaises(ValueError):
                        exporter.export(Path("missing.pt"), destination, report_path,
                                        parity, Path("unused"), Path("unused"),
                                        Path("unused"), False, False)
                    load.assert_not_called()

    def test_source_changes_create_a_new_snapshot_and_preserve_old_bytes(self):
        legacy = self.training / "exports/same-weights/source/training/export.py"
        legacy.parent.mkdir(parents=True)
        legacy.write_text("historical exporter\n")
        first, hashes = exporter.snapshot(self.shipped, "same-weights", False)
        before = self.tree(first)
        repeated, _ = exporter.snapshot(self.shipped, "same-weights", False)
        self.assertEqual(first, repeated)
        (self.sources / "export.py").write_text("updated exporter\n")
        second, new_hashes = exporter.snapshot(self.shipped, "same-weights", False)
        self.assertNotEqual(first, second)
        self.assertNotEqual(hashes, new_hashes)
        self.assertEqual(before, self.tree(first))
        self.assertEqual(legacy.read_text(), "historical exporter\n")
        self.assertEqual(hashes["training/export.py"], hashlib.sha256(before["training/export.py"]).hexdigest())
        (second / "training/export.py").write_text("corrupt\n")
        with self.assertRaisesRegex(ValueError, "snapshot"):
            exporter.snapshot(self.shipped, "same-weights", False)
        self.assertEqual((second / "training/export.py").read_text(), "corrupt\n")

    def test_candidate_outputs_reject_aliases_and_snapshot_collisions(self):
        target = self.root / "candidate.ts"
        alias = self.root / "alias"
        alias.symlink_to(self.training / "active", target_is_directory=True)
        for report in (target, alias / "export-report.json", self.root / "candidate.ts.sources/report.json"):
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    exporter.validate_outputs(target, report, None)

    def test_skip_gate_still_cannot_publish_shipped_weights(self):
        with self.assertRaisesRegex(SystemExit, "skip-gate"):
            exporter.export(Path("missing.pt"), self.shipped,
                            self.training / "active/export-report.json",
                            self.training / "active/parity", Path("unused"),
                            Path("unused"), Path("unused"), False, True)

    def test_isolated_export_keeps_all_repository_artifacts_unchanged(self):
        model = TimeTagger(324)
        checkpoint = self.root / "checkpoint.pt"
        torch.save({
            "model": model.state_dict(), "config": {"run": "fixture", "storage": "f32"},
            "epoch": 0, "tokensSeen": 0, "labelNames": ["O"],
        }, checkpoint)
        data = self.training / "data/synth/fixture"
        data.mkdir(parents=True)
        (data / "heldout.jsonl").write_text('{"text":"hello"}\n')

        class Dataset:
            manifest = {"labelCounts": {"O": 1}}

            def __init__(self, prefix):
                pass

            def __len__(self):
                return 1

            def batch(self, indices, device):
                return (
                    torch.full((1, 2, 17), PADDING_ROW, dtype=torch.long),
                    torch.tensor([[0, -100]]), torch.zeros(1, 2),
                    torch.tensor([[True, False]]),
                    torch.full((1, 2, 2), -1, dtype=torch.long),
                )

        before = self.tree(self.training)
        target = self.root / "isolated/candidate.ts"
        report = target.with_suffix(".report.json")
        parity = target.with_suffix(".parity")
        with patch.object(exporter, "Dataset", Dataset), \
             patch.object(exporter, "calibrate", return_value={"threshold": 0.0}), \
             patch.object(exporter, "evaluate", return_value={}), \
             patch.object(exporter, "corpus_digest", return_value="fixture"), \
             contextlib.redirect_stdout(io.StringIO()):
            exporter.export(checkpoint, target, report, parity, Path("unused"),
                            Path("unused"), Path("unused"), False, True)
        self.assertEqual(before, self.tree(self.training))
        self.assertEqual(self.shipped.read_text(), "original weights\n")
        result = json.loads(report.read_text())
        self.assertTrue(Path(result["exportSourceDirectory"]).is_relative_to(target.parent.resolve()))
        self.assertEqual(json.loads(Path(f"{parity}.texts.json").read_text()), ["hello"])
        self.assertTrue(Path(f"{parity}.logits.bin").exists())
        self.assertTrue(target.exists())


if __name__ == "__main__":
    unittest.main()
