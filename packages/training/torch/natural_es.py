"""Spanish natural-phrasing tier: broad idiomatic variety for the TRAINING split only.

Mirrors natural.py's role in English: independently built clauses (not routed
through spanish.render()), so the model sees many ways to say the same
schedule. Deliberately stays clear of spanish.RESERVED_ES and every
construction spanish.render_heldout() uses (hacia/sobre clock leads, "no antes
de", "con una frecuencia de", "a partir de este momento", reversed ranges,
postposed modifiers, month-led dates) so the unseen-frame split stays unseen.
"""

from __future__ import annotations

import random

import semantic
import spanish
from semantic import Specification

FAMILIES = [
    "plural-weekday",
    "approx-clock",
    "window-idiom",
    "relative-idiom",
    "deadline-carrier",
    "holiday-exception",
    "chat-terse",
    "range-carrier",
]
# The two texting-register families keep their own short shape; no carrier
# prose glued on either side.
TERSE_FAMILIES = {"chat-terse", "range-carrier"}


def _time(r: random.Random, hour: int | None = None) -> dict:
    return {
        "hour": hour if hour is not None else r.randint(0, 23),
        "minute": r.choice([0, 0, 0, 15, 30, 45]),
    }


def _plural_weekday(s, r) -> dict:
    days = [r.randrange(7)]
    if r.random() < 0.3:
        second = r.randrange(7)
        while second == days[0]:
            second = r.randrange(7)
        days.append(second)
    codes = [spanish.DAY_CODES[d] for d in days]
    marked = r.random() < 0.5
    # "los lunes" differs from "el lunes" only by the article, so "los" must
    # carry RECUR. Augmentation drops filler "O" words, which would erase the
    # only recurring signal.
    s.add("todos" if marked else "los", "RECUR")
    if marked:
        s.add("los", "O")
    for index, day in enumerate(days):
        if index:
            s.add(r.choice(["y", ","]), "JOIN")
        s.add(spanish.weekday_word(r, day, plural=True), "WEEKDAY")
    clause = {"recurrence": {"freq": "weekly", "interval": 1, "byDay": codes}}
    if r.random() < 0.5:
        time = _time(r)
        spanish.clock(time, s, r.randrange(4))
        clause["time"] = {"start": time}
    return clause


def _approx_clock(s, r) -> dict:
    """"a eso de las 3" / "a las tres y pico": never the hacia/sobre reading."""
    started = r.randint(0, 23)
    hour = started % 12 or 12
    word = "una" if hour == 1 else r.choice([str(hour), spanish.NUMBERS_ES[hour]])
    s.add("a", "O")
    if r.random() < 0.5:
        s.add("eso de", "O")
    s.add("la" if hour == 1 else "las", "O")
    s.add(word, "HOUR")
    if r.random() < 0.4:
        s.add("y pico", "CLOCK_OFFSET")
    if r.random() < 0.6:
        period = "mañana" if 5 <= started < 12 else "tarde" if 12 <= started < 20 else "noche"
        s.add(f"de la {period}", "MERIDIEM")
    else:
        # No period marker: the compiler reads the bare spoken hour literally.
        started = hour
    return {"time": {"start": {"hour": started, "minute": 0}}}


def _window_idiom(s, r) -> dict:
    """"desde las 9 hasta las 5" / "de 9 a 5 h": start always precedes end."""
    start = _time(r, r.randint(6, 14))
    start["minute"] = 0
    end = _time(r, min(23, start["hour"] + r.randint(1, 9)))
    end["minute"] = 0
    style = r.randrange(4)
    if r.random() < 0.5:
        s.add("desde", "RANGE_START")
        spanish.clock(start, s, style, lead=False)
        s.add("hasta", "RANGE_END")
        spanish.clock(end, s, style, lead=False)
    else:
        s.add("de", "RANGE_START")
        spanish.clock(start, s, style, lead=False)
        s.add("a", "RANGE_END")
        spanish.clock(end, s, style, lead=False)
        if r.random() < 0.4:
            s.add("h", "O")
    return {"time": {"start": start, "end": end}}


def _relative_idiom(s, r) -> dict:
    """"en tres días" / "de aquí a tres días": always the after-now reading."""
    amount = r.choice([1, 2, 3, 4, 5, 6, 7, 10, 14, 15, 20, 30])
    unit = r.choice(["minute", "hour", "day", "week", "month"])
    s.add(r.choice(["en", "de aquí a"]), "DIR_AFTER")
    spanish.quantity_unit(s, [unit], amount)
    return {"shift": {"amount": amount, "unit": unit, "direction": "after"}}


def _deadline_carrier(s, r) -> dict:
    """"antes del viernes" / "para el viernes" / "a más tardar el viernes".

    A deadline lead names the date itself as the value, the same way English
    "by 3" glues onto a plain clock rather than opening a bound, so the lead
    is plain filler (O), not DIR_BEFORE (which needs a clock to bound).
    """
    lead = r.choice(["antes del", "para el", "a más tardar el"])
    clause: dict = {}
    if r.random() < 0.6:
        day = r.randrange(7)
        s.add(lead, "O")
        s.add(spanish.weekday_word(r, day), "WEEKDAY")
        clause["date"] = {"kind": "weekday", "days": [spanish.DAY_CODES[day]]}
    else:
        month, day = r.randint(1, 12), r.randint(1, 28)
        s.add(lead, "O")
        spanish.calendar({"month": month, "day": day}, s, style=1, article=False)
        clause["date"] = {"kind": "calendar", "month": month, "day": day}
    if r.random() < 0.3:
        s.add(",", "GLUE", separator="")
        time = _time(r, r.randint(8, 20))
        spanish.clock(time, s, r.randrange(4))
        clause["time"] = {"start": time}
    return clause


def _holiday_exception(s, r) -> dict:
    """"todos los días salvo Navidad": a holiday exclusion, unseen elsewhere."""
    name = r.choice(list(spanish.HOLIDAYS_ES))
    # "días" carries UNIT, not RECUR: the compiler reads daily frequency off
    # the unit word, the same way "cada día" does in spanish.py.
    s.add("todos los", "RECUR")
    s.add("días", "UNIT")
    s.add(r.choice(["salvo", "excepto"]), "EXCEPT")
    s.add(spanish.HOLIDAYS_ES[name], "HOLIDAY")
    return {
        "recurrence": {
            "freq": "daily",
            "interval": 1,
            "except": [{"kind": "holiday", "name": name}],
        }
    }


def _chat_terse(s, r) -> dict:
    """Texting register: "mañ 9h" / "vie 18h"."""
    hour = r.randint(6, 22)
    if r.random() < 0.5:
        name, offset = r.choice([("hoy", 0), ("mañ", 1), ("pasado mañana", 2)])
        s.add(name, "REL_DAY")
        date = {"kind": "relativeDay", "offset": offset}
    else:
        day = r.randrange(7)
        s.add(spanish.SHORT_DAYS_ES[day], "WEEKDAY")
        date = {"kind": "weekday", "days": [spanish.DAY_CODES[day]]}
    s.add(str(hour), "HOUR")
    s.add("h", "O")
    return {"date": date, "time": {"start": {"hour": hour, "minute": 0}}}


def _range_carrier(s, r) -> dict:
    """Texting register: "lun-vie 9-17"."""
    start_day = r.randrange(5)
    end_day = r.randint(start_day + 1, 6)
    s.add(spanish.SHORT_DAYS_ES[start_day], "WEEKDAY")
    s.add("-", "RANGE_END", separator="")
    s.add(spanish.SHORT_DAYS_ES[end_day], "WEEKDAY", separator="")
    hour_start = r.randint(6, 12)
    hour_end = r.randint(hour_start + 1, 22)
    s.add(str(hour_start), "HOUR")
    s.add("-", "RANGE_END", separator="")
    s.add(str(hour_end), "HOUR", separator="")
    # No lead word ("de"/"desde") marks this a range, so the compiler reads
    # it the same way English reads bare "Mon-Fri": every day in between,
    # recurring weekly -- not a single-occurrence weekdayRange.
    return {
        "recurrence": {
            "freq": "weekly",
            "interval": 1,
            "byDay": [spanish.DAY_CODES[d] for d in range(start_day, end_day + 1)],
        },
        "time": {
            "start": {"hour": hour_start, "minute": 0},
            "end": {"hour": hour_end, "minute": 0},
        },
    }


BUILDERS = {
    "plural-weekday": _plural_weekday,
    "approx-clock": _approx_clock,
    "window-idiom": _window_idiom,
    "relative-idiom": _relative_idiom,
    "deadline-carrier": _deadline_carrier,
    "holiday-exception": _holiday_exception,
    "chat-terse": _chat_terse,
    "range-carrier": _range_carrier,
}


def render(s) -> Specification:
    r = s.rng
    family = r.choice(FAMILIES)
    if family not in TERSE_FAMILIES and r.random() < 0.4:
        s.add(spanish.prefix_es(r))
    s.clause()
    clause = BUILDERS[family](s, r)
    return Specification(family, {"clauses": [clause]})


if __name__ == "__main__":
    # Self-check: 20000 rendered rows must never surface a RESERVED_ES carrier.
    import background
    from generate import Sentence

    rng = random.Random(20260916)
    hits = 0
    for _ in range(20000):
        sentence = Sentence(
            rng, connectors=spanish.SPANISH_CONNECTORS, fillers=spanish.SPANISH_DROPPABLE
        )
        render(sentence)
        if background.normal(sentence.text) in spanish._RESERVED_ES:
            hits += 1
    assert hits == 0, hits
    print("ok: 0 reserved collisions across 20000 rows")
