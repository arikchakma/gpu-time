"""Structural fingerprints for keeping evaluation frames out of training."""
import hashlib
import json
import re


def fingerprint(example: dict) -> str:
    text = example["text"]
    encoded = text.encode("utf-16-le")
    pattern = []
    for span in example["spans"]:
        label = span["label"]
        if label == "O":
            continue
        if label in ("GLUE", "JOIN", "RANGE_START", "RANGE_END", "RECUR", "FREQ", "DIR_BEFORE", "DIR_AFTER", "DEICTIC", "BOUND_START", "BOUND_END", "DUR", "EXCEPT", "TIMES", "COUNT"):
            value = encoded[span["start"] * 2:span["end"] * 2].decode("utf-16-le")
            value = " ".join(value.lower().split())
            pattern.extend((label, token) for token in re.findall(r"[^\W\d]+(?:['’][^\W\d]+)*|\d+|[^\s]", value))
        else:
            pattern.append((label, "slot"))
    if not pattern:
        pattern = [("negative", re.sub(r"\d+", "#", " ".join(text.lower().split()))) ]
    return hashlib.sha256(json.dumps(pattern, separators=(",", ":")).encode()).hexdigest()
