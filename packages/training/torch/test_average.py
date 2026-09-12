from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

import average as averaging
from export import lineage


def checkpoint(path: Path, value: float, **config) -> Path:
    saved = {
        "model": {"weight": torch.tensor([value], dtype=torch.float32)},
        "config": {
            "run": path.parent.name,
            "feature_rows": 580,
            "layers": 1,
            "transitions": True,
            "storage": "f32",
            "quantization_bits": 6,
            "row_scales": False,
            **config,
        },
        "epoch": 2,
        "tokensSeen": 10,
        "labelNames": ["O"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(saved, path)
    return path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class AverageTest(unittest.TestCase):
    def test_exact_weighted_arithmetic_and_provenance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = checkpoint(root / "runs/base/best.pt", 2)
            new = checkpoint(root / "runs/fine/best.pt", 6)
            with patch.object(averaging, "ROOT", root):
                output = averaging.average(base, new, 0.25, "averaged")
            saved = torch.load(output, map_location="cpu", weights_only=True)
            self.assertTrue(torch.equal(saved["model"]["weight"], torch.tensor([3.0])))
            self.assertEqual(saved["tokensSeen"], 0)
            self.assertNotIn("optimizer", saved)
            self.assertEqual(saved["config"]["run"], "averaged")
            self.assertEqual(saved["config"]["evaluation_run"], "fine")
            self.assertEqual(saved["config"]["epochs"], 0)
            self.assertEqual(
                [parent["coefficient"] for parent in saved["derivation"]["parents"]],
                [0.75, 0.25],
            )
            self.assertFalse((root / "active").exists())

    def test_rejects_incompatible_shapes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = checkpoint(root / "base.pt", 2)
            other = torch.load(base, map_location="cpu", weights_only=True)
            other["model"]["weight"] = torch.ones(2)
            candidate = root / "candidate.pt"
            torch.save(other, candidate)
            with patch.object(averaging, "ROOT", root):
                with self.assertRaisesRegex(ValueError, "shape"):
                    averaging.average(base, candidate, 0.25, "bad")

    def test_rejects_incompatible_labels_and_architecture(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = checkpoint(root / "base.pt", 2)
            candidate = checkpoint(root / "candidate.pt", 3)
            saved = torch.load(candidate, map_location="cpu", weights_only=True)
            saved["labelNames"] = ["OTHER"]
            torch.save(saved, candidate)
            with patch.object(averaging, "ROOT", root):
                with self.assertRaisesRegex(ValueError, "label vocabularies"):
                    averaging.average(base, candidate, 0.25, "bad-labels")
            saved["labelNames"] = ["O"]
            saved["config"]["layers"] = 2
            torch.save(saved, candidate)
            with patch.object(averaging, "ROOT", root):
                with self.assertRaisesRegex(ValueError, "layers"):
                    averaging.average(base, candidate, 0.25, "bad-architecture")

    def test_lineage_counts_shared_ancestor_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ancestor = checkpoint(root / "ancestor.pt", 1)
            left = checkpoint(root / "left.pt", 2, init=str(ancestor))
            right = checkpoint(root / "right.pt", 3, init=str(ancestor))
            parents = [
                {"checkpoint": str(left), "sha256": digest(left)},
                {"checkpoint": str(right), "sha256": digest(right)},
            ]
            derived = checkpoint(root / "derived.pt", 4, provenanceParents=parents)
            found = lineage(derived)
            self.assertEqual(len(found), 4)
            self.assertEqual(sum(item["trainingTokens"] for item in found), 40)

    def test_lineage_rejects_parent_hash_mismatch_and_cycle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent = checkpoint(root / "parent.pt", 1)
            bad = checkpoint(
                root / "bad.pt",
                2,
                provenanceParents=[{"checkpoint": str(parent), "sha256": "0" * 64}],
            )
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                lineage(bad)

            # A checkpoint cannot contain its own final hash, so use legacy init
            # edges to exercise cycle detection independently of hash validation.
            first = root / "first.pt"
            second = root / "second.pt"
            checkpoint(first, 1, init=str(second))
            checkpoint(second, 2, init=str(first))
            with self.assertRaisesRegex(ValueError, "cycle"):
                lineage(first)


if __name__ == "__main__":
    unittest.main()
