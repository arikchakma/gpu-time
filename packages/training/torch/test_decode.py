import itertools
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch

from export import parity_texts, sequence_scores
from model import ROLE_CLASSES, TimeTagger, decode
from train import evaluate


class DecodeTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(17)
        torch.set_num_threads(2)

    def test_parity_keeps_original_text_order_without_training_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            texts = ["next Monday", "June 3 at 4pm", "Sam’s appointment tomorrow"]
            (root / "heldout.jsonl").write_text(
                "\n".join(json.dumps({"text": text}) for text in texts) + "\n"
            )
            parity_texts(root, root / "parity")
            self.assertEqual(json.loads((root / "parity.texts.json").read_text()), texts)

    def test_matches_exhaustive_paths_with_whitespace_and_padding(self):
        emissions = torch.randn(4, 5, 3)
        transition = torch.randn(3, 3)
        mask = torch.tensor(
            [
                [True, False, True, True, False],
                [False, True, False, True, False],
                [False, False, False, False, False],
                [False, False, True, False, False],
            ]
        )
        actual = decode(emissions, mask, transition)
        for row in range(len(mask)):
            kept = mask[row].nonzero().flatten().tolist()
            if not kept:
                self.assertEqual(actual[row].tolist(), [0] * 5)
                continue
            paths = itertools.product(range(3), repeat=len(kept))

            def score(path):
                return sum(
                    emissions[row, index, label].item()
                    for index, label in zip(kept, path)
                ) + sum(
                    transition[left, right].item()
                    for left, right in zip(path, path[1:])
                )

            expected = max(paths, key=score)
            self.assertEqual(actual[row, kept].tolist(), list(expected))
            self.assertTrue((actual[row, ~mask[row]] == 0).all())

    def test_transitions_change_the_path_and_skip_masked_emissions(self):
        emissions = torch.tensor([[[2.0, 1.0], [100.0, -100.0], [0.0, 2.0]]])
        mask = torch.tensor([[True, False, True]])
        transition = torch.tensor([[0.0, -10.0], [-10.0, 0.0]])
        self.assertEqual(decode(emissions, mask).tolist(), [[0, 0, 1]])
        self.assertEqual(decode(emissions, mask, transition).tolist(), [[1, 0, 1]])

    def test_ties_empty_sequences_and_independent_decoding(self):
        emissions = torch.zeros(2, 4, 3)
        mask = torch.ones(2, 4, dtype=torch.bool)
        transition = torch.zeros(3, 3)
        self.assertTrue((decode(emissions, mask, transition) == 0).all())
        self.assertEqual(decode(emissions[:, :0], mask[:, :0], transition).shape, (2, 0))
        self.assertEqual(decode(emissions[:, :0], mask[:, :0]).shape, (2, 0))
        emissions = torch.randn(2, 4, 3)
        torch.testing.assert_close(
            decode(emissions, mask), decode(emissions, mask, transition)
        )

    def test_transition_comparisons_preserve_javascript_near_ties(self):
        emissions = torch.tensor([[[1.0, 1.0 + 2**-23], [10.0, 0.0]]])
        transition = torch.tensor([[0.5, -1.0], [0.5 - 2**-24, -1.0]])
        mask = torch.ones(1, 2, dtype=torch.bool)
        # Rounding best + transition early makes both predecessor scores 1.5.
        self.assertEqual(decode(emissions, mask, transition).tolist(), [[1, 0]])

    def test_complete_step_scores_round_to_f32_before_the_next_token(self):
        emissions = torch.tensor([[[1.0, 0.0], [0.0, 2**-24], [10.0, 0.0]]])
        transition = torch.zeros(2, 2)
        mask = torch.ones(1, 3, dtype=torch.bool)
        # Retaining double scores between tokens instead would choose [0, 1, 0].
        self.assertEqual(decode(emissions, mask, transition).tolist(), [[0, 0, 0]])

    @unittest.skipUnless(torch.backends.mps.is_available(), "MPS is unavailable")
    def test_mps_uses_exact_cpu_comparisons_and_returns_labels_to_mps(self):
        emissions = torch.tensor(
            [[[1.0, 1.0 + 2**-23], [100.0, -100.0], [10.0, 0.0]]],
            device="mps",
        )
        transition = torch.tensor(
            [[0.5, -1.0], [0.5 - 2**-24, -1.0]], device="mps"
        )
        mask = torch.tensor([[True, False, True]], device="mps")
        actual = decode(emissions, mask, transition)
        self.assertEqual(actual.device.type, "mps")
        self.assertEqual(actual.cpu().tolist(), [[1, 0, 0]])
        empty = decode(emissions[:, :0], mask[:, :0], transition)
        self.assertEqual(empty.device.type, "mps")
        self.assertEqual(empty.shape, (1, 0))

    def test_model_decodes_with_quantized_transitions_during_qat(self):
        model = TimeTagger(transitions=True)
        with torch.no_grad():
            model.transition.zero_()
            model.transition[0, 1] = 0.49
            model.transition[-1, -1] = 31.0
        emissions = torch.full((1, 2, ROLE_CLASSES), -100.0)
        emissions[0, :, :2] = torch.tensor([[2.0, 0.0], [0.2, 0.0]])
        mask = torch.ones(1, 2, dtype=torch.bool)
        self.assertEqual(model.decode(emissions, mask).tolist(), [[0, 1]])
        model.qat = True
        self.assertEqual(model.decode(emissions, mask).tolist(), [[0, 0]])

    def test_training_and_export_metrics_use_the_decoded_path(self):
        model = TimeTagger(transitions=True)
        with torch.no_grad():
            model.transition.zero_()
            model.transition[0, 1] = -10.0
            model.transition[1, 0] = -10.0
        emissions = torch.full((1, 3, ROLE_CLASSES), -100.0)
        emissions[0, :, :2] = torch.tensor([[2.0, 1.0], [100.0, -100.0], [0.0, 2.0]])
        labels = torch.tensor([[1, -100, 1]])
        boundaries = torch.zeros(1, 3)
        valid = torch.ones(1, 3, dtype=torch.bool)

        class Dataset:
            def __len__(self):
                return 1

            def batches(self, batch_size):
                return [np.array([0])]

            def batch(self, indices, device):
                return emissions, labels, boundaries, valid, None

        with patch.object(model, "forward", return_value=(emissions, boundaries - 1)):
            metrics = evaluate(model, Dataset(), 256, "cpu")
            self.assertEqual(metrics["tokenAccuracy"], 1.0)
            self.assertEqual(metrics["exactLabelAndBoundarySequence"], 1.0)
            self.assertEqual(sequence_scores(model, Dataset(), 0).tolist(), [True])


if __name__ == "__main__":
    unittest.main()
