import json
import random
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from generate import Sentence
import natural


class ProseTests(unittest.TestCase):
    def test_new_prose_frames_exclude_reserved_carrier_head_nouns(self):
        with patch.object(natural.background, "prefix", return_value="a generic event"):
            for family in ("prose-shift", "prose-date"):
                for seed in range(1000):
                    sentence = Sentence(random.Random(seed), augment=False)
                    natural.render(sentence, family=family)
                    prefix = sentence.spans[0]
                    if prefix["label"] == "O":
                        words = sentence.text[prefix["start"]:prefix["end"]].lower().split()
                        self.assertFalse({"rehearsal", "train", "diary", "reminder"} & set(words), sentence.text)

    def test_family_weights_keep_prose_contrasts_small(self):
        weights = dict(zip(natural.FAMILIES, natural.FAMILY_WEIGHTS))
        self.assertEqual(weights["prose-shift"], 1)
        self.assertEqual(weights["carrier-date"], 1)
        self.assertEqual(weights["compound-shift"], 2)
        self.assertEqual(weights["prose-date"], 2)

    def test_prose_and_existing_shapes_roundtrip(self):
        cases = []
        months = set()
        partial_years = set()
        units = set()
        quantities = set()
        dates = set()
        prefixes = set()
        articles = set()
        for family, count in (
            ("prose-shift", 400), ("prose-date", 800), ("carrier-date", 400),
            ("compound-shift", 100), ("compound-duration", 100), ("numeric-date", 100),
        ):
            for seed in range(count):
                sentence = Sentence(
                    random.Random(seed), augment=0.35 if seed % 3 == 0 else False
                )
                spec = natural.render(sentence, family=family, bare=seed % 4 == 0)
                clause = spec.schedule["clauses"][0]
                self.assertFalse(any(
                    phrase in sentence.text.lower()
                    for phrase in natural.RESERVED + natural.RESERVED_DURATION
                ))
                if family == "prose-shift":
                    shift = clause["shift"]
                    self.assertEqual(shift["direction"], "after")
                    self.assertNotIn("components", shift)
                    units.add(shift["unit"])
                    roles = [span["label"] for span in sentence.spans]
                    self.assertEqual(roles.count("NUM"), 1)
                    self.assertEqual(roles.count("UNIT"), 1)
                    number = next(span for span in sentence.spans if span["label"] == "NUM")
                    quantity = sentence.text[number["start"]:number["end"]]
                    quantities.add(quantity.isdigit())
                    if quantity in ("a", "an"):
                        articles.add(quantity)
                        self.assertEqual(shift["amount"], 1)
                    first = next(span for span in sentence.spans if span["label"] != "O")
                    prefixes.add(sentence.text[:first["start"]].strip())
                    self.assertEqual(first["label"], "DIR_AFTER")
                    self.assertFalse(first["clauseStart"])
                if family in ("compound-shift", "compound-duration"):
                    key = "shift" if family == "compound-shift" else "duration"
                    self.assertEqual(len(clause[key]["components"]), 1)
                    self.assertEqual(
                        sum(span["label"] == "NUM" for span in sentence.spans), 2
                    )
                if family == "prose-date":
                    date = clause["date"]
                    dates.add(tuple(sorted(date)))
                    if "day" not in date:
                        months.add(date["month"])
                        if "year" in date:
                            partial_years.add(date["year"])
                cases.append({
                    "family": family, "seed": seed, "text": sentence.text,
                    "spans": sentence.spans, "schedule": spec.schedule,
                })
        self.assertEqual(months, set(range(1, 13)))
        self.assertTrue(any(year < 1990 for year in partial_years))
        self.assertTrue(any(year >= 2026 for year in partial_years))
        self.assertEqual(units, {"minute", "hour", "day", "week", "month", "year"})
        self.assertEqual(quantities, {False, True})
        self.assertEqual(articles, {"a", "an"})
        self.assertGreater(len(prefixes), 40)
        self.assertEqual(dates, {
            ("kind", "month"), ("kind", "month", "year"),
            ("day", "kind"), ("day", "kind", "month", "year"),
        })
        result = subprocess.run(
            ["npx", "tsx", "--eval", """
                import { readFileSync } from "node:fs";
                import { isDeepStrictEqual } from "node:util";
                import { tokenize } from "./packages/core/src/tokenizer.ts";
                import { compile } from "./packages/core/src/compile.ts";
                const failures = [];
                for (const example of JSON.parse(readFileSync(0, "utf8"))) {
                    const tokens = tokenize(example.text).map(token => {
                        const span = example.spans.find(span =>
                            token.start >= span.start && token.end <= span.end);
                        if (token.kind !== 3 && !span)
                            throw new Error(`Unaligned supervision: ${example.family}/${example.seed}`);
                        return {...token, label: span?.label ?? "O", score: 1,
                            clauseStart: Boolean(span?.clauseStart && token.start === span.start)};
                    });
                    const actual = compile(example.text, tokens);
                    if (actual.length !== 1 || !isDeepStrictEqual(actual[0].schedule, example.schedule))
                        failures.push({family: example.family, seed: example.seed,
                            text: example.text, expected: example.schedule, actual});
                }
                process.stdout.write(JSON.stringify(failures));
            """],
            cwd=Path(__file__).resolve().parents[3],
            input=json.dumps(cases), text=True, capture_output=True, check=True,
        )
        failures = json.loads(result.stdout)
        self.assertEqual(failures, [], json.dumps(failures[:5], indent=2))

    def test_reserved_shift_carriers_are_evaluation_only(self):
        for seed in range(100):
            sentence = Sentence(random.Random(seed), augment=False)
            natural.render(sentence, family="prose-shift", reserved=True)
            self.assertTrue(any(
                sentence.text.startswith(phrase)
                for phrase in natural.RESERVED_DURATION
            ))
            self.assertEqual(sentence.spans[0]["label"], "O")
            self.assertEqual(sentence.spans[1]["label"], "DIR_AFTER")


if __name__ == "__main__":
    unittest.main()
