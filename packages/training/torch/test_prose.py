import json
import random
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from generate import Sentence
import natural


class ProseTests(unittest.TestCase):
    def test_prose_month_is_always_a_partial_calendar_date(self):
        months = set()
        prefixes = set()
        for seed in range(300):
            sentence = Sentence(random.Random(seed), augment=False)
            spec = natural.render(sentence, family="prose-month")
            date = spec.schedule["clauses"][0]["date"]
            self.assertEqual(set(date), {"kind", "month"})
            month = next(span for span in sentence.spans if span["label"] == "MONTH")
            months.add(date["month"])
            prefixes.add(sentence.text[:month["start"]].strip())
            self.assertTrue(prefixes)
            self.assertEqual(month, sentence.spans[-1])
        self.assertEqual(months, set(range(1, 13)))
        self.assertGreater(len(prefixes), 5)

    def test_compact_named_dates_keep_day_month_year_roles(self):
        separators = set()
        for seed in range(200):
            sentence = Sentence(random.Random(seed), augment=False)
            spec = natural.render(sentence, family="compact-named-date", bare=True)
            labels = [span["label"] for span in sentence.spans]
            self.assertEqual(labels, ["DOM", "GLUE", "MONTH", "GLUE", "YEAR"])
            self.assertEqual(
                set(spec.schedule["clauses"][0]["date"]),
                {"kind", "day", "month", "year"},
            )
            separators.add(sentence.text[2])
        self.assertEqual(separators, {"-", "/"})

    def test_shared_month_ranges_assign_the_separator_to_the_range(self):
        for seed in range(100):
            sentence = Sentence(random.Random(seed), augment=False)
            spec = natural.render(sentence, family="shared-month-range", bare=True)
            labels = [span["label"] for span in sentence.spans]
            self.assertEqual(labels[:4], ["DOM", "RANGE_END", "DOM", "MONTH"])
            date = spec.schedule["clauses"][0]["date"]
            self.assertEqual(date["kind"], "calendarRange")
            self.assertEqual(date["from"]["month"], date["to"]["month"])
            self.assertLess(date["from"]["day"], date["to"]["day"])

    def test_new_english_families_match_the_compiler_oracle(self):
        rows = []
        for family in (
            "prose-month",
            "compact-named-date",
            "shared-month-range",
            "anchored-shift",
            "anchored-duration",
            "daypart-clock",
            "month-led-range",
            "imperative-shift",
            "monthly-ordinal",
            "idiom-date",
            "contrast-date",
            *natural.NEW_FAMILIES,
        ):
            for seed in range(100):
                sentence = Sentence(random.Random(seed), augment=0.35)
                spec = natural.render(sentence, family=family, bare=family != "prose-month")
                rows.append({
                    "id": f"{family}-{seed}",
                    "family": family,
                    "text": sentence.text,
                    "spans": sentence.spans,
                    "schedule": spec.schedule,
                })
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "english.jsonl"
            report = Path(directory) / "report.json"
            source.write_text("".join(json.dumps(row) + "\n" for row in rows))
            subprocess.run(
                ["npx", "tsx", "src/check-semantic.ts", str(source), str(report)],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            )
            result = json.loads(report.read_text())
        self.assertEqual(result["correct"], len(rows), result.get("failures", [])[:5])

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
        self.assertEqual(weights["prose-month"], 0.5)
        self.assertEqual(weights["compact-named-date"], 0.5)
        self.assertEqual(weights["shared-month-range"], 0.5)

    def test_anchored_shifts_cover_written_and_digit_subday_quantities(self):
        units = set()
        written = set()
        anchors = set()
        amounts = set()
        for seed in range(300):
            sentence = Sentence(random.Random(seed), augment=False)
            spec = natural.render(sentence, family="anchored-shift", bare=True)
            shift = spec.schedule["clauses"][0]["shift"]
            units.add(shift["unit"])
            amounts.add(shift["amount"])
            number = next(span for span in sentence.spans if span["label"] == "NUM")
            written.add(not sentence.text[number["start"]:number["end"]].isdigit())
            anchors.add(sentence.spans[-1]["label"])
        self.assertEqual(units, {"second", "minute", "hour", "day", "week"})
        self.assertEqual(written, {False, True})
        self.assertEqual(anchors, {"NOW", "REL_DAY", "WEEKDAY"})
        self.assertIn(45, amounts)
        self.assertTrue(any(amount >= 90 for amount in amounts))

    def test_a_leading_duration_carrier_spans_instead_of_shifting(self):
        carriers = set()
        openers = set()
        anchors = set()
        for seed in range(400):
            sentence = Sentence(random.Random(seed), augment=False)
            spec = natural.render(sentence, family="anchored-duration", bare=True)
            clause = spec.schedule["clauses"][0]
            self.assertIn("duration", clause)
            self.assertNotIn("shift", clause)
            labels = [span["label"] for span in sentence.spans]
            self.assertEqual(labels[0], "DUR")
            carriers.add(sentence.text.split()[0].lower())
            opener = sentence.spans[-2]
            openers.add((opener["label"], sentence.text[opener["start"]:opener["end"]].lower()))
            anchors.add(labels[-1])
        self.assertEqual(carriers, {"for", "within", "lasting"})
        self.assertEqual(
            openers,
            {("GLUE", "from"), ("BOUND_START", "starting"), ("BOUND_START", "beginning")},
        )
        self.assertEqual(anchors, {"NOW", "REL_DAY", "WEEKDAY"})

    def test_anchored_shift_and_duration_differ_only_by_the_carrier(self):
        for seed in range(200):
            shift = natural.render(
                Sentence(random.Random(seed), augment=False),
                family="anchored-shift",
                bare=True,
            ).schedule["clauses"][0]
            span = natural.render(
                Sentence(random.Random(seed), augment=False),
                family="anchored-duration",
                bare=True,
            ).schedule["clauses"][0]
            self.assertIn("shift", shift)
            self.assertNotIn("duration", shift)
            self.assertIn("duration", span)
            self.assertNotIn("shift", span)

    def test_prose_shifts_include_delayed_imperative_actions(self):
        imperatives = set()
        for seed in range(500):
            sentence = Sentence(random.Random(seed), augment=False)
            natural.render(sentence, family="prose-shift")
            first = sentence.text.split()[0].lower()
            if first in {"check", "resume", "contact", "reopen", "revisit", "return"}:
                imperatives.add(first)
        self.assertEqual(
            imperatives, {"check", "resume", "contact", "reopen", "revisit", "return"}
        )

    def test_imperative_shift_does_not_get_an_unrelated_carrier(self):
        retry = False
        trailing = False
        for seed in range(100):
            sentence = Sentence(random.Random(seed), augment=False)
            natural.render(sentence, family="imperative-shift")
            self.assertIn(
                sentence.text.split()[0].lower(),
                {"check", "resume", "contact", "reopen", "revisit", "return", "try", "please"},
            )
            self.assertEqual(sentence.spans[0]["label"], "O")
            labels = [span["label"] for span in sentence.spans]
            start = labels.index("DIR_AFTER")
            self.assertEqual(labels[start:start + 3], ["DIR_AFTER", "NUM", "UNIT"])
            retry |= sentence.text.lower().startswith(("try again", "please try again"))
            if labels[-1] == "O" and len(labels) > start + 3:
                trailing = True
                self.assertEqual(labels[-2], "GLUE")
        self.assertTrue(retry)
        self.assertTrue(trailing)

    def test_daypart_clock_trailing_action_is_background(self):
        found = 0
        for seed in range(200):
            sentence = Sentence(random.Random(seed), augment=False)
            natural.render(sentence, family="daypart-clock")
            labels = [span["label"] for span in sentence.spans]
            self.assertIn("DAYPART", labels)
            self.assertIn("HOUR", labels)
            if labels[-1] == "O":
                found += 1
                self.assertNotEqual(labels[-2], "O")
        self.assertGreater(found, 100)

    def test_a_place_after_a_clock_stays_background(self):
        shapes = set()
        for seed in range(600):
            sentence = Sentence(random.Random(seed), augment=False)
            specification = natural.render(sentence)
            if sentence.spans[-1]["label"] != "O":
                continue
            tail = sentence.text[sentence.spans[-1]["start"] :]
            if not tail.startswith(("at ", "in ")):
                continue
            shapes.add(tail.split()[0])
            clause = specification.schedule["clauses"][0]
            self.assertIn("time", clause)
            for span in sentence.spans:
                if span["start"] >= sentence.spans[-1]["start"]:
                    self.assertEqual(span["label"], "O")
        self.assertEqual(shapes, {"at", "in"})

    def test_last_minute_idiom_stays_background_before_a_real_date(self):
        forms = set()
        adverbial = False
        for seed in range(100):
            sentence = Sentence(random.Random(seed), augment=False)
            natural.render(sentence, family="idiom-date")
            prefix = sentence.spans[0]
            self.assertEqual(prefix["label"], "O")
            if "last-minute" in sentence.text:
                self.assertLess(sentence.text.index("last-minute"), prefix["end"])
                forms.add("hyphenated")
            if "last minute" in sentence.text:
                self.assertLess(sentence.text.index("last minute"), prefix["end"])
                forms.add("words")
                adverbial |= "this last minute" in sentence.text
            labels = [span["label"] for span in sentence.spans]
            self.assertIn("MONTH", labels)
            self.assertIn("DOM", labels)
            self.assertIn("HOUR", labels)
        self.assertEqual(forms, {"hyphenated", "words"})
        self.assertTrue(adverbial)

    def test_ordinal_and_month_homonyms_stay_in_the_date_carrier(self):
        for seed in range(100):
            sentence = Sentence(random.Random(seed), augment=False)
            natural.render(sentence, family="contrast-date")
            self.assertEqual(sentence.spans[0]["label"], "O")
            labels = [span["label"] for span in sentence.spans]
            self.assertIn("MONTH", labels[1:])
            self.assertIn("DOM", labels[1:])

    def test_daypart_before_clock_keeps_both_time_roles(self):
        for seed in range(100):
            sentence = Sentence(random.Random(seed), augment=False)
            natural.render(sentence, family="daypart-clock", bare=True)
            labels = [span["label"] for span in sentence.spans]
            self.assertIn("DAYPART", labels)
            self.assertIn("HOUR", labels)
            self.assertLess(labels.index("DAYPART"), labels.index("HOUR"))

    def test_month_led_ranges_share_month_and_year(self):
        for seed in range(100):
            sentence = Sentence(random.Random(seed), augment=False)
            spec = natural.render(sentence, family="month-led-range", bare=True)
            labels = [span["label"] for span in sentence.spans]
            self.assertEqual(labels, ["MONTH", "DOM", "RANGE_END", "DOM", "GLUE", "YEAR"])
            date = spec.schedule["clauses"][0]["date"]
            self.assertEqual(date["from"]["month"], date["to"]["month"])
            self.assertEqual(date["from"]["year"], date["to"]["year"])

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
        self.assertEqual(
            units, {"second", "minute", "hour", "day", "week", "month", "year"}
        )
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
