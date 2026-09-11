"""Natural phrasing with independently constructed schedules and role supervision.

Reference dates and timezones never enter these examples. Reserved wording uses
separate sentence frames; quantities, dates and combinations vary within frames.
"""

from __future__ import annotations
import random
from copy import deepcopy
import background
from semantic import DAYS, DAY_CODES, MONTHS, Specification

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = {20: "twenty", 30: "thirty", 40: "forty", 50: "fifty"}
FAMILIES = [
    "spoken-clock",
    "fraction-clock",
    "qualified-clock",
    "compound-duration",
    "compound-shift",
    "fraction-duration",
    "prose-date",
    "numeric-date",
    "date-range",
    "datetime-range",
    "month-period",
    "month-week",
    "recurrence",
    "recurrence-bound",
    "monthly-exception",
    "shared-times",
]
RESERVED = [
    "could you arrange a reminder for",
    "our rehearsal begins at",
    "the train leaves at",
    "please put this in my diary for",
]
RESERVED_DURATION = ["allow extra time", "the workshop continues"]
# Registered rather than imported: background cannot see natural without closing
# the cycle that runs back through semantic.
background.reserve(RESERVED + RESERVED_DURATION)


def words(value, hyphen=False):
    if value < 20:
        return ONES[value]
    tens, ones = divmod(value, 10)
    return TENS[tens * 10] + (("-" if hyphen else " ") + ONES[ones] if ones else "")


def clock(s, mode=None, hour=None):
    r = s.rng
    h = hour if hour is not None else r.randint(1, 12)
    m = r.randrange(60)
    meridiem = r.choice(["am", "pm"])
    mode = mode or r.choice(["digits", "spoken", "qualified", "fraction"])
    if mode == "fraction":
        m = r.choice([15, 30, 45])
        subtract = m == 45
        s.add("quarter" if m != 30 else "half", "CLOCK_OFFSET")
        s.add("to" if subtract else "past", "GLUE")
        target = h % 12 + 1 if subtract else h
        s.add(words(target), "HOUR")
        s.add(meridiem, "MERIDIEM")
        target24 = target % 12 + (12 if meridiem == "pm" else 0)
        total = (target24 * 60 + (-15 if subtract else m)) % 1440
        return {"hour": total // 60, "minute": total % 60}
    s.add(words(h) if mode == "spoken" or r.random() < 0.4 else str(h), "HOUR")
    if mode == "spoken":
        if m:
            s.add(words(m, r.random() < 0.5), "MINUTE")
        else:
            s.add(r.choice(["o'clock", "o’clock", "oclock"]), "MERIDIEM")
    elif mode == "qualified":
        m = 0
    else:
        s.add(":", "GLUE", "")
        s.add(f"{m:02}", "MINUTE", "")
    if mode == "qualified":
        qualifier = (
            r.choice(["in the morning", "in morning"])
            if meridiem == "am"
            else r.choice(["in the afternoon", "in the evening", "at night"])
        )
        s.add(qualifier, "MERIDIEM")
        if h == 12 and qualifier == "at night":
            meridiem = "am"
    elif r.random() < 0.85:
        s.add(meridiem, "MERIDIEM")
    else:
        meridiem = None
    return {
        "hour": h % 12 + (12 if meridiem == "pm" else 0) if meridiem else h,
        "minute": m,
    }


def quantity(s, amount, name):
    s.add(words(amount) if amount < 60 and s.rng.random() < 0.6 else str(amount), "NUM")
    s.add(name if amount == 1 else name + "s", "UNIT")


def calendar(s, date, numeric=False):
    r = s.rng
    if numeric:
        order = r.choice(["MDY", "DMY"])
        sep = r.choice(["/", "-"])
        for i, key in enumerate(
            ["month", "day", "year"] if order == "MDY" else ["day", "month", "year"]
        ):
            if i:
                s.add(sep, "GLUE", "")
            s.add(
                (
                    str(date[key]).zfill(2)
                    if key != "year" and r.random() < 0.5
                    else str(date[key])
                ),
                {"month": "MONTH", "day": "DOM", "year": "YEAR"}[key],
                "",
            )
    else:
        s.add(
            MONTHS[date["month"] - 1]
            if r.random() < 0.5
            else MONTHS[date["month"] - 1][:3],
            "MONTH",
        )
        if r.random() < 0.3:
            s.add(".", "GLUE", "")
        s.add(str(date["day"]), "DOM")
        if date.get("year"):
            s.add(str(date["year"]), "YEAR")


def render(s, reserved=False, family=None, bare=False):
    r = s.rng
    family = family or r.choice(FAMILIES)
    anchored = family not in (
        "compound-duration",
        "compound-shift",
        "fraction-duration",
    )
    if bare:
        prefix = ""
    elif reserved:
        prefix = r.choice(RESERVED if anchored else RESERVED_DURATION)
    elif r.random() < 0.85:
        prefix = background.prefix(r, connector=anchored)
    else:
        prefix = ""
    if prefix:
        s.add(prefix)
    s.clause()
    clause = {}
    if family in ("spoken-clock", "fraction-clock", "qualified-clock"):
        mode = {
            "spoken-clock": "spoken",
            "fraction-clock": "fraction",
            "qualified-clock": "qualified",
        }[family]
        clause = {"time": {"start": clock(s, mode)}}
    elif family in ("compound-duration", "compound-shift"):
        shift = family == "compound-shift"
        s.add("in" if shift else "for", "DIR_AFTER" if shift else "DUR")
        first = r.randint(1, 5)
        second = r.randint(1, 11)
        units = r.choice([("hour", "minute"), ("day", "hour"), ("week", "day")])
        quantity(s, first, units[0])
        s.add("and", "GLUE")
        quantity(s, second, units[1])
        value = {
            "amount": first,
            "unit": units[0],
            "components": [{"amount": second, "unit": units[1]}],
        }
        if shift:
            value["direction"] = "after"
        clause = {"shift" if shift else "duration": value}
    elif family == "fraction-duration":
        shift = r.random() < 0.5
        s.add("in" if shift else "for", "DIR_AFTER" if shift else "DUR")
        style = r.randrange(3)
        amount = r.randint(1, 4) + 0.5
        if style == 0:
            amount = 0.5
            s.add("half", "NUM")
            s.add("an", "NUM")
            s.add("hour", "UNIT")
        elif style == 1:
            amount = 1.5
            s.add("an", "NUM")
            s.add("hour", "UNIT")
            s.add("and", "GLUE")
            s.add("a", "NUM")
            s.add("half", "NUM")
        else:
            s.add(str(amount), "NUM")
            s.add("hours", "UNIT")
        value = {"amount": amount, "unit": "hour"}
        if shift:
            value["direction"] = "after"
        clause = {"shift" if shift else "duration": value}
    elif family in ("prose-date", "numeric-date"):
        date = {
            "year": r.randint(1990, 2040),
            "month": r.randint(1, 12),
            "day": r.randint(13, 28),
        }
        if family == "prose-date" and r.random() < 0.35:
            date = {"day": r.randint(1, 28)}
            s.add("on the", "GLUE")
            s.add(str(date["day"]), "DOM")
            s.add(
                "th"
                if 10 <= date["day"] % 100 <= 20
                else {1: "st", 2: "nd", 3: "rd"}.get(date["day"] % 10, "th"),
                "GLUE",
                "",
            )
        else:
            calendar(s, date, family == "numeric-date")
        clause = {"date": {"kind": "calendar", **date}}
        if r.random() < 0.65:
            s.add("at", "GLUE")
            clause["time"] = {"start": clock(s)}
    elif family == "date-range":
        month = r.randint(1, 12)
        start = r.randint(1, 12)
        end = r.randint(16, 28)
        s.add("from", "RANGE_START")
        annotated = r.random() < 0.3
        if annotated:
            s.add(r.choice(DAYS), "WEEKDAY")
            s.add("the", "GLUE")
            s.add(str(start), "DOM")
            s.add(
                "th"
                if 10 <= start % 100 <= 20
                else {1: "st", 2: "nd", 3: "rd"}.get(start % 10, "th"),
                "GLUE",
                "",
            )
        else:
            calendar(s, {"month": month, "day": start})
        s.add(r.choice(["through", "until", "to"]), "RANGE_END")
        if annotated:
            s.add(r.choice(DAYS), "WEEKDAY")
            s.add("the", "GLUE")
            s.add(str(end), "DOM")
            s.add(
                "th"
                if 10 <= end % 100 <= 20
                else {1: "st", 2: "nd", 3: "rd"}.get(end % 10, "th"),
                "GLUE",
                "",
            )
        else:
            calendar(s, {"month": month, "day": end})
        clause = {
            "date": {
                "kind": "calendarRange",
                "from": {"month": month, "day": start},
                "to": {"month": month, "day": end},
            }
        }
        if annotated:
            clause = {
                "date": {
                    "kind": "calendarRange",
                    "from": {"day": start},
                    "to": {"day": end},
                }
            }
    elif family == "datetime-range":
        day = r.randint(0, 5)
        s.add(DAYS[day], "WEEKDAY")
        s.add("at", "GLUE")
        begin = clock(s, "digits")
        s.add(r.choice(["until", "to"]), "RANGE_END")
        s.add(DAYS[day + 1], "WEEKDAY")
        s.add("at", "GLUE")
        end = clock(s, "digits")
        clause = {
            "date": {"kind": "weekday", "days": [DAY_CODES[day]]},
            "endDate": {"kind": "weekday", "days": [DAY_CODES[day + 1]]},
            "time": {"start": begin, "end": end},
        }
    elif family in ("month-period", "month-week"):
        month = r.randint(1, 12)
        if family == "month-week":
            week = r.randint(1, 4)
            s.add(["first", "second", "third", "fourth"][week - 1], "ORD")
            s.add("week", "UNIT")
            s.add("of", "GLUE")
            s.add(MONTHS[month - 1], "MONTH")
            clause = {"date": {"kind": "calendarPeriod", "month": month, "week": week}}
        else:
            modifier = r.choice(["this", "next", "last"])
            s.add(modifier, "DEICTIC")
            s.add(MONTHS[month - 1], "MONTH")
            clause = {
                "date": {"kind": "calendarPeriod", "month": month, "modifier": modifier}
            }
    else:
        day = r.randrange(7)
        interval = 1
        group = (
            family in ("recurrence", "recurrence-bound", "shared-times")
            and r.random() < 0.5
        )
        if not group or r.random() < 0.5:
            s.add("every", "RECUR")
        if family == "recurrence":
            interval = r.randint(1, 3)
            if interval > 1:
                s.add(
                    "other" if interval == 2 and r.random() < 0.5 else words(interval),
                    "NUM",
                )
                if r.random() < 0.5:
                    s.add("weeks", "UNIT")
                    s.add("on", "GLUE")
        if group:
            s.add("weekday" if r.random() < 0.5 else "weekdays", "DAYGROUP")
        else:
            s.add(DAYS[day], "WEEKDAY")
        rule = {"freq": "weekly", "interval": interval, "byDay": [DAY_CODES[day]]}
        if group:
            rule["byDay"] = DAY_CODES[:5]
        if group and family == "recurrence" and interval == 1 and r.random() < 0.3:
            return Specification(family, {"clauses": [{"recurrence": rule}]})
        s.add("at", "GLUE")
        start = clock(s)
        clause = {"recurrence": rule, "time": {"start": start}}
        if family == "recurrence-bound":
            s.add("until", "BOUND_END")
            date = {"year": 2036, "month": r.randint(1, 12), "day": r.randint(1, 28)}
            calendar(s, date)
            rule["until"] = {"kind": "calendar", **date}
        elif family == "monthly-exception":
            ordinal = r.choice([1, 2, -1])
            s.add("except", "EXCEPT")
            s.add("the", "GLUE")
            s.add({1: "first", 2: "second", -1: "last"}[ordinal], "ORD")
            s.add(DAYS[day], "WEEKDAY")
            s.add("of", "GLUE")
            s.add("each", "RECUR")
            s.add("month", "UNIT")
            rule["except"] = [
                {
                    "kind": "ordinalWeekday",
                    "ordinal": ordinal,
                    "day": DAY_CODES[day],
                    "of": {"kind": "calendar"},
                    "recurring": True,
                }
            ]
        elif family == "shared-times":
            s.add("and", "JOIN")
            end = clock(s)
            return Specification(
                family,
                {
                    "clauses": [
                        clause,
                        {"recurrence": deepcopy(rule), "time": {"start": end}},
                    ]
                },
            )
    return Specification(family, {"clauses": [clause]})
