"""Spanish renderer for the sampled schedule Specification.

Mirrors semantic.render(): same Specification objects, same Sentence.add() span
tracking, real Spanish word order instead of translated English. Weekday and
month names stay lowercase, as Spanish spells them.

natural.py itself is English-only; its Spanish counterpart, natural_es.py,
sits next to this file and is wired in by generate.py's generate_es. Carrier
prose below has its own idiomatic Spanish section (not a translation of
background.py).
"""

from __future__ import annotations

import random
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

import background
import semantic
from semantic import DAY_CODES

if TYPE_CHECKING:
    from generate import Sentence

DAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
SHORT_DAYS_ES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
SHORT_MONTHS_ES = [name[:3] for name in MONTHS_ES]
NUMBERS_ES = [
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete",
    "ocho", "nueve", "diez", "once", "doce",
]
# (singular, plural). "hora"/"semana" are feminine, the rest masculine.
UNIT_WORDS = {
    "minute": ("minuto", "minutos"),
    "hour": ("hora", "horas"),
    "day": ("día", "días"),
    "week": ("semana", "semanas"),
    "month": ("mes", "meses"),
    "year": ("año", "años"),
}
FEMININE_UNITS = {"week", "hour"}
HOLIDAYS_ES = {
    "christmas": "Navidad",
    "christmas-eve": "Nochebuena",
    "new-year": "Año Nuevo",
    "new-years-eve": "Nochevieja",
    "halloween": "Halloween",
    "valentines": "San Valentín",
}
NAMED_ES = {"noon": "mediodía", "midnight": "medianoche"}
# Spanish has no separate "evening" word; both fold to "noche".
DAYPART_ES = {"morning": "mañana", "afternoon": "tarde", "evening": "noche", "night": "noche"}
DAYGROUP_ES = {"weekday": "día laborable", "weekend": "fin de semana"}
REL_DAY_ES = {-1: "ayer", 0: "hoy", 1: "mañana", 2: "pasado mañana"}
ORD_MASC = ["primer", "segundo", "tercer", "cuarto", "quinto"]
DAYGROUP_PLURAL_ES = {"weekday": "días laborables", "weekend": "fines de semana"}

# Held-out-only carrier prefixes, the Spanish counterpart of natural.py's
# RESERVED: these strings never appear in a training row (see render_heldout
# and the guards on prefix_es/suffix_es/sentence_es below).
RESERVED_ES = [
    "podrías ponerme un recordatorio para",
    "nuestro ensayo empieza a",
    "el tren sale a",
    "por favor anota esto en mi agenda para",
]
RESERVED_DURATION_ES = ["dejen tiempo de sobra", "el taller continúa"]
_RESERVED_ES = frozenset(
    background.normal(phrase) for phrase in RESERVED_ES + RESERVED_DURATION_ES
)

# "el/la/los/las/a/al/de/del/en" are grammar words a carrier connector can meet.
# Only "el" and "a" are droppable for texting-register variety.
SPANISH_FILLERS = ("a", "al", "el", "la", "los", "las", "de", "del", "en")
SPANISH_DROPPABLE = ("a", "el")
SPANISH_CONNECTORS = frozenset(SPANISH_FILLERS + ("por", "para", "entre"))


def weekday_word(rng: random.Random, index: int, plural: bool = False) -> str:
    word = rng.choice([DAYS_ES[index], DAYS_ES[index], SHORT_DAYS_ES[index]])
    return word + "s" if plural and word.endswith("o") else word


def month_word(rng: random.Random, index: int) -> str:
    return rng.choice([MONTHS_ES[index], MONTHS_ES[index], SHORT_MONTHS_ES[index]])


def deictic(rng: random.Random, modifier: str, feminine: bool = False) -> str:
    if modifier == "this":
        return "esta" if feminine else "este"
    if modifier == "last":
        return "pasada" if feminine else "pasado"
    return "próxima" if feminine else "próximo"


def dom_word(day: int, rng: random.Random) -> str:
    if day == 1:
        return rng.choice(["1º", "primero"])
    return str(day)


def quantity(sentence: Sentence, value: int | None = None, label: str = "NUM") -> int:
    rng = sentence.rng
    value = (
        value
        if value is not None
        else rng.choice([1, 2, 3, 4, 5, 6, 7, 10, 12, 15, 24, 30, 45, 90])
    )
    # "uno"/"una" needs gender agreement callers don't supply here, so 1 stays
    # a digit; 2-12 are gender-invariant and safe to spell.
    if value != 1 and value <= 12 and rng.random() < 0.35:
        text = NUMBERS_ES[value]
    else:
        text = str(value)
    sentence.add(text, label)
    return value


def quantity_unit(
    sentence: Sentence, units: list[str], amount: int | None = None
) -> None:
    rng = sentence.rng
    unit = rng.choice(units)
    singular, plural = UNIT_WORDS[unit]
    amount = (
        amount if amount is not None else rng.choice([1, 2, 3, 5, 7, 10, 12, 15, 30, 90])
    )
    if amount == 1 and rng.random() < 0.4:
        sentence.add("una" if unit in FEMININE_UNITS else "un", "NUM")
    else:
        quantity(sentence, amount)
    sentence.add(singular if amount == 1 else plural, "UNIT")


def render_days(
    days: list[str], sentence: Sentence, article: bool = True, habitual: bool = False
) -> None:
    rng = sentence.rng
    if article and habitual:
        sentence.add("los", "O")
    for position, day in enumerate(days):
        if position:
            sentence.add(rng.choice(["y", ","]), "JOIN")
        if article and not habitual:
            sentence.add("el", "O")
        sentence.add(
            weekday_word(rng, DAY_CODES.index(day), plural=habitual), "WEEKDAY"
        )


def clock(value: dict, sentence: Sentence, style: int, lead: bool = True) -> None:
    rng = sentence.rng
    if "named" in value:
        if lead:
            sentence.add(
                rng.choice(["a", "a", "al" if value["named"] == "noon" else "a la"])
            )
        sentence.add(NAMED_ES[value["named"]], "TIME_NAMED")
        return
    if "part" in value:
        # Spanish has one word, "noche", for both "evening" and "night"; fold
        # the schedule to match what the text can actually tell apart.
        if value["part"] == "evening":
            value["part"] = "night"
        sentence.add(rng.choice(["por la", "en la"]) if lead else "la")
        sentence.add(DAYPART_ES[value["part"]], "DAYPART")
        return
    hour, minute = value["hour"], value["minute"]
    if hour == 11 and minute == 45 and "second" not in value:
        # "doce menos cuarto de la mañana" rolls to the same spoken form the
        # "quarter to twelve" idiom uses for 23:45 ("de la noche"), so the
        # compiler cannot tell 11:45 from 23:45 there -- genuinely
        # unrecoverable from that idiom. Digits plus an explicit period
        # avoid the idiom and stay unambiguous.
        if lead:
            sentence.add("a")
        sentence.add("las", "O")
        sentence.add("11", "HOUR")
        sentence.add(":", separator="")
        sentence.add("45", "MINUTE", separator="")
        sentence.add("de la mañana", "MERIDIEM")
        return
    if rng.random() < 0.2:
        display = hour % 12 or 12
        second = value.get("second")
        if lead:
            sentence.add("a")
            sentence.add("la" if display == 1 else "las", "O")
        if minute and second is None and rng.random() < 0.3:
            sentence.add(f"{display}{minute:02d}", "HOUR")
        else:
            sentence.add(str(display), "HOUR")
            if minute or second is not None:
                sentence.add(":", separator="")
                sentence.add(f"{minute:02d}", "MINUTE", separator="")
            if second is not None:
                sentence.add(":", separator="")
                sentence.add(f"{second:02d}", "SECOND", separator="")
        sentence.add(meridiem_marker(rng, hour), "MERIDIEM", separator=rng.choice(["", " "]))
        return
    digital = style % 2 == 0 or "second" in value
    if digital:
        if lead:
            sentence.add("a")
        sentence.add("la" if hour % 24 == 1 else "las", "O")
        sentence.add(str(hour), "HOUR")
        sentence.add(":", separator="")
        sentence.add(f"{minute:02d}", "MINUTE", separator="")
        if "second" in value:
            sentence.add(":", separator="")
            sentence.add(f"{value['second']:02d}", "SECOND", separator="")
        return
    display = hour % 12 or 12
    # "menos cuarto" reads as the hour ahead: 2:45 is "las tres menos cuarto".
    spoken = display % 12 + 1 if minute == 45 else display
    if lead:
        sentence.add("a")
    sentence.add("la" if spoken == 1 else "las", "O")
    hour_word = "una" if spoken == 1 else NUMBERS_ES[spoken]
    sentence.add(hour_word if style % 4 == 1 else str(spoken), "HOUR")
    if minute == 15:
        sentence.add("y", "GLUE")
        sentence.add("cuarto", "CLOCK_OFFSET")
    elif minute == 30:
        sentence.add("y", "GLUE")
        sentence.add("media", "CLOCK_OFFSET")
    elif minute == 45:
        sentence.add("menos", "GLUE")
        sentence.add("cuarto", "CLOCK_OFFSET")
    # Always rendered: the spoken hour alone is 1-12 and cannot otherwise
    # tell the compiler which half of the day the true 24-hour value meant.
    period = "mañana" if hour < 12 else "tarde" if hour < 20 else "noche"
    sentence.add(f"de la {period}", "MERIDIEM")


def meridiem_marker(rng: random.Random, hour: int) -> str:
    return rng.choice(["pm", "p. m.", "PM", "p.m."] if hour >= 12 else ["am", "a. m.", "AM", "a.m."])


def digits(value: dict, sentence: Sentence) -> None:
    sentence.add(str(value["hour"]), "HOUR")
    sentence.add(sentence.rng.choice([":", ":", "."]), separator="")
    sentence.add(f"{value['minute']:02d}", "MINUTE", separator="")


def window(time: dict, sentence: Sentence, style: int) -> None:
    plain = all("hour" in time[key] and "second" not in time[key] for key in ("start", "end"))
    if plain and sentence.rng.random() < 0.25:
        start, end = time["start"], time["end"]
        shared = (start["hour"] >= 12) == (end["hour"] >= 12) and 0 < start[
            "hour"
        ] % 12 < end["hour"] % 12
        if shared and sentence.rng.random() < 0.5:
            for position, value in enumerate((start, end)):
                if position:
                    sentence.add("-", "RANGE_END", separator=sentence.rng.choice(["", " "]))
                sentence.add(str(value["hour"] % 12), "HOUR", separator=" " if not position else sentence.rng.choice(["", " "]))
                if value["minute"]:
                    sentence.add(":", separator="")
                    sentence.add(f"{value['minute']:02d}", "MINUTE", separator="")
            sentence.add(meridiem_marker(sentence.rng, end["hour"]), "MERIDIEM", separator="")
            return
        digits(start, sentence)
        sentence.add("-", "RANGE_END")
        digits(end, sentence)
        return
    between = style % 2 == 1
    sentence.add("entre" if between else "de", "RANGE_START")
    clock(time["start"], sentence, style, lead=False)
    sentence.add("y" if between else "a", "RANGE_END")
    clock(time["end"], sentence, style, lead=False)


def calendar(
    date: dict,
    sentence: Sentence,
    style: int,
    article: bool = True,
    numeric: bool | None = None,
) -> None:
    rng = sentence.rng
    year, month, day = date.get("year"), date["month"], date["day"]
    use_numeric = (style % 2 == 0) if numeric is None else numeric
    if article:
        sentence.add("el", "O")
    if use_numeric:
        sep = rng.choice(["/", "-"])
        fields = [(day, "DOM"), (month, "MONTH")]
        if year:
            fields.append((year, "YEAR"))
        for index, (value, label) in enumerate(fields):
            if index:
                sentence.add(sep, separator="")
            sentence.add(str(value), label, separator="" if index else " ")
        return
    terse = rng.random() < 0.3
    sentence.add(dom_word(day, rng), "DOM")
    if not terse:
        sentence.add("de")
    sentence.add(month_word(rng, month - 1), "MONTH")
    if year:
        if not terse and rng.random() < 0.7:
            sentence.add("de")
        sentence.add(str(year), "YEAR")


def render_date(
    date: dict, sentence: Sentence, style: int, article: bool = True
) -> None:
    rng = sentence.rng
    kind = date["kind"]
    if kind == "now":
        sentence.add(rng.choice(["ahora", "ahora mismo", "ya"]), "NOW")
    elif kind == "relativeDay":
        sentence.add(REL_DAY_ES[date["offset"]], "REL_DAY")
    elif kind == "weekday":
        modifier = date.get("modifier")
        if modifier == "this":
            sentence.add(deictic(rng, modifier), "DEICTIC")
            render_days(date["days"], sentence, article=False)
        elif modifier == "last":
            render_days(date["days"], sentence, article=article)
            sentence.add(deictic(rng, modifier), "DEICTIC")
        elif modifier == "next" and rng.random() < 0.5:
            render_days(date["days"], sentence, article=article)
            sentence.add("que viene", "DEICTIC")
        elif modifier == "next":
            if article:
                sentence.add("el")
            sentence.add(deictic(rng, modifier), "DEICTIC")
            render_days(date["days"], sentence, article=False)
        else:
            render_days(date["days"], sentence, article=article)
    elif kind == "weekdayRange":
        sentence.add("de", "RANGE_START")
        render_days([date["from"]], sentence, article=False)
        sentence.add("a", "RANGE_END")
        render_days([date["to"]], sentence, article=False)
    elif kind == "holiday":
        sentence.add(HOLIDAYS_ES[date["name"]], "HOLIDAY")
    elif kind == "calendar":
        calendar(date, sentence, style, article=article)
    elif kind == "calendarRange":
        start, end = date["from"], date["to"]
        if (
            start["month"] == end["month"]
            and start.get("year") == end.get("year")
            and rng.random() < 0.5
        ):
            spelled = rng.random() < 0.5
            if spelled:
                sentence.add("del", "RANGE_START")
            sentence.add(dom_word(start["day"], rng), "DOM")
            sentence.add("al" if spelled else rng.choice(["-", "a"]), "RANGE_END")
            sentence.add(dom_word(end["day"], rng), "DOM")
            if spelled or rng.random() < 0.5:
                sentence.add("de")
            sentence.add(month_word(rng, start["month"] - 1), "MONTH")
            if start.get("year"):
                if spelled or rng.random() < 0.5:
                    sentence.add("de")
                sentence.add(str(start["year"]), "YEAR")
        else:
            calendar(start, sentence, style, numeric=False)
            sentence.add(rng.choice(["a", "hasta", "-"]), "RANGE_END")
            calendar(end, sentence, style, numeric=False)
    elif kind == "relativeUnit":
        relative_unit(date, sentence, article=article)
    else:
        raise ValueError(f"No Spanish date renderer for {kind}")


def relative_unit(
    date: dict, sentence: Sentence, article: bool = True, heldout: bool = False
) -> None:
    rng = sentence.rng
    unit, modifier = date["unit"], date["modifier"]
    feminine = unit in FEMININE_UNITS
    noun = UNIT_WORDS[unit][0]
    if date.get("edge"):
        if article:
            sentence.add("a")
        start, end = ("comienzos", "fines") if heldout else ("principios", "finales")
        sentence.add(start if date["edge"] == "start" else end, "EDGE")
        sentence.add("de" if modifier == "this" else "de la" if feminine else "del")
        article = False
    if modifier == "this":
        sentence.add(deictic(rng, modifier, feminine), "DEICTIC")
        sentence.add(noun, "UNIT")
        return
    if article:
        sentence.add("la" if feminine else "el")
    if modifier == "next" and not heldout and rng.random() < 0.5:
        sentence.add(deictic(rng, modifier, feminine), "DEICTIC")
        sentence.add(noun, "UNIT")
        return
    sentence.add(noun, "UNIT")
    if modifier == "next" and not heldout:
        sentence.add("que viene", "DEICTIC")
    else:
        sentence.add(deictic(rng, modifier, feminine), "DEICTIC")


def date_article(date: dict) -> str | None:
    kind = date["kind"]
    if kind == "calendar":
        return "el"
    if kind == "weekday":
        return None if date.get("modifier") == "this" else "el"
    if kind == "relativeUnit" and not date.get("edge") and date["modifier"] != "this":
        return "la" if date["unit"] in FEMININE_UNITS else "el"
    return None


def lead_into(date: dict, sentence: Sentence, word: str, label: str, style: int) -> None:
    if not word.endswith(" de"):
        sentence.add(word, label)
        render_date(date, sentence, style)
        return
    sentence.add(word[:-3], label)
    sentence.add({"el": "del", "la": "de la"}.get(date_article(date) or "", "de"))
    render_date(date, sentence, style, article=False)


def relative(clause: dict, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    shift = clause["shift"]
    direction = shift["direction"]
    label = "DIR_AFTER" if direction == "after" else "DIR_BEFORE"
    has_date = bool(clause.get("date"))
    prefix = style % 2 == 1 and not has_date
    if prefix:
        sentence.add("dentro de" if direction == "after" else "hace", label)
    quantity_unit(sentence, [shift["unit"]], shift["amount"])
    if has_date and clause["date"]["kind"] != "now":
        lead_into(
            clause["date"],
            sentence,
            "después de" if direction == "after" else "antes de",
            label,
            style,
        )
    elif not prefix:
        if has_date:
            word = "a partir de"
        else:
            word = (
                rng.choice(["después", "más tarde"])
                if direction == "after"
                else rng.choice(["antes", "atrás"])
            )
        sentence.add(word, label)
    if has_date:
        if clause["date"]["kind"] == "now":
            sentence.add("ahora", "NOW")
            return
        if clause.get("time"):
            clock(clause["time"]["start"], sentence, style)


def render_general(clause: dict, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    if clause.get("shift"):
        relative(clause, sentence, style)
        return
    rule = clause.get("recurrence")
    if rule:
        if rule.get("timesPer"):
            quantity(sentence, rule["timesPer"], "NUM")
            sentence.add("vez" if rule["timesPer"] == 1 else "veces", "TIMES")
            daily = rule["freq"] == "daily"
            sentence.add("al" if daily else rng.choice(["a la", "por"]), "RECUR")
            sentence.add("día" if daily else "semana", "UNIT")
        elif rule["interval"] == 1 and rule.get("byDay") in (
            DAY_CODES[:5],
            DAY_CODES[5:],
        ):
            sentence.add("cada", "RECUR")
            key = "weekday" if rule["byDay"] == DAY_CODES[:5] else "weekend"
            sentence.add(DAYGROUP_ES[key], "DAYGROUP")
        else:
            sentence.add("cada", "RECUR")
            if rule["interval"] > 1:
                quantity(sentence, rule["interval"])
            period = {
                "hourly": "hour", "daily": "day", "weekly": "week",
                "monthly": "month", "yearly": "year",
            }[rule["freq"]]
            singular, plural = UNIT_WORDS[period]
            sentence.add(plural if rule["interval"] > 1 else singular, "UNIT")
            if rule.get("byDay"):
                render_days(rule["byDay"], sentence, habitual=True)
            if rule.get("byMonth"):
                # Spanish is day first: "el doce de enero", never "el enero doce".
                sentence.add("el", "O")
                quantity(sentence, rule["byMonthDay"][0], "DOM")
                sentence.add("de")
                sentence.add(month_word(rng, rule["byMonth"][0] - 1), "MONTH")
    elif clause.get("date"):
        render_date(clause["date"], sentence, style)
    if clause.get("time"):
        if clause["time"].get("end"):
            window(clause["time"], sentence, style)
        else:
            dated = (clause.get("date") or {}).get("kind") == "calendar"
            clock(
                clause["time"]["start"],
                sentence,
                style,
                lead=not (dated and rng.random() < 0.3),
            )
    if rule:
        if rule.get("start"):
            lead_into(
                rule["start"],
                sentence,
                rng.choice(["a partir de", "empezando"]),
                "BOUND_START",
                style,
            )
        if rule.get("until"):
            sentence.add("hasta", "BOUND_END")
            render_date(rule["until"], sentence, style)
        if rule.get("count"):
            sentence.add("durante")
            count = rule["count"]
            quantity(sentence, count)
            sentence.add("vez" if count == 1 else rng.choice(["veces", "ocasiones"]), "COUNT")
        if rule.get("except"):
            sentence.add(rng.choice(["excepto", "salvo"]), "EXCEPT")
            render_date(rule["except"][0], sentence, style)
    duration = clause.get("duration") or (rule or {}).get("span")
    if duration:
        sentence.add(rng.choice(["durante", "por"]), "DUR")
        quantity_unit(sentence, [duration["unit"]], duration["amount"])


def render(spec: semantic.Specification, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    if rng.random() < 0.4:
        sentence.add(prefix_es(rng))
    for index, clause in enumerate(spec.schedule["clauses"]):
        if index and style % 2:
            sentence.add(rng.choice(["y", ";", ",", "y luego"]), "JOIN")
        sentence.clause()
        family = spec.family
        if family in semantic.GENERAL_FAMILIES:
            render_general(clause, sentence, style)
        elif family == "calendar":
            calendar(clause["date"], sentence, style)
        elif family == "relative":
            relative(clause, sentence, style)
        elif family == "relative-day":
            sentence.add(REL_DAY_ES[clause["date"]["offset"]], "REL_DAY")
        elif family == "relative-unit":
            relative_unit(clause["date"], sentence)
        elif family == "modified-group":
            modifier = clause["date"]["modifier"]
            if modifier != "this":
                sentence.add("el")
            if modifier == "last":
                sentence.add("fin de semana", "DAYGROUP")
                sentence.add(deictic(rng, modifier), "DEICTIC")
            else:
                sentence.add(deictic(rng, modifier), "DEICTIC")
                sentence.add("fin de semana", "DAYGROUP")
        elif family == "bounded-weekday":
            sentence.add("cada", "RECUR")
            sentence.add("día", "UNIT")
            sentence.add("hasta", "BOUND_END")
            sentence.add("el", "O")
            day = clause["recurrence"]["until"]["days"][0]
            sentence.add(weekday_word(rng, DAY_CODES.index(day)), "WEEKDAY")
        elif family == "weekday-points":
            sentence.add("el", "O")
            day = clause["date"]["days"][0]
            sentence.add(weekday_word(rng, DAY_CODES.index(day)), "WEEKDAY")
            clock({**clause["time"]["start"], "minute": 0}, sentence, style)
        elif family == "monthly-ordinal":
            rule = clause["recurrence"]
            position = rule["bySetPos"][0]
            sentence.add("último" if position == -1 else ORD_MASC[position - 1], "ORD")
            sentence.add(weekday_word(rng, DAY_CODES.index(rule["byDay"][0])), "WEEKDAY")
            sentence.add("de")
            if style % 2:
                every = rng.choice(["cada", "todos los"])
                sentence.add(every, "RECUR")
                sentence.add("mes" if every == "cada" else "meses", "UNIT")
            else:
                sentence.add("el", "O")
                sentence.add("mes", "UNIT")
        elif family == "monthly-days":
            days = clause["recurrence"]["byMonthDay"]
            if style % 2:
                sentence.add("cada", "RECUR")
                sentence.add("mes", "UNIT")
                sentence.add("los" if len(days) > 1 else "el", "O")
            for position, day in enumerate(days):
                if position:
                    sentence.add("y", "JOIN")
                sentence.add(dom_word(day, rng), "DOM")
            if style % 2 == 0:
                sentence.add("de")
                sentence.add("cada", "RECUR")
                sentence.add("mes", "UNIT")
        else:  # weekday-windows: one or more day-list + time-range clauses
            recurrence = clause.get("recurrence")
            days = recurrence["byDay"] if recurrence else clause["date"]["days"]
            if recurrence:
                interval = recurrence["interval"]
                sentence.add("cada" if interval > 1 else "todos", "RECUR")
                if interval > 1:
                    quantity(sentence, interval)
                    sentence.add("semanas", "UNIT")
            render_days(days, sentence, habitual=bool(recurrence))
            window(clause["time"], sentence, style)
    if rng.random() < 0.15:
        sentence.in_expression = False
        sentence.add(rng.choice(["por favor", "para nuestro equipo", "me funciona"]))


# ---------------------------------------------------------------------------
# Unseen-frame renderer: the Spanish counterpart of generate.py's
# render_heldout(). Same schedule families as render() above, but different
# connectors (postposed modifiers, "hacia"/"sobre" for an approximate clock,
# "desde"/"como muy tarde" bounds, "desde ... hasta" ranges) so a heldout row
# never matches a shape render() can produce. Always carries a RESERVED_ES
# prefix, mirroring natural.py's reserved=True behaviour.
# ---------------------------------------------------------------------------


def clock_heldout(value: dict, sentence: Sentence, style: int) -> None:
    """Approximate clock reading: "hacia"/"sobre" never leads in render()."""
    rng = sentence.rng
    lead = rng.choice(["hacia", "sobre"])
    if "named" in value:
        sentence.add(lead)
        sentence.add(NAMED_ES[value["named"]], "TIME_NAMED")
        return
    if "part" in value:
        if value["part"] == "evening":
            value["part"] = "night"
        sentence.add("hacia")
        sentence.add("la", "O")
        sentence.add(DAYPART_ES[value["part"]], "DAYPART")
        return
    hour, minute = value["hour"], value["minute"]
    sentence.add("a" if "second" in value else lead)
    sentence.add("la" if hour % 24 == 1 else "las", "O")
    sentence.add(str(hour), "HOUR")
    if minute or "second" in value:
        sentence.add(":", separator="")
        sentence.add(f"{minute:02d}", "MINUTE", separator="")
    if "second" in value:
        sentence.add(":", separator="")
        sentence.add(f"{value['second']:02d}", "SECOND", separator="")


def window_heldout(time: dict, sentence: Sentence, style: int) -> None:
    sentence.add("desde", "RANGE_START")
    clock(time["start"], sentence, style, lead=False)
    sentence.add("hasta", "RANGE_END")
    clock(time["end"], sentence, style, lead=False)


def calendar_heldout(date: dict, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    sentence.add("el día", "O")
    sentence.add(dom_word(date["day"], rng), "DOM")
    sentence.add("de")
    sentence.add(month_word(rng, date["month"] - 1), "MONTH")
    if date.get("year"):
        sentence.add("de")
        sentence.add(str(date["year"]), "YEAR")


def render_date_heldout(date: dict, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    kind = date["kind"]
    if kind == "now":
        sentence.add("ahora", "NOW")
    elif kind == "relativeDay":
        sentence.add(REL_DAY_ES[date["offset"]], "REL_DAY")
    elif kind == "weekday":
        modifier = date.get("modifier")
        render_days(date["days"], sentence)
        if modifier == "next":
            sentence.add("que viene", "DEICTIC")
        elif modifier:
            sentence.add(deictic(rng, modifier), "DEICTIC")
    elif kind == "weekdayRange":
        sentence.add("desde", "RANGE_START")
        render_days([date["from"]], sentence)
        sentence.add("hasta", "RANGE_END")
        render_days([date["to"]], sentence)
    elif kind == "holiday":
        sentence.add(HOLIDAYS_ES[date["name"]], "HOLIDAY")
    elif kind == "calendar":
        calendar_heldout(date, sentence, style)
    elif kind == "calendarRange":
        sentence.add("desde", "RANGE_START")
        calendar(date["from"], sentence, style, numeric=False)
        sentence.add("hasta", "RANGE_END")
        calendar(date["to"], sentence, style, numeric=False)
    elif kind == "relativeUnit":
        relative_unit(date, sentence, heldout=True)
    else:
        raise ValueError(f"No Spanish heldout date renderer for {kind}")


def relative_heldout(clause: dict, sentence: Sentence, style: int) -> None:
    shift = clause["shift"]
    direction = shift["direction"]
    label = "DIR_AFTER" if direction == "after" else "DIR_BEFORE"
    date = clause.get("date")
    if date and date["kind"] == "now":
        quantity_unit(sentence, [shift["unit"]], shift["amount"])
        sentence.add("a partir de", label)
        sentence.add("ahora", "NOW")
        return
    if date:
        quantity_unit(sentence, [shift["unit"]], shift["amount"])
        lead_into(
            date,
            sentence,
            "después de" if direction == "after" else "antes de",
            label,
            style,
        )
        if clause.get("time"):
            clock_heldout(clause["time"]["start"], sentence, style)
        return
    sentence.add("dentro de" if direction == "after" else "hace", label)
    quantity_unit(sentence, [shift["unit"]], shift["amount"])

def render_general_heldout(clause: dict, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    if clause.get("shift"):
        relative_heldout(clause, sentence, style)
        return
    rule = clause.get("recurrence")
    if clause.get("time"):
        if clause["time"].get("end"):
            window_heldout(clause["time"], sentence, style)
        else:
            clock_heldout(clause["time"]["start"], sentence, style)
    if rule:
        if rule.get("timesPer"):
            daily = rule["freq"] == "daily"
            quantity(sentence, rule["timesPer"], "NUM")
            sentence.add("vez" if rule["timesPer"] == 1 else "veces", "TIMES")
            sentence.add("cada", "RECUR")
            sentence.add("día" if daily else "semana", "UNIT")
        elif rule["interval"] == 1 and rule.get("byDay") in (
            DAY_CODES[:5],
            DAY_CODES[5:],
        ):
            key = "weekday" if rule["byDay"] == DAY_CODES[:5] else "weekend"
            sentence.add("todos los", "RECUR")
            sentence.add(DAYGROUP_PLURAL_ES[key], "DAYGROUP")
        else:
            period = {
                "hourly": "hour", "daily": "day", "weekly": "week",
                "monthly": "month", "yearly": "year",
            }[rule["freq"]]
            singular, plural = UNIT_WORDS[period]
            if rule["interval"] > 1:
                sentence.add("cada", "RECUR")
                quantity(sentence, rule["interval"])
                sentence.add(plural, "UNIT")
            elif period == "hour":
                sentence.add("cada", "RECUR")
                sentence.add(singular, "UNIT")
            else:
                sentence.add("todas las" if period in FEMININE_UNITS else "todos los", "RECUR")
                sentence.add(plural, "UNIT")
            if rule.get("byDay"):
                render_days(rule["byDay"], sentence, habitual=True)
            if rule.get("byMonth"):
                sentence.add("en")
                sentence.add(month_word(rng, rule["byMonth"][0] - 1), "MONTH")
                sentence.add("el", "O")
                quantity(sentence, rule["byMonthDay"][0], "DOM")
        if rule.get("start"):
            sentence.add("desde", "BOUND_START")
            render_date(rule["start"], sentence, style)
        if rule.get("until"):
            sentence.add("como muy tarde", "BOUND_END")
            render_date(rule["until"], sentence, style)
        if rule.get("count"):
            count = rule["count"]
            quantity(sentence, count)
            sentence.add("vez" if count == 1 else "veces", "COUNT")
        if rule.get("except"):
            sentence.add("menos", "EXCEPT")
            render_date(rule["except"][0], sentence, style)
    elif clause.get("date"):
        render_date_heldout(clause["date"], sentence, style)
    duration = clause.get("duration") or (rule or {}).get("span")
    if duration:
        sentence.add("con una duración")
        sentence.add("de", "DUR")
        quantity_unit(sentence, [duration["unit"]], duration["amount"])


def render_heldout(spec: semantic.Specification, sentence: Sentence, style: int) -> None:
    rng = sentence.rng
    anchored = spec.family not in ("duration", "weekday-range", "relative")
    sentence.add(rng.choice(RESERVED_ES if anchored else RESERVED_DURATION_ES))
    for index, clause in enumerate(spec.schedule["clauses"]):
        if index and style % 2:
            sentence.add(rng.choice(["y", ","]), "JOIN")
        sentence.clause()
        family = spec.family
        if family in semantic.GENERAL_FAMILIES:
            render_general_heldout(clause, sentence, style)
        elif family == "calendar":
            calendar_heldout(clause["date"], sentence, style)
        elif family == "relative":
            relative_heldout(clause, sentence, style)
        elif family == "relative-day":
            sentence.add("justo", "O")
            sentence.add(REL_DAY_ES[clause["date"]["offset"]], "REL_DAY")
        elif family == "relative-unit":
            relative_unit(clause["date"], sentence, heldout=True)
        elif family == "modified-group":
            modifier = clause["date"]["modifier"]
            if modifier == "this":
                sentence.add(deictic(rng, modifier), "DEICTIC")
                sentence.add("fin de semana", "DAYGROUP")
            else:
                sentence.add("el")
                sentence.add("fin de semana", "DAYGROUP")
                sentence.add(deictic(rng, modifier), "DEICTIC")
        elif family == "bounded-weekday":
            day = clause["recurrence"]["until"]["days"][0]
            sentence.add("todos los", "RECUR")
            sentence.add("días", "UNIT")
            sentence.add("hasta", "BOUND_END")
            sentence.add("el")
            sentence.add(weekday_word(rng, DAY_CODES.index(day)), "WEEKDAY")
        elif family == "weekday-points":
            day = clause["date"]["days"][0]
            clock_heldout({**clause["time"]["start"], "minute": 0}, sentence, style)
            sentence.add("el", "O")
            sentence.add(weekday_word(rng, DAY_CODES.index(day)), "WEEKDAY")
        elif family == "monthly-ordinal":
            rule = clause["recurrence"]
            position = rule["bySetPos"][0]
            sentence.add("el", "O")
            sentence.add("último" if position == -1 else ORD_MASC[position - 1], "ORD")
            sentence.add(weekday_word(rng, DAY_CODES.index(rule["byDay"][0])), "WEEKDAY")
            sentence.add("de")
            sentence.add("cada", "RECUR")
            sentence.add("mes", "UNIT")
        elif family == "monthly-days":
            days = clause["recurrence"]["byMonthDay"]
            sentence.add("los días")
            for position, day in enumerate(days):
                if position:
                    sentence.add("y", "JOIN")
                sentence.add(dom_word(day, rng), "DOM")
            sentence.add("de")
            sentence.add("cada", "RECUR")
            sentence.add("mes", "UNIT")
        else:  # weekday-windows: window first, days and recurrence postposed
            recurrence = clause.get("recurrence")
            days = recurrence["byDay"] if recurrence else clause["date"]["days"]
            window_heldout(clause["time"], sentence, style)
            render_days(days, sentence, habitual=bool(recurrence))
            if recurrence:
                sentence.add("cada", "RECUR")
                if recurrence["interval"] > 1:
                    quantity(sentence, recurrence["interval"])
                    sentence.add("semanas", "UNIT")


# ---------------------------------------------------------------------------
# Carrier prose: idiomatic Spanish filler for a calendar app. Every phrase
# below is written directly in Spanish, not translated from background.py.
# None of these words appear in the time vocabulary above (see
# fetch_corpus_es.py's blocklist), so a carrier or borrowed sentence never
# collides with a real time expression while labelled O.
# ---------------------------------------------------------------------------

PROSE_ES = Path(__file__).resolve().parent.parent / "data/prose/sentences.es.txt"

NAMES_ES = ["Ana", "Luis", "Marta", "Diego", "Sofía", "Pablo", "Elena", "Carlos", "Lucía", "Javier"]
# All masculine, so "el {noun}" never needs gender agreement logic.
NOUNS_ES = [
    "informe", "proyecto", "equipo", "cliente", "correo", "documento",
    "presupuesto", "pedido", "contrato", "sistema", "producto", "servicio",
    "formulario", "borrador", "expediente", "reporte",
]
# All feminine, so "la {event}" never needs gender agreement logic.
EVENTS_ES = [
    "reunión", "cita", "entrevista", "llamada", "clase", "revisión", "junta",
    "sesión", "entrega", "capacitación",
]
VERBS_ES = [
    "revisar", "enviar", "terminar", "preparar", "confirmar", "actualizar",
    "firmar", "aprobar", "cancelar", "organizar", "compartir", "corregir",
]
PLACES_ES = ["la oficina", "la clínica", "la tienda", "la biblioteca", "el gimnasio"]
ACTORS_ES = ["puedo", "podemos", "no puedo", "no podemos", "quiero", "queremos", "necesito", "necesitamos"]
STATES_ES = [
    "estar libre", "estar ocupado", "volver a la oficina", "estar disponible",
    "trabajar desde casa", "quedarme en casa",
]
REQUESTS_ES = [
    "¿podemos mover la {event}", "¿podemos cambiar la {event}",
    "muévelo, por favor", "cambia la {event}", "en realidad, hazlo así",
    "mejor dicho,", "perdón, quise decir", "corrección:", "no, mejor así",
    "espera, quise decir", "por favor mueve la {event}", "reagendemos, por favor",
    "avísame si puedes", "te paso el enlace", "confírmame si puedes",
    "anótame en la lista",
]
AVAILABILITY_ES = [
    "horario de oficina", "disponible", "ocupado", "fuera de la oficina",
    "de guardia", "libre", "reservado", "bloqueado", "en una llamada",
    "sin conexión", "trabajando desde casa",
]
QUESTIONS_ES = [
    "¿estás libre", "¿tienes tiempo", "¿podemos vernos", "¿te viene bien",
    "¿qué tal si nos vemos", "¿seguimos en pie", "¿nos vemos", "¿quieres almorzar",
    "¿te parece bien", "¿puedes",
]
COMPLETIONS_ES = [
    "me viene bien", "te viene bien", "nos funciona", "suena bien",
    "está perfecto", "resulta complicado", "es mejor así", "va bien",
    "no es posible",
]
ASIDES_ES = ["", "", "", "por favor,", "nota:", "revisa esto:"]


def _availability_es(rng: random.Random) -> str:
    return f"{rng.choice(ACTORS_ES)} {rng.choice(STATES_ES)}"


def _hours_es(rng: random.Random) -> str:
    """"la oficina está cerrada", never "cerrado": PLACES_ES mixes genders."""
    place = rng.choice(PLACES_ES)
    if rng.random() < 0.5:
        return f"{place} {rng.choice(['abre', 'cierra'])}"
    feminine = place.startswith("la ")
    open_word, closed_word = (
        ("abierta", "cerrada") if feminine else ("abierto", "cerrado")
    )
    return f"{place} está {rng.choice([open_word, closed_word])}"


def _event_es(rng: random.Random) -> str:
    state = rng.choice(["está confirmada", "quedó lista", "se movió", "sigue en pie"])
    return f"la {rng.choice(EVENTS_ES)} {state}"


def _request_es(rng: random.Random) -> str:
    return rng.choice(REQUESTS_ES).format(event=rng.choice(EVENTS_ES))


def _title_es(rng: random.Random) -> str:
    noun, name = rng.choice(NOUNS_ES), rng.choice(NAMES_ES)
    return rng.choice(
        [rng.choice(EVENTS_ES), f"{rng.choice(EVENTS_ES)} con {name}",
         f"el {noun}", f"{noun} de {name}", f"{name}: {noun}"]
    )


def _availability_window_es(rng: random.Random) -> str:
    return rng.choice(AVAILABILITY_ES)


def _question_es(rng: random.Random) -> str:
    return rng.choice(QUESTIONS_ES)


def _statement_es(rng: random.Random) -> str:
    noun, other, name = rng.choice(NOUNS_ES), rng.choice(NOUNS_ES), rng.choice(NAMES_ES)
    return rng.choice(
        [
            f"el {noun} está listo",
            f"la {rng.choice(EVENTS_ES)} quedó confirmada",
            f"{name} dijo que el {noun} cambió",
            f"movieron el {noun}",
            f"el {noun} y el {other} coinciden",
            f"{name} confirmó el {noun}",
            f"el {noun} sigue en marcha",
        ]
    )


def _ask_es(rng: random.Random) -> str:
    noun, verb, name = rng.choice(NOUNS_ES), rng.choice(VERBS_ES), rng.choice(NAMES_ES)
    return rng.choice(
        [
            f"por favor {verb} el {noun}",
            f"¿puedes {verb} el {noun}",
            f"recuérdame {verb} el {noun}",
            f"necesito {verb} el {noun}",
            f"tenemos que {verb} el {noun}",
            f"no olvides {verb} el {noun}",
            f"avísale a {name} que hay que {verb} el {noun}",
            f"alguien debe {verb} el {noun}",
        ]
    )


def _broad_question_es(rng: random.Random) -> str:
    noun, verb, name = rng.choice(NOUNS_ES), rng.choice(VERBS_ES), rng.choice(NAMES_ES)
    return rng.choice(
        [
            f"¿quién va a {verb} el {noun}",
            f"¿puede alguien {verb} el {noun}",
            f"¿{name} puede {verb} el {noun}",
            f"¿cómo va el {noun}",
            f"¿por qué movieron el {noun}",
            f"¿hace falta {verb} el {noun}",
        ]
    )


def _greeting_es(rng: random.Random) -> str:
    noun, name = rng.choice(NOUNS_ES), rng.choice(NAMES_ES)
    return rng.choice(
        [
            f"hola {name}, una nota rápida sobre el {noun}",
            f"buenas, gracias por enviar el {noun}",
            f"hola a todos, el {noun} quedó confirmado",
            f"gracias {name}, el {noun} está listo",
            f"perdón por la demora con el {noun}",
            f"buenas noticias, el {noun} está terminado",
            f"hola, un aviso sobre el {noun}",
        ]
    )


def _listing_es(rng: random.Random) -> str:
    items = ", ".join(rng.sample(NOUNS_ES, 3))
    return rng.choice([f"pendientes: {items}", f"{items}: revisar", f"lista: {items}"])


def _numeric_es(rng: random.Random) -> str:
    """Number-heavy prose with no time expression, mirroring background.numeric().

    Ages and counts never carry their unit word ("años", "días"), the same way
    background.py's English ages drop "years old": the bare unit is time
    vocabulary and would collide with a real duration.
    """
    noun, name = rng.choice(NOUNS_ES), rng.choice(NAMES_ES)
    count = rng.randint(2, 99)
    return rng.choice(
        [
            f"pon el volumen en {rng.randint(1, 99)}.",
            f"la sala {rng.randint(1, 999)} está libre.",
            f"el pedido número {rng.randint(100, 9999)} llegó.",
            f"{name} tiene {rng.randint(18, 92)} y sigue con el {noun}.",
            f"compra {count} carpetas para el {noun}.",
            f"el {noun} tiene {count} páginas.",
        ]
    )


SHAPES_ES = [
    _availability_es, _hours_es, _event_es, _request_es, _title_es,
    _availability_window_es, _question_es, _statement_es, _statement_es,
    _ask_es, _ask_es, _broad_question_es, _greeting_es, _listing_es,
]


def _compose_es(rng: random.Random) -> str:
    body = rng.choice(SHAPES_ES)(rng)
    aside = "" if body.startswith("¿") else rng.choice(ASIDES_ES)
    return f"{aside} {body}".strip()


@lru_cache(maxsize=1)
def borrowed_es() -> tuple[str, ...]:
    try:
        lines = PROSE_ES.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ()
    return tuple(line for line in map(str.strip, lines) if 0 < len(line) <= 120)


def _terminated_es(text: str) -> str:
    return text if text[-1] in ".!?" else text + "."


def prefix_es(rng: random.Random) -> str:
    """Ordinary prose before a time expression; every token is background."""
    pool = borrowed_es()
    while True:
        text = (
            _terminated_es(rng.choice(pool))
            if pool and rng.random() < 0.3
            else _compose_es(rng)
        )
        if background.normal(text) not in _RESERVED_ES:
            return text


def suffix_es(rng: random.Random) -> str:
    pool = borrowed_es()
    while True:
        if pool and rng.random() < 0.3:
            text = _terminated_es(rng.choice(pool))
        else:
            noun, name = rng.choice(NOUNS_ES), rng.choice(NAMES_ES)
            text = rng.choice(
                [
                    f"si le sirve a {name}", f"para el {noun}", f"sobre el {noun}",
                    "por favor", rng.choice(COMPLETIONS_ES), f"y {name} lo revisa",
                ]
            )
        if background.normal(text) not in _RESERVED_ES:
            return text


def completion_es(rng: random.Random) -> str:
    return rng.choice(COMPLETIONS_ES)


def terminator_es(rng: random.Random, text: str) -> str:
    """The leading "¿" already marks a question in Spanish; no keyword list needed."""
    if text.lstrip().startswith("¿"):
        return rng.choice(["?", "?", "?", "?!"])
    return rng.choice([".", ".", ".", "!", "?"])


def sentence_es(rng: random.Random) -> str:
    """A negative row's whole text: no time expression, every token labelled O."""
    while True:
        if rng.random() < 0.15:
            text = _numeric_es(rng)
        else:
            pool = borrowed_es()
            text = rng.choice(pool) if pool and rng.random() < 0.55 else _compose_es(rng)
        if background.normal(text) not in _RESERVED_ES:
            return text


if __name__ == "__main__":
    # Self-check: reserved carriers must stay unreachable from ordinary prose.
    rng = random.Random(20260916)
    drawn = {background.normal(prefix_es(rng)) for _ in range(50000)}
    drawn |= {background.normal(suffix_es(rng)) for _ in range(50000)}
    drawn |= {background.normal(sentence_es(rng)) for _ in range(50000)}
    assert not drawn & _RESERVED_ES
    assert len(drawn) > 1000, len(drawn)
    print(f"ok: {len(drawn)} unique carriers, 0 reserved collisions")
