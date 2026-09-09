"""Generate supervision from semantic slots, never from the runtime parser.

A rendered slot supplies its label and source span. The shared browser tokenizer
later maps these spans onto tokens. Template partitions are disjoint by ID.
"""
from __future__ import annotations

import argparse
import json
import hashlib
import random
from collections import Counter
from pathlib import Path

from signature import fingerprint

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
ORDINALS = ["first", "second", "third", "fourth", "fifth"]
ZONES = ["UTC", "EST", "PST", "EDT", "Asia/Dhaka", "America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney", "Dhaka time"]
HOLIDAYS = ["Christmas", "Christmas Eve", "New Year's Day", "New Year's Eve", "Halloween", "Valentine's Day"]
UNITS = ["minute", "hour", "day", "week", "month", "year"]


class Sentence:
    def __init__(self, rng: random.Random, augment: bool = True):
        self.rng = rng
        self.augment = augment
        self.text = ""
        self.spans: list[dict] = []
        self.clauses = 0
        self.pending_clause = False
        self.in_expression = False

    def add(self, text: str, label: str = "O", separator: str = " ") -> None:
        if label == "O" and self.in_expression:
            if self.augment and text in ("the", "at", "on", "of") and self.rng.random() < 0.3:
                return
            if self.augment and text == "on the":
                text = self.rng.choice(["on", "the", "on the"])
            label = "GLUE"
        if self.augment and self.text and separator == " ":
            left, right = self.text[-1], text[0]
            would_merge = ((left.isalpha() or left == "_") and (right.isalpha() or right == "_")) or (left.isdigit() and right.isdigit())
            separator = self.rng.choice([" ", " ", "  ", "\t"] if would_merge else ["", " ", " ", "  "])
        if self.text:
            self.text += separator
        start = len(self.text.encode("utf-16-le")) // 2
        self.text += text
        end = len(self.text.encode("utf-16-le")) // 2
        boundary = self.pending_clause and label not in ("O", "GLUE", "JOIN")
        if boundary:
            self.pending_clause = False
        self.spans.append({"start": start, "end": end, "label": label, "clauseStart": boundary})

    def clause(self) -> None:
        self.in_expression = True
        self.pending_clause = self.clauses > 0
        self.clauses += 1

    def quantity(self, value: int | None = None, label: str = "NUM") -> int:
        value = value if value is not None else self.rng.choice([1, 2, 3, 4, 5, 6, 7, 10, 12, 15, 24, 30, 45, 90])
        text = NUMBERS[value] if value <= 12 and self.rng.random() < 0.35 else str(value)
        self.add(text, label)
        return value

    def day(self) -> None:
        name = self.rng.choice(DAYS)
        self.add(self.rng.choice([name, name.lower(), name[:3], name[:3].lower(), name + "s"]), "WEEKDAY")
        if self.rng.random() < 0.08:
            self.add(".", separator="")

    def days(self) -> None:
        self.day()
        if self.rng.random() < 0.45:
            connector = self.rng.choice(["and", ",", "&", ""])
            if connector:
                self.add(connector, "JOIN")
            self.day()

    def ordinal(self, label: str = "ORD", day_of_month: bool = False) -> None:
        value = self.rng.randint(1, 31 if day_of_month else 5)
        if not day_of_month and self.rng.random() < 0.55:
            self.add(self.rng.choice(ORDINALS + ["last"]), label)
            return
        suffix = "th" if value % 100 in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
        self.add(str(value), label)
        self.add(suffix, separator="")

    def clock(self, style: int | None = None) -> None:
        style = self.rng.randrange(8) if style is None else style
        if style == 0:
            self.add(self.rng.choice(["noon", "midnight", "midday"]), "TIME_NAMED")
            return
        if style == 1:
            self.add(self.rng.choice(["morning", "afternoon", "evening", "night"]), "DAYPART")
            return
        meridiem = style in (2, 3, 4)
        hour = self.rng.randint(1, 12) if meridiem else self.rng.randint(0, 23)
        self.add(NUMBERS[hour] if style == 7 and hour <= 12 and self.rng.random() < 0.2 else str(hour), "HOUR")
        if style in (3, 4, 5, 6):
            self.add(":", separator="")
            self.add(f"{self.rng.randint(0, 59):02d}", "MINUTE", separator="")
        if style in (4, 6):
            self.add(":", separator="")
            self.add(f"{self.rng.randint(0, 59):02d}", "SECOND", separator="")
        if meridiem:
            marker = self.rng.choice(["am", "pm", "AM", "PM", "a.m.", "p.m."])
            self.add(marker, "MERIDIEM", separator=self.rng.choice(["", " "]))

    def window(self, variant: int) -> None:
        if variant % 3 == 0:
            self.add("from", "RANGE_START")
        elif variant % 3 == 1:
            self.add("between", "RANGE_START")
        self.clock(self.rng.choice([2, 3, 5, 6, 7]))
        connector = "and" if variant % 3 == 1 else self.rng.choice(["-", "–", "to", "till", "through"])
        self.add(connector, "RANGE_END", separator="" if connector in ("-", "–") else " ")
        self.clock(self.rng.choice([0, 2, 3, 5, 7]))

    def date(self, variant: int) -> None:
        month = self.rng.randint(1, 12)
        day = self.rng.randint(1, 28)
        year = self.rng.randint(1990, 2035)
        if variant % 3 == 0:
            self.add(str(year), "YEAR")
            self.add("-", separator="")
            self.add(f"{month:02d}", "MONTH", separator="")
            self.add("-", separator="")
            self.add(f"{day:02d}", "DOM", separator="")
        elif variant % 3 == 1:
            self.add(str(day), "DOM")
            self.add(self.rng.choice([MONTHS[month - 1], MONTHS[month - 1][:3]]), "MONTH")
            if self.rng.random() < 0.5:
                self.add(str(year), "YEAR")
        else:
            self.add(self.rng.choice([MONTHS[month - 1], MONTHS[month - 1][:3]]), "MONTH")
            self.add(str(day), "DOM")
            if self.rng.random() < 0.5:
                self.add(",", separator="")
                self.add(str(year), "YEAR")

    def recurrence(self, variant: int) -> None:
        if variant % 3 == 0:
            self.add(self.rng.choice(["every", "each"]), "RECUR")
            if self.rng.random() < 0.45:
                self.add("other", "NUM")
            self.days()
        elif variant % 3 == 1:
            self.add("every", "RECUR")
            self.quantity(self.rng.randint(1, 6))
            self.add(self.rng.choice(["hours", "days", "weeks", "months", "years"]), "UNIT")
            if self.rng.random() < 0.5:
                self.add("on")
                self.day()
        else:
            self.add(self.rng.choice(["hourly", "daily", "weekly", "biweekly", "fortnightly", "monthly", "yearly", "annually"]), "FREQ")
        if self.rng.random() < 0.6:
            self.add("at")
            self.clock()


def render(family: int, variant: int, rng: random.Random) -> Sentence:
    sentence = Sentence(rng)
    if rng.random() < 0.3:
        sentence.add(rng.choice([
            "remind me to call Sam on", "the meeting is", "let us meet", "deadline:",
            "room 10 is booked for", "call 3 people about", "I may be available",
            "please schedule", "our second discussion is", "Alex asked about",
        ]))
    sentence.clause()
    if family == 0:  # A weekday list shares a clock or a window.
        if variant == 8:
            sentence.clock()
            sentence.add(rng.choice([",", "on", "for", "—"]))
            sentence.days()
            return sentence
        if variant % 3 == 0:
            sentence.add(rng.choice(["next", "this", "last", "coming", "previous"]), "DEICTIC")
        sentence.days()
        if rng.random() < 0.3:
            return sentence
        if variant % 2:
            sentence.add(rng.choice(["at", "on"]))
            sentence.clock()
        else:
            sentence.window(variant)
    elif family == 1:  # Relative quantity, with both prefix and suffix direction.
        if variant == 8:
            sentence.add("right")
            sentence.add("after", "DIR_AFTER")
            sentence.quantity()
            sentence.add(rng.choice(UNITS) + "s", "UNIT")
            return sentence
        if variant % 2:
            sentence.add(rng.choice(["in", "after"]), "DIR_AFTER")
        sentence.quantity()
        sentence.add(rng.choice(UNITS) + "s", "UNIT")
        if variant % 2 == 0:
            marker = rng.choice(["before", "ago", "earlier", "after", "later", "hence"])
            sentence.add(marker, "DIR_BEFORE" if marker in ("before", "ago", "earlier") else "DIR_AFTER")
    elif family == 2:  # Relative quantity anchored to a date, not the reference.
        if variant == 8:
            sentence.add("before", "DIR_BEFORE")
            sentence.date(0)
            sentence.add("by")
            sentence.quantity()
            sentence.add("days", "UNIT")
            return sentence
        if variant in (0, 3):
            sentence.add(rng.choice(["exactly", "precisely", "another", "more"]))
        sentence.quantity()
        sentence.add(rng.choice(UNITS) + "s", "UNIT")
        marker = rng.choice(["before", "after"])
        sentence.add(marker, "DIR_BEFORE" if marker == "before" else "DIR_AFTER")
        if variant % 3 == 0:
            sentence.add(rng.choice(HOLIDAYS), "HOLIDAY")
        elif variant % 3 == 1:
            sentence.add(rng.choice(["today", "tomorrow", "yesterday"]), "REL_DAY")
            sentence.add("at")
            sentence.clock()
        else:
            sentence.day()
    elif family == 3:
        if variant in (6, 7):
            sentence.clock()
            sentence.add("every", "RECUR")
            sentence.days()
        elif variant == 8:
            sentence.days()
            sentence.clock()
            sentence.add("weekly", "FREQ")
        else:
            sentence.recurrence(variant)
    elif family == 4:
        sentence.date(variant)
        if rng.random() < 0.65:
            sentence.add("at")
            sentence.clock()
    elif family == 5:  # No connector is required between separately timed clauses.
        for clause in range(rng.randint(2, 3)):
            if clause:
                connector = rng.choice(["and", ",", ";", "then", "", "and then"])
                if connector:
                    sentence.add(connector, "JOIN")
                sentence.clause()
            if rng.random() < 0.25:
                sentence.add("every", "RECUR")
            if variant in (2, 6):
                sentence.clock()
                sentence.add(rng.choice(["—", ",", "for", "on", "at"]))
                sentence.days()
                continue
            sentence.days()
            if rng.random() < 0.65:
                sentence.window(variant + clause)
            else:
                sentence.clock()
    elif family == 6:
        sentence.add("the")
        sentence.ordinal()
        sentence.day()
        sentence.add("of")
        if variant % 2:
            sentence.add("every", "RECUR")
        else:
            sentence.add(rng.choice(["next", "this", "last"]), "DEICTIC")
        sentence.add("month", "UNIT")
    elif family == 7:
        sentence.add("every", "RECUR")
        sentence.add("month", "UNIT")
        sentence.add("on the")
        sentence.ordinal("DOM", day_of_month=True)
        if rng.random() < 0.4:
            sentence.add("and")
            sentence.ordinal("DOM", day_of_month=True)
    elif family == 8:
        if variant == 8:
            sentence.add("every", "RECUR")
            sentence.add(rng.choice(MONTHS), "MONTH")
            sentence.ordinal("DOM", day_of_month=True)
            return sentence
        sentence.add("every", "RECUR")
        if variant % 2:
            sentence.add("other", "NUM")
        sentence.add("year", "UNIT")
        sentence.add("on the")
        sentence.ordinal("DOM", day_of_month=True)
        sentence.add("of")
        sentence.add(rng.choice(MONTHS), "MONTH")
    elif family == 9:
        if variant % 2:
            sentence.add(rng.choice(["today", "tomorrow", "yesterday", "tonight"]), "REL_DAY")
        else:
            sentence.add(rng.choice(["next", "this", "last"]), "DEICTIC")
            sentence.add(rng.choice(["week", "month", "year"]), "UNIT")
        if rng.random() < 0.6:
            sentence.clock()
    elif family == 10:
        sentence.recurrence(variant)
        sentence.add(rng.choice(["starting", "beginning", "from"]), "BOUND_START")
        if variant % 2:
            sentence.add("next", "DEICTIC")
            sentence.add("week", "UNIT")
        else:
            sentence.date(variant)
        if rng.random() < 0.5:
            sentence.add(rng.choice(["until", "till", "through", "ending"]), "BOUND_END")
            sentence.add(rng.choice(MONTHS), "MONTH")
            if rng.random() < 0.5:
                sentence.quantity(rng.randint(1, 28), "DOM")
    elif family == 11:
        if variant == 8:
            sentence.quantity(rng.randint(1, 12))
            sentence.add("more")
            sentence.add("occurrences", "COUNT")
            sentence.add("daily", "FREQ")
            return sentence
        sentence.recurrence(variant)
        if variant % 2:
            sentence.add("for")
            sentence.quantity(rng.randint(1, 12))
            sentence.add(rng.choice(["times", "occurrences"]), "COUNT")
        else:
            sentence.add("for", "DUR")
            sentence.quantity(rng.randint(1, 12))
            sentence.add(rng.choice(["days", "weeks", "months"]), "UNIT")
    elif family == 12:
        if variant == 8:
            sentence.add("except", "EXCEPT")
            sentence.days()
            sentence.add("daily", "FREQ")
            return sentence
        sentence.add("every", "RECUR")
        sentence.add(rng.choice(["weekday", "weekdays", "weekend", "weekends", "workdays"]), "DAYGROUP")
        sentence.add(rng.choice(["except", "excluding", "skip"]), "EXCEPT")
        sentence.days()
    elif family == 13:
        if variant == 8:
            sentence.add("at")
            sentence.clock()
            sentence.quantity()
            sentence.add("hours", "UNIT")
            sentence.add("long", "DUR")
            return sentence
        sentence.clock()
        sentence.add(rng.choice(["for", "lasting"]), "DUR")
        sentence.quantity(rng.randint(1, 12))
        sentence.add(rng.choice(["minutes", "hours"]), "UNIT")
    elif family == 14:
        if variant == 8:
            sentence.add("weekly", "FREQ")
            sentence.add(rng.choice(["once", "twice", "thrice"]), "TIMES")
            return sentence
        if variant % 2:
            sentence.add(rng.choice(["once", "twice", "thrice"]), "TIMES")
        else:
            sentence.quantity(rng.randint(2, 6))
            sentence.add("times", "TIMES")
        if variant % 3 == 0:
            sentence.add("per", "RECUR")
        else:
            sentence.add("a")
        sentence.add(rng.choice(["day", "week"]), "UNIT")
    elif family == 15:
        sentence.add(rng.choice(MONTHS), "MONTH")
        if variant == 8:
            sentence.add("between", "RANGE_START")
        sentence.quantity(rng.randint(1, 14), "DOM")
        sentence.add("and" if variant == 8 else rng.choice(["-", "–", "through"]), "RANGE_END")
        sentence.quantity(rng.randint(15, 28), "DOM")
        if rng.random() < 0.5:
            sentence.add(",")
            sentence.add(str(rng.randint(2024, 2030)), "YEAR")
    elif family == 16:
        sentence.day()
        sentence.add(rng.choice(["-", "through", "to"]), "RANGE_END")
        sentence.day()
        if rng.random() < 0.7:
            sentence.window(variant)
    elif family == 17:
        sentence.clock()
        sentence.add(rng.choice(ZONES), "TZ")
    elif family == 18:
        sentence.window(variant)
    elif family == 19:
        sentence.add("in", "DIR_AFTER")
        sentence.quantity(rng.randint(1, 5))
        sentence.add("to", "RANGE_END")
        sentence.quantity(rng.randint(6, 12))
        sentence.add(rng.choice(["minutes", "hours", "days"]), "UNIT")
    elif family == 20:
        sentence.add(rng.choice(["now", "immediately"]), "NOW")
    elif family == 21:
        sentence.add(rng.choice(["today", "tomorrow", "yesterday"]), "REL_DAY")
        if variant % 2:
            sentence.add(rng.choice(["in the early", "in the late", "in the"]))
        sentence.add(rng.choice(["morning", "afternoon", "evening", "night"]), "DAYPART")
    elif family == 22:
        sentence.add("the day")
        sentence.add("after", "DIR_AFTER")
        sentence.add("tomorrow", "REL_DAY")
    else:
        sentence = Sentence(rng)
        count = rng.randint(1, 99)
        year = rng.randint(1990, 2035)
        name = rng.choice(["Sam", "Alex", "Jordan", "Riley", "Taylor", "May", "Casey"])
        sentence.add(rng.choice([
            "May I have your second opinion?", f"Please call {count} people in room {rng.randint(1, 40)}.",
            f"The last slide has {count} diagrams for {name}.", "We march together and may succeed.",
            f"The build has {year} errors and {count} warnings.", f"Please send the report to {name}.",
            "Our second attempt was the last one.", "A month is a unit in this glossary.",
            "From Alice to Bob, the message says hello.", f"This number is {count} and that one is {year}.",
        ]))
    if family != 23 and rng.random() < 0.25:
        sentence.in_expression = False
        sentence.add(rng.choice(["works for me", "please", "for the team", "is the deadline", "."]))
    return sentence


def render_heldout(family: int, rng: random.Random) -> Sentence:
    """Alternative frames, not renamed copies of the training templates."""
    sentence = Sentence(rng, augment=False)
    sentence.clause()
    if family == 0:
        sentence.add("at")
        sentence.clock()
        sentence.add("on")
        sentence.days()
    elif family == 1:
        sentence.add("in", "DIR_AFTER")
        sentence.add(rng.choice(["precisely", "exactly", "another"]))
        sentence.quantity()
        sentence.add(rng.choice(UNITS) + "s", "UNIT")
    elif family == 2:
        sentence.add("before", "DIR_BEFORE")
        sentence.add(rng.choice(HOLIDAYS), "HOLIDAY")
        sentence.add("by")
        sentence.quantity()
        sentence.add("days", "UNIT")
    elif family == 3:
        sentence.add("on")
        sentence.days()
        sentence.add("each", "RECUR")
        sentence.add("week", "UNIT")
        sentence.add("at")
        sentence.clock()
    elif family == 4:
        sentence.ordinal("DOM", day_of_month=True)
        sentence.add("of")
        sentence.add(rng.choice(MONTHS), "MONTH")
        sentence.add(str(rng.randint(2024, 2035)), "YEAR")
    elif family == 5:
        for clause in range(rng.randint(2, 3)):
            if clause:
                sentence.add(";", "JOIN")
                sentence.clause()
            sentence.clock(2)
            sentence.add("on")
            sentence.days()
    elif family == 6:
        sentence.add("next", "DEICTIC")
        sentence.add("month", "UNIT")
        sentence.add("on its")
        sentence.ordinal()
        sentence.day()
    elif family == 7:
        sentence.add("on the")
        sentence.ordinal("DOM", day_of_month=True)
        sentence.add("and")
        sentence.ordinal("DOM", day_of_month=True)
        sentence.add("monthly", "FREQ")
    elif family == 8:
        sentence.add("each", "RECUR")
        sentence.add(rng.choice(MONTHS), "MONTH")
        sentence.ordinal("DOM", day_of_month=True)
    elif family == 9:
        sentence.clock()
        sentence.add("on")
        sentence.add(rng.choice(["today", "tomorrow", "yesterday"]), "REL_DAY")
    elif family == 10:
        sentence.add("starting", "BOUND_START")
        sentence.add("tomorrow", "REL_DAY")
        sentence.add("weekly", "FREQ")
    elif family == 11:
        sentence.quantity(rng.randint(1, 12))
        sentence.add("more")
        sentence.add("occurrences", "COUNT")
        sentence.add("starting", "BOUND_START")
        sentence.add("tomorrow", "REL_DAY")
        sentence.add("weekly", "FREQ")
    elif family == 12:
        sentence.add("excluding", "EXCEPT")
        sentence.day()
        sentence.add("weekdays", "DAYGROUP")
        sentence.add("at")
        sentence.clock()
    elif family == 13:
        sentence.quantity()
        sentence.add("hours", "UNIT")
        sentence.add("long", "DUR")
        sentence.add("at")
        sentence.clock()
    elif family == 14:
        sentence.add("per", "RECUR")
        sentence.add("week", "UNIT")
        sentence.add(rng.choice(["once", "twice", "thrice"]), "TIMES")
    elif family == 15:
        sentence.add(rng.choice(MONTHS), "MONTH")
        sentence.add("from", "RANGE_START")
        sentence.quantity(rng.randint(1, 14), "DOM")
        sentence.add("to", "RANGE_END")
        sentence.quantity(rng.randint(15, 28), "DOM")
    elif family == 16:
        sentence.window(2)
        sentence.add("every", "RECUR")
        sentence.day()
        sentence.add("through", "RANGE_END")
        sentence.day()
    elif family == 17:
        sentence.add(rng.choice(ZONES), "TZ")
        sentence.add("at")
        sentence.clock(2)
    elif family == 18:
        sentence.add("between", "RANGE_START")
        sentence.add(rng.choice(["noon", "midnight"]), "TIME_NAMED")
        sentence.add("and", "RANGE_END")
        sentence.clock(2)
    elif family == 19:
        sentence.quantity(rng.randint(1, 5))
        sentence.add("to", "RANGE_END")
        sentence.quantity(rng.randint(6, 12))
        sentence.add("minutes", "UNIT")
        sentence.add("later", "DIR_AFTER")
    elif family == 20:
        sentence.add("right")
        sentence.add("now", "NOW")
    elif family == 21:
        sentence.add("in the early")
        sentence.add("morning", "DAYPART")
        sentence.add("tomorrow", "REL_DAY")
    elif family == 22:
        sentence.add("the day")
        sentence.add("after", "DIR_AFTER")
        sentence.add("tomorrow", "REL_DAY")
        sentence.add("at")
        sentence.clock()
    else:
        sentence = Sentence(rng, augment=False)
        sentence.add(rng.choice([
            "May wrote a second edition of the book.", "The timestamp column is empty.",
            "Choose option 2 from section 3.", "March is a family name on the document.",
            "The last draft contains 31 examples.", "We may print another 12 copies.",
        ]))
    return sentence


def generate(path: Path, count: int, seed: int, split: str, exclude: Path | None = None) -> dict:
    rng = random.Random(seed)
    variants = [9] if split == "heldout" else list(range(9))
    families = Counter()
    span_counts = Counter()
    templates = set()
    signatures = set()
    reserved = set(json.loads(exclude.read_text())) if exclude else set()
    rejected = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as output:
        index = 0
        while index < count:
            family = rng.choices(range(24), weights=[18, 8, 7, 14, 10, 12, 5, 4, 3, 6, 6, 5, 4, 4, 3, 4, 4, 2, 5, 3, 1, 3, 2, 6])[0]
            variant = rng.choice(variants)
            sentence = render_heldout(family, rng) if split == "heldout" else render(family, variant, rng)
            template = f"family-{family:02d}/" + ("heldout-reordered" if split == "heldout" else f"surface-{variant}")
            row = {"id": f"{split}-{seed}-{index}", "template": template, "text": sentence.text, "spans": sentence.spans}
            key = fingerprint(row)
            if key in reserved:
                rejected += 1
                continue
            row["fingerprint"] = key
            signatures.add(key)
            index += 1
            output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            families[family] += 1
            span_counts.update(span["label"] for span in sentence.spans)
            templates.add(template)
    path.with_suffix(".fingerprints.json").write_text(json.dumps(sorted(signatures)))
    return {"structuralFingerprints": len(signatures), "rejectedReservedFrames": rejected, "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "sequences": count, "seed": seed, "split": split, "templates": sorted(templates), "families": dict(families), "spanCounts": dict(span_counts)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300000)
    parser.add_argument("--seed", type=int, default=20260909)
    parser.add_argument("--split", choices=["train", "validation", "heldout"], default="train")
    parser.add_argument("--exclude", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/synth/train.jsonl"))
    args = parser.parse_args()
    report = generate(args.out, args.count, args.seed, args.split, args.exclude)
    args.out.with_suffix(".manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
