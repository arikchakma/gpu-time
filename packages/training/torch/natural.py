"""Natural phrasing with independently constructed schedules and role supervision.

Reference dates and timezones never enter these examples. Reserved wording uses
separate sentence frames; quantities, dates and combinations vary within frames.
"""

from __future__ import annotations
import random
from copy import deepcopy
import background
from semantic import DAYS, DAY_CODES, HOLIDAYS, Specification, month_word, weekday_word

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
ORDINALS = "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth".split()
TENS = {20: "twenty", 30: "thirty", 40: "forty", 50: "fifty"}
FAMILIES = [
    "spoken-clock",
    "fraction-clock",
    "qualified-clock",
    "compound-duration",
    "compound-shift",
    "fraction-duration",
    "prose-date",
    "prose-month",
    "numeric-date",
    "compact-named-date",
    "date-range",
    "shared-month-range",
    "datetime-range",
    "month-period",
    "month-week",
    "recurrence",
    "recurrence-bound",
    "monthly-exception",
    "shared-times",
    "slot-request",
    "carrier-date",
    "prose-shift",
    "imperative-shift",
    "anchored-shift",
    "anchored-duration",
    "daypart-clock",
    "month-led-range",
    "monthly-ordinal",
    "idiom-date",
    "contrast-date",
    "clock-place",
]
# Prose dates and shifts stay balanced against their contrastive negatives.
FAMILY_WEIGHTS = [
    0.5
    if name in (
        "prose-month",
        "compact-named-date",
        "shared-month-range",
        "month-led-range",
    )
    else 1
    if name in (
        "monthly-ordinal",
        "carrier-date",
        "prose-shift",
        "imperative-shift",
        "daypart-clock",
    )
    else 6
    if name == "clock-place"
    else 2
    for name in FAMILIES
]
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
# New narrative frames must not reuse nouns from reserved carriers.
PROSE_EVENTS = [
    word for word in FILLERS
    if word not in set(" ".join(RESERVED + RESERVED_DURATION).split())
]


PLACES = (
    "office cafe bar diner clinic studio salon gym club school library lobby "
    "kitchen garage hotel restaurant pub bakery museum stadium airport station "
    "warehouse rooftop garden terrace dock pier chapel gallery arena"
).split()
EVENT_NOUNS = (
    "dinner lunch coffee standup call interview gym class dentist drinks pickup "
    "breakfast haircut yoga brunch checkup practice rehearsal session demo retro "
    "physio therapy swim tutoring meeting appointment lesson sync review briefing"
).split()
BARE_PLACES = "home school work daycare".split()
VENUES = [
    "Nobu", "Joe's", "HQ", "Luigi's", "Maria's", "the Ivy", "Blue Bottle",
    "Cafe Nero", "the Grand", "Dorsia", "Pret", "the Anchor",
]


def trailing_place(s):
    """A venue after a clock is background, and the clock is still a clock."""
    r = s.rng
    s.in_expression = False
    lead = r.choice(["at", "in", "near", "by", "next to", "outside", "across from"])
    roll = r.random()
    if roll < 0.35:
        s.add(f"{lead} {r.choice(VENUES)}", "O")
    elif roll < 0.65:
        s.add(f"{lead} the {r.choice(PLACES)}", "O")
    elif roll < 0.8:
        s.add(f"{r.choice(['at', 'from'])} {r.choice(BARE_PLACES)}", "O")
    else:
        spot = r.choice(["room", "suite", "studio", "gate", "desk"])
        where = r.choice(["at", "in"]) if spot in ("room", "suite", "studio") else "at"
        s.add(f"{where} {spot} {r.randint(1, 40)}", "O")


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
    if "day" not in date:
        s.add(month_word(r, date["month"] - 1), "MONTH")
        if date.get("year"):
            s.add(str(date["year"]), "YEAR")
        return
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


# "scheduled for next week" is a date: its preposition belongs to the carrier.
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
        if r.random() < 0.25:
            del date["day"]
            if r.random() < 0.5:
                date["year"] = r.randint(1600, 2040)
        elif r.random() < 0.3:
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
    partial_date = family == "prose-date" and r.random() < 0.25
    # The carrier is this family's own prefix; reserved and bare get none.
    lead = carrier(r) if family == "carrier-date" and not (reserved or bare) else None
    anchored = family not in (
        "compound-duration",
        "compound-shift",
        "prose-shift",
        "fraction-duration",
        "slot-request",
    )
    if bare:
        prefix = ""
    elif lead:
        prefix = lead[0]
    elif reserved:
        prefix = r.choice(RESERVED if anchored else RESERVED_DURATION)
    elif family == "prose-month":
        prefix = r.choice([
            "{name} will leave in",
            "{name} expects to return in",
            "the {event} should happen in",
            "we plan to finish in",
            "the {event} opens in",
            "they expect the {event} in",
            "{name} moved the {event} to",
            "we postponed the {event} until",
        ]).format(name=r.choice(background.NAMES), event=r.choice(PROSE_EVENTS))
    elif family == "clock-place":
        prefix = ""
    elif family == "imperative-shift":
        prefix = r.choice([
            "check again",
            "please try again",
            "resume the review",
            "contact the team",
            "reopen the report",
            "revisit the plan",
            "return to the task",
            "try the request again",
            "try again",
        ])
    elif family == "daypart-clock":
        prefix = ""
    elif family == "idiom-date":
        prefix = r.choice([
            "after that last-minute change, move the meeting to",
            "this is short notice, but schedule the review for",
            "we made a last minute adjustment; try",
            "despite the last-minute revision, book the room for",
            "the change came at the last minute. use",
            "we are doing this last minute. move the meeting to",
            "sorry for handling this last minute. use",
            "one final change at short notice. schedule it for",
        ])
    elif family == "contrast-date":
        prefix = r.choice([
            f"after visiting the office on {suffixed(r.randint(32, 99))} Street, schedule the review for",
            f"after placing {suffixed(r.randint(2, 12))} in the contest, {r.choice(background.NAMES)} booked the meeting for",
            f"from the historic Quarter, {r.choice(background.NAMES)} proposed",
            f"send the second draft to {r.choice(background.MONTH_NAMES)} and set the deadline for",
        ])
    elif (family == "prose-shift" or partial_date) and r.random() < 0.65:
        frames = (
            [
                "{name} will be here",
                "{name} is coming back",
                "the {event} will begin",
                "we will be ready",
                "{name} will join us",
                "the {event} should start",
                "we expect {name} to arrive",
                "we can start the {event}",
                "check the {event}",
                "resume the {event}",
                "contact {name}",
                "reopen the {event}",
                "revisit the {event}",
                "return",
            ]
            if family == "prose-shift"
            else [
                "{name} will return in",
                "the {event} took place in",
                "we agreed on",
                "the {event} is planned for",
                "{name} remembers",
                "they moved here in",
                "we expect the {event} in",
                "the {event} happened in",
            ]
        )
        prefix = r.choice(frames).format(
            name=r.choice(background.NAMES), event=r.choice(PROSE_EVENTS)
        )
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
    elif family == "prose-shift":
        amount = 1 if r.random() < 0.15 else r.randint(1, 59)
        unit = r.choice(
            ["second", "minute", "hour", "day", "week", "month", "year"]
        )
        s.add("in", "DIR_AFTER")
        if amount == 1 and r.random() < 0.5:
            s.add("an" if unit == "hour" else "a", "NUM")
            s.add(unit, "UNIT")
        else:
            quantity(s, amount, unit)
        clause = {"shift": {"amount": amount, "unit": unit, "direction": "after"}}
    elif family == "imperative-shift":
        s.add("in", "DIR_AFTER")
        amount = r.choice([15, 30, 45, 60, 75, 90, 120])
        unit = r.choice(["second", "minute", "hour"])
        quantity(s, amount, unit)
        clause = {"shift": {"amount": amount, "unit": unit, "direction": "after"}}
        if r.random() < 0.4:
            s.add(",", "GLUE", "")
            s.in_expression = False
            s.add(r.choice(["please", "if that works", "then let me know"]), "O")
    elif family == "anchored-shift":
        amount = (
            r.choice([15, 30, 45, 60, 75, 90, 120])
            if r.random() < 0.65
            else r.randint(1, 120)
        )
        unit = r.choice(["second", "minute", "hour", "day", "week"])
        quantity(s, amount, unit)
        s.add(r.choice(["from", "after"]), "DIR_AFTER")
        anchor = r.choice(["now", "today", "tomorrow", "weekday"])
        if anchor == "now":
            s.add(anchor, "NOW")
            date = {"kind": "now"}
        elif anchor == "weekday":
            day = r.randrange(7)
            s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
            date = {"kind": "weekday", "days": [DAY_CODES[day]]}
        else:
            s.add(anchor, "REL_DAY")
            date = {"kind": "relativeDay", "offset": RELATIVE_DAYS[anchor]}
        clause = {
            "date": date,
            "shift": {"amount": amount, "unit": unit, "direction": "after"},
        }
    elif family == "anchored-duration":
        amount = r.randint(1, 12) if r.random() < 0.7 else r.choice([15, 30, 45, 90])
        unit = r.choice(["minute", "hour", "day", "week", "month"])
        s.add(r.choice(["for", "within", "lasting"]), "DUR")
        if amount == 1 and r.random() < 0.5:
            s.add("an" if unit == "hour" else "a", "NUM")
            s.add(unit, "UNIT")
        else:
            quantity(s, amount, unit)
        if r.random() < 0.5:
            s.add(",", "GLUE", "")
        opener = r.choice(["from", "starting", "beginning"])
        s.add(opener, "O" if opener == "from" else "BOUND_START")
        anchor = r.choice(["now", "today", "tomorrow", "weekday"])
        if anchor == "now":
            s.add(anchor, "NOW")
            date = {"kind": "now"}
        elif anchor == "weekday":
            day = r.randrange(7)
            s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
            date = {"kind": "weekday", "days": [DAY_CODES[day]]}
        else:
            s.add(anchor, "REL_DAY")
            date = {"kind": "relativeDay", "offset": RELATIVE_DAYS[anchor]}
        clause = {"duration": {"amount": amount, "unit": unit}, "date": date}
    elif family == "clock-place":
        s.add(r.choice(EVENT_NOUNS), "O")
        s.add(r.choice(["at", "@"]), "GLUE")
        hour = r.randint(1, 12)
        s.add(words(hour) if r.random() < 0.25 else str(hour), "HOUR")
        minute = 0
        if r.random() < 0.3:
            s.add(":", "GLUE", "")
            minute = r.choice([15, 30, 45])
            s.add(f"{minute:02}", "MINUTE", "")
        # One prefix, two endings: the following word decides, not the preposition.
        if r.random() < 0.45:
            morning = r.random() < 0.5
            qualifier = (
                r.choice(["in the morning", "in morning"])
                if morning
                else r.choice(["in the afternoon", "in the evening", "at night"])
            )
            s.add(qualifier, "MERIDIEM")
            meridiem = "am" if morning or (hour == 12 and qualifier == "at night") else "pm"
            hour = hour % 12 + (12 if meridiem == "pm" else 0)
        else:
            trailing_place(s)
        clause = {"time": {"start": {"hour": hour, "minute": minute}}}
    elif family == "daypart-clock":
        part = r.choice(["morning", "afternoon", "evening"])
        if r.random() < 0.65:
            s.add("this")
        s.add(part, "DAYPART")
        s.add(r.choice(["at", "around", "by"]), "GLUE")
        hour = r.randint(1, 11)
        s.add(words(hour) if r.random() < 0.35 else str(hour), "HOUR")
        clause = {
            "time": {
                "start": {
                    "hour": hour + (12 if part in ("afternoon", "evening") else 0),
                    "minute": 0,
                }
            },
        }
        if r.random() < 0.65:
            s.add(",", "GLUE", "")
            s.in_expression = False
            s.add(
                r.choice([
                    "review the report",
                    "call the team",
                    "open the room",
                    "start the session",
                    "send the draft",
                ]),
                "O",
            )
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
    elif family == "prose-month":
        date = {"month": r.randint(1, 12)}
        calendar(s, date)
        clause = {"date": {"kind": "calendar", **date}}
    elif family == "compact-named-date":
        date = {
            "year": r.randint(1990, 2040),
            "month": r.randint(1, 12),
            "day": r.randint(1, 28),
        }
        separator = r.choice(["-", "/"])
        s.add(f'{date["day"]:02}', "DOM")
        s.add(separator, "GLUE", "")
        s.add(month_word(r, date["month"] - 1), "MONTH", "")
        s.add(separator, "GLUE", "")
        s.add(str(date["year"]), "YEAR", "")
        clause = {"date": {"kind": "calendar", **date}}
    elif family in ("prose-date", "numeric-date"):
        date = {
            "year": r.randint(1990, 2040),
            "month": r.randint(1, 12),
            "day": r.randint(13, 28),
        }
        if partial_date:
            date = {"month": date["month"]}
            if r.random() < 0.5:
                date["year"] = r.randint(1600, 2040)
            calendar(s, date)
        elif family == "prose-date" and r.random() < 0.35:
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
    elif family == "shared-month-range":
        month = r.randint(1, 12)
        start = r.randint(1, 20)
        end = r.randint(start + 1, 28)
        s.add(str(start), "DOM")
        separator = r.choice(["-", "-", "–", "to"])
        s.add(separator, "RANGE_END", "" if separator != "to" else " ")
        s.add(str(end), "DOM", "" if separator != "to" else " ")
        s.add(month_word(r, month - 1), "MONTH")
        clause = {
            "date": {
                "kind": "calendarRange",
                "from": {"month": month, "day": start},
                "to": {"month": month, "day": end},
            }
        }
        if r.random() < 0.65:
            join(s)
            clause["time"] = {"start": clock(s, r.choice(["bare", "digits"]))}
    elif family == "month-led-range":
        month = r.randint(1, 12)
        year = r.randint(1990, 2040)
        start = r.randint(1, 20)
        end = r.randint(start + 1, 28)
        s.add(month_word(r, month - 1), "MONTH")
        s.add(str(start), "DOM")
        s.add(r.choice(["through", "to", "-"]), "RANGE_END")
        s.add(str(end), "DOM")
        s.add(",", "GLUE", "")
        s.add(str(year), "YEAR")
        clause = {
            "date": {
                "kind": "calendarRange",
                "from": {"year": year, "month": month, "day": start},
                "to": {"year": year, "month": month, "day": end},
            }
        }
    elif family == "monthly-ordinal":
        day = r.randint(1, len(ORDINALS))
        s.add("every", "RECUR")
        s.add("month", "UNIT")
        s.add("on the", "GLUE")
        s.add(ORDINALS[day - 1], "DOM")
        clause = {
            "recurrence": {"freq": "monthly", "interval": 1, "byMonthDay": [day]}
        }
    elif family == "idiom-date":
        date = {"month": r.randint(1, 12), "day": r.randint(1, 28)}
        calendar(s, date)
        join(s)
        clause = {
            "date": {"kind": "calendar", **date},
            "time": {"start": clock(s, r.choice(["bare", "digits"]))},
        }
    elif family == "contrast-date":
        date = {"month": r.randint(1, 12), "day": r.randint(1, 28)}
        calendar(s, date)
        clause = {"date": {"kind": "calendar", **date}}
        if r.random() < 0.6:
            join(s)
            clause["time"] = {"start": clock(s, r.choice(["bare", "digits"]))}
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
            connector_span = None
            if connector:
                s.add(connector, "GLUE")
                connector_span = s.spans[-1]
            clause = target(s)
            # Keep the explicit connector while rendering the target, then give
            # it the same background label as every other carrier preposition.
            # Marking it O earlier lets Sentence trim it before "next week".
            if connector_span:
                connector_span["label"] = "O"
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
        clause = {"recurrence": rule}
        if family != "monthly-exception" or r.random() < 0.65:
            join(s)
            clause["time"] = {"start": clock(s)}
        if family == "recurrence-bound":
            s.add("until", "BOUND_END")
            date = {"year": 2036, "month": r.randint(1, 12), "day": r.randint(1, 28)}
            calendar(s, date)
            rule["until"] = {"kind": "calendar", **date}
        elif family == "monthly-exception":
            s.add("except", "EXCEPT")
            # Keep the original ordinal shape while varying what is excluded.
            # Otherwise EXCEPT is learned only before another weekday.
            shape = r.choice(["ordinal"] * 4 + ["day", "month", "date", "holiday"])
            if shape == "ordinal":
                ordinal = r.choice([1, 2, -1])
                s.add("the", "GLUE")
                s.add({1: "first", 2: "second", -1: "last"}[ordinal], "ORD")
                s.add(weekday_word(r, DAYS[day]), "WEEKDAY")
                s.add("of", "GLUE")
                s.add("each", "RECUR")
                s.add("month", "UNIT")
                excluded = {
                    "kind": "ordinalWeekday",
                    "ordinal": ordinal,
                    "day": DAY_CODES[day],
                    "of": {"kind": "calendar"},
                    "recurring": True,
                }
            elif shape == "holiday":
                name = r.choice(list(HOLIDAYS))
                s.add(HOLIDAYS[name], "HOLIDAY")
                excluded = {"kind": "holiday", "name": name}
            else:
                excluded = {"kind": "calendar"}
                if shape == "day":
                    value = r.randint(1, 28)
                    s.add("the", "GLUE")
                    s.add(str(value), "DOM")
                    s.add(suffixed(value), "GLUE", "")
                    excluded["day"] = value
                elif shape == "month":
                    value = r.randint(1, 12)
                    s.add(month_word(r, value - 1), "MONTH")
                    excluded["month"] = value
                else:
                    excluded.update(month=r.randint(1, 12), day=r.randint(1, 28))
                    if r.random() < 0.5:
                        excluded["year"] = r.randint(2024, 2040)
                    calendar(s, excluded)
            rule["except"] = [excluded]
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
    if (
        not reserved
        and "time" in clause
        and "end" not in clause.get("time", {})
        and s.spans
        and s.spans[-1]["label"] != "O"
        and r.random() < 0.3
    ):
        trailing_place(s)
    return Specification(family, {"clauses": [clause]})
