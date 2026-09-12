import unittest

import torch

from export import decide, override
from model import PADDING_ROW, TimeTagger, affine_scan, crf_nll


class ModelTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(17)
        torch.set_num_threads(2)

    def inputs(self, length=8, padded=None, batch=1):
        padded = padded or length
        rows = torch.full((batch, padded, 17), PADDING_ROW, dtype=torch.long)
        rows[:, :length, :9] = torch.randint(0, 580, (batch, length, 9))
        valid = torch.zeros((batch, padded), dtype=torch.bool)
        valid[:, :length] = True
        neighbors = torch.full((batch, padded, 2), -1, dtype=torch.long)
        for index in range(length):
            if index:
                neighbors[:, index, 0] = index - 1
            if index + 1 < length:
                neighbors[:, index, 1] = index + 1
        return rows, valid, neighbors

    def test_parameter_count(self):
        self.assertEqual(
            sum(parameter.numel() for parameter in TimeTagger().parameters()), 32953
        )
        self.assertEqual(
            sum(parameter.numel() for parameter in TimeTagger(324).parameters()), 24761
        )

    def test_small_model_discards_the_second_hash_and_keeps_padding_neutral(self):
        model = TimeTagger(324).eval()
        model.storage_f16 = False
        rows, valid, neighbors = self.inputs(length=8, padded=32)
        changed = rows.clone()
        second_hash = (changed >= 396) & (changed < 524)
        changed[second_hash] = 396 + (changed[second_hash] - 395) % 128
        with torch.no_grad():
            original = model(rows, valid, neighbors)
            altered = model(changed, valid, neighbors)
            short = model(rows[:, :8], valid[:, :8], neighbors[:, :8])
        for a, b, c in zip(original, altered, short):
            torch.testing.assert_close(a, b, atol=0, rtol=0)
            torch.testing.assert_close(a[:, :8], c, atol=1e-6, rtol=1e-5)

    def test_parallel_scan_matches_the_sequential_recurrence(self):
        for length in (1, 2, 5, 32, 63):
            gate = torch.sigmoid(torch.randn(3, length, 32))
            candidate = torch.tanh(torch.randn(3, length, 32))
            state = torch.zeros(3, 32)
            expected = []
            for index in range(length):
                state = gate[:, index] * state + candidate[:, index]
                expected.append(state)
            torch.testing.assert_close(
                affine_scan(gate, candidate),
                torch.stack(expected, 1),
                atol=1e-6,
                rtol=1e-5,
            )

    def test_padding_does_not_change_real_token_predictions(self):
        model = TimeTagger().eval()
        model.qat = True
        rows, valid, neighbors = self.inputs(length=8, padded=32)
        with torch.no_grad():
            padded = model(rows, valid, neighbors)
            short = model(rows[:, :8], valid[:, :8], neighbors[:, :8])
        for left, right in zip(padded, short):
            torch.testing.assert_close(left[:, :8], right, atol=2e-4, rtol=1e-4)

    def test_batches_do_not_mix_expression_context(self):
        model = TimeTagger().eval()
        inputs = self.inputs(batch=2)
        with torch.no_grad():
            batched = model(*inputs)
            single = model(*(value[:1] for value in inputs))
        for left, right in zip(batched, single):
            torch.testing.assert_close(left[:1], right, atol=2e-4, rtol=1e-4)

    def test_all_parameters_receive_finite_gradients(self):
        for layers, transitions in ((1, False), (2, True)):
            model = TimeTagger(layers=layers, transitions=transitions)
            model.qat = True
            roles, boundaries = model(*self.inputs())
            loss = roles.square().mean() + boundaries.square().mean()
            if transitions:
                loss = loss + model.transition.square().mean()
            loss.backward()
            for name, parameter in model.named_parameters():
                self.assertIsNotNone(parameter.grad, name)
                self.assertTrue(torch.isfinite(parameter.grad).all(), name)

    def test_a_second_scan_layer_keeps_the_first_layer_tensor_names(self):
        one = set(dict(TimeTagger().named_parameters()))
        two = dict(TimeTagger(layers=2, transitions=True).named_parameters())
        self.assertTrue(one <= set(two))
        self.assertEqual(
            sorted(set(two) - one),
            [
                "candidate2_bias",
                "candidate2_weight",
                "combine2_bias",
                "combine2_weight",
                "gate2_bias",
                "gate2_weight",
                "transition",
            ],
        )

    def test_crf_matches_brute_force_enumeration(self):
        """Masked positions must drop out of the chain, not just out of the sum."""
        classes, length = 4, 5
        emissions = torch.randn(1, length, classes)
        transition = torch.randn(classes, classes)
        labels = torch.tensor([[1, -100, 3, 0, -100]])
        mask = labels >= 0
        kept = [index for index in range(length) if mask[0, index]]
        paths = torch.cartesian_prod(*[torch.arange(classes)] * len(kept))
        scores = []
        for path in paths:
            total = sum(emissions[0, kept[step], label] for step, label in enumerate(path))
            total = total + sum(
                transition[path[step - 1], path[step]] for step in range(1, len(kept))
            )
            scores.append(total)
        gold = [labels[0, index] for index in kept]
        expected = torch.logsumexp(torch.stack(scores), 0) - (
            sum(emissions[0, kept[step], label] for step, label in enumerate(gold))
            + sum(transition[gold[step - 1], gold[step]] for step in range(1, len(kept)))
        )
        torch.testing.assert_close(
            crf_nll(emissions, transition, labels, mask),
            expected / mask.sum(),
            atol=1e-5,
            rtol=1e-5,
        )


class PromotionGateTests(unittest.TestCase):
    """Promotion is decided by pooled hand-authored gold accuracy."""

    def gold(self, correct, total=100):
        return {"prose": {"total": total, "correct": correct}}

    def test_a_tie_ships(self):
        decision = decide(self.gold(90), self.gold(90), [])
        self.assertTrue(decision["accepted"])
        self.assertEqual(decision["improvement"], 0)

    def test_improvement_is_recorded_but_not_required(self):
        decision = decide(self.gold(95), self.gold(90), [])
        self.assertTrue(decision["accepted"])
        self.assertAlmostEqual(decision["improvement"], 0.05)

    def test_noise_sized_regression_ships(self):
        decision = decide(self.gold(89), self.gold(90), [])
        self.assertTrue(decision["accepted"])

    def test_significant_regression_is_rejected(self):
        decision = decide(self.gold(60), self.gold(90), [])
        self.assertFalse(decision["accepted"])
        self.assertEqual(decision["failures"], ["gold schedules: regression"])

    def test_changed_row_counts_are_rejected(self):
        decision = decide(self.gold(90, 100), self.gold(90, 99), [])
        self.assertFalse(decision["accepted"])

    def test_a_missing_baseline_blocks(self):
        decision = decide(self.gold(90), None, ["no pinned baseline"])
        self.assertFalse(decision["accepted"])
        self.assertIsNone(decision["guard"])

    def test_force_records_what_it_overrode(self):
        forced = override(decide(self.gold(60), self.gold(90), []))
        self.assertTrue(forced["accepted"])
        self.assertEqual(forced["failures"], [])
        self.assertEqual(forced["overriddenFailures"], ["gold schedules: regression"])
        self.assertEqual(forced["overriddenCriterion"], "gold-schedule-accuracy")


if __name__ == "__main__":
    unittest.main()
