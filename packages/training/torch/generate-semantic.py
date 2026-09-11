"""Write independent AST/rendering pairs for compiler and dataset checks."""

import argparse
import json
import random
from pathlib import Path

from generate import Sentence
from semantic import sample, render

ROOT = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser()
parser.add_argument("--count", type=int, default=5000)
parser.add_argument("--seed", type=int, default=271828)
parser.add_argument(
    "--out", type=Path, default=ROOT / "data/synth/semantic-checks.jsonl"
)
args = parser.parse_args()
rng = random.Random(args.seed)
args.out.parent.mkdir(parents=True, exist_ok=True)
with args.out.open("w") as output:
    for index in range(args.count):
        spec = sample(rng)
        sentence = Sentence(rng)
        render(spec, sentence, rng.randrange(9))
        output.write(
            json.dumps(
                {
                    "id": f"semantic-{args.seed}-{index}",
                    "family": spec.family,
                    "text": sentence.text,
                    "spans": sentence.spans,
                    "schedule": spec.schedule,
                }
            )
            + "\n"
        )
print(f"Wrote {args.count} independently sampled AST/rendering pairs to {args.out}")
