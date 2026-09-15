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
            "quarter-code": False,
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
            # The tokenizer splits "Q3" in two, so the digit is only ever
            # distinguishable from an hour by the "Q" glued in front of it.
            for code in re.finditer(r"[Qq]\s*[1-4]\b", text):
                self.assertRegex(code.group(), r"^[Qq][1-4]$")
            found["quarter-code"] |= bool(re.search(r"\bQ[1-4]\b", text))
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

    def test_numeric_identifiers_are_background_and_never_a_date_surface(self):
        rng = random.Random(20260915)
        run = re.compile(r"\d+(?:[.:/-]\d+)+")
        found = {
            "dotted-version": False, "prefixed-v": False,
            "build-stamp": False, "commit": False, "ip": False, "port": False,
            "phone": False, "isbn": False, "spec": False, "part": False,
            "range": False,
        }
        for _ in range(8000):
            text = background.numeric_identifier(rng)
            sentence = Sentence(rng, augment=False)
            sentence.add(text)
            self.assertTrue(all(span["label"] == "O" for span in sentence.spans), text)
            self.assertFalse(sentence.clauses, text)
            self.assertNotIn(background.normal(text), background.RESERVED)
            normalized = background.normal(text)
            self.assertTrue(all(p not in normalized for p in background.RESERVED), text)
            low = text.lower()
            self.assertIsNone(re.search(r"\b(?:am|pm|noon|midnight|o'clock)\b", low), text)
            # semantic.py dots at most three fields and never pads them; its
            # three-field form always ends in a 1990-2040 year. Anything of that
            # shape here would label a real date O.
            self.assertIsNone(re.search(r"\b\d{1,2}\.\d{1,2}\.(?:19|20)\d{2}\b", text), text)
            # The tokenizer splits on every digit boundary, so a year-sized
            # number is a live YEAR surface whatever the string around it says.
            for number in re.finditer(r"\d+", text):
                self.assertFalse(1990 <= int(number.group()) <= 2040, text)
            for match in run.finditer(text):
                parts = re.split(r"[.:/-]", match.group())
                if len(parts) != 2:
                    continue
                first, second = int(parts[0]), int(parts[1])
                if "-" in match.group():
                    self.assertGreater(max(first, second), 31, text)
                else:
                    self.assertFalse(1 <= first <= 28 and 1 <= second <= 28, text)
            found["dotted-version"] |= bool(re.search(r"\bversion \d+\.\d+\b", low))
            found["prefixed-v"] |= bool(re.search(r"\bv\d+\.\d+\b", low))
            found["build-stamp"] |= bool(re.search(r"\b(?:19|20)\d{6}\b", text))
            found["commit"] |= bool(re.search(r"\b[0-9a-f]{7,10}\b", low)) and "ommit" in text
            found["ip"] |= bool(re.search(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", text))
            found["port"] |= bool(re.search(r"\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b", text)) or "port" in low
            found["phone"] |= bool(re.search(r"\b\d{3}-\d{4}\b", text))
            found["isbn"] |= "978-" in text
            found["spec"] |= bool(re.search(r"\b(?:rfc|iso|ieee|ecma|pep|tls)\b", low))
            found["part"] |= bool(re.search(r"\b[A-Z]{2,3}-\d{4,5}\b", text))
            found["range"] |= bool(re.search(r"\b\d{2,4}-\d{2,4}\b", text))
        self.assertTrue(all(found.values()), found)

    def test_greeting_dayparts_stay_background_before_a_real_expression(self):
        rng = random.Random(20260915)
        parts = set()
        for _ in range(6000):
            text = background.prefix(rng)
            low = text.lower()
            match = re.search(r"\b(morning|afternoon|evening)\b", low)
            if not match:
                continue
            sentence = Sentence(rng, augment=False)
            sentence.add(text)
            self.assertTrue(all(span["label"] == "O" for span in sentence.spans), text)
            self.assertFalse(sentence.clauses, text)
            self.assertNotIn(background.normal(text), background.RESERVED)
            if low.startswith("good "):
                parts.add(match.group())
                # "good" is the only cue separating the greeting from a real
                # day part, so it must sit directly in front of the word.
                self.assertEqual(low[: match.start()].strip(), "good")
                # A greeting that also carried a clock would label a real
                # expression O.
                self.assertIsNone(re.search(r"\b\d{1,2}:\d{2}\b|\b(?:am|pm)\b", low), text)
        self.assertEqual(parts, {"morning", "afternoon", "evening"})

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
