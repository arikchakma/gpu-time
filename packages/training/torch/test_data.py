import json
import random
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from generate import Sentence
import natural


class CarrierTests(unittest.TestCase):
    def test_oracle_report_normalizes_an_absolute_source_path(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "cases.jsonl"
            output = Path(directory) / "report.json"
            source.write_text(json.dumps({
                "id": "clock", "family": "clock", "text": "9am",
                "spans": [
                    {"start": 0, "end": 1, "label": "HOUR", "clauseStart": False},
                    {"start": 1, "end": 3, "label": "MERIDIEM", "clauseStart": False},
                ],
                "schedule": {"clauses": [{"time": {"start": {"hour": 9, "minute": 0}}}]},
            }) + "\n")
            subprocess.run(
                ["npx", "tsx", "src/check-semantic.ts", str(source), str(output)],
                cwd=root, check=True, capture_output=True, text=True,
            )
            report = json.loads(output.read_text())
            self.assertEqual(report["correct"], 1)
            self.assertFalse(Path(report["source"]).is_absolute())
            self.assertEqual((root / report["source"]).resolve(), source.resolve())

    def test_date_connectors_are_background(self):
        for connector in ("for", "to", "until", "in for"):
            with self.subTest(connector=connector):
                dates = durations = 0
                with patch.object(
                    natural, "carrier", return_value=("the appointment is scheduled", connector)
                ):
                    for seed in range(100):
                        sentence = Sentence(random.Random(seed), augment=False)
                        spec = natural.render(sentence, family="carrier-date")
                        clause = spec.schedule["clauses"][0]
                        span = sentence.spans[1]
                        text = sentence.text[span["start"]:span["end"]]
                        self.assertEqual(text, connector)
                        self.assertFalse(span["clauseStart"])
                        if "duration" in clause:
                            durations += 1
                            self.assertEqual(span["label"], "DUR")
                        else:
                            dates += 1
                            self.assertEqual(span["label"], "O")
                self.assertGreater(dates, 0)
                self.assertEqual(durations > 0, connector == "for")

    def test_connector_labels_preserve_surfaces_and_schedules(self):
        with patch.object(
            natural, "carrier", return_value=("the appointment is scheduled", "for")
        ):
            sentence = Sentence(random.Random(0), augment=False)
            spec = natural.render(sentence, family="carrier-date")
            # Singular: a plural weekday compiles to a weekly series, not one day.
            self.assertEqual(sentence.text, "the appointment is scheduled for Thursday")
            self.assertEqual(
                spec.schedule,
                {"clauses": [{"date": {"kind": "weekday", "days": ["TH"]}}]},
            )
            sentence = Sentence(random.Random(4), augment=False)
            spec = natural.render(sentence, family="carrier-date")
            self.assertEqual(sentence.text, "the appointment is scheduled for fifteen minutes")
            self.assertEqual(
                spec.schedule,
                {"clauses": [{"duration": {"amount": 15, "unit": "minute"}}]},
            )


if __name__ == "__main__":
    unittest.main()
