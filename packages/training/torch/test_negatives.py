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
        found = {"lasting": False, "starting": False, "plain-for": False}
        for _ in range(8000):
            text = background.sentence(rng)
            low = text.lower()
            found["lasting"] |= "lasting" in low
            found["starting"] |= "starting" in low
            found["plain-for"] |= bool(re.search(r"\bargued for\b|\bis for \w+, not for\b", low))
            if not any(word in low for word in ("lasting", "starting")):
                continue
            sentence = Sentence(rng, augment=False)
            sentence.add(text, "O")
            self.assertTrue(
                all(span["label"] == "O" for span in sentence.spans),
                (text, sentence.spans),
            )
        self.assertTrue(all(found.values()), found)

    def test_hard_negatives_stay_background_and_cover_both_classes(self):
        rng = random.Random(987654)
        found = {
            "set-to-int": False, "numbered-noun": False, "plural-count": False,
            "int-to-int": False, "weekday-person": False, "weekday-title": False,
            "unit-as-noun": False,
        }
        for _ in range(6000):
            for text in (background.setting_number(rng), background.time_word_name(rng)):
                sentence = Sentence(rng, augment=False)
                sentence.add(text)
                self.assertTrue(all(span["label"] == "O" for span in sentence.spans), text)
                self.assertFalse(sentence.clauses, text)
                self.assertNotIn(background.normal(text), background.RESERVED)
                # A meridiem, a clock, or a weekday beside a day number would be
                # a real expression labelled O, which poisons the corpus.
                low = text.lower()
                self.assertIsNone(re.search(r"\b(?:am|pm|noon|midnight|o'clock)\b", low), text)
                self.assertIsNone(re.search(r"\b\d{1,2}:\d{2}\b", text), text)
                self.assertIsNone(
                    re.search(
                        r"\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|"
                        r"january|february|march|april|may|june|july|august|"
                        r"september|october|november|december)\s+(?:the\s+)?\d",
                        low,
                    ),
                    text,
                )
                found["set-to-int"] |= bool(re.search(r"\b(?:set|turned|raised|lowered|bumped|capped) the \w+", low))
                found["numbered-noun"] |= bool(re.search(r"\b(?:pull request|ticket|issue|option|version|build) \d+", low))
                found["plural-count"] |= bool(re.search(r"\b\d+ (?:chairs|shirts|assertions|pages|seats)\b", low))
                found["int-to-int"] |= bool(re.search(r"\b\d+ (?:to|by) \d+\b", low))
                found["weekday-person"] |= bool(re.search(r"^(?:my \w+ )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", low))
                found["weekday-title"] |= " club meets" in low or " night football" in low or bool(re.search(r"\b(?:times|herald|gazette|journal)\b", low))
                found["unit-as-noun"] |= bool(re.search(r"\b(?:the word|the plural of|a) (?:second|minute|hour|day|week|month|year)\b", low))
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
