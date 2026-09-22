"""Filter Tatoeba Spanish sentences into carrier prose, mirroring src/fetch-corpus.ts.

The blocklist is derived from spanish.py's own vocabulary tables so it cannot
drift from what the generator renders as a real time expression.
"""

import bz2
import hashlib
import json
import re
import unicodedata
from pathlib import Path

import spanish

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "data/downloads/spa_sentences.tsv.bz2"
OUTPUT = ROOT / "data/prose/sentences.es.txt"
CORPUS_JSON = ROOT / "data/corpus.json"

MIN_CHARS, MAX_CHARS = 30, 160
MIN_WORDS, MAX_WORDS = 5, 26
SELECTION_LIMIT = 50000

# Not in spanish.py: general adverbs a calendar-app negative corpus must still avoid.
EXTRA_TIME_WORDS = [
    "hoy", "ayer", "ahora", "mediodia", "medianoche", "tarde", "noche",
    "madrugada", "siempre", "nunca", "diario", "diaria", "semanal", "mensual",
    "anual", "temprano", "pronto", "luego", "despues", "antes", "durante",
    "mientras", "ya",
]
# The indefinite article, not the spelled numeral: mirrors allowing "a"/"an" in
# fetch-corpus.ts, or almost no sentence would survive.
ALLOWED = {"un", "una"}


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def _words(*phrases: str) -> set[str]:
    return {
        strip_accents(word.lower())
        for phrase in phrases
        for word in phrase.split()
    }


def build_blocklist() -> set[str]:
    words: set[str] = set()
    words |= _words(*spanish.DAYS_ES, *spanish.SHORT_DAYS_ES)
    words |= _words(*spanish.MONTHS_ES, *spanish.SHORT_MONTHS_ES)
    words |= _words(*spanish.NUMBERS_ES)
    for singular, plural in spanish.UNIT_WORDS.values():
        words |= _words(singular, plural)
    words |= _words(
        *spanish.ORD_MASC,
        "primero", "primera", "segunda", "tercero", "tercera", "cuarta",
        "quinta", "ultimo", "ultima",
    )
    words |= _words(*spanish.HOLIDAYS_ES.values())
    words |= _words(*spanish.NAMED_ES.values())
    words |= _words(*spanish.DAYPART_ES.values())
    words |= _words(*spanish.REL_DAY_ES.values())
    # Not "esta"/"pasado"/"proximo": stripped of accents "esta" collides with
    # "está" (is), and they only mean time beside a weekday or unit, which this
    # list already blocks. English leaves "this"/"last"/"next" alone too.
    words |= _words(*EXTRA_TIME_WORDS)
    return words - ALLOWED


BLOCKLIST = build_blocklist()

# Numbers are kept: a plain number is exactly what teaches "digit beside prose
# is not automatically a time". Only time-shaped ones go, as in fetch-corpus.ts.
TIME_SHAPED = [
    re.compile(r"\d{1,2}\s*:\s*\d{2}"),
    re.compile(r"\b\d{1,2}\s*(?:am|pm|a\.m|p\.m)\b", re.IGNORECASE),
    re.compile(r"\b\d{1,2}\s*[/.-]\s*\d{1,2}\b"),
    re.compile(r"\b(?:19|20)\d{2}\b"),
    re.compile(r"\b\d{1,3}\s*(?:º|ª|er|do|to|mo|vo|no)\b", re.IGNORECASE),
]
SHAPE = re.compile(
    r"^[¡¿]?[A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑÜáéíóúñü'’\",;:!?¡¿()\- ]*[.!?]$"
)
WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def time_like_number(text: str) -> bool:
    return any(pattern.search(text) for pattern in TIME_SHAPED)


def has_time_word(text: str) -> bool:
    return any(strip_accents(token.lower()) in BLOCKLIST for token in WORD.findall(text))


def within_length(text: str) -> bool:
    words = text.split()
    return (
        MIN_CHARS <= len(text) <= MAX_CHARS
        and MIN_WORDS <= len(words) <= MAX_WORDS
    )


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> None:
    sha256 = digest(ARCHIVE)
    seen: set[str] = set()
    kept: list[str] = []
    dropped = {"shape": 0, "digits": 0, "length": 0, "timeWord": 0, "duplicate": 0}
    read = 0
    with bz2.open(ARCHIVE, "rt", encoding="utf-8") as handle:
        for line in handle:
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 3 or fields[1] != "spa":
                continue
            text = fields[2]
            read += 1
            if not SHAPE.match(text):
                dropped["shape"] += 1
            elif time_like_number(text):
                dropped["digits"] += 1
            elif not within_length(text):
                dropped["length"] += 1
            elif has_time_word(text):
                dropped["timeWord"] += 1
            elif text.lower() in seen:
                dropped["duplicate"] += 1
            else:
                seen.add(text.lower())
                kept.append(text)

    stride = max(1, len(kept) // SELECTION_LIMIT)
    selected = kept[::stride][:SELECTION_LIMIT]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(selected) + "\n", encoding="utf-8")

    print(f"read {read} sentences")
    for reason, count in dropped.items():
        print(f"  drop {reason}: {count}")
    print(f"kept {len(kept)}, wrote {len(selected)} to {OUTPUT}")

    manifest = json.loads(CORPUS_JSON.read_text())
    manifest["proseEs"] = {
        "url": "https://downloads.tatoeba.org/exports/per_language/spa/spa_sentences.tsv.bz2",
        "license": "CC-BY-2.0-FR",
        "attribution": "Sentences from Tatoeba (https://tatoeba.org), CC-BY 2.0 FR.",
        "retrievedAt": "2026-09-16",
        "sha256": sha256,
        "filter": {
            "minimumCharacters": MIN_CHARS,
            "maximumCharacters": MAX_CHARS,
            "minimumWords": MIN_WORDS,
            "maximumWords": MAX_WORDS,
            "allowedQuantityWords": sorted(ALLOWED),
            "blocklistSource": "torch/spanish.py vocabulary tables plus torch/fetch_corpus_es.py:EXTRA_TIME_WORDS",
            "blocklistSize": len(BLOCKLIST),
            "accentInsensitive": True,
            "timeShapedNumberPatterns": [pattern.pattern for pattern in TIME_SHAPED],
        },
        "selection": {"limit": SELECTION_LIMIT},
        "counts": {"read": read, "kept": len(kept), "wrote": len(selected), **dropped},
    }
    CORPUS_JSON.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
