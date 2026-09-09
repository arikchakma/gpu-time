"""Non-temporal language for contextual contrast with the time grammar."""

import random


def sentence(rng: random.Random) -> str:
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
    name = rng.choice(["May", "Alex", "Jordan", "Riley", "Sam", "Taylor", "Casey"])
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
