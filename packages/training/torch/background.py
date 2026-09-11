"""Non-temporal language for contextual contrast with the time grammar."""

import random
from functools import lru_cache
from pathlib import Path

CONNECTORS = frozenset({"at", "on", "of", "for", "about", "to", "from", "in"})

PROSE = Path(__file__).resolve().parent.parent / "data/prose/sentences.txt"
RESERVED: set[str] = set()

ACTORS = ["I", "we", "you", "they"]
MODALS = ["'ll", " will", " may", " might", " should"]
STATES = ["be out", "be back", "be available", "go back"]
PLACES = ["the office", "our clinic", "the store", "the library"]
OPENINGS = ["is open", "is closed", "opens", "closes"]
DETERMINERS = ["the", "our", "my"]
EVENTS = ["meeting", "appointment", "interview", "call", "lesson"]
PREDICATES = ["is", "starts", "is scheduled"]
LEADS = ["", "please", "could you", "can you", "I'd like to"]
ASKS = [
    "schedule a {event}",
    "book a {event}",
    "reserve the {event}",
    "book room {room}",
    "set an alarm",
    "remind me",
    "remind me to call {name}",
]
NAMES = ["May", "Alex", "Jordan", "Riley", "Sam", "Taylor", "Casey"]
ASIDES = ["", "", "", "please,", "note:", "could you check this:"]
RECIPIENTS = ["me", "us", "the team"] + NAMES


def normal(text: str) -> str:
    return " ".join(text.lower().split())


def reserve(phrases) -> None:
    RESERVED.update(normal(phrase) for phrase in phrases)


@lru_cache(maxsize=1)
def borrowed() -> tuple[str, ...]:
    try:
        lines = PROSE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ()
    # Carriers share the 32/64/128-token buckets train.py batches on.
    return tuple(line for line in map(str.strip, lines) if 0 < len(line) <= 120)


def _availability(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    actor, modal = rng.choice(ACTORS), rng.choice(MODALS)
    return f"{actor}{modal} {rng.choice(STATES)}", ("at", "on", "for")


def _hours(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    return f"{rng.choice(PLACES)} {rng.choice(OPENINGS)}", ("at", "on", "for")


def _event(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    determiner, event = rng.choice(DETERMINERS), rng.choice(EVENTS)
    return f"{determiner} {event} {rng.choice(PREDICATES)}", ("at", "on")


def _request(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    ask = rng.choice(ASKS).format(
        event=rng.choice(EVENTS), room=rng.randint(1, 50), name=rng.choice(NAMES)
    )
    return f"{rng.choice(LEADS)} {ask}".strip(), ("for", "at", "on", "about")


SHAPES = [_availability, _hours, _event, _request]


def _compose(rng: random.Random, connector: bool) -> str:
    body, connectors = rng.choice(SHAPES)(rng)
    if connector and rng.random() < 0.85:
        body += " " + rng.choice(connectors)
    return f"{rng.choice(ASIDES)} {body}".strip()


def _terminated(text: str) -> str:
    return text if text[-1] in ".!?" else text + "."


def prefix(rng: random.Random, connector: bool = True) -> str:
    """Ordinary prose before a time expression; every token is background."""
    pool = borrowed()
    while True:
        if pool and rng.random() < 0.2:
            text = _terminated(rng.choice(pool))
        else:
            text = _compose(rng, connector)
        if normal(text) not in RESERVED:
            return text


def suffix(rng: random.Random) -> str:
    pool = borrowed()
    while True:
        if pool and rng.random() < 0.2:
            text = _terminated(rng.choice(pool))
        elif rng.random() < 0.3:
            text = f"and {_availability(rng)[0]}"
        else:
            text = rng.choice(
                [
                    f"works for {rng.choice(RECIPIENTS)}",
                    f"for {rng.choice(RECIPIENTS)}",
                    f"if that works for {rng.choice(RECIPIENTS)}",
                    "is the deadline",
                    "please",
                ]
            )
        if normal(text) not in RESERVED:
            return text


def sentence(rng: random.Random) -> str:
    pool = borrowed()
    if pool and rng.random() < 0.15:
        return rng.choice(pool)
    if rng.random() < 0.12:
        subject = rng.choice(
            ["Our clinic", "The office", "The shop", "The team", "The library"]
        )
        purpose = rng.choice(
            ["questions", "discussion", "feedback", "suggestions", "comments"]
        )
        return f"{subject} is open for {purpose}."
    if rng.random() < 0.25:
        modifier = rng.choice(["next", "last", "previous", "first", "second"])
        subject = rng.choice(
            [
                "step",
                "chapter",
                "attempt",
                "task",
                "item",
                "version",
                "page",
                "paragraph",
            ]
        )
        action = rng.choice(["open", "read", "review", "check", "copy", "close"])
        item = rng.choice(["file", "report", "document", "menu", "window"])
        return f"The {modifier} {subject} is to {action} the {item}."
    noun = rng.choice(
        [
            "file",
            "document",
            "report",
            "chapter",
            "book",
            "story",
            "table",
            "column",
            "row",
            "window",
            "menu",
            "program",
            "list",
            "paragraph",
            "message",
            "draft",
            "page",
            "section",
            "option",
            "example",
            "step",
        ]
    )
    verb = rng.choice(
        [
            "open",
            "close",
            "read",
            "review",
            "print",
            "select",
            "send",
            "check",
            "copy",
            "approve",
        ]
    )
    order = rng.choice(["first", "second", "third", "last", "next", "previous"])
    name = rng.choice(NAMES)
    count = rng.randint(1, 99)
    version = rng.randint(1990, 2040)
    phrase = rng.choice(
        [
            f"Please {verb} the {order} {noun}.",
            f"Could you {verb} the {noun} for {name}?",
            f"The {order} {noun} contains {count} examples.",
            f"The {noun} has {count} rows and {rng.randint(1, 31)} columns.",
            f"The beginning of the {noun} explains the format.",
            f"At the end of the {noun}, the author signs it.",
            f"We may {verb} another {noun}.",
            f"{name} wrote the {order} {noun}.",
            f"Send the {order} {noun} to {name}.",
            f"Build {version} failed with {count} warnings.",
            f"Choose option {count} from section {rng.randint(1, 12)}.",
            f"The {order} attempt succeeded.",
            f"Each {noun} needs a title.",
            f"Every {noun} in the list contains a number.",
            f"The field named {rng.choice(['year', 'timestamp', 'date', 'duration'])} contains a string.",
            f"The word {rng.choice(['midnight', 'tomorrow', 'morning', 'weekend'])} appears in the glossary.",
            f"From {name} to Alex, the message says hello.",
            f"Between the two choices, {name} prefers the {order}.",
            "The soldiers march through the square.",
            "March in a straight line toward the gate.",
            "This change looks correct.",
        ]
    )
    if rng.random() < 0.4:
        phrase = (
            rng.choice(["Please, ", "Could you check this: ", "Note: "])
            + phrase[0].lower()
            + phrase[1:]
        )
    return phrase


if __name__ == "__main__":
    # Running this file as a script gives natural.py a second background module,
    # so the registration its import performs has to be repeated here.
    import natural

    reserve(natural.RESERVED + natural.RESERVED_DURATION)
    PROSE = Path("/nonexistent")
    borrowed.cache_clear()
    rng = random.Random(20260909)
    drawn = {normal(prefix(rng)) for _ in range(200000)}
    drawn |= {normal(prefix(rng, connector=False)) for _ in range(200000)}
    drawn |= {normal(suffix(rng)) for _ in range(200000)}
    assert not drawn & RESERVED
    assert len(drawn) > 5000, len(drawn)
    print(len(drawn))
