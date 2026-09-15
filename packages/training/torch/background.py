"""Non-temporal language for contextual contrast with the time grammar."""

import random
import re
from collections import Counter
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
# Calendar-app input: an event title with no verb, a correction, a request, or
# an availability window. None of these words are ever part of the expression.
TITLES = [
    "dentist", "team sync", "standup", "gym", "haircut", "yoga", "book club",
    "all hands", "sprint planning", "design review", "board meeting", "retro",
    "school pickup", "vet appointment", "parent teacher conference", "demo",
    "1:1 with {name}", "lunch with {name}", "coffee with {name}", "class",
    "call {name}", "interview with {name}", "flight to {place}", "shift",
    "workout", "rehearsal", "checkin", "session", "practice", "report review",
    "deep work", "focus time", "swim", "piano lesson", "therapy", "physio",
]
PLACES2 = ["sfo", "boston", "berlin", "the airport", "the clinic", "London"]
REQUESTS = [
    "can we push {event} to", "can we move {event} to", "move it to",
    "actually make it", "let's do", "let's meet", "can we bump it to",
    "change it to", "on second thought,", "scratch that,", "sorry i meant",
    "wait, i meant", "revised:", "nope, make it", "hold on, make it",
    "please move {event} to", "actually", "let's push to", "book it for",
    "correction: {event} is at", "i'd like to reschedule to", "pencil me in for",
]
AVAILABILITY = [
    "working hours", "available", "busy", "out of office", "ooo", "wfh",
    "office hours", "focus block", "free", "unavailable", "away", "blocked",
    "open", "booked", "on call", "reachable",
]
QUESTIONS = [
    "are you free", "are you around", "do you have time", "can we do",
    "can we meet", "can you do", "how about", "what about", "you free",
    "any chance you're free", "should i book it for", "shall we say",
    "are we still on for", "wanna hop on a call", "want to grab lunch",
    "could we push it to", "is", "does", "would", "will",
]
# "does 10am on the 14th work for you?" needs a tail; the opener alone is not a
# sentence. generate() forces one of these when the carrier opened with a verb.
OPENERS_NEEDING_TAIL = frozenset({"is", "does", "would", "will"})
COMPLETIONS = [
    "work for you", "work", "still work", "sound good", "suit you", "be ok",
    "work for everyone", "still suit you", "be too late", "be better",
]
QUESTION_WORDS = frozenset(
    "are can could do does did how is shall should wanna want what when where "
    "which who why will would any you".split()
)
# Never a carrier word: the model must read these as part of the expression.
TIME_WORDS = frozenset(
    "am pm noon midnight midday morning afternoon evening night today tomorrow "
    "tonight tonite tmrw tmr yesterday hour hours minute minutes second seconds "
    "day days week weeks month months year years weekday weekdays weekend "
    "weekends every each other half quarter past until till through from next "
    "last this coming previous upcoming sharp oclock clock daily weekly monthly "
    "yearly annually nightly hourly biweekly bimonthly quarterly fortnightly "
    "fortnight except excluding starting beginning ending start end before "
    "after between around once twice thrice times occurrences per now "
    "immediately noonish min mins hrs secs wks mos yrs january february march "
    "april may june july august september october november december jan feb mar "
    "apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday "
    "friday saturday sunday mon tue tues wed weds thu thur thurs fri sat sun "
    "zero one two three four five six seven eight nine ten eleven twelve "
    "thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty "
    "thirty forty fifty sixty seventy eighty ninety first second third fourth "
    "fifth sixth seventh eighth ninth tenth eleventh twelfth christmas "
    "halloween thanksgiving valentines eve".split()
)
# Cheap part of speech: the word after a determiner is a noun, the word after an
# infinitive or modal is a verb. Good enough over fifty thousand sentences, and
# it costs nothing next to a tagger dependency.
_NOUN_CUES = frozenset(
    "the a an my our your his her their its another one each every some no this "
    "that".split()
)
_VERB_CUES = frozenset(
    "to will would can could should must may might please let's i we they you "
    "he she didn't don't doesn't won't can't".split()
)


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


@lru_cache(maxsize=1)
def vocabulary() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Common nouns and verbs mined from the borrowed prose.

    Carriers built from a handful of hand-written nouns teach the model those
    nouns. Thousands of them teach it that an unknown word beside a time
    expression is filler, which is the actual job.
    """
    nouns: Counter[str] = Counter()
    verbs: Counter[str] = Counter()
    for line in borrowed():
        words = re.findall(r"[a-z']+", line.lower())
        for left, right in zip(words, words[1:]):
            if len(right) < 3 or "'" in right or right in TIME_WORDS:
                continue
            if left in _NOUN_CUES:
                nouns[right] += 1
            elif left in _VERB_CUES:
                verbs[right] += 1
    chosen = tuple(
        tuple(sorted(word for word, count in counter.items() if count >= 3))
        for counter in (nouns, verbs)
    )
    return (chosen[0] or ("meeting",), chosen[1] or ("call",))


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


def _title(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    """An event title with no verb. Mostly an ordinary noun, not a fixed list."""
    nouns, _ = vocabulary()
    if rng.random() < 0.25:
        title = rng.choice(TITLES).format(
            name=rng.choice(NAMES).lower(), place=rng.choice(PLACES2)
        )
    else:
        noun = rng.choice(nouns)
        title = rng.choice(
            [
                noun,
                f"{noun} {rng.choice(nouns)}",
                f"{noun} with {rng.choice(NAMES).lower()}",
                f"{rng.choice(DETERMINERS)} {noun}",
                f"{rng.choice(NAMES).lower()}'s {noun}",
            ]
        )
    return title, ("at", "on")


def _correction(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    nouns, _ = vocabulary()
    event = rng.choice(EVENTS) if rng.random() < 0.3 else rng.choice(nouns)
    return rng.choice(REQUESTS).format(event=event), ()


def _availability_window(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    return rng.choice(AVAILABILITY), ("on", "from", "at")


def _question(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    return rng.choice(QUESTIONS), ("at", "on")


def _statement(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    """An ordinary declarative built from mined vocabulary."""
    nouns, verbs = vocabulary()
    noun, other, verb = rng.choice(nouns), rng.choice(nouns), rng.choice(verbs)
    name = rng.choice(NAMES)
    return (
        rng.choice(
            [
                f"the {noun} is",
                f"the {noun} starts",
                f"our {noun} ends",
                f"{name} said the {noun} moved",
                f"{name} will {verb} the {noun}",
                f"we {verb} the {noun}",
                f"i {verb} the {noun} with {name}",
                f"they moved the {noun}",
                f"the {noun} and the {other} both happen",
                f"{name} booked the {noun}",
                f"my {noun} is confirmed",
                f"the new {noun} goes live",
            ]
        ),
        ("at", "on", "for"),
    )


def _ask(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    """A request or an instruction, any verb."""
    nouns, verbs = vocabulary()
    noun, verb, name = rng.choice(nouns), rng.choice(verbs), rng.choice(NAMES)
    return (
        rng.choice(
            [
                f"please {verb} the {noun}",
                f"could you {verb} the {noun}",
                f"remind me to {verb} the {noun}",
                f"i need to {verb} the {noun}",
                f"let {name} know we {verb} the {noun}",
                f"don't forget to {verb} the {noun}",
                f"{verb} the {noun}",
                f"we should {verb} the {noun} with {name}",
                f"someone has to {verb} the {noun}",
            ]
        ),
        ("at", "on", "for", "about", "by"),
    )


def _broad_question(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    nouns, verbs = vocabulary()
    noun, verb, name = rng.choice(nouns), rng.choice(verbs), rng.choice(NAMES)
    return (
        rng.choice(
            [
                f"when should we {verb} the {noun}",
                f"did {name} {verb} the {noun}",
                f"can you {verb} the {noun}",
                f"is the {noun} still",
                f"why did they move the {noun}",
                f"who wants to {verb} the {noun}",
                f"do we {verb} the {noun}",
            ]
        ),
        ("at", "on", "to"),
    )


def _greeting(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    nouns, _ = vocabulary()
    name = rng.choice(NAMES)
    # "good afternoon" opens a letter; the day part belongs to the greeting and
    # never to the clause that follows it.
    part = rng.choice(["morning", "afternoon", "evening"])
    return (
        rng.choice(
            [
                f"good {part}. we are writing to confirm the {rng.choice(nouns)}",
                f"good {part} {name}. a quick note on the {rng.choice(nouns)}",
                f"good {part} all, the {rng.choice(nouns)} is confirmed",
                f"good {part}! thanks for sending the {rng.choice(nouns)}",
                f"good {part}, everyone. the {rng.choice(nouns)} moves",
                f"hi {name}, quick note about the {rng.choice(nouns)}",
                f"hey! hope the {rng.choice(nouns)} went well",
                f"thanks {name}. the {rng.choice(nouns)} is ready",
                f"morning all, one update on the {rng.choice(nouns)}",
                f"sorry for the slow reply about the {rng.choice(nouns)}",
                f"good news, the {rng.choice(nouns)} is done",
            ]
        ),
        ("at", "on", "for"),
    )


def _listing(rng: random.Random) -> tuple[str, tuple[str, ...]]:
    nouns, _ = vocabulary()
    items = ", ".join(rng.choice(nouns) for _ in range(rng.randint(2, 4)))
    return rng.choice([f"agenda: {items} -", f"{items}:", f"todo: {items},"]), ()


# One calendar frame among many. The model must learn English filler, not a
# fixed set of event titles: _statement, _ask, _broad_question, _greeting and
# _listing all draw from thousands of mined nouns and verbs.
SHAPES = [
    _availability,
    _hours,
    _event,
    _request,
    _title,
    _correction,
    _availability_window,
    _question,
    _statement,
    _statement,
    _ask,
    _ask,
    _broad_question,
    _broad_question,
    _greeting,
    _listing,
]


def _compose(rng: random.Random, connector: bool) -> str:
    body, connectors = rng.choice(SHAPES)(rng)
    if connector and connectors and rng.random() < 0.6:
        body += " " + rng.choice(connectors)
    # "please, does tuesday work" is not a sentence anyone types.
    aside = "" if body.split(" ")[0] in QUESTION_WORDS else rng.choice(ASIDES)
    return f"{aside} {body}".strip()


def completion(rng: random.Random) -> str:
    return rng.choice(COMPLETIONS)


def terminator(rng: random.Random, text: str) -> str:
    """Sentence-final punctuation, glued to the last token.

    The tokenizer folds "? ! ) ] % # *" into one catch-all punctuation class and
    the generator never used to place any of them next to an expression.
    """
    head = {word.strip(",:") for word in text.lower().split()[:3]}
    if head & QUESTION_WORDS:
        return rng.choice(["?", "?", "?", "?!"])
    return rng.choice([".", ".", ".", "!", "?", ")", '"'])


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
            nouns, verbs = vocabulary()
            noun, verb = rng.choice(nouns), rng.choice(verbs)
            text = rng.choice(
                [
                    f"works for {rng.choice(RECIPIENTS)}",
                    f"for {rng.choice(RECIPIENTS)}",
                    f"if that works for {rng.choice(RECIPIENTS)}",
                    "is the deadline",
                    "please",
                    f"for the {noun}",
                    f"to {verb} the {noun}",
                    f"in the {noun}",
                    f"with {rng.choice(NAMES)} and the {noun}",
                    f"so we can {verb}",
                    f"about the {noun}",
                    f"unless the {noun} changes",
                    f"and {rng.choice(NAMES)} will {verb}",
                    f"per the {noun}",
                ]
            )
        if normal(text) not in RESERVED:
            return text


# Contrastive negatives: same surface forms as labelled expressions, different carrier.
DISTANCES = [
    "mile", "5k", "10k", "lap", "marathon", "half marathon", "course",
    "circuit", "final leg", "sprint", "climb", "descent", "relay", "length",
]
COMPLETED = [
    "ran", "swam", "cycled", "rowed", "walked", "finished", "completed",
    "covered", "cleared", "paced", "jogged", "skated",
]
PRODUCED = [
    "built", "wrote", "assembled", "fixed", "shipped", "drafted", "packed",
    "cooked", "printed", "reviewed", "rewired", "repainted",
]
SPOKEN_COUNTS = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "twenty", "thirty", "twenty two", "forty five",
    "ninety", "a hundred",
]
NUMBERED = [
    "section", "chapter", "page", "room", "floor", "aisle", "gate", "line",
    "seat", "row", "track", "version", "build", "table", "figure", "exhibit",
    "unit", "lot", "bay", "platform", "suite", "ward", "locker", "carriage",
]
ORDINAL_NOUNS = [
    "edition", "chapter", "floor", "draft", "album", "verse", "row", "attempt",
    "prize", "amendment", "instalment", "printing", "season", "movement",
    "act", "half", "quarter", "helping", "opinion", "language", "cousin",
]
ORDINAL_WORDS = [
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
    "eighth", "ninth", "tenth", "eleventh", "twelfth",
]
MONTH_NAMES = ["May", "June", "April", "August", "March", "January"]
VAGUE_COUNTS = [
    "a couple of", "a few", "a dozen", "half a dozen", "several",
    "a handful of", "a bunch of", "a couple more",
]
MEASURES = [
    "kilos", "pounds", "metres", "feet", "litres", "dollars", "euros",
    "degrees", "volts", "megabytes", "gigabytes", "characters", "milligrams",
    "millimetres", "acres", "calories", "decibels", "pixels",
]
CONTAINERS = [
    "tablets", "drops", "spoons", "scoops", "sheets", "slices", "coats",
    "cups", "tickets", "copies", "batteries", "screws",
]
SPORTS = [
    "match", "final", "semifinal", "derby", "opener", "friendly", "rematch",
    "tie", "playoff", "scrimmage",
]
# The scheduling verbs natural.py's carrier-date family uses, aimed at something
# that is not a date: the verb and its preposition alone must not trigger.
CARRIER_VERBS = [
    "is scheduled for", "has been rescheduled for", "is planned for",
    "is booked for", "is set for", "is slated for", "is penciled in for",
    "is pencilled in for", "is down for", "was postponed for",
    "is earmarked for", "is queued for", "is lined up for", "is up for",
]
CARRIER_MOVES = [("push", "pushed"), ("move", "moved"), ("bump", "bumped"),
                 ("shift", "shifted"), ("hand", "handed"), ("put", "put")]
NON_DATES = [
    "review", "approval", "release", "discussion", "signoff", "repair",
    "translation", "testing", "demolition", "auction", "resale", "inspection",
    "recycling", "further notice", "the next sprint", "the back burner",
    "a second opinion", "a rewrite", "two people", "a promotion", "a refund",
    "spare parts", "the archive", "scrap", "adoption", "a vote", "safekeeping",
]
CALENDAR_MONTHS = [
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
]
MONTH_PARTS = ["mid", "mid-", "early", "late"]


def _suffixed(value: int) -> str:
    tail = (
        "th"
        if value % 100 in (11, 12, 13)
        else {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    )
    return f"{value}{tail}"


def measured_duration(rng: random.Random) -> str:
    """A measured elapsed time, including the same compound units as requests."""
    first, second = rng.choice(
        [("second", None), ("minute", "second"), ("hour", "minute"), ("day", "hour"), ("week", "day")]
    )

    def quantity(unit: str) -> str:
        amount = rng.choice(SPOKEN_COUNTS) if rng.random() < 0.6 else str(rng.randint(1, 59))
        return f"{amount} {unit if amount in ('one', '1') else unit + 's'}"

    duration = quantity(first)
    if second and rng.random() < 0.3:
        duration += " and " + quantity(second)
    return duration


def numeric(rng: random.Random) -> str:
    """Number-heavy prose with no time expression in it at all.

    The nouns and verbs come from the mined vocabulary, so a negative is not
    recognisable by its handful of template words. The groups below mirror the
    false triggers the shipped model shows on negatives.jsonl: a measurement
    after a completion verb, an ordinal on an ordinary noun, a numbered thing,
    a score, a numeric range, an age, a percentage, a month name used as a
    person, and a vague count.
    """
    nouns, verbs = vocabulary()
    noun, other, verb = rng.choice(nouns), rng.choice(nouns), rng.choice(verbs)
    name = rng.choice(NAMES)
    month, second_month = rng.sample(MONTH_NAMES, 2)
    count = rng.randint(2, 99)
    ordinal_value = rng.randint(2, 12)
    ordinal_noun = rng.choice(ORDINAL_NOUNS)
    numbered = rng.choice(NUMBERED)
    duration = measured_duration(rng)
    low = rng.randint(1, 20)
    high = low + rng.randint(1, 40)
    address = f"{rng.randint(1, 499)} {rng.choice(nouns).title()} {rng.choice(['Street', 'Road', 'Avenue', 'Lane', 'Drive', 'Way'])}"
    numbered_plural = rng.choice(["seats", "rooms", "pages", "tracks", "tables", "gates"])
    quarter, second_quarter = rng.sample(["Q1", "Q2", "Q3", "Q4"], 2)
    year = rng.randint(1995, 2038)
    groups = [
        # Measured duration, all O. Keep "in N units" to 2 of 6 frames or real shifts regress.
        [
            f"{name} {rng.choice(COMPLETED)} the {rng.choice(DISTANCES)} in {duration}.",
            f"They {rng.choice(PRODUCED)} the whole {noun} in {duration} flat.",
            f"The {noun} took {duration} to {verb} start to finish.",
            f"Our fastest {rng.choice(DISTANCES)} was {duration}.",
            f"{name} held the record at just over {duration}.",
            f"The {noun} is {duration} long end to end.",
        ],
        # An ordinal sitting on an ordinary noun, never on a day of the month.
        [
            f"The {_suffixed(ordinal_value)} {ordinal_noun} corrected those {other}.",
            f"The {_suffixed(ordinal_value)} {ordinal_noun} is out of print.",
            f"{name} lives on the {_suffixed(ordinal_value)} floor of the {noun}.",
            f"Our seats are in the {_suffixed(ordinal_value)} row.",
            f"The {rng.choice(ORDINAL_WORDS)} {ordinal_noun} reads better than the first.",
            f"{name} placed {_suffixed(ordinal_value)} and {other} went unclaimed.",
            f"{name} placed {_suffixed(ordinal_value)} in the {rng.choice(SPORTS)}.",
            f"The {noun} ranked {_suffixed(ordinal_value)} among the finalists.",
            f"{name} won the {_suffixed(ordinal_value)} prize in the {rng.choice(SPORTS)}.",
            f"He finished {_suffixed(ordinal_value)} overall in the {rng.choice(SPORTS)}.",
            f"Take the {rng.choice(ORDINAL_WORDS)} exit and follow the {noun}.",
            f"The {rng.choice(ORDINAL_WORDS)} argument of the {noun} must be a string.",
        ],
        # A numbered thing. "on the 3rd floor" must not become a day of month.
        [
            f"Room {count} on the {_suffixed(rng.randint(2, 20))} floor.",
            f"{numbered.capitalize()} {count} explains the {noun}.",
            f"{numbered.capitalize()} {count} covers the {other} and the {noun}.",
            f"Meet me in {numbered} {count} of the {noun}.",
            f"Version {rng.randint(1, 12)}.{rng.randint(0, 9)} shipped with {count} fixes.",
            f"Build {rng.randint(1990, 2040)}.{rng.randint(1, 12)}.{rng.randint(1, 28)} passed the {noun}.",
            f"Pull request {rng.randint(1990, 2040)} updates the {noun}.",
            f"Page {low} to {high} covers the {noun}.",
            f"The stack trace points to line {count}.",
            f"{numbered.capitalize()} {count} is at the far end of the {noun}.",
            f"Dial {rng.randint(200, 999)} {rng.randint(1000, 9999)} about the {noun}.",
            f"We booked {numbered_plural} {low} and {high}.",
            f"{name} requested {numbered_plural} {low} and {high} for the {noun}.",
        ],
        # Street numbers and arithmetic share clock-sized numbers and connectors.
        [
            f"You can find the {noun} at {address}.",
            f"Send the {noun} to {address}.",
            f"{name} lives at {address}.",
            f"The address on the {noun} is {address}.",
            f"Our new location is {address}.",
            f"The {noun} office is on {_suffixed(rng.randint(2, 99))} Street.",
            f"Their studio moved to {_suffixed(rng.randint(2, 99))} Avenue.",
        ],
        [
            f"Multiply {count} by {low} to get the {noun}.",
            f"Divide {count} by {low} for the {noun}.",
            f"Subtract {low} from {count}.",
            f"Add {low} to {count} and check the {noun}.",
            f"Write the {noun} in base {rng.choice([2, 8, 10, 16, 32])}.",
            f"The {noun} uses base {rng.choice([2, 8, 10, 16, 32])} notation.",
            f"Only {low} of the {high} {other} passed inspection.",
            f"The {noun} affects {low} out of {high} {other}.",
        ],
        # Scores and tallies: "3 to 1" is not a clock range.
        [
            f"We scored {rng.randint(0, 9)} to {rng.randint(0, 9)} in the second half.",
            f"The ratio was {rng.randint(1, 9)}:{rng.randint(1, 9)} for the {noun}.",
            f"Mix the {noun} at a {rng.randint(1, 9)}-{rng.randint(1, 9)} ratio.",
            f"The {rng.choice(SPORTS)} ended {rng.randint(0, 9)} nil.",
            f"They beat us {rng.randint(0, 9)} to {rng.randint(0, 9)} in the {rng.choice(SPORTS)}.",
            f"The vote was {count} in favour and {rng.randint(1, 40)} against.",
            f"The judges gave the {noun} an {rng.randint(1, 9)} and a {rng.randint(1, 9)}.",
            f"{name} shot {rng.randint(1, 9)} under par.",
            f"{name} scored {rng.randint(1, 9)} out of {rng.randint(10, 20)} on the {noun}.",
        ],
        # A numeric range between two plain quantities.
        [
            f"Pick a number between {low} and {high}.",
            f"Between {low} and {high} people asked about the {noun}.",
            f"The {noun} ranges from {low} to {high} {rng.choice(MEASURES)}.",
            f"Prices sit between {low} and {high} {rng.choice(['euros', 'dollars', 'pounds'])}.",
            f"Anything from {low} to {high} {rng.choice(MEASURES)} is within spec.",
            f"The {noun} holds between {low} and {high} {other}.",
        ],
        # Ages, plain counts and measurements.
        [
            f"{name} is {rng.randint(18, 92)} and still runs the {noun}.",
            f"{name} is {rng.randint(18, 92)} and has {rng.choice(SPOKEN_COUNTS[:5])} kids.",
            f"The twins are {rng.randint(2, 15)} and {rng.randint(2, 15)}.",
            f"{name} retired at {rng.randint(55, 70)} with a full pension.",
            f"The {noun} weighs {rng.randint(2, 90)} {rng.choice(MEASURES)} and costs {count} dollars.",
            f"The {noun} is {count} {rng.choice(MEASURES)} across.",
            f"The {noun} costs {rng.randint(2, 400)}.{rng.randint(0, 99):02} {rng.choice(['dollars', 'euros', 'pounds'])}.",
            f"Take {rng.choice(SPOKEN_COUNTS[:4])} {rng.choice(CONTAINERS)} with the {noun}.",
            f"Add {rng.choice(SPOKEN_COUNTS[:5])} {rng.choice(CONTAINERS)} and stir.",
            f"A minute detail changed the {noun} completely.",
            f"The second draft improves the {noun}.",
            f"The hour hand on the {noun} is bent.",
            f"Her day job involves the {noun} and the {other}.",
        ],
        # Keep "half"/"quarter" to 2 of 8 frames or CLOCK_OFFSET regresses.
        [
            f"A {rng.randint(2, 60)} percent raise on the {noun} is unrealistic.",
            f"Turnout on the {noun} was up {rng.randint(2, 60)} percent.",
            f"Only {rng.randint(2, 90)} percent of the {other} matched the {noun}.",
            f"A third of the {other} never reached the {noun}.",
            f"Two thirds of the {noun} is already spent.",
            f"Most of the {other} were filed under the wrong {noun}.",
            f"About a quarter of the {noun} went to {other}.",
            f"Half the {other} left before the {noun} finished.",
        ],
        # A month name that is somebody's name, not a month.
        [
            f"{month} and {second_month} are both on the team.",
            f"{month} introduced me to her brother at the {noun}.",
            f"{month} is the name of the main character in the {noun}.",
            f"{month} signed the {noun} and {second_month} cosigned.",
            f"Ask {month} what she thinks of the {noun}.",
            f"{month} and {name} split the {noun} evenly.",
            f"{month} said {rng.choice(SPOKEN_COUNTS[:5])} things about the {noun}.",
            f"The group will march toward the {noun} after lunch.",
            f"The cafe is in the quarter district near the {noun}.",
            f"They rented a studio in the historic quarter by the {noun}.",
            f"The old quarter borders the {noun} and the river.",
            f"They live in the {rng.choice(['French', 'Historic', 'Old', 'Riverside'])} Quarter.",
            f"Send the second {noun} draft to {month} for review.",
        ],
        # A fiscal quarter code. The schema has no quarters, so "Q3" must read
        # as filler; the tokenizer splits it, leaving a bare digit beside "Q".
        [
            f"{quarter} revenue on the {noun} beat the forecast.",
            f"{year} {quarter} was the strongest run for the {noun}.",
            f"The {noun} slipped to {quarter} and then to {second_quarter}.",
            f"Compare {quarter} and {second_quarter} before you {verb} the {noun}.",
            f"{name} owns the {noun} roadmap from {quarter} onwards.",
            f"The {quarter} numbers for the {noun} are in the {other}.",
            f"{year} {quarter} and {year} {second_quarter} both missed the {noun}.",
            f"We shipped the {noun} in {quarter} and the {other} in {second_quarter}.",
            f"Their {year} {quarter} filing lists the {noun}.",
            f"{quarter} closes before the {noun} is ready.",
        ],
        # A vague count of ordinary objects, not of days or weeks.
        [
            f"{rng.choice(VAGUE_COUNTS).capitalize()} {other} are broken.",
            f"There are {rng.choice(VAGUE_COUNTS)} typos in the {noun}.",
            f"{name} brought {rng.choice(VAGUE_COUNTS)} friends to the {noun}.",
            f"A dozen reasons to {verb} the {noun} come to mind.",
            f"{rng.choice(VAGUE_COUNTS).capitalize()} {other} still need a {noun}.",
            f"We ordered {rng.choice(VAGUE_COUNTS)} {rng.choice(CONTAINERS)} for the {noun}.",
        ],
        # The original number-heavy frames, kept.
        [
            f"See section {rng.randint(1, 12)}.{rng.randint(1, 9)} of the {noun}.",
            f"Chapter {rng.randint(1, 20)} of the {noun} runs to page {rng.randint(100, 400)}.",
            f"The {noun} is in room {count} on floor {rng.randint(1, 9)}.",
            f"Upgrade the {noun} to version {rng.randint(1, 9)}.{rng.randint(0, 20)}.{rng.randint(0, 9)}.",
            f"The final score was {rng.randint(0, 5)} to {rng.randint(0, 5)}.",
            f"Only {rng.randint(2, 90)} percent of the {other} matched the {noun}.",
            f"{name} is {rng.randint(18, 80)} years old and owns a {noun}.",
            f"The {noun} costs {rng.randint(2, 400)} dollars plus tax.",
            f"Call {rng.randint(200, 999)}-{rng.randint(1000, 9999)} about the {noun}.",
            f"{name} came in second in the {rng.randint(2, 10)}00 metres.",
            f"She ran a quarter mile and then stopped to {verb}.",
            f"Half of them never answered the {noun}.",
            f"A quarter of the {rng.randint(20, 400)} {other} were blank.",
            f"May and {name} split the {noun} evenly.",
            f"March and August are both names in the {noun}.",
            f"The second argument of the {noun} must be an integer, not {count}.",
            f"Table {rng.randint(1, 9)} lists all {count} {other}.",
            f"Invoice {rng.randint(1000, 9999)} totals {rng.randint(10, 900)} euros.",
            f"Flight {rng.choice('ABDEFKLMNQRSUVWXZ')}{rng.randint(100, 999)} leaves from gate {rng.randint(1, 40)}.",
            f"Our {noun} finished {rng.choice(['first', 'second', 'third', 'last'])} out of {count}.",
            f"There are {count} {other} in the {noun}.",
            f"{name} had to {verb} the {noun} {rng.randint(2, 9)} times.",
            f"Page {count} of the {noun} explains the {other}.",
            f"The {noun} weighs {rng.randint(2, 90)} kilos.",
            f"Room {count} holds {rng.randint(4, 60)} {other}.",
        ],
    ]
    # Uniform over groups, not over templates: the last group has twenty-five
    # frames and would otherwise swamp the focused contrast categories.
    return rng.choice(rng.choice(groups))


def carrier_contrast(rng: random.Random) -> str:
    """A scheduling verb whose preposition points at something that is not a date.

    The carrier-date family teaches "scheduled for next week"; without the same
    frames ending in a noun the model learns the verb rather than the date.
    """
    nouns, _ = vocabulary()
    noun, other = rng.choice(nouns), rng.choice(nouns)
    name = rng.choice(NAMES)
    target = rng.choice(NON_DATES)
    present, past = rng.choice(CARRIER_MOVES)
    return rng.choice(
        [
            f"The {noun} {rng.choice(CARRIER_VERBS)} {target}.",
            f"{name}'s {noun} {rng.choice(CARRIER_VERBS)} {target}.",
            f"Our {noun} {rng.choice(CARRIER_VERBS)} {target}.",
            f"{present.capitalize()} the {noun} to {target}.",
            f"{name} {past} the {noun} to {target}.",
            f"We are aiming for {target}.",
            f"{name} booked the {noun} for {target}.",
            f"They put the {noun} off until further notice.",
            f"The {noun} is on hold pending {target}.",
            f"{name} pencilled the {other} in for {target}.",
            f"The {noun} was set aside for {target}.",
            f"Everything is riding on {target}.",
            f"{name} is holding the {noun} for {target}.",
            f"The {other} has been earmarked for {target}.",
        ]
    )


def month_part(rng: random.Random) -> str:
    """"mid october" names no supported sub-period, so every token stays O."""
    month = rng.choice(CALENDAR_MONTHS)
    part = rng.choice(MONTH_PARTS)
    phrase = f"{part}{month}" if part.endswith("-") else f"{part} {month}"
    nouns, verbs = vocabulary()
    return rng.choice(
        [
            phrase,
            phrase,
            f"{phrase}?",
            f"The {rng.choice(nouns)} lands {phrase}.",
            f"We should {rng.choice(verbs)} the {rng.choice(nouns)} {phrase}.",
            f"{phrase} is my best guess for the {rng.choice(nouns)}.",
            f"Aiming for {phrase} at the latest.",
        ]
    )


# Class A hard negatives: a bare integer with no time unit anywhere near it.
SETTINGS = [
    "volume", "brightness", "font size", "temperature", "contrast", "zoom",
    "speed", "threshold", "margin", "line height", "gain", "opacity",
    "difficulty", "pressure", "resolution", "bitrate", "sensitivity",
    "saturation", "indent", "thermostat", "tempo", "quota", "row limit",
    "batch size", "column width", "border radius", "page count", "priority",
    "retry count", "seat number", "shutter speed", "aperture", "bass",
    "treble", "altitude", "torque", "voltage", "word count", "zoom level",
]
KNOBS = ["dial", "knob", "slider", "lever", "switch", "dimmer", "throttle",
         "regulator", "handle", "wheel", "stopper", "valve"]
SET_VERBS = [
    ("set", "set"), ("increase", "increased"), ("decrease", "decreased"),
    ("raise", "raised"), ("lower", "lowered"), ("change", "changed"),
    ("turn", "turned"), ("bump", "bumped"), ("adjust", "adjusted"),
    ("drop", "dropped"), ("reset", "reset"), ("cap", "capped"),
    ("limit", "limited"), ("tune", "tuned"), ("nudge", "nudged"),
    ("crank", "cranked"), ("round", "rounded"), ("pin", "pinned"),
    ("restrict", "restricted"), ("scale", "scaled"), ("trim", "trimmed"),
]
TRACKED = [
    "pull request", "issue", "ticket", "bug", "case", "order", "invoice",
    "patch", "changeset", "merge request", "work item", "incident", "form",
    "claim", "docket", "permit", "receipt", "purchase order", "complaint",
]
COUNTABLES = [
    "chairs", "shirts", "assertions", "pages", "rows", "columns", "seats",
    "tickets", "boxes", "screws", "files", "tests", "errors", "warnings",
    "photos", "slides", "passengers", "crates", "envelopes", "candles",
    "mugs", "bricks", "sockets", "cables", "sensors", "entries", "records",
    "commits", "branches", "plugins", "fonts", "icons", "pixels", "spare keys",
    "towels", "plates", "napkins", "batteries", "bolts", "washers", "labels",
    "stamps", "postcards", "buttons", "sleeves", "pairs of shoes", "shelves",
    "drawers", "pillows", "blankets", "saucers", "cartridges", "lenses",
]
RELATIONS = [
    "friend", "cousin", "flatmate", "neighbour", "colleague", "landlord",
    "tutor", "dentist", "aunt", "nephew", "goddaughter", "boss", "lodger",
    "coach", "accountant", "plumber", "co-author", "sister-in-law",
]
# Class B hard negatives: a weekday, a month or a unit used as a name or a noun.
WEEKDAY_PEOPLE = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                  "Saturday", "Sunday"]
MONTH_PEOPLE = ["April", "May", "June", "August", "January", "March", "July"]
SURNAMES = [
    "Addams", "Jones", "Ferreira", "Okonkwo", "Lindqvist", "Vance", "Bello",
    "Nakamura", "Petrov", "Silva", "Hart", "Osei", "Kaur", "Novak", "Reyes",
    "Whitfield", "Duarte", "Ivanova", "Haddad", "Larsen",
]
PAPERS = [
    "Times", "Herald", "Post", "Review", "Gazette", "Journal", "Observer",
    "Telegraph", "Mail", "Express", "Tribune", "Chronicle", "Standard",
    "Mirror", "Bulletin", "Courier", "Dispatch", "Sentinel",
]
UNIT_WORDS = ["second", "minute", "hour", "day", "week", "month", "year",
              "decade", "century", "fortnight"]
PRONOUNS = [("she", "her", "her"), ("he", "him", "his"), ("they", "them", "their")]


def _plain_int(rng: random.Random) -> int:
    """Weighted to the ranges a clock, a day of month or a year would occupy."""
    roll = rng.random()
    if roll < 0.30:
        return rng.randint(1, 12)
    if roll < 0.50:
        return rng.randint(13, 31)
    if roll < 0.65:
        return rng.randint(1900, 2099)
    if roll < 0.85:
        return rng.randint(32, 99)
    return rng.randint(100, 9999)


def setting_number(rng: random.Random) -> str:
    """A bare integer with no unit beside it: a setting, a label, or a count.

    "set the volume to 7" shares its whole surface with a clock and a range
    end, so the integer has to be seen next to a non-temporal noun in training.
    """
    nouns, verbs = vocabulary()
    noun, other, verb = rng.choice(nouns), rng.choice(nouns), rng.choice(verbs)
    name = rng.choice(NAMES)
    value, second = _plain_int(rng), _plain_int(rng)
    # A setting or a divisor is small; a label or a count runs to four digits.
    level, divisor = rng.randint(1, 99), rng.randint(2, 60)
    count, count2 = max(2, value), max(2, second)
    base, past = rng.choice(SET_VERBS)
    setting, knob = rng.choice(SETTINGS), rng.choice(KNOBS)
    thing, other_thing = rng.choice(COUNTABLES), rng.choice(COUNTABLES)
    label, ticket = rng.choice(NUMBERED), rng.choice(TRACKED)
    subject, _, possessive = rng.choice(PRONOUNS)
    groups = [
        # "to 14" after a scheduling-shaped verb is exactly a clock or a range end.
        [
            f"{base.capitalize()} the {setting} to {level}.",
            f"Please {base} the {setting} to {level}.",
            f"{name} {past} the {setting} to {level}.",
            f"{base.capitalize()} the {knob} to {level}.",
            f"{subject.capitalize()} {past} the {knob} to {level}.",
            f"Can you {base} the {setting} to {level}?",
            f"{base.capitalize()} the {setting} to {level} and save the {noun}.",
            f"The {setting} is {past} to {value} by default.",
            f"Leave the {setting} at {level}.",
            f"Keep the {knob} at {level} while you {verb} the {noun}.",
            f"Cap the {setting} at {level} for now.",
            f"The default {setting} is {level}.",
            f"{name} wants the {setting} {past} to {value}.",
            f"Try the {knob} at {level} instead.",
        ],
        # A noun that is simply numbered, bare and inside a sentence.
        [
            f"Please review {ticket} {value}.",
            f"{ticket.capitalize()} {value} is still open.",
            f"Close {ticket} {value} and raise a fresh one.",
            f"{name} assigned {ticket} {value} to the {noun} team.",
            f"{label.capitalize()} {value} covers the {noun}.",
            f"Open {label} {value} of the {noun}.",
            f"Skip to {label} {value}.",
            f"See {label} {value} for the {other}.",
            f"Build {value} broke the {noun}.",
            f"Version {value} replaced version {second}.",
            f"Option {value} is greyed out.",
            f"Choose option {value}.",
            f"The error points at {label} {value}.",
            f"{name} filed {ticket} {value} about the {noun}.",
            f"Merge {ticket} {value} into the main {noun}.",
            f"{label.capitalize()} {value} of the {noun} is blank.",
        ],
        # A plain count of countable objects, never a quantity of time.
        [
            f"The test suite has {count} {thing}.",
            f"There are {count} {thing} in the {noun}.",
            f"Pack {count} {thing} and {count2} {other_thing}.",
            f"We ordered {count} {thing} for the {noun}.",
            f"The {noun} ships with {count} {thing}.",
            f"{name} counted {count} {thing} on the {noun}.",
            f"Only {count} {thing} survived the {noun}.",
            f"The report lists {count} {thing} and {count2} {other_thing}.",
            f"Bring {count} {thing}.",
            f"That box holds {count} {thing}.",
            f"Add {count} {thing} to the {noun}.",
            f"{count} {thing} went missing from the {noun}.",
            f"The form has {count} {thing} left blank.",
            f"{subject.capitalize()} packed {count} {thing} into {possessive} bag.",
        ],
        # "60 by 12" and "7 to 5": the connectors a range uses, with no unit.
        [
            f"Divide {value} by {divisor}.",
            f"Multiply {value} by {divisor}.",
            f"{value} divided by {divisor} is not a whole number.",
            f"Round {value} down to {divisor}.",
            f"The score was {level} to {divisor}.",
            f"They won {level} to {divisor}.",
            f"The ratio of {noun} to {other} is {level} to {divisor}.",
            f"Compare {value} to {second}.",
            f"Change {value} to {second} in the {noun}.",
            f"Rename {label} {value} to {label} {second}.",
            f"The vote went {value} to {divisor}.",
            f"Convert {value} to {second} using the {noun}.",
            f"Sort the {thing} from {value} to {second}.",
            f"The {thing} are numbered {value} to {second}.",
        ],
    ]
    return rng.choice(rng.choice(groups))


def time_word_name(rng: random.Random) -> str:
    """A weekday, a month or a unit used as a person, a title or a bare noun.

    The carrier grammar can only ever render these words as dates, so nothing
    teaches the model that "Wednesday" is sometimes just somebody's name.
    """
    nouns, _ = vocabulary()
    noun = rng.choice(nouns)
    name, surname = rng.choice(NAMES), rng.choice(SURNAMES)
    who = rng.choice(WEEKDAY_PEOPLE + MONTH_PEOPLE)
    paper, relation = rng.choice(PAPERS), rng.choice(RELATIONS)
    subject, objective, possessive = rng.choice(PRONOUNS)
    unit, second_unit = rng.sample(UNIT_WORDS, 2)
    groups = [
        # Somebody's given name that happens to be a weekday or a month.
        [
            f"My {relation} {who} never returns {possessive} calls.",
            f"{who} sent the invoice through.",
            f"{who} signed the {noun} and {name} countersigned it.",
            f"Ask {who} about the {noun}.",
            f"{who} {surname} runs the {noun} department.",
            f"They named {possessive} daughter {who}.",
            f"A {relation} called {who} joined the {noun} team.",
            f"{who} is the main character in the {noun}.",
            f"{who} lent me {possessive} copy of the {noun}.",
            f"I sat next to {who} at the {noun}.",
            f"{who} and {name} split the {noun} between them.",
            f"{who} answered the door holding a {noun}.",
            f"{name} introduced me to {who} at the {noun}.",
            f"{who} teaches the {noun} class downstairs.",
            f"Everyone calls {objective} {who} because of the {noun}.",
            f"{who} would rather work on the {noun} alone.",
        ],
        # A title that contains one: a paper, a film, a programme.
        [
            f"The {who} {paper} ran the story on its front page.",
            f"{subject.capitalize()} writes a column for the {who} {paper}.",
            f"The {who} {paper} printed a correction about the {noun}.",
            f"I cancelled my {who} {paper} subscription.",
            f"The {who} {paper} costs more than the plain edition.",
            f"{who} Night Football clashed with the {noun}.",
            f"The {who} Club meets in the back room.",
            f"{who} is the title of that film, not a date.",
            f"The horror sequel {who} went straight to streaming.",
            f"The novel {who} sold out at the {noun}.",
            f"{who} {surname} plays the lead in the film.",
            f"The {who} {paper} archive is not searchable.",
            f"{subject.capitalize()} read the obituary in the {who} {paper}.",
            f"The {who} {paper} broke the {noun} story.",
            f"Our cat is called {who}, after the {noun}.",
        ],
        # The unit word itself as a glossary entry or a grammar example.
        [
            f"A {unit} is a unit of measurement and nothing more.",
            f"The word {unit} has {len(unit)} letters.",
            f"The word {unit} appears twice on that page.",
            f"The plural of {unit} is {unit}s.",
            f"{unit.capitalize()} is a noun in this sentence.",
            f"Spell the word {unit} backwards.",
            f"The glossary defines {unit} and {second_unit} in one entry.",
            f"The entry for {unit} is missing from the glossary.",
            f"The term {unit} is defined on page {rng.randint(2, 400)}.",
            f"{name} underlined the word {unit} in the {noun}.",
            f"The crossword answer was {unit}.",
            f"The column header reads {unit}.",
            f"How would you translate the word {unit}?",
            f"{unit.capitalize()} and {second_unit} are both nouns.",
            f"Type the word {unit} into the search box.",
            f"The {noun} spells {unit} with a capital letter.",
            f"A {unit} and a {second_unit} are different words for different things.",
        ],
    ]
    return rng.choice(rng.choice(groups))


# Class C hard negatives: a dotted or dashed numeric string that is not a date.
ARTEFACTS = [
    "build", "release", "patch", "hotfix", "rollout", "image", "firmware",
    "driver", "schema", "runtime", "bundle", "package", "snapshot", "installer",
    "client", "agent", "plugin", "extension", "toolchain", "kernel", "sdk",
    "binary", "container", "manifest", "changelog", "tarball", "branch cut",
]
SHIP_VERBS = [
    ("ship", "shipped"), ("deploy", "deployed"), ("tag", "tagged"),
    ("pin", "pinned"), ("promote", "promoted"), ("publish", "published"),
    ("install", "installed"), ("revert", "reverted"), ("cut", "cut"),
    ("sign", "signed"), ("mirror", "mirrored"), ("roll back", "rolled back"),
    ("cherry-pick", "cherry-picked"), ("rebuild", "rebuilt"), ("vendor", "vendored"),
]
HOSTS = [
    "gateway", "proxy", "load balancer", "database", "cache node", "mail relay",
    "print server", "access point", "firewall", "jump box", "router",
    "staging box", "build agent", "name server", "broker", "file share",
    "monitoring box", "test rig", "camera", "printer", "thermostat",
]
ENVIRONMENTS = [
    "production", "staging", "the sandbox", "the test cluster", "the lab",
    "the demo tenant", "canary", "the mirror", "the field units", "preview",
]
SPEC_DOCS = [
    "RFC 3339", "RFC 2119", "RFC 7231", "RFC 5322", "RFC 6749", "RFC 4122",
    "ISO 8601", "ISO 9001", "ISO 3166", "IEEE 754", "IEEE 802.11", "UTF-8",
    "SHA-256", "X.509", "ECMA-262", "PEP 8", "HTTP/2", "TLS 1.0", "ASCII 65",
]
PART_LABELS = [
    "SKU", "part", "model", "serial", "asset tag", "batch", "lot", "item",
    "catalogue number", "unit", "die", "mould", "fixture", "coupler",
]
# Listed, not drawn from letters: random pairs produce "PM", "SAT" and "DEC",
# and the tokenizer splits "PM-84233" into a bare meridiem token.
PART_CODES = [
    "BK", "CR", "DX", "FG", "HP", "KL", "NX", "PQ", "RV", "TZ", "VB", "XG",
    "ZL", "QD", "BRK", "CLP", "DRV", "FLX", "GRN", "HLX", "KPR", "NVL", "PLT",
    "RDX", "TRB", "VLX", "ZNC", "GSK", "LTP", "WRN",
]
RANGE_NOUNS = [
    "pages", "rows", "lines", "ports", "records", "entries", "frames",
    "columns", "offsets", "channels", "slots", "blocks", "sectors", "bins",
    "shelves", "lockers", "plots", "readings", "samples", "cells",
]


def _dotted_version(rng: random.Random, fields: int = 0) -> str:
    """A dotted number the positive calendar can never render.

    semantic.py dots only two or three fields, never pads them, and always puts
    a 1990-2040 year in the three-field form; natural.py never dots at all. So a
    four-field address, a small three-field triple, and a two-field pair whose
    minor is 0 or above 28 are all outside that grammar.

    A padded year-first stamp is not, whatever the strings say: the tokenizer
    splits it into five tokens and the padding survives only as one number
    bucket, so "Calibration date: 2027.06.24." read as filler. See test.
    """
    fields = fields or rng.choice([2, 3, 3])  # a four-field address is asked for by name.
    if fields == 4:
        return f"{rng.choice([10, 172, 192])}.{rng.randint(0, 254)}.{rng.randint(0, 254)}.{rng.randint(1, 254)}"
    if fields == 3:
        return f"{rng.randint(1, 40)}.{rng.randint(0, 40)}.{rng.randint(0, 40)}"
    minor = 0 if rng.random() < 0.6 else rng.randint(29, 99)
    return f"{rng.randint(1, 40)}.{minor}"


def _commit(rng: random.Random) -> str:
    """A short hash. A letter every third place, or the tokenizer splits
    "2023e23" and leaves a bare year token labelled O."""
    body = [rng.choice("0123456789abcdef") for _ in range(rng.choice([7, 7, 8, 10]))]
    for index in range(0, len(body), 3):
        body[index] = rng.choice("abcdef")
    return "".join(body)


def numeric_identifier(rng: random.Random) -> str:
    """A dotted or dashed numeric string that looks like a date and is not one.

    "Use build 2026.09.12 in production" is the whole class: a version, a build
    stamp, an address, a part number or a numeric range. Nothing in the carrier
    grammar shows these, so the model reads the digits and answers with a date.
    """
    nouns, verbs = vocabulary()
    noun, other, verb = rng.choice(nouns), rng.choice(nouns), rng.choice(verbs)
    name = rng.choice(NAMES)
    artefact, host = rng.choice(ARTEFACTS), rng.choice(HOSTS)
    base, past = rng.choice(SHIP_VERBS)
    environment, spec = rng.choice(ENVIRONMENTS), rng.choice(SPEC_DOCS)
    version, older = _dotted_version(rng), _dotted_version(rng)
    calver = _dotted_version(rng, 3)
    address, second_address = _dotted_version(rng, 4), _dotted_version(rng, 4)
    port, commit = rng.choice([80, 443, 3000, 5432, 8000, 8080, 9090]), _commit(rng)
    stamp = f"{rng.randint(2019, 2031)}{rng.randint(1, 12):02}{rng.randint(1, 28):02}"
    part_label, letters = rng.choice(PART_LABELS), rng.choice(PART_CODES)
    part = f"{letters}-{rng.randint(10000, 99999)}"
    isbn = f"978-{rng.randint(0, 1)}-{rng.randint(10, 99)}-{rng.randint(100000, 999999)}-{rng.randint(0, 9)}"
    phone = f"{rng.randint(200, 989)}-{rng.choice([rng.randint(0, 1860), rng.randint(2100, 9999)]):04}"
    # Both ends clear 31, so a dashed pair is never a day range or a clock range,
    # and the band a year could occupy is skipped outright.
    low = rng.choice([rng.randint(32, 1860), rng.randint(2100, 8000)])
    high = low + rng.randint(1, 120)
    ranged = rng.choice(RANGE_NOUNS)
    groups = [
        # A dotted version, with and without a prefix word.
        [
            f"Use {artefact} {calver} in {environment} until the {noun} lands.",
            f"{base.capitalize()} {artefact} {version} to {environment}.",
            f"{name} {past} {version} after the {noun} failed.",
            f"We are still on {artefact} {older} here.",
            f"Version {version} of the {noun} dropped the {other}.",
            f"{artefact.capitalize()} {calver} replaced {artefact} {older}.",
            f"The {noun} needs {artefact} {version} or newer.",
            f"v{version} of the {noun} is the last one that works.",
            f"Pin the {noun} to v{version} until we {verb} the {other}.",
            f"release {version} is tagged but not announced.",
            f"{name} asked whether {version} fixes the {noun}.",
            f"Downgrade to {older} if the {noun} breaks.",
            f"The changelog jumps from {older} to {version} with no note.",
            f"Our {noun} pins {artefact} {calver} in the lockfile.",
            f"{base.capitalize()} v{version} and tell {name}.",
            f"Anything above {version} needs a new {noun}.",
        ],
        # A build stamp or a commit hash.
        [
            f"{artefact.capitalize()} {stamp} never reached {environment}.",
            f"The {noun} ships as {artefact} {stamp}.",
            f"{name} {past} {artefact} {stamp} by hand.",
            f"Compare {artefact} {stamp} against {artefact} {calver}.",
            f"Commit {commit} touched the {noun}.",
            f"{name} reverted commit {commit} on the {noun} branch.",
            f"The {noun} regression starts at {commit}.",
            f"Cherry-pick {commit} into the {noun} branch.",
            f"{commit} and {_commit(rng)} both change the {noun}.",
            f"The bug report only quotes {artefact} {stamp}.",
            f"Tag {commit} as {artefact} {version}.",
            f"Our {noun} logs show {artefact} {stamp} everywhere.",
            f"{base.capitalize()} the {noun} from {commit} instead.",
            f"The stack trace names {artefact} {stamp} and nothing else.",
        ],
        # An address, a port, a phone number: dots and colons that carry no time.
        [
            f"The {host} answers on {address}.",
            f"Point the {noun} at {address} instead of {second_address}.",
            f"{name} moved the {host} to {address}:{port}.",
            f"Only {address} may reach the {noun}.",
            f"The {host} at {address} keeps dropping the {noun}.",
            f"Whitelist {address} and {second_address} for the {noun}.",
            f"Bind the {noun} to {address}:{port}.",
            f"{address} is the old {host}; use {second_address}.",
            f"Port {port} on {address} is closed.",
            f"Ring {phone} and ask about the {noun}.",
            f"{name} left {phone} as the callback number.",
            f"The {noun} lists {phone} as the support line.",
            f"Our {host} and the {noun} share {address}.",
            f"Route the {noun} through {address} for now.",
        ],
        # A part number, an SKU, an ISBN, a standard.
        [
            f"{part_label.capitalize()} {part} is out of stock.",
            f"Order {part_label} {part} for the {noun}.",
            f"{name} quoted {part_label} {part} instead of the {noun}.",
            f"The {noun} takes {part_label} {part} or the older {letters} range.",
            f"{part_label.capitalize()} {part} and {part_label} {rng.choice(PART_CODES)}-{rng.randint(10000, 99999)} are not interchangeable.",
            f"The ISBN on the {noun} is {isbn}.",
            f"Catalogue the {noun} under {isbn}.",
            f"{isbn} is a reprint, not a new edition.",
            f"The {noun} follows {spec} to the letter.",
            f"{spec} says nothing about the {noun}.",
            f"{name} cited {spec} in the {noun} review.",
            f"Read {spec} before you {verb} the {noun}.",
            f"The {noun} predates {spec}.",
            f"{spec} and {rng.choice(SPEC_DOCS)} disagree about the {other}.",
        ],
        # A dashed numeric range over things that are not days.
        [
            f"{ranged.capitalize()} {low}-{high} describe the {noun}.",
            f"Reread {ranged} {low}-{high} of the {noun}.",
            f"The {noun} fills {ranged} {low}-{high}.",
            f"{name} flagged {ranged} {low}-{high} as wrong.",
            f"Copy {ranged} {low}-{high} into the {other}.",
            f"Ports {low}-{high} are reserved for the {noun}.",
            f"Open ports {low}-{high} on the {host}.",
            f"The {noun} reads {ranged} {low}-{high} in one pass.",
            f"Delete {ranged} {low}-{high} and rerun the {noun}.",
            f"{ranged.capitalize()} {low}-{high} are blank in the {noun}.",
            f"The error covers {ranged} {low}-{high} only.",
            f"Everything in {ranged} {low}-{high} needs a second {noun}.",
            f"{base.capitalize()} the {noun} across {ranged} {low}-{high}.",
            f"Check {ranged} {low}-{high} before you {verb} the {other}.",
        ],
    ]
    return rng.choice(rng.choice(groups))


def sentence(rng: random.Random) -> str:
    # The three hard-negative classes go first, so their share is the stated one.
    if rng.random() < 0.12:
        return setting_number(rng)
    if rng.random() < 0.09:
        return time_word_name(rng)
    if rng.random() < 0.07:
        return numeric_identifier(rng)
    pool = borrowed()
    if pool and rng.random() < 0.15:
        return rng.choice(pool)
    if rng.random() < 0.10:
        return carrier_contrast(rng)
    if rng.random() < 0.05:
        return month_part(rng)
    if rng.random() < 0.35:
        return numeric(rng)
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
    # Mined, not listed: a negative must not be identifiable by its vocabulary.
    pool_nouns, pool_verbs = vocabulary()
    noun = rng.choice(pool_nouns)
    other = rng.choice(pool_nouns)
    verb = rng.choice(pool_verbs)
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
            f"The beginning of the {noun} explains the {other}.",
            f"At the end of the {noun}, the author signs it.",
            f"The change made a lasting impression on {name}.",
            f"A lasting {noun} needs a careful {other}.",
            f"{name} is starting a new {noun} with the {other}.",
            f"Starting the {noun} without the {other} never works.",
            f"This {noun} is for {name}, not for the {other}.",
            f"We argued for the {noun} and against the {other}.",
            f"We may {verb} another {noun}.",
            f"{name} wrote the {order} {noun}.",
            f"Send the {order} {noun} to {name}.",
            f"Build {version} failed with {count} warnings.",
            f"Choose option {count} from section {rng.randint(1, 12)}.",
            f"The {order} attempt succeeded.",
            f"Each {noun} needs a {other}.",
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
