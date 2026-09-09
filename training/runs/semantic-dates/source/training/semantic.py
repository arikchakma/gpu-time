"""Sample schedules first, then render their words and token supervision.

The expected AST comes from the sampled specification. Neither the browser
parser nor a date recognizer supplies training labels or expected schedules.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from generate import Sentence

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]


@dataclass
class Specification:
    family: str
    schedule: dict


def sample(rng: random.Random) -> Specification:
    family = rng.choice(["calendar", "relative", "weekday-windows", "monthly-days"])
    if family == "calendar":
        date = {"kind": "calendar", "month": rng.randint(1, 12), "day": rng.randint(1, 28)}
        if rng.random() < 0.65:
            date["year"] = rng.randint(1990, 2040)
        clause = {"date": date}
    elif family == "relative":
        clause = {"shift": {"amount": rng.choice([1, 2, 3, 5, 7, 10, 12, 15, 30, 90]),
            "unit": rng.choice(["minute", "hour", "day", "week", "month", "year"]),
            "direction": rng.choice(["before", "after"])}}
        if rng.random() < 0.35:
            clause["date"] = {"kind": "relativeDay", "offset": rng.choice([-1, 0, 1])}
    elif family == "monthly-days":
        clause = {"recurrence": {"freq": "monthly", "interval": 1,
            "byMonthDay": sorted(rng.sample(range(1, 29), rng.randint(1, 3)))}}
    else:
        clauses = []
        for _ in range(rng.randint(1, 3)):
            days = rng.sample(DAY_CODES, rng.randint(1, 3))
            start = {"hour": rng.randint(0, 23), "minute": rng.choice([0, 15, 30, 45])}
            end = {"hour": (start["hour"] + rng.randint(1, 12)) % 24, "minute": start["minute"]}
            clause = {"time": {"start": start, "end": end}}
            if rng.random() < 0.35:
                clause["recurrence"] = {"freq": "weekly", "interval": rng.randint(1, 4), "byDay": days}
            else:
                clause["date"] = {"kind": "weekday", "days": days}
            clauses.append(clause)
        return Specification(family, {"clauses": clauses})
    return Specification(family, {"clauses": [clause]})


def render(spec: Specification, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    if rng.random() < 0.4:
        sentence.add(rng.choice(["I'll go back", "please book a room", "I am available", "the appointment is", "we should meet"]))
    for index, clause in enumerate(spec.schedule["clauses"]):
        if index and style % 2:
            sentence.add(rng.choice(["and", ";", ",", "then"]), "JOIN")
        sentence.clause()
        if spec.family == "calendar":
            calendar(clause["date"], sentence, style)
        elif spec.family == "relative":
            relative(clause, sentence, style)
        elif spec.family == "monthly-days":
            days = clause["recurrence"]["byMonthDay"]
            if style % 2:
                sentence.add("every", "RECUR")
                sentence.add("month", "UNIT")
                sentence.add("on")
            for position, day in enumerate(days):
                if position:
                    sentence.add("and")
                ordinal(day, sentence)
            if style % 2 == 0:
                sentence.add("of")
                sentence.add("each", "RECUR")
                sentence.add("month", "UNIT")
        else:
            recurrence = clause.get("recurrence")
            if recurrence:
                sentence.add(rng.choice(["every", "each"]), "RECUR")
                if recurrence["interval"] > 1:
                    sentence.quantity(recurrence["interval"])
            days = recurrence["byDay"] if recurrence else clause["date"]["days"]
            for position, day in enumerate(days):
                if position and style % 3:
                    sentence.add(rng.choice(["and", ",", "&"]), "JOIN")
                name = DAYS[DAY_CODES.index(day)]
                sentence.add(name[:3] if style % 2 else name, "WEEKDAY")
            if style % 3 == 0:
                sentence.add("from", "RANGE_START")
            clock(clause["time"]["start"], sentence, style)
            sentence.add("to" if style % 3 == 0 else "-", "RANGE_END")
            clock(clause["time"]["end"], sentence, style)
    if rng.random() < 0.2:
        sentence.in_expression = False
        sentence.add(rng.choice(["please", "for our team", "works for me"]))


def ordinal(day: int, sentence: Sentence) -> None:
    sentence.add(str(day), "DOM")
    suffix = "th" if day in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    sentence.add(suffix, separator="")


def calendar(date: dict, sentence: Sentence, style: int) -> None:
    year, month, day = date.get("year"), date["month"], date["day"]
    separator = ["/", "-", "."][style % 3]
    if style % 6 == 0 and year:
        fields = [(year, "YEAR"), (month, "MONTH"), (day, "DOM")]
    elif style % 6 < 4:
        # Unambiguous day-first numeric examples do not contradict the default
        # month-first labels on inputs such as 03/04. Locale overrides belong to
        # the caller's dateOrder option, not to an unobservable training choice.
        fields = [(day, "DOM"), (month, "MONTH")] if day > 12 and style % 2 else [(month, "MONTH"), (day, "DOM")]
        if year:
            fields.append((year, "YEAR"))
    else:
        named = MONTHS[month - 1]
        fields = [(named, "MONTH"), (day, "DOM")] if style % 2 else [(day, "DOM"), (named, "MONTH")]
        if year:
            fields.append((year, "YEAR"))
        separator = " "
    for index, (value, label) in enumerate(fields):
        if index and separator != " ":
            sentence.add(separator, separator="")
        sentence.add(str(value), label, separator="" if separator != " " else " ")


def relative(clause: dict, sentence: Sentence, style: int) -> None:
    shift = clause["shift"]
    direction = shift["direction"]
    label = "DIR_AFTER" if direction == "after" else "DIR_BEFORE"
    prefix = style % 2 and not clause.get("date")
    if prefix:
        sentence.add("in" if direction == "after" else "before", label)
    sentence.quantity(shift["amount"])
    sentence.add(shift["unit"] + ("s" if shift["amount"] != 1 else ""), "UNIT")
    if not prefix:
        sentence.add(direction if clause.get("date") else sentence.rng.choice(["after", "later"] if direction == "after" else ["before", "ago", "earlier"]), label)
    if clause.get("date"):
        sentence.add({-1: "yesterday", 0: "today", 1: "tomorrow"}[clause["date"]["offset"]], "REL_DAY")


def clock(value: dict, sentence: Sentence, style: int) -> None:
    hour, minute = value["hour"], value["minute"]
    meridiem = style % 2 == 0
    sentence.add(str(hour % 12 or 12) if meridiem else f"{hour:02d}", "HOUR")
    if minute or not meridiem:
        sentence.add(":", separator="")
        sentence.add(f"{minute:02d}", "MINUTE", separator="")
    if meridiem:
        sentence.add("pm" if hour >= 12 else "am", "MERIDIEM", separator="")
