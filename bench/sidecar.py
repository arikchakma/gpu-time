"""Run Python baselines with fixed context; preserve each library's native output."""

from __future__ import annotations

import datetime as dt
import importlib
import importlib.metadata
import json
import platform
import statistics
import time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = dt.datetime(2026, 9, 9, 12, tzinfo=ZoneInfo("Asia/Dhaka"))


def create(name):
    module = importlib.import_module(name)
    if name == "dateparser":
        return lambda text: module.parse(
            text,
            settings={
                "RELATIVE_BASE": REFERENCE,
                "TIMEZONE": "Asia/Dhaka",
                "RETURN_AS_TIMEZONE_AWARE": True,
                "PREFER_DATES_FROM": "future",
            },
        )
    if name == "parsedatetime":
        calendar = module.Calendar()
        return lambda text: calendar.parseDT(
            text, sourceTime=REFERENCE, tzinfo=REFERENCE.tzinfo
        )
    if name == "recurrent":
        return lambda text: module.RecurringEvent(
            now_date=REFERENCE.replace(tzinfo=None)
        ).parse(text)
    config = module.tfhConfig(now=REFERENCE.replace(tzinfo=None))
    return lambda text: module.timefhuman(text, config=config)


def encode(value):
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    raise TypeError(f"Unsupported native result: {type(value).__name__}")


def invoke(parse, text):
    try:
        return {"raw": parse(text)}
    except Exception as error:
        return {"error": f"{type(error).__name__}: {error}"}


def main():
    examples = [
        json.loads(line)
        for line in (ROOT / "data/gold/adversarial.jsonl").read_text().splitlines()
    ]
    results = []
    for name in ["dateparser", "parsedatetime", "recurrent", "timefhuman"]:
        started = time.perf_counter()
        parse = create(name)
        initialization_ms = (time.perf_counter() - started) * 1000
        sample = "next Monday at 2pm"
        started = time.perf_counter()
        invoke(parse, sample)
        first_ms = (time.perf_counter() - started) * 1000
        for _ in range(10):
            invoke(parse, sample)
        measurements = []
        for _ in range(100):
            started = time.perf_counter()
            invoke(parse, sample)
            measurements.append((time.perf_counter() - started) * 1000)
        outputs = [
            {"id": case["id"], "text": case["text"], **invoke(parse, case["text"])}
            for case in examples
        ]
        result = {
            "library": name,
            "version": importlib.metadata.version(name),
            "initializationMs": initialization_ms,
            "firstParseMs": first_ms,
            "single": {
                "text": sample,
                "samples": 100,
                "p50Ms": statistics.median(measurements),
                "p95Ms": sorted(measurements)[94],
            },
            "outputs": outputs,
        }
        results.append(result)
        print(name, result["single"], flush=True)
    (ROOT / "bench/results/python.json").write_text(
        json.dumps(
            {
                "environment": {
                    "python": platform.python_version(),
                    "reference": REFERENCE.isoformat(),
                    "timeZone": "Asia/Dhaka",
                },
                "method": "In-process native parsing, ten warmups and 100 samples. Exceptions are captured, not silently dropped. Native return values are retained; naive datetimes remain naive. Browser and Python timings use different runtimes.",
                "results": results,
            },
            default=encode,
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
