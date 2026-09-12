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
    return (
        rng.choice(
            [
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
DURATION_UNITS = ["seconds", "minutes", "hours", "days", "weeks"]
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
    spoken = rng.choice(SPOKEN_COUNTS)
    unit = rng.choice(DURATION_UNITS)
    low = rng.randint(1, 20)
    high = low + rng.randint(1, 40)
    groups = [
        # Measured duration, all O. Keep "in N units" to 2 of 6 frames or real shifts regress.
        [
            f"{name} {rng.choice(COMPLETED)} the {rng.choice(DISTANCES)} in {spoken} {unit}.",
            f"They {rng.choice(PRODUCED)} the whole {noun} in {spoken} {unit} flat.",
            f"The {noun} took {spoken} {unit} to {verb} start to finish.",
            f"Our fastest {rng.choice(DISTANCES)} was {spoken} {unit}.",
            f"{name} held the record at just over {spoken} {unit}.",
            f"The {noun} is {spoken} {unit} long end to end.",
        ],
        # An ordinal sitting on an ordinary noun, never on a day of the month.
        [
            f"The {_suffixed(ordinal_value)} {ordinal_noun} corrected those {other}.",
            f"The {_suffixed(ordinal_value)} {ordinal_noun} is out of print.",
            f"{name} lives on the {_suffixed(ordinal_value)} floor of the {noun}.",
            f"Our seats are in the {_suffixed(ordinal_value)} row.",
            f"The {rng.choice(ORDINAL_WORDS)} {ordinal_noun} reads better than the first.",
            f"{name} placed {_suffixed(ordinal_value)} and {other} went unclaimed.",
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
            f"Page {low} to {high} covers the {noun}.",
            f"The stack trace points to line {count}.",
            f"{numbered.capitalize()} {count} is at the far end of the {noun}.",
            f"Dial {rng.randint(200, 999)} {rng.randint(1000, 9999)} about the {noun}.",
        ],
        # Scores and tallies: "3 to 1" is not a clock range.
        [
            f"We scored {rng.randint(0, 9)} to {rng.randint(0, 9)} in the second half.",
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
            f"Take {rng.choice(SPOKEN_COUNTS[:4])} {rng.choice(CONTAINERS)} with the {noun}.",
            f"Add {rng.choice(SPOKEN_COUNTS[:5])} {rng.choice(CONTAINERS)} and stir.",
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
    # frames and would otherwise swamp the nine categories that actually fail.
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


def sentence(rng: random.Random) -> str:
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
