import unittest

import torch

from model import PADDING_ROW, TimeTagger, affine_scan


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
        model = TimeTagger()
        model.qat = True
        roles, boundaries = model(*self.inputs())
        loss = roles.square().mean() + boundaries.square().mean()
        loss.backward()
        for name, parameter in model.named_parameters():
            self.assertIsNotNone(parameter.grad, name)
            self.assertTrue(torch.isfinite(parameter.grad).all(), name)


if __name__ == "__main__":
    unittest.main()
