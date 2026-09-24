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
TERSE_FAMILIES = {"chat-terse", "range-carrier", "dated-clock"}


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


def _dated_clock(s, r) -> dict:
    """A calendar entry: "martes 5/1/2013 1115am" / "lunes 29/4/2013 630-930am"."""
    date = {
        "kind": "calendar",
        "day": r.randint(1, 28),
        "month": r.randint(1, 12),
        "year": r.randint(2000, 2030),
    }
    if r.random() < 0.7:
        s.add(r.choice(spanish.DAYS_ES), "WEEKDAY")
        if r.random() < 0.4:
            s.add(",", separator="")
    spanish.calendar(date, s, 0, article=False, numeric=True)
    if r.random() < 0.4:
        s.add(",", separator="")
    half = 12 if r.random() < 0.5 else 0
    colon = r.random() < 0.5

    def clock(value: dict, separator: str = " ") -> None:
        display = value["hour"] % 12
        if colon:
            s.add(str(display), "HOUR", separator)
            s.add(":", separator="")
            s.add(f"{value['minute']:02d}", "MINUTE", separator="")
            return
        text = f"{display}{value['minute']:02d}" if value["minute"] else str(display)
        s.add(text, "HOUR", separator)

    def marker(value: dict) -> None:
        s.add(spanish.meridiem_marker(r, value["hour"]), "MERIDIEM", separator=r.choice(["", " "]) if colon else "")

    start = {"hour": r.randint(1, 9) + half, "minute": r.choice([0, 15, 30, 45])}
    if r.random() < 0.5:
        clock(start)
        marker(start)
        return {"date": date, "time": {"start": start}}
    end = {
        "hour": r.randint(start["hour"] + 1, 11 + half),
        "minute": r.choice([0, 15, 30, 45]),
    }
    spaced = colon and r.random() < 0.5
    clock(start)
    if spaced:
        marker(start)
    s.add("-", "RANGE_END", separator=" " if spaced else "")
    clock(end, separator=" " if spaced else "")
    marker(end)
    return {"date": date, "time": {"start": start, "end": end}}


def _counted_days(s, r) -> dict:
    """A counted weekly series: "los próximos tres domingos a las diez"."""
    day = r.randrange(7)
    count = r.randint(2, 6)
    s.add("los", "GLUE")
    s.add(r.choice(["próximos", "siguientes"]), "DEICTIC")
    s.add(spanish.NUMBERS_ES[count] if r.random() < 0.6 else str(count), "NUM")
    s.add(spanish.DAYS_ES[day] + ("s" if day >= 5 else ""), "WEEKDAY")
    clause = {
        "recurrence": {
            "freq": "weekly",
            "interval": 1,
            "count": count,
            "byDay": [spanish.DAY_CODES[day]],
        }
    }
    if r.random() < 0.5:
        time = _time(r, r.randint(7, 21))
        spanish.clock(time, s, r.randrange(4))
        clause["time"] = {"start": time}
    return clause


ONES_ES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"]
TEENS_ES = [
    "diez", "once", "doce", "trece", "catorce", "quince",
    "dieciséis", "diecisiete", "dieciocho", "diecinueve",
]
TWENTIES_ES = [
    "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
    "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
]
TENS_ES = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta", 7: "setenta", 8: "ochenta", 9: "noventa"}


def spoken_year(year: int) -> list[str]:
    words = ["dos", "mil"] if year >= 2000 else ["mil", "novecientos"]
    rest = year % 100
    if rest >= 30:
        words.append(TENS_ES[rest // 10])
        if rest % 10:
            words += ["y", ONES_ES[rest % 10]]
    elif rest >= 20:
        words.append(TWENTIES_ES[rest - 20])
    elif rest >= 10:
        words.append(TEENS_ES[rest - 10])
    elif rest:
        words.append(ONES_ES[rest])
    return words


HOLIDAY_WORDS_ES = [
    (["navidad"], "christmas"),
    (["nochebuena"], "christmas-eve"),
    (["nochevieja"], "new-years-eve"),
    (["año", "nuevo"], "new-year"),
    (["pascua"], "easter"),
    (["halloween"], "halloween"),
]


def _edge_or_holiday_year(s, r) -> dict:
    """ "el último día del mes" / "navidad de 2027" / "pascua de dos mil dieciocho"."""
    if r.random() < 0.5:
        unit = r.choice(["month", "year", "week"])
        s.add("el", "O")
        s.add(r.choice(["último", "ultimo"]), "EDGE")
        s.add("día", "O")
        if unit == "week":
            s.add("de", "GLUE")
            s.add("la", "GLUE")
            s.add("semana", "UNIT")
        else:
            s.add("del", "GLUE")
            s.add("mes" if unit == "month" else "año", "UNIT")
        return {"date": {"kind": "relativeUnit", "unit": unit, "modifier": "this", "edge": "end"}}
    words, name = r.choice(HOLIDAY_WORDS_ES)
    if r.random() < 0.4:
        s.add("el" if name in ("new-year", "halloween") else "la", "O")
    for word in words:
        s.add(word, "HOLIDAY")
    if r.random() < 0.3:
        return {"date": {"kind": "holiday", "name": name}}
    year = r.randint(1990, 2035)
    s.add(r.choice(["de", "del"]) if r.random() < 0.8 else "en", "GLUE")
    if r.random() < 0.5:
        s.add(str(year), "YEAR")
    else:
        for word in spoken_year(year):
            s.add(word, "YEAR")
    return {"date": {"kind": "holiday", "name": name, "year": year}}


BUILDERS = {
    "plural-weekday": _plural_weekday,
    "approx-clock": _approx_clock,
    "window-idiom": _window_idiom,
    "relative-idiom": _relative_idiom,
    "deadline-carrier": _deadline_carrier,
    "holiday-exception": _holiday_exception,
    "chat-terse": _chat_terse,
    "range-carrier": _range_carrier,
    "dated-clock": _dated_clock,
    "counted-days": _counted_days,
    "edge-holiday-year": _edge_or_holiday_year,
}


def render(s) -> Specification:
    r = s.rng
    roll = r.random()
    family = (
        "dated-clock"
        if roll < 0.03
        else "counted-days"
        if roll < 0.05
        else "edge-holiday-year"
        if roll < 0.07
        else r.choice(FAMILIES)
    )
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
