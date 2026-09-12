"""Natural phrasing with independently constructed schedules and role supervision.

Reference dates and timezones never enter these examples. Reserved wording uses
separate sentence frames; quantities, dates and combinations vary within frames.
"""

from __future__ import annotations
import random
from copy import deepcopy
import background
from semantic import DAYS, DAY_CODES, Specification, month_word, weekday_word

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
    "slot-request",
    "carrier-date",
]
# Half weight for carrier-date: date-after-prose pressure has to stay balanced
# against background's contrastive carrier negatives.
FAMILY_WEIGHTS = [2] * (len(FAMILIES) - 1) + [1]
RELATIVE_DAYS = {"today": 0, "tomorrow": 1, "yesterday": -1, "tmrw": 1, "tmr": 1}
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


# A noun between the carrier and the clock is the shape "team sync tuesday 2pm"
# takes; drawing it from all of Tatoeba taught vocabulary instead of position.
FILLERS = (
    "report meeting call sync standup review lunch dinner breakfast dentist gym "
    "class shift appointment interview demo checkin retro session workout "
    "practice rehearsal haircut flight commute briefing offsite kickoff "
    "handover onboarding training walkthrough"
).split()


def join(s, connective="at"):
    r = s.rng
    if r.random() < 0.12:
        s.add(r.choice(FILLERS))
    if r.random() < 0.95:
        s.add("@" if connective == "at" and r.random() < 0.12 else connective, "GLUE")


def clock(s, mode=None, hour=None):
    r = s.rng
    h = hour if hour is not None else r.randint(1, 12)
    m = r.randrange(60)
    meridiem = r.choice(["am", "pm"])
    mode = mode or r.choice(["digits", "spoken", "qualified", "fraction"])
    if mode == "bare":
        s.add(str(h), "HOUR")
        s.add(meridiem, "MERIDIEM", "" if r.random() < 0.7 else " ")
        return {"hour": h % 12 + (12 if meridiem == "pm" else 0), "minute": 0}
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
    # Only a clock without digit minutes may spell its hour: "three:19 pm" is
    # not a thing anyone writes.
    spelled = mode == "spoken" or (mode == "qualified" and r.random() < 0.4)
    s.add(words(h) if spelled else str(h), "HOUR")
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


def calendar(s, date, numeric=False, day_first=False):
    r = s.rng
    if day_first and not numeric:
        s.add(str(date["day"]), "DOM")
        s.add(month_word(r, date["month"] - 1), "MONTH")
        if date.get("year"):
            s.add(str(date["year"]), "YEAR")
        return
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
        s.add(month_word(r, date["month"] - 1), "MONTH")
        if r.random() < 0.3:
            s.add(".", "GLUE", "")
        s.add(str(date["day"]), "DOM")
        if date.get("year"):
            s.add(str(date["year"]), "YEAR")


# "scheduled for next week" is a date: the preposition is glue, not a duration.
CARRIERS = [
    ("the {event} is scheduled", "for"),
    ("{name}'s {event} is scheduled", "for"),
    ("the {event} is planned", "for"),
    ("{name} planned the {event}", "for"),
    ("we set the {event}", "for"),
    ("the {event} is set", "for"),
    ("book the {event}", "for"),
    ("book the room", "for"),
    ("i booked the {event}", "for"),
    ("the {event} is booked", "for"),
    ("the {event} has been rescheduled", "for"),
    ("{name} rescheduled the {event}", "to"),
    ("we moved the {event}", "to"),
    ("the {event} moved", "to"),
    ("push the {event}", "to"),
    ("they postponed the {event}", "to"),
    ("the {event} is postponed", "until"),
    ("the {event} has been put off", "until"),
    # "in" rides along: a carrier ending in a connector loses the next one.
    ("pencil it", "in for"),
    ("pencil me", "in for"),
    ("{name} penciled you", "in for"),
    ("the {event} is penciled", "for"),
    ("the {event} is slated", "for"),
    ("{name} slated the {event}", "for"),
    ("we are aiming", "for"),
]


def carrier(r):
    """A scheduling verb and the preposition that follows it."""
    nouns, _ = background.vocabulary()
    text, connector = r.choice(CARRIERS)
    return (
        text.format(
            event=r.choice(FILLERS) if r.random() < 0.3 else r.choice(nouns),
            name=r.choice(background.NAMES),
        ),
        connector,
    )


def suffixed(day):
    return (
        "th"
        if 10 <= day % 100 <= 20
        else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    )


def target(s):
    """The date a carrier preposition points at, optionally with a clock."""
    r = s.rng
    pick = r.random()
    if pick < 0.3:
        modifier = r.choice(["next", "this", "last"])
        unit = r.choice(["week", "month", "year"])
        s.add(modifier, "DEICTIC")
        s.add(unit, "UNIT")
        clause = {"date": {"kind": "relativeUnit", "unit": unit, "modifier": modifier}}
    elif pick < 0.45:
        name = r.choice(list(RELATIVE_DAYS))
        s.add(name, "REL_DAY")
        clause = {"date": {"kind": "relativeDay", "offset": RELATIVE_DAYS[name]}}
    elif pick < 0.65:
        day = r.randrange(7)
        date = {"kind": "weekday", "days": [DAY_CODES[day]]}
        if r.random() < 0.4:
            date["modifier"] = r.choice(["this", "next", "last"])
            s.add(date["modifier"], "DEICTIC")
        s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
        clause = {"date": date}
    elif pick < 0.8:
        day = r.randint(1, 28)
        s.add("the", "GLUE")
        s.add(str(day), "DOM")
        s.add(suffixed(day), "GLUE", "")
        clause = {"date": {"kind": "calendar", "day": day}}
    else:
        date = {"month": r.randint(1, 12), "day": r.randint(1, 28)}
        if r.random() < 0.3:
            date["year"] = r.randint(2024, 2040)
        calendar(s, date)
        clause = {"date": {"kind": "calendar", **date}}
    if r.random() < 0.35:
        join(s)
        clause["time"] = {"start": clock(s)}
    return clause


def render(s, reserved=False, family=None, bare=False):
    r = s.rng
    family = family or r.choices(FAMILIES, FAMILY_WEIGHTS)[0]
    # The carrier is this family's own prefix; reserved and bare get none.
    lead = carrier(r) if family == "carrier-date" and not (reserved or bare) else None
    anchored = family not in (
        "compound-duration",
        "compound-shift",
        "fraction-duration",
        "slot-request",
    )
    if bare:
        prefix = ""
    elif lead:
        prefix = lead[0]
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
            join(s)
            clause["time"] = {"start": clock(s)}
    elif family == "date-range":
        month = r.randint(1, 12)
        start = r.randint(1, 12)
        end = r.randint(16, 28)
        s.add("from", "RANGE_START")
        annotated = r.random() < 0.3
        if annotated:
            s.add(weekday_word(r, r.choice(DAYS)), "WEEKDAY")
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
        s.add(r.choice(["through", "until", "to", "-", "\u2013"]), "RANGE_END")
        if annotated:
            s.add(weekday_word(r, r.choice(DAYS)), "WEEKDAY")
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
    elif family == "datetime-range" and r.random() < 0.45:
        # "17 August 2013 2pm - 19 August 2013 2pm": a full date on both sides,
        # so the number after the dash is a day of month and never an hour.
        month = r.randint(1, 12)
        year = r.randint(2013, 2040)
        first = r.randint(1, 20)
        day_first = r.random() < 0.5
        # Always clocked: two bare dates collapse to a calendarRange instead.
        mode = r.choice(["bare", "bare", "digits"])
        clause = {}
        for key, day in (("date", first), ("endDate", first + r.randint(1, 8))):
            if key == "endDate":
                s.add(r.choice(["-", "–", "to", "until"]), "RANGE_END")
            date = {"year": year, "month": month, "day": day}
            calendar(s, date, day_first=day_first)
            if r.random() < 0.35:
                s.add("at", "GLUE")
            edge = "start" if key == "date" else "end"
            clause.setdefault("time", {})[edge] = clock(s, mode)
            clause[key] = {"kind": "calendar", **date}
    elif family == "datetime-range":
        day = r.randint(0, 5)
        s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
        join(s)
        begin = clock(s, "digits")
        s.add(r.choice(["until", "to", "-", "\u2013"]), "RANGE_END")
        s.add(weekday_word(r, DAYS[day + 1]), "WEEKDAY")
        join(s)
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
            s.add(month_word(r, month - 1), "MONTH")
            clause = {"date": {"kind": "calendarPeriod", "month": month, "week": week}}
        else:
            modifier = r.choice(["this", "next", "last"])
            s.add(modifier, "DEICTIC")
            s.add(month_word(r, month - 1), "MONTH")
            clause = {
                "date": {"kind": "calendarPeriod", "month": month, "modifier": modifier}
            }
    elif family == "slot-request":
        # "30 min call thursday afternoon": a bare NUM+UNIT ahead of the anchor
        # compiles to the clause duration.
        amount = r.choice([1, 2, 3, 15, 20, 30, 45, 60, 90])
        unit = "hour" if amount <= 3 else "minute"
        # One word only: "forty five min" splits the quantity across two NUM
        # tokens and the compiler reads the duration as five minutes.
        spellable = amount < 20 or amount in TENS
        s.add(words(amount) if spellable and r.random() < 0.25 else str(amount), "NUM")
        s.add(
            r.choice(["min", "mins", "minutes"] if unit == "minute" else ["hr", "hrs", "hours"])
            if amount != 1
            else r.choice(["hour", "hr"]),
            "UNIT",
        )
        if r.random() < 0.5:
            s.add(r.choice(FILLERS))
        clause = {"duration": {"amount": amount, "unit": unit}}
        if r.random() < 0.35:
            name = r.choice(list(RELATIVE_DAYS))
            s.add(name, "REL_DAY")
            clause["date"] = {"kind": "relativeDay", "offset": RELATIVE_DAYS[name]}
        else:
            day = r.randrange(7)
            s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
            clause["date"] = {"kind": "weekday", "days": [DAY_CODES[day]]}
        choice = r.random()
        if choice < 0.45:
            part = r.choice(["morning", "afternoon", "evening"])
            s.add(part, "DAYPART")
            clause["time"] = {"start": {"part": part}}
        elif choice < 0.8:
            join(s)
            clause["time"] = {"start": clock(s, "digits")}
    elif family == "carrier-date":
        connector = lead[1] if lead else None
        if connector == "for" and r.random() < 0.18:
            # Contrast: a quantity after the same verb keeps "for" a duration.
            s.add("for", "DUR")
            unit = r.choice(["minute", "hour", "day", "week"])
            amount = r.choice([15, 30, 45, 90]) if unit == "minute" else r.randint(1, 5)
            quantity(s, amount, unit)
            clause = {"duration": {"amount": amount, "unit": unit}}
        else:
            if connector:
                s.add(connector, "GLUE")
            clause = target(s)
    else:
        day = r.randrange(7)
        interval = 1
        group = (
            family in ("recurrence", "recurrence-bound", "shared-times")
            and r.random() < 0.5
        )
        # Never optional: a bare "weekdays at 9" is a day group, not a series,
        # and the sampled specification says recurrence.
        s.add("each" if r.random() < 0.15 else "every", "RECUR")
        if family == "recurrence" and not group:
            interval = r.randint(1, 3)
            if interval > 1:
                spelled = (
                    "other" if interval == 2 and r.random() < 0.5 else words(interval)
                )
                s.add(spelled, "NUM")
                # "every other" may stand alone; "every three" needs its unit.
                if spelled != "other" or r.random() < 0.5:
                    s.add("week" if spelled == "other" else "weeks", "UNIT")
                    s.add("on", "GLUE")
        if group:
            s.add("weekday" if r.random() < 0.5 else "weekdays", "DAYGROUP")
        else:
            s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
        rule = {"freq": "weekly", "interval": interval, "byDay": [DAY_CODES[day]]}
        if group:
            rule["byDay"] = DAY_CODES[:5]
        if group and family == "recurrence" and interval == 1 and r.random() < 0.3:
            return Specification(family, {"clauses": [{"recurrence": rule}]})
        join(s)
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
            s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
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
