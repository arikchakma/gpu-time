"""Sample schedules first, then render their words and token supervision.

The expected AST comes from the sampled specification. Neither the browser
parser nor a date recognizer supplies training labels or expected schedules.
"""

from __future__ import annotations

import random
import background
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from generate import Sentence

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
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
ORDINALS = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
]

GENERAL_FAMILIES = [
    "now",
    "clock",
    "day-part",
    "weekday",
    "day-group",
    "time-window",
    "date-range",
    "weekday-range",
    "duration",
    "anchored-relative",
    "recurrence",
    "yearly",
    "frequency-count",
    "exceptions",
    "recurrence-bounds",
    "holiday",
]
HOLIDAYS = {
    "christmas": "Christmas",
    "christmas-eve": "Christmas Eve",
    "new-year": "New Year's Day",
    "new-years-eve": "New Year's Eve",
    "halloween": "Halloween",
    "valentines": "Valentine's Day",
}


@dataclass
class Specification:
    family: str
    schedule: dict


def sample(rng: random.Random) -> Specification:
    family = rng.choice(
        [
            "calendar",
            "relative",
            "weekday-windows",
            "monthly-days",
            "relative-day",
            "relative-unit",
            "modified-group",
            "weekday-points",
            "bounded-weekday",
            "monthly-ordinal",
        ]
        + GENERAL_FAMILIES
    )
    if family in GENERAL_FAMILIES:
        return Specification(family, {"clauses": [sample_general(family, rng)]})
    if family == "calendar":
        date = {
            "kind": "calendar",
            "month": rng.randint(1, 12),
            "day": rng.randint(1, 28),
        }
        if rng.random() < 0.65:
            date["year"] = rng.randint(1990, 2040)
        clause = {"date": date}
    elif family == "relative":
        clause = {
            "shift": {
                "amount": rng.choice([1, 2, 3, 5, 7, 10, 12, 15, 30, 90]),
                "unit": rng.choice(["minute", "hour", "day", "week", "month", "year"]),
                "direction": rng.choice(["before", "after"]),
            }
        }
        if rng.random() < 0.35:
            clause["date"] = {"kind": "relativeDay", "offset": rng.choice([-1, 0, 1])}
        elif rng.random() < 0.3:
            clause["date"] = {"kind": "now"}
            clause["shift"]["direction"] = "after"
    elif family == "relative-day":
        clause = {"date": {"kind": "relativeDay", "offset": rng.choice([-1, 0, 1, 2])}}
    elif family == "relative-unit":
        date = {
            "kind": "relativeUnit",
            "unit": rng.choice(["week", "month", "year"]),
            "modifier": rng.choice(["this", "next", "last"]),
        }
        if rng.random() < 0.65:
            date["edge"] = rng.choice(["start", "end"])
        clause = {"date": date}
    elif family == "modified-group":
        clause = {
            "date": {
                "kind": "dayGroup",
                "group": "weekend",
                "modifier": rng.choice(["this", "next", "last"]),
            }
        }
    elif family == "bounded-weekday":
        clause = {
            "recurrence": {
                "freq": "daily",
                "interval": 1,
                "until": {"kind": "weekday", "days": [rng.choice(DAY_CODES)]},
            }
        }
    elif family == "weekday-points":
        clauses = [
            {
                "date": {"kind": "weekday", "days": [day]},
                "time": {"start": {"hour": rng.randint(1, 12), "minute": 0}},
            }
            for day in rng.sample(DAY_CODES, rng.randint(2, 4))
        ]
        return Specification(family, {"clauses": clauses})
    elif family == "monthly-ordinal":
        clause = {
            "recurrence": {
                "freq": "monthly",
                "interval": 1,
                "byDay": [rng.choice(DAY_CODES)],
                "bySetPos": [rng.choice([-1, 1, 2, 3, 4, 5])],
            }
        }
    elif family == "monthly-days":
        clause = {
            "recurrence": {
                "freq": "monthly",
                "interval": 1,
                "byMonthDay": sorted(rng.sample(range(1, 29), rng.randint(1, 3))),
            }
        }
    else:
        clauses = []
        for _ in range(rng.randint(1, 3)):
            days = rng.sample(DAY_CODES, rng.randint(1, 3))
            start = {"hour": rng.randint(0, 23), "minute": rng.choice([0, 15, 30, 45])}
            end = {
                "hour": (start["hour"] + rng.randint(1, 12)) % 24,
                "minute": start["minute"],
            }
            clause = {"time": {"start": start, "end": end}}
            if rng.random() < 0.35:
                clause["recurrence"] = {
                    "freq": "weekly",
                    "interval": rng.randint(1, 4),
                    "byDay": days,
                }
            else:
                clause["date"] = {"kind": "weekday", "days": days}
            clauses.append(clause)
        return Specification(family, {"clauses": clauses})
    return Specification(family, {"clauses": [clause]})


def render(spec: Specification, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    if rng.random() < 0.4:
        anchored = spec.family not in ("duration", "weekday-range", "relative")
        sentence.add(background.prefix(rng, connector=anchored))
    for index, clause in enumerate(spec.schedule["clauses"]):
        if index and style % 2:
            sentence.add(rng.choice(["and", ";", ",", "then"]), "JOIN")
        sentence.clause()
        if spec.family in GENERAL_FAMILIES:
            render_general(clause, sentence, style)
        elif spec.family == "calendar":
            calendar(clause["date"], sentence, style)
        elif spec.family == "relative":
            relative(clause, sentence, style)
        elif spec.family == "relative-day":
            sentence.add(
                {
                    -1: "yesterday",
                    0: "today",
                    1: "tomorrow",
                    2: "the day after tomorrow",
                }[clause["date"]["offset"]],
                "REL_DAY",
            )
        elif spec.family == "relative-unit":
            date = clause["date"]
            if date.get("edge"):
                sentence.add(date["edge"], "EDGE")
                sentence.add("of")
            sentence.add(date["modifier"], "DEICTIC")
            sentence.add(date["unit"], "UNIT")
        elif spec.family == "modified-group":
            sentence.add(clause["date"]["modifier"], "DEICTIC")
            sentence.add("weekend", "DAYGROUP")
        elif spec.family == "bounded-weekday":
            sentence.add("every", "RECUR")
            sentence.add("day", "UNIT")
            sentence.add(rng.choice(["through", "until"]), "BOUND_END")
            sentence.add(
                DAYS[DAY_CODES.index(clause["recurrence"]["until"]["days"][0])],
                "WEEKDAY",
            )
        elif spec.family == "weekday-points":
            day = DAYS[DAY_CODES.index(clause["date"]["days"][0])]
            sentence.add(day[:3] if style % 2 else day, "WEEKDAY")
            sentence.add("at")
            sentence.add(str(clause["time"]["start"]["hour"]), "HOUR")
        elif spec.family == "monthly-ordinal":
            rule = clause["recurrence"]
            position = rule["bySetPos"][0]
            sentence.add(
                "last"
                if position == -1
                else ["first", "second", "third", "fourth", "fifth"][position - 1],
                "ORD",
            )
            sentence.add(DAYS[DAY_CODES.index(rule["byDay"][0])], "WEEKDAY")
            sentence.add("of")
            if style % 2:
                sentence.add("every", "RECUR")
            else:
                sentence.add("the")
            sentence.add("month", "UNIT")
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
                interval = recurrence["interval"]
                sentence.add(
                    rng.choice(["every", "each"]) if interval == 1 else "every",
                    "RECUR",
                )
                if interval == 2 and style % 2:
                    sentence.add("other", "NUM")
                elif interval > 1:
                    sentence.quantity(interval)
                    sentence.add("weeks", "UNIT")
                    sentence.add("on")
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
    if day <= 12 and sentence.rng.random() < 0.3:
        sentence.add(ORDINALS[day - 1], "DOM")
        return
    sentence.add(str(day), "DOM")
    suffix = (
        "th" if day in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    )
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
        fields = (
            [(day, "DOM"), (month, "MONTH")]
            if day > 12 and style % 2
            else [(month, "MONTH"), (day, "DOM")]
        )
        if year:
            fields.append((year, "YEAR"))
    else:
        named = MONTHS[month - 1]
        day_text = (
            ORDINALS[day - 1] if day <= 12 and sentence.rng.random() < 0.5 else day
        )
        fields = (
            [(named, "MONTH"), (day_text, "DOM")]
            if style % 2
            else [(day_text, "DOM"), (named, "MONTH")]
        )
        if year:
            fields.append((year, "YEAR"))
        separator = " "
    for index, (value, label) in enumerate(fields):
        if (
            label == "MONTH"
            and index
            and fields[index - 1][1] == "DOM"
            and separator == " "
            and sentence.rng.random() < 0.5
        ):
            sentence.add("of")
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
    sentence.quantity_unit([shift["unit"]], shift["amount"])
    if not prefix:
        sentence.add(
            ("from" if clause["date"]["kind"] == "now" else direction)
            if clause.get("date")
            else sentence.rng.choice(
                ["after", "later"]
                if direction == "after"
                else ["before", "ago", "earlier"]
            ),
            label,
        )
    if clause.get("date"):
        if clause["date"]["kind"] == "now":
            sentence.add("now", "NOW")
            return
        render_date(clause["date"], sentence, style)
        if clause.get("time"):
            sentence.add("at")
            clock(clause["time"]["start"], sentence, style)


def clock(value: dict, sentence: Sentence, style: int) -> None:
    if "named" in value:
        sentence.add(value["named"], "TIME_NAMED")
        return
    if "part" in value:
        sentence.add(value["part"], "DAYPART")
        return
    hour, minute = value["hour"], value["minute"]
    meridiem = style % 2 == 0
    display = hour % 12 or 12 if meridiem else hour
    hour_text = (
        NUMBERS[display]
        if display <= 12 and style % 4 == 0 and minute == 0 and "second" not in value
        else str(display)
        if meridiem
        else f"{display:02d}"
    )
    sentence.add(hour_text, "HOUR")
    if minute or not meridiem or "second" in value:
        sentence.add(":", separator="")
        sentence.add(f"{minute:02d}", "MINUTE", separator="")
    if "second" in value:
        sentence.add(":", separator="")
        sentence.add(f"{value['second']:02d}", "SECOND", separator="")
    if meridiem:
        if sentence.rng.random() < 0.25:
            period = "morning" if hour < 12 else "afternoon" if hour < 18 else "evening"
            article = "the " if sentence.rng.random() < 0.9 else ""
            sentence.add(f"in {article}{period}", "MERIDIEM")
            return
        separator = (
            " " if hour_text.isalpha() and not minute and "second" not in value else ""
        )
        sentence.add("pm" if hour >= 12 else "am", "MERIDIEM", separator=separator)


def sample_clock(rng: random.Random) -> dict:
    value = {"hour": rng.randint(0, 23), "minute": rng.choice([0, 15, 30, 45])}
    if rng.random() < 0.2:
        value["second"] = rng.randint(0, 59)
    return value


def sample_general(family: str, rng: random.Random) -> dict:
    if family == "now":
        return {"date": {"kind": "now"}}
    if family == "holiday":
        return {"date": {"kind": "holiday", "name": rng.choice(list(HOLIDAYS))}}
    if family == "clock":
        return {
            "time": {
                "start": rng.choice(
                    [sample_clock(rng), {"named": "noon"}, {"named": "midnight"}]
                )
            }
        }
    if family == "day-part":
        return {
            "date": {"kind": "relativeDay", "offset": rng.choice([0, 1, -1])},
            "time": {
                "start": {
                    "part": rng.choice(["morning", "afternoon", "evening", "night"])
                }
            },
        }
    if family == "weekday":
        date = {"kind": "weekday", "days": rng.sample(DAY_CODES, rng.randint(1, 3))}
        if rng.random() < 0.5:
            date["modifier"] = rng.choice(["this", "next", "last"])
        return {"date": date, "time": {"start": sample_clock(rng)}}
    if family == "weekday-range":
        start, end = rng.sample(DAY_CODES, 2)
        return {"date": {"kind": "weekdayRange", "from": start, "to": end}}
    if family == "day-group":
        return {
            "recurrence": {
                "freq": "weekly",
                "interval": 1,
                "byDay": DAY_CODES[:5] if rng.random() < 0.5 else DAY_CODES[5:],
            }
        }
    if family == "time-window":
        start = sample_clock(rng)
        return {
            "time": {
                "start": start,
                "end": {
                    "hour": (start["hour"] + rng.randint(1, 10)) % 24,
                    "minute": start["minute"],
                },
            }
        }
    if family == "date-range":
        month = rng.randint(1, 11)
        year = rng.randint(2020, 2035)
        return {
            "date": {
                "kind": "calendarRange",
                "from": {"year": year, "month": month, "day": rng.randint(1, 14)},
                "to": {
                    "year": year,
                    "month": month + rng.randint(0, 1),
                    "day": rng.randint(15, 28),
                },
            }
        }
    if family == "duration":
        clause = {
            "duration": {
                "amount": rng.choice([1, 2, 3, 6, 10, 30, 90]),
                "unit": rng.choice(["minute", "hour", "day", "week"]),
            }
        }
        if rng.random() < 0.5:
            clause["date"] = {"kind": "relativeDay", "offset": rng.choice([0, 1])}
        return clause
    if family == "anchored-relative":
        date = rng.choice(
            [
                {"kind": "weekday", "days": [rng.choice(DAY_CODES)]},
                {"kind": "holiday", "name": rng.choice(list(HOLIDAYS))},
                {
                    "kind": "calendar",
                    "month": rng.randint(1, 12),
                    "day": rng.randint(1, 28),
                },
            ]
        )
        clause = {
            "date": date,
            "shift": {
                "amount": rng.randint(1, 12),
                "unit": rng.choice(["hour", "day", "week"]),
                "direction": rng.choice(["before", "after"]),
            },
        }
        if rng.random() < 0.3:
            clause["time"] = {"start": {"named": "noon"}}
        return clause
    if family == "frequency-count":
        return {
            "recurrence": {
                "freq": rng.choice(["daily", "weekly"]),
                "interval": 1,
                "timesPer": rng.randint(1, 6),
            }
        }
    if family == "exceptions":
        return {
            "recurrence": {
                "freq": "daily",
                "interval": 1,
                "except": [
                    {
                        "kind": "weekday",
                        "days": rng.sample(DAY_CODES, rng.randint(1, 2)),
                    }
                ],
            }
        }
    if family == "yearly":
        return {
            "recurrence": {
                "freq": "yearly",
                "interval": rng.randint(1, 3),
                "byMonth": [rng.randint(1, 12)],
                "byMonthDay": [rng.randint(1, 28)],
            }
        }
    rule = {
        "freq": rng.choice(["hourly", "daily", "weekly", "monthly", "yearly"]),
        "interval": rng.randint(1, 4),
    }
    if rule["freq"] == "weekly" and rng.random() < 0.6:
        rule["byDay"] = rng.sample(DAY_CODES, rng.randint(1, 3))
    if family == "recurrence-bounds":
        bound = rng.choice(["count", "span", "until", "start"])
        if bound == "count":
            rule[bound] = rng.randint(1, 12)
        elif bound == "span":
            rule[bound] = {"amount": rng.randint(1, 12), "unit": "week"}
        elif bound == "start":
            rule[bound] = {"kind": "relativeUnit", "unit": "week", "modifier": "next"}
        else:
            rule[bound] = {
                "kind": "calendar",
                "month": rng.randint(1, 12),
                "day": rng.randint(1, 28),
            }
    return {"recurrence": rule, "time": {"start": sample_clock(rng)}}


def render_days(days: list[str], sentence: Sentence, style: int) -> None:
    for index, day in enumerate(days):
        if index:
            sentence.add("and", "JOIN")
        name = DAYS[DAY_CODES.index(day)]
        sentence.add(name[:3] if style % 2 else name, "WEEKDAY")


def render_date(date: dict, sentence: Sentence, style: int) -> None:
    kind = date["kind"]
    if kind == "now":
        sentence.add("now", "NOW")
    elif kind == "relativeDay":
        sentence.add(
            {-1: "yesterday", 0: "today", 1: "tomorrow", 2: "the day after tomorrow"}[
                date["offset"]
            ],
            "REL_DAY",
        )
    elif kind == "weekday":
        if date.get("modifier"):
            sentence.add(date["modifier"], "DEICTIC")
        render_days(date["days"], sentence, style)
    elif kind == "weekdayRange":
        sentence.add("from", "RANGE_START")
        render_days([date["from"]], sentence, style)
        sentence.add("to", "RANGE_END")
        render_days([date["to"]], sentence, style)
    elif kind == "holiday":
        sentence.add(HOLIDAYS[date["name"]], "HOLIDAY")
    elif kind == "calendar":
        calendar(date, sentence, style)
    elif kind == "calendarRange":
        calendar(date["from"], sentence, 5)
        sentence.add("to", "RANGE_END")
        calendar(date["to"], sentence, 5)
    elif kind == "relativeUnit":
        if date.get("edge"):
            sentence.add(date["edge"], "EDGE")
            sentence.add("of")
        sentence.add(date["modifier"], "DEICTIC")
        sentence.add(date["unit"], "UNIT")
    else:
        raise ValueError(f"No date renderer for {kind}")


def render_general(clause: dict, sentence: Sentence, style: int) -> None:
    if clause.get("shift"):
        relative(clause, sentence, style)
        return
    rule = clause.get("recurrence")
    if rule:
        if rule.get("timesPer"):
            sentence.quantity(rule["timesPer"])
            sentence.add("times", "TIMES")
            sentence.add("per", "RECUR")
            sentence.add("day" if rule["freq"] == "daily" else "week", "UNIT")
        elif rule["interval"] == 1 and rule.get("byDay") in (
            DAY_CODES[:5],
            DAY_CODES[5:],
        ):
            sentence.add("every", "RECUR")
            sentence.add(
                "weekday" if rule["byDay"] == DAY_CODES[:5] else "weekend", "DAYGROUP"
            )
        else:
            sentence.add("every", "RECUR")
            if rule["interval"] > 1:
                sentence.quantity(rule["interval"])
            period = {
                "hourly": "hour",
                "daily": "day",
                "weekly": "week",
                "monthly": "month",
                "yearly": "year",
            }[rule["freq"]]
            sentence.add(period + ("s" if rule["interval"] > 1 else ""), "UNIT")
            if rule.get("byDay"):
                sentence.add("on")
                render_days(rule["byDay"], sentence, style)
            if rule.get("byMonth"):
                sentence.add("on")
                sentence.add(MONTHS[rule["byMonth"][0] - 1], "MONTH")
                sentence.quantity(rule["byMonthDay"][0], "DOM")
    elif clause.get("date"):
        render_date(clause["date"], sentence, style)
    if clause.get("time"):
        has_end = bool(clause["time"].get("end"))
        if has_end and style % 3 == 0:
            sentence.add("from", "RANGE_START")
        elif has_end and style % 3 == 1:
            sentence.add("between", "RANGE_START")
        else:
            sentence.add("at")
        clock(clause["time"]["start"], sentence, style)
        if has_end:
            sentence.add(
                "and"
                if style % 3 == 1
                else sentence.rng.choice(["to", "-", "–", "through"]),
                "RANGE_END",
            )
            clock(clause["time"]["end"], sentence, style)
    if rule:
        for field, marker, label in [
            ("start", "starting", "BOUND_START"),
            ("until", "until", "BOUND_END"),
        ]:
            if rule.get(field):
                sentence.add(marker, label)
                render_date(rule[field], sentence, style)
        if rule.get("count"):
            sentence.add("for")
            sentence.quantity(rule["count"])
            sentence.add("occurrences", "COUNT")
        if rule.get("except"):
            sentence.add("except", "EXCEPT")
            render_date(rule["except"][0], sentence, style)
    duration = clause.get("duration") or (rule or {}).get("span")
    if duration:
        sentence.add("for", "DUR")
        next_duration = sentence.rng.random() < 0.3
        if next_duration:
            sentence.add("the")
            sentence.add("next", "DEICTIC")
        sentence.quantity_unit(
            [duration["unit"]], duration["amount"], allow_article=not next_duration
        )
