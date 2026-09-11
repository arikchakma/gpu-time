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
import semantic
import background
import natural

ROOT = Path(__file__).resolve().parent.parent

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
NUMBERS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
]
TENS = {20: "twenty", 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty",
        70: "seventy", 80: "eighty", 90: "ninety"}
ORDINALS = ["first", "second", "third", "fourth", "fifth"]
DAY_ORDINALS = [
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
    "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth",
    "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
    "nineteenth", "twentieth", "twenty-first", "twenty-second",
    "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth",
    "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth",
    "thirty-first",
]
HOLIDAYS = [
    "Christmas",
    "Christmas Eve",
    "New Year's Day",
    "New Year's Eve",
    "Halloween",
    "Valentine's Day",
]
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
        if label in ("O", "GLUE") and self.in_expression:
            # A carrier ending in a preposition meeting a clause that opens with
            # one reads as "the appointment is at on the 18th".
            words = text.split()
            tail = self.text.split()
            if (
                words
                and tail
                and words[0] in background.CONNECTORS
                and tail[-1].lower() in background.CONNECTORS
            ):
                words = words[1:]
                if not words:
                    return
                text = " ".join(words)
        if label == "O" and self.in_expression:
            if (
                self.augment
                and text in ("the", "at", "on", "of")
                and self.rng.random() < 0.3
            ):
                return
            if self.augment and text == "on the":
                text = self.rng.choice(["on", "the", "on the"])
            label = "GLUE"
        if (
            self.augment
            and any(character.isalpha() for character in text)
            and self.rng.random() < 0.3
        ):
            text = self.rng.choice([text.lower(), text.upper(), text.capitalize()])
        if self.text:
            left, right = self.text[-1], text[0]
            would_merge = (
                (left.isalpha() or left == "_") and (right.isalpha() or right == "_")
            ) or (left.isdigit() and right.isdigit())
            if self.augment and separator == " ":
                separator = self.rng.choice(
                    [" ", " ", "  ", "\t"] if would_merge else ["", " ", " ", "  "]
                )
            # A caller asking for no separator cannot know what precedes it; two
            # tokens fused here leave a span the tokenizer cannot address.
            self.text += separator or (" " if would_merge else "")
        start = len(self.text.encode("utf-16-le")) // 2
        self.text += text
        end = len(self.text.encode("utf-16-le")) // 2
        boundary = self.pending_clause and label not in ("O", "GLUE", "JOIN")
        if boundary:
            self.pending_clause = False
        self.spans.append(
            {"start": start, "end": end, "label": label, "clauseStart": boundary}
        )

    def clause(self) -> None:
        self.in_expression = True
        self.pending_clause = self.clauses > 0
        self.clauses += 1

    def quantity(self, value: int | None = None, label: str = "NUM") -> int:
        value = (
            value
            if value is not None
            else self.rng.choice([1, 2, 3, 4, 5, 6, 7, 10, 12, 15, 24, 30, 45, 90])
        )
        text = (
            NUMBERS[value] if value <= 12 and self.rng.random() < 0.35 else str(value)
        )
        self.add(text, label)
        return value

    def quantity_unit(
        self,
        units: list[str] = UNITS,
        amount: int | None = None,
        *,
        allow_article: bool = True,
    ) -> None:
        name = self.rng.choice(units)
        amount = (
            amount
            if amount is not None
            else self.rng.choice([1, 2, 3, 5, 7, 10, 12, 15, 30, 90])
        )
        if allow_article and amount == 1 and self.rng.random() < 0.4:
            self.add("an" if name == "hour" else "a", "NUM")
        else:
            self.quantity(amount)
        self.add(name if amount == 1 else name + "s", "UNIT")

    def day(self) -> None:
        name = self.rng.choice(DAYS)
        self.add(
            self.rng.choice(
                [name, name.lower(), name[:3], name[:3].lower(), name + "s"]
            ),
            "WEEKDAY",
        )
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
        if day_of_month and self.rng.random() < 0.3:
            word = DAY_ORDINALS[value - 1]
            if "-" in word and self.rng.random() < 0.4:
                word = word.replace("-", " ")
            self.add(word, label)
            return
        suffix = (
            "th"
            if value % 100 in (11, 12, 13)
            else {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
        )
        self.add(str(value), label)
        self.add(suffix, separator="")

    def clock(self, style: int | None = None) -> None:
        style = self.rng.randrange(8) if style is None else style
        if style == 0:
            self.add(self.rng.choice(["noon", "midnight", "midday"]), "TIME_NAMED")
            return
        if style == 1:
            self.add(
                self.rng.choice(["morning", "afternoon", "evening", "night"]), "DAYPART"
            )
            return
        meridiem = style in (2, 3, 4)
        hour = self.rng.randint(1, 12) if meridiem else self.rng.randint(0, 23)
        self.add(
            NUMBERS[hour]
            if style == 7 and hour <= 12 and self.rng.random() < 0.2
            else str(hour),
            "HOUR",
        )
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
        connector = (
            "and"
            if variant % 3 == 1
            else self.rng.choice(["-", "–", "to", "till", "through"])
        )
        self.add(
            connector, "RANGE_END", separator="" if connector in ("-", "–") else " "
        )
        self.clock(self.rng.choice([0, 2, 3, 5, 7]))

    def day_of_month(self, day: int, spoken: bool = False) -> None:
        if spoken or self.rng.random() < 0.3:
            word = DAY_ORDINALS[day - 1]
            if "-" in word and self.rng.random() < 0.4:
                word = word.replace("-", " ")
            self.add(word, "DOM")
            return
        self.add(str(day), "DOM")

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
            self.day_of_month(day)
            self.add(
                self.rng.choice([MONTHS[month - 1], MONTHS[month - 1][:3]]), "MONTH"
            )
            if self.rng.random() < 0.5:
                self.add(str(year), "YEAR")
        else:
            self.add(
                self.rng.choice([MONTHS[month - 1], MONTHS[month - 1][:3]]), "MONTH"
            )
            self.day_of_month(day)
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
            self.add(
                self.rng.choice(["hours", "days", "weeks", "months", "years"]), "UNIT"
            )
            if self.rng.random() < 0.5:
                self.add("on")
                self.day()
        else:
            self.add(
                self.rng.choice(
                    [
                        "hourly",
                        "daily",
                        "weekly",
                        "biweekly",
                        "fortnightly",
                        "monthly",
                        "yearly",
                        "annually",
                    ]
                ),
                "FREQ",
            )
        if self.rng.random() < 0.6:
            self.add("at")
            self.clock()


def render(family: int, variant: int, rng: random.Random) -> Sentence:
    sentence = Sentence(rng)
    if rng.random() < 0.45:
        sentence.add(background.prefix(rng))
    sentence.clause()
    if family == 0:  # A weekday list shares a clock or a window.
        if variant == 8:
            sentence.clock()
            sentence.add(rng.choice([",", "on", "for", "—"]))
            sentence.days()
            return sentence
        if variant % 3 == 0:
            sentence.add(
                rng.choice(["next", "this", "last", "coming", "previous"]), "DEICTIC"
            )
        sentence.days()
        if rng.random() < 0.3:
            return sentence
        if variant % 2:
            sentence.add(rng.choice(["at", "on"]))
            sentence.clock()
        else:
            sentence.window(variant)
    elif family == 1:  # Relative quantity, with both prefix and suffix direction.
        if variant == 6:
            sentence.quantity_unit()
            sentence.add("from", "DIR_AFTER")
            sentence.add("now", "NOW")
            return sentence
        if variant == 8:
            sentence.add("right")
            sentence.add("after", "DIR_AFTER")
            sentence.quantity_unit()
            return sentence
        if variant % 2:
            sentence.add(rng.choice(["in", "after"]), "DIR_AFTER")
        sentence.quantity_unit()
        if variant % 2 == 0:
            marker = rng.choice(["before", "ago", "earlier", "after", "later", "hence"])
            sentence.add(
                marker,
                "DIR_BEFORE" if marker in ("before", "ago", "earlier") else "DIR_AFTER",
            )
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
        sentence.quantity_unit()
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
        if variant % 2:
            sentence.ordinal("DOM", day_of_month=True)
            sentence.add("and")
            sentence.ordinal("DOM", day_of_month=True)
            sentence.add("of")
            sentence.add(rng.choice(["each", "every"]), "RECUR")
            sentence.add("month", "UNIT")
            return sentence
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
            sentence.add(
                rng.choice(["today", "tomorrow", "yesterday", "tonight"]), "REL_DAY"
            )
        else:
            if rng.random() < 0.4:
                sentence.add(rng.choice(["end", "start", "beginning"]), "EDGE")
                sentence.add("of")
            sentence.add(rng.choice(["next", "this", "last"]), "DEICTIC")
            sentence.add(rng.choice(["week", "month", "year"]), "UNIT")
        if rng.random() < 0.6:
            sentence.clock()
    elif family == 10:
        sentence.recurrence(variant)
        if variant == 5:
            sentence.add(rng.choice(["until", "through"]), "BOUND_END")
            sentence.day()
            return sentence
        if variant in (2, 4, 6):
            sentence.add(rng.choice(["until", "till", "through"]), "BOUND_END")
            sentence.add("the")
            sentence.add("end", "EDGE")
            sentence.add("of the")
            sentence.add(rng.choice(["week", "month", "year"]), "UNIT")
            return sentence
        sentence.add(rng.choice(["starting", "beginning", "from"]), "BOUND_START")
        if variant % 2:
            sentence.add("next", "DEICTIC")
            sentence.add("week", "UNIT")
        else:
            sentence.date(variant)
        if rng.random() < 0.5:
            sentence.add(
                rng.choice(["until", "till", "through", "ending"]), "BOUND_END"
            )
            sentence.add(rng.choice(MONTHS), "MONTH")
            if rng.random() < 0.5:
                sentence.quantity(rng.randint(1, 31), "DOM")
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
        if rng.random() < 0.35:
            sentence.add(rng.choice(["day", "days"]), "UNIT")
        else:
            sentence.add(
                rng.choice(["weekday", "weekdays", "weekend", "weekends", "workdays"]),
                "DAYGROUP",
            )
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
        if variant in (0, 3):
            sentence.add(rng.choice(["starting", "beginning"]), "BOUND_START")
            sentence.add("from", "RANGE_START")
            sentence.add(rng.choice(["today", "tomorrow", "yesterday"]), "REL_DAY")
        elif variant not in (1, 4):
            sentence.clock()
        sentence.add(rng.choice(["for", "lasting"]), "DUR")
        if rng.random() < 0.5:
            sentence.add("the")
            sentence.add("next", "DEICTIC")
        sentence.quantity_unit()
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
        if variant in (1, 3, 5):
            sentence.quantity(rng.randint(1, 28), "DOM")
            sentence.add(rng.choice(MONTHS), "MONTH")
            sentence.add(rng.choice(["-", "–", "to", "through"]), "RANGE_END")
            sentence.quantity(rng.randint(1, 28), "DOM")
            sentence.add(rng.choice(MONTHS), "MONTH")
            return sentence
        sentence.add(rng.choice(MONTHS), "MONTH")
        if variant == 8:
            sentence.add("between", "RANGE_START")
        sentence.quantity(rng.randint(1, 14), "DOM")
        sentence.add(
            "and" if variant == 8 else rng.choice(["-", "–", "through"]), "RANGE_END"
        )
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
        sentence.add(
            rng.choice(["morning", "afternoon", "evening", "night"]), "DAYPART"
        )
    elif family == 22:
        sentence.add("the day after tomorrow", "REL_DAY")
    else:
        sentence = Sentence(rng)
        if rng.random() < 0.85:
            sentence.add(background.sentence(rng))
            return sentence
        count = rng.randint(1, 99)
        year = rng.randint(1990, 2035)
        name = rng.choice(["Sam", "Alex", "Jordan", "Riley", "Taylor", "May", "Casey"])
        sentence.add(
            rng.choice(
                [
                    "May I have your second opinion?",
                    f"Please call {count} people in room {rng.randint(1, 40)}.",
                    f"The last slide has {count} diagrams for {name}.",
                    "We march together and may succeed.",
                    f"The build has {year} errors and {count} warnings.",
                    f"Please send the report to {name}.",
                    "Our second attempt was the last one.",
                    "A month is a unit in this glossary.",
                    "From Alice to Bob, the message says hello.",
                    f"This number is {count} and that one is {year}.",
                ]
            )
        )
    return sentence


TERSE_GROUPS = ["weekends", "weekend", "weekdays", "weekday"]


def dash(sentence: Sentence, choices: list[str]) -> None:
    connector = sentence.rng.choice(choices)
    sentence.add(
        connector,
        "RANGE_END",
        separator="" if connector in ("-", "\u2013") else " ",
    )


def terse(sentence: Sentence, variant: int) -> str:
    rng = sentence.rng
    sentence.clause()
    shape = rng.randrange(8)
    if shape == 0:
        sentence.add(rng.choice(TERSE_GROUPS), "DAYGROUP")
    elif shape == 1:
        sentence.day()
        dash(sentence, ["-", "\u2013", "to", "through"])
        sentence.day()
    elif shape == 2:
        name = MONTHS[rng.randint(1, 12) - 1]
        sentence.add(rng.choice([name, name[:3]]), "MONTH")
        first = rng.randint(1, 20)
        sentence.add(str(first), "DOM")
        dash(sentence, ["-", "\u2013", "to"])
        sentence.add(str(rng.randint(first + 1, 28)), "DOM")
    elif shape == 3:
        sentence.window(variant)
    elif shape == 4:
        sentence.window(variant)
        sentence.day()
        dash(sentence, ["-", "\u2013", "to"])
        sentence.day()
    elif shape == 5:
        day = rng.randint(1, 28)
        name = MONTHS[rng.randint(1, 12) - 1]
        if rng.random() < 0.5:
            sentence.add(rng.choice(["the", "on the"]))
            sentence.day_of_month(day, spoken=True)
            sentence.add("of")
            sentence.add(rng.choice([name, name[:3]]), "MONTH")
        else:
            sentence.add(rng.choice([name, name[:3]]), "MONTH")
            sentence.day_of_month(day, spoken=True)
    elif shape == 6:
        sentence.add(rng.choice(["in", "for"]), "DIR_AFTER")
        value = rng.choice([13, 15, 20, 21, 24, 25, 35, 40, 45])
        tens, ones = divmod(value, 10)
        if tens >= 2:
            spoken = TENS[tens * 10] + (
                rng.choice([" ", "-"]) + NUMBERS[ones] if ones else ""
            )
        else:
            spoken = NUMBERS[value] if value <= 12 else str(value)
        sentence.add(spoken, "NUM")
        sentence.add(rng.choice(["minutes", "hours", "days"]), "UNIT")
    else:
        pick = rng.randrange(4)
        if pick == 0:
            sentence.add(
                rng.choice(
                    ["the day before yesterday", "the day after tomorrow", "tmrw"]
                ),
                "REL_DAY",
            )
        elif pick == 1:
            sentence.add(rng.choice(["a few", "a couple of", "several"]), "NUM")
            sentence.add(rng.choice(["days", "weeks", "hours"]), "UNIT")
            sentence.add("ago", "DIR_BEFORE")
        elif pick == 2:
            sentence.add("in", "DIR_AFTER")
            sentence.add(rng.choice(["a few", "a couple of"]), "NUM")
            sentence.add(rng.choice(["days", "weeks", "hours"]), "UNIT")
        else:
            sentence.add(rng.choice(["next", "this"]), "DEICTIC")
            sentence.add(rng.choice(["wk", "week", "mo", "month"]), "UNIT")
    return f"terse-{shape}"


def render_heldout(family: int, rng: random.Random) -> Sentence:
    """Alternative frames, not renamed copies of the training templates."""
    sentence = Sentence(rng)
    if rng.random() < 0.45:
        sentence.add(background.prefix(rng))
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
        sentence.add("the day after tomorrow", "REL_DAY")
        sentence.add("at")
        sentence.clock()
    else:
        sentence = Sentence(rng)
        sentence.add(background.sentence(rng))
    return sentence


def generate(
    path: Path, count: int, seed: int, split: str, exclude: Path | None = None
) -> dict:
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
            family = rng.choices(
                range(24),
                weights=[
                    18,
                    8,
                    7,
                    14,
                    10,
                    12,
                    5,
                    4,
                    3,
                    6,
                    6,
                    5,
                    4,
                    4,
                    3,
                    4,
                    4,
                    2,
                    5,
                    3,
                    1,
                    3,
                    2,
                    24,
                ],
            )[0]
            variant = rng.choice(variants)
            spec = semantic.sample(rng) if family != 23 and rng.random() < 0.8 else None
            if rng.random() < 0.12:
                sentence = Sentence(rng)
                template = terse(sentence, variant)
                spec = None
            elif rng.random() < 0.4:
                sentence = Sentence(rng, augment=False)
                spec = natural.render(sentence, reserved=split == "heldout")
                template = f"natural-{spec.family}/" + ("reserved" if split == "heldout" else "train")
            elif spec:
                sentence = Sentence(rng)
                semantic.render(spec, sentence, variant)
                template = f"semantic-{spec.family}/surface-{variant}"
            else:
                sentence = (
                    render_heldout(family, rng)
                    if split == "heldout"
                    else render(family, variant, rng)
                )
                template = f"family-{family:02d}/" + (
                    "heldout-reordered" if split == "heldout" else f"surface-{variant}"
                )
            if sentence.clauses and rng.random() < 0.3:
                sentence.in_expression = False
                tail = background.suffix(rng)
                if tail[:1].isupper():
                    sentence.add(".", separator="")
                sentence.add(tail)
            row = {
                "id": f"{split}-{seed}-{index}",
                "template": template,
                "text": sentence.text,
                "spans": sentence.spans,
            }
            if spec:
                row["schedule"] = spec.schedule
            key = fingerprint(row)
            if key in reserved:
                rejected += 1
                continue
            row["fingerprint"] = key
            signatures.add(key)
            index += 1
            output.write(
                json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
            families[spec.family if spec else family] += 1
            span_counts.update(span["label"] for span in sentence.spans)
            templates.add(template)
    path.with_suffix(".fingerprints.json").write_text(json.dumps(sorted(signatures)))
    prose = background.borrowed()
    return {
        "structuralFingerprints": len(signatures),
        "rejectedReservedFrames": rejected,
        "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "borrowedProse": len(prose),
        "borrowedProseSha256": (
            hashlib.sha256(background.PROSE.read_bytes()).hexdigest() if prose else None
        ),
        "sequences": count,
        "seed": seed,
        "split": split,
        "templates": sorted(templates),
        "families": dict(families),
        "spanCounts": dict(span_counts),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300000)
    parser.add_argument("--seed", type=int, default=20260909)
    parser.add_argument(
        "--split", choices=["train", "validation", "heldout"], default="train"
    )
    parser.add_argument("--exclude", type=Path)
    parser.add_argument(
        "--out", type=Path, default=ROOT / "data/synth/train.jsonl"
    )
    args = parser.parse_args()
    report = generate(args.out, args.count, args.seed, args.split, args.exclude)
    args.out.with_suffix(".manifest.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(json.dumps(report))
