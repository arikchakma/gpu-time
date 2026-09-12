import random
import re
import unittest

import background
from generate import Sentence
import natural


class NumericNegativeTests(unittest.TestCase):
    def test_measured_durations_include_compounds_and_correct_number(self):
        values = [background.measured_duration(random.Random(seed)) for seed in range(500)]
        self.assertTrue(any(" and " in value for value in values))
        self.assertTrue(any(" and " not in value for value in values))
        self.assertTrue(any(re.search(r"\b(?:one|1) (?:hour|minute|day|week)\b", value) for value in values))
        for value in values:
            self.assertIsNone(re.search(r"\b(?:one|1) (?:hours|minutes|days|weeks)\b", value))

    def test_numeric_contexts_are_background_without_reserved_carriers(self):
        rng = random.Random(671903)
        found = {
            "address": False,
            "arithmetic": False,
            "base": False,
            "decimal-price": False,
            "dotted-build": False,
            "month-homonym": False,
            "number-list": False,
            "ratio": False,
            "ordinal-rank": False,
            "ordinal-street": False,
            "proper-quarter": False,
            "unit-homonym": False,
        }
        for _ in range(4000):
            text = background.numeric(rng)
            sentence = Sentence(rng, augment=False)
            sentence.add(text)
            self.assertTrue(all(span["label"] == "O" for span in sentence.spans))
            self.assertFalse(sentence.clauses)
            normalized = background.normal(text)
            self.assertTrue(all(phrase not in normalized for phrase in background.RESERVED))
            found["address"] |= bool(re.search(r"\d+ \w+ (?:Street|Road|Avenue|Lane|Drive|Way)", text))
            found["arithmetic"] |= text.startswith(("Multiply ", "Divide ", "Subtract ", "Add "))
            found["base"] |= "base " in text
            found["decimal-price"] |= bool(re.search(r"\b\d+\.\d{2} (?:dollars|euros|pounds)\b", text))
            found["dotted-build"] |= bool(re.search(r"\bbuild \d{4}\.\d{1,2}\.\d{1,2}\b", text.lower()))
            found["month-homonym"] |= any(
                phrase in text.lower()
                for phrase in ("march toward", "quarter district", "pull request")
            )
            found["number-list"] |= bool(re.search(r"(?:seats|rooms|pages|tracks|tables|gates) \d+ and \d+", text))
            found["ratio"] |= bool(re.search(r"\b\d+[-:]\d+\b", text))
            found["ordinal-rank"] |= bool(re.search(r"\b(?:placed|ranked|finished|won) \d+(?:st|nd|rd|th)\b", text.lower()))
            found["ordinal-street"] |= bool(re.search(r"\b\d+(?:st|nd|rd|th) (?:Street|Avenue)\b", text))
            found["proper-quarter"] |= " Quarter" in text and any(
                word in text for word in ("French", "Historic", "Old", "Riverside")
            )
            found["unit-homonym"] |= any(
                phrase in text.lower()
                for phrase in ("minute detail", "second draft", "hour hand", "day job")
            )
        self.assertTrue(all(found.values()), found)

    def test_span_carriers_keep_their_plain_senses_as_background(self):
        rng = random.Random(881204)
        found = {"lasting": False, "within": False, "starting": False, "plain-for": False}
        for _ in range(8000):
            text = background.sentence(rng)
            low = text.lower()
            found["lasting"] |= "lasting" in low
            found["within"] |= "within" in low
            found["starting"] |= "starting" in low
            found["plain-for"] |= bool(re.search(r"\bargued for\b|\bis for \w+, not for\b", low))
            if not any(word in low for word in ("lasting", "within", "starting")):
                continue
            sentence = Sentence(rng, augment=False)
            sentence.add(text, "O")
            self.assertTrue(
                all(span["label"] == "O" for span in sentence.spans),
                (text, sentence.spans),
            )
        self.assertTrue(all(found.values()), found)

    def test_positive_compound_roles_are_preserved(self):
        for family in ("compound-duration", "compound-shift"):
            for seed in range(50):
                sentence = Sentence(random.Random(seed), augment=False)
                spec = natural.render(sentence, family=family, bare=True)
                roles = [span["label"] for span in sentence.spans]
                self.assertEqual(roles.count("NUM"), 2)
                self.assertEqual(roles.count("UNIT"), 2)
                key = "duration" if family == "compound-duration" else "shift"
                self.assertIn(key, spec.schedule["clauses"][0])


if __name__ == "__main__":
    unittest.main()
