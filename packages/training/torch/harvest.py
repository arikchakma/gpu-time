"""Pull real English sentences that carry a time expression out of Tatoeba.

`background.py` keeps the sentences that hold no time and labels them all `O`.
This keeps the ones it throws away, for labelling in harvest-real.ts.
"""

import argparse
import bz2
import hashlib
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data/downloads/eng_sentences.tsv.bz2"
OUT = ROOT / "data/prose/timed.txt"
SOURCE_ES = ROOT / "data/downloads/spa_sentences.tsv.bz2"
OUT_ES = ROOT / "data/prose/timed.es.txt"

MONTHS = (
    "january|february|march|april|may|june|july|august|september|october"
    "|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec"
)
WEEKDAYS = "mon|tues|wednes|thurs|fri|satur|sun"
UNITS = "minute|hour|day|week|month|year"
COUNTS = r"a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten"

# A month or weekday needs a word boundary on both sides, or "dec" matches
# "decision" and "mar" matches "marshmallow".
TIME = re.compile(
    rf"""(?ix)
    \b\d{{1,2}}\s*:\s*\d{{2}}\b
  | \b\d{{1,2}}\s*(?:am|pm|a\.m\.?|p\.m\.?)\b
  | \b(?:o'clock|oclock|noon|midnight|midday)\b
  | \b(?:{WEEKDAYS})day\b
  | \b(?:{MONTHS})\b\.?(?=\s|$|[,.])
  | \b(?:today|tomorrow|yesterday|tonight)\b
  | \b(?:next|last|this|every|each)\s+
    (?:week|month|year|day|morning|afternoon|evening|night|{WEEKDAYS}day)\b
  | \b\d+\s*(?:{UNITS})s?\b
  | \b(?:in|after|before|within)\s+(?:{COUNTS})\s+(?:{UNITS})s?\b
  | \b(?:daily|weekly|monthly|yearly|hourly|annually)\b
"""
)


MONTHS_ES = (
    "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre"
    "|octubre|noviembre|diciembre"
)
WEEKDAYS_ES = "lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?"
UNITS_ES = "minutos?|horas?|d[ií]as?|semanas?|mes|meses|años?"
COUNTS_ES = r"un|una|unos|unas|\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez"

TIME_ES = re.compile(
    rf"""(?ix)
    \b\d{{1,2}}\s*[:.]\s*\d{{2}}\b
  | \b\d{{1,2}}\s*(?:am|pm|a\.m\.?|p\.m\.?|h)\b
  | \ba\s+la?s?\s+\d{{1,2}}\b
  | \b(?:mediod[ií]a|medianoche)\b
  | \b(?:{WEEKDAYS_ES})\b
  | \b(?:{MONTHS_ES})\b
  | \b(?:hoy|ayer|anoche|anteayer|ahora|pasado\s+mañana)\b
  | \bmañana\b
  | \b(?:este|esta|pr[oó]xim[oa]|pasad[oa]|siguiente)\s+(?:semana|mes|año|lunes|martes|jueves|viernes)
  | \b(?:semana|mes|año)\s+(?:que\s+viene|pasad[oa]|pr[oó]xim[oa])\b
  | \b(?:dentro\s+de|hace|en)\s+(?:{COUNTS_ES})\s+(?:{UNITS_ES})\b
  | \b(?:todos\s+los|todas\s+las|cada)\s+(?:d[ií]as|semanas?|mes|meses|años?|{WEEKDAYS_ES})\b
  | \bfin(?:es)?\s+de\s+semana\b
  | \bde\s+la\s+(?:mañana|tarde|noche)\b
"""
)


def harvest(source: Path, limit: int, seed: int, pattern: re.Pattern = TIME) -> list[str]:
    seen: set[str] = set()
    kept: list[str] = []
    with bz2.open(source, "rt", encoding="utf-8") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            text = parts[2].strip()
            if not 12 <= len(text) <= 160 or not pattern.search(text):
                continue
            key = text.casefold()
            if key in seen:
                continue
            seen.add(key)
            kept.append(text)
    random.Random(seed).shuffle(kept)
    return kept[:limit]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=["en", "es"], default="en")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--limit", type=int, default=100000)
    parser.add_argument("--seed", type=int, default=20260913)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    spanish = args.language == "es"
    args.source = args.source or (SOURCE_ES if spanish else SOURCE)
    args.out = args.out or (OUT_ES if spanish else OUT)

    sentences = harvest(args.source, args.limit, args.seed, TIME_ES if spanish else TIME)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(sentences) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "sentences": len(sentences),
                "source": args.source.name,
                "sourceSha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
                "outSha256": hashlib.sha256(args.out.read_bytes()).hexdigest(),
                "seed": args.seed,
            }
        )
    )
