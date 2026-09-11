"""Produce independent oracle fixtures for every added natural-language family."""

import argparse
import json
import random
from pathlib import Path
from generate import Sentence
from natural import FAMILIES, render

ROOT = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser()
parser.add_argument("--count", type=int, default=1000)
parser.add_argument("--seed", type=int, default=424242)
parser.add_argument(
    "--out", type=Path, default=ROOT / "data/synth/natural-evaluation.jsonl"
)
parser.add_argument("--reserved", action="store_true")
parser.add_argument("--bare", action="store_true")
args = parser.parse_args()
rng = random.Random(args.seed)
args.out.parent.mkdir(parents=True, exist_ok=True)
with args.out.open("w") as output:
    for index in range(args.count):
        sentence = Sentence(rng, augment=False)
        spec = render(
            sentence, args.reserved, FAMILIES[index % len(FAMILIES)], bare=args.bare
        )
        output.write(
            json.dumps(
                {
                    "id": f"natural-{args.seed}-{index}",
                    "family": spec.family,
                    "text": sentence.text,
                    "spans": sentence.spans,
                    "schedule": spec.schedule,
                }
            )
            + "\n"
        )
