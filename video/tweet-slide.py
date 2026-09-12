"""Five tweet images, with two release features and examples on each."""
from pathlib import Path
import json
import subprocess
from manimlib import *
from gpu_time_edge_cases import DATE, TIME, INK, MUTED, text, marked, rule

REPEAT, DURATION = "#E2DCFD", "#CFEFD8"
CONTEXT = "Reference: Sep 12, 2026 at noon · Asia/Dhaka"
REPORT = json.loads(Path("packages/training/active/export-report.json").read_text())
COVERAGE = json.loads(Path("packages/benchmark/results/english-coverage.json").read_text())
CASES = {item["id"]: item for item in COVERAGE["cases"]}
assert CASES["english-019"]["actual"][0]["start"] == "2026-09-13T14:00:00+06:00"
assert CASES["english-025"]["actual"][0]["start"] == "2027-09-12T12:00:00+06:00"
assert REPORT["options"]["layers"] == 2
assert REPORT["parameters"] == 38745

# The first four pages cover the eight parser features. The last covers
# the model and test changes in the same release.
PAGES = [
    [
        {
            "title": "Everyday phrasing",
            "lines": [("Tomorrow morning at 8,", [("Tomorrow", DATE), ("morning at 8", TIME)]),
                      ("unlock the office.", [])],
            "result": "Sep 13 · 8:00 AM",
            "note": CONTEXT,
        },
        {
            "title": "Complete date ranges",
            "lines": [("The retreat runs", []),
                      ("June 8-10, 2027.", [("June 8-10, 2027", DATE)])],
            "result": "June 8–10, 2027",
            "note": "One range, all three days",
        },
    ],
    [
        {
            "title": "Months in sentences",
            "lines": [("She is leaving in August.", [("August", DATE)])],
            "result": "August 1, 2027",
            "note": CONTEXT,
        },
        {
            "title": "Short date formats",
            "lines": [("The filing date is", []),
                      ("07-JAN-2027.", [("07-JAN-2027", DATE)])],
            "result": "January 7, 2027",
            "note": "All day",
        },
    ],
    [
        {
            "title": "Dates before or after",
            "lines": [("Remind me two hours after", [("two hours after", DURATION)]),
                      ("tomorrow at noon.", [("tomorrow", DATE), ("at noon", TIME)])],
            "result": "Sep 13 · 2:00 PM",
            "note": CONTEXT,
        },
        {
            "title": "The same time next year",
            "lines": [("Check back this time", [("this time", TIME)]),
                      ("next year.", [("next year", DATE)])],
            "result": "Sep 12, 2027 · noon",
            "note": CONTEXT,
        },
    ],
    [
        {
            "title": "Monthly schedules",
            "lines": [("the first Monday", [("first Monday", REPEAT)]),
                      ("of every month", [("every month", REPEAT)])],
            "result": "Oct 5 · Nov 2 · Dec 7",
            "note": "Next three dates after Sep 12, 2026",
        },
        {
            "title": "Fewer false dates",
            "lines": [("Our office is at", []),
                      ("15 Baker Street.", [("15 Baker Street", DURATION)])],
            "result": "No date returned",
            "note": "An address stays an address",
        },
    ],
    [
        {
            "title": "Two-layer model",
            "lines": [("Words pass through", []),
                      ("two model layers.", [("two model layers", REPEAT)])],
            "result": "Linked word roles",
            "note": "38,745 learned parameters",
        },
        {
            "title": "Stronger tests",
            "lines": [("A score falls below", [("falls below", DATE)]),
                      ("its saved minimum.", [])],
            "result": "The test run fails",
            "note": "Authored English cases: 37/56 → 56/56",
        },
    ],
]


class ReleaseTweetSlide(Scene):
    page = 0

    def construct(self):
        source = Path("apps/website/src/components/Logo.astro").read_text()
        logo_path = Path("video/output/release-logo.png")
        subprocess.run(
            ["rsvg-convert", "--width", "1024", "--height", "1024", "-o", str(logo_path)],
            input=source.replace("currentColor", INK), text=True, check=True,
        )
        icon = ImageMobject(str(logo_path)).set_height(0.55)
        name = text("gpu-time", 31, weight="SEMIBOLD")
        brand = Group(icon, name).arrange(RIGHT, buff=0.15).move_to([0, 2.75, 0])
        self.add(brand, rule([0, 1.53, 0], [0, -1.99, 0]))

        for x, feature in zip([-3.45, 3.45], PAGES[self.page]):
            heading = text(feature["title"], 32, weight="SEMIBOLD").move_to([x, 1.28, 0])
            assert heading.get_width() < 6.2, feature["title"]
            self.add(heading)

            ys = [0.30, -0.33] if len(feature["lines"]) == 2 else [-0.015]
            for y, (value, spans) in zip(ys, feature["lines"]):
                phrase = marked(value, spans, size=29)
                assert phrase.get_width() < 6.2, value
                phrase.move_to([x, y, 0])
                self.add(phrase[0], phrase[1])

            result = text(feature["result"], 32, weight="SEMIBOLD").move_to([x, -1.50, 0])
            note = text(feature["note"], 16, MUTED).move_to([x, -2.08, 0])
            assert result.get_width() < 6.2, feature["result"]
            assert note.get_width() < 6.2, feature["note"]
            self.add(text("↓", 25, MUTED).move_to([x, -0.97, 0]), result, note)


class TweetPage2(ReleaseTweetSlide):
    page = 1


class TweetPage3(ReleaseTweetSlide):
    page = 2


class TweetPage4(ReleaseTweetSlide):
    page = 3


class TweetPage5(ReleaseTweetSlide):
    page = 4
