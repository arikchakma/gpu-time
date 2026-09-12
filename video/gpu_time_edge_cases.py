"""Four release highlights using the website's type and highlight colors."""
from pathlib import Path
import json
import subprocess
from manimlib import *

DATA = json.loads(Path(__file__).with_name("edge-cases-data.json").read_text())
INK, MUTED, LINE = "#171717", "#737373", "#E5E5E5"
DATE, TIME, DURATION = "#CFE3FD", "#FDE8B4", "#CFEFD8"


def text(value, size=34, color=INK, weight="NORMAL"):
    family = "SF Pro Display" if weight == "SEMIBOLD" else "SF Pro Text"
    item = Text(value, font=family, font_size=size, weight=weight).set_color(color)
    assert item.get_width() < 12.4, f"Text exceeds the safe width: {value}"
    return item


def rule(start, end, color=LINE, width=1.2):
    return Line(start, end, stroke_color=color, stroke_width=width)


def marked(value, spans, size=38, y=0.7):
    # Shape the entire line once. The highlight rectangles follow those glyphs.
    label = text(value, size).move_to([0, y, 0]).set_z_index(2)
    marks = VGroup().set_z_index(-2)
    for substring, color in spans:
        start = value.index(substring)
        a = label.substr_to_path_count(value[:start])
        b = label.substr_to_path_count(value[:start + len(substring)])
        glyphs = label[a:b]
        marks.add(RoundedRectangle(
            width=glyphs.get_width() + 0.13, height=label.get_height() + 0.13,
            corner_radius=0.04, stroke_width=0, fill_color=color, fill_opacity=1,
        ).move_to([glyphs.get_x(), label.get_y(), 0]).set_z_index(-1))
    return VGroup(marks, label)


class GpuTimeEdgeCases(Scene):
    def until(self, seconds):
        assert self.time <= seconds + 0.035, f"Scene overruns {seconds}: {self.time}"
        self.wait(max(0, seconds - self.time))

    def title(self, value, index):
        heading = text(value, 43, weight="SEMIBOLD").move_to([0, 2.77, 0])
        count = text(f"{index:02d} / 04", 17, MUTED).move_to([5.9, 3.63, 0])
        self.play(FadeIn(heading, UP * 0.04), FadeIn(count), run_time=0.8)
        return VGroup(heading, count)

    def reveal(self, phrase):
        self.play(FadeIn(phrase[1], UP * 0.06), run_time=1.0)
        self.wait(0.5)
        self.play(FadeIn(phrase[0]), run_time=0.8)

    def construct(self):
        brand = text("gpu-time", 20, weight="SEMIBOLD").move_to([-5.85, 3.63, 0])
        version = text("v0.2.0 update", 17, MUTED).next_to(brand, RIGHT, buff=0.3)
        self.add(brand, version)
        context = text("Reference: Sep 12, 2026 at noon · Asia/Dhaka", 17, MUTED)
        context.move_to([0, -3.35, 0])

        # 00–10: a full sentence opens the update.
        title = self.title("More natural English", 1)
        phrase = marked("Tomorrow morning at 8, unlock the office.",
                        [("Tomorrow", DATE), ("morning at 8", TIME)], size=38)
        self.reveal(phrase)
        self.until(3.6)
        result = next(x for x in DATA["positives"] if x["id"] == "english-049")["occurrences"][0]
        assert result["start"] == "2026-09-13T08:00:00+06:00"
        day = text("Sun, Sep 13", 38, weight="SEMIBOLD").move_to([-2.55, -1.15, 0])
        time = text("8:00 AM", 43, weight="SEMIBOLD").move_to([2.5, -1.15, 0])
        result_labels = VGroup(
            text("DATE", 16, MUTED).next_to(day, UP, buff=0.3),
            text("TIME", 16, MUTED).next_to(time, UP, buff=0.3),
        )
        divider = rule([0, -0.65, 0], [0, -1.65, 0])
        self.play(FadeIn(day, UP * 0.08), FadeIn(time, UP * 0.08),
                  FadeIn(result_labels), ShowCreation(divider), FadeIn(context), run_time=1.3)
        self.until(9.4)
        self.play(FadeOut(VGroup(title, phrase, day, time, result_labels, divider, context)),
                  run_time=0.6)

        # 10–20: compact formats get their own feature and readable result.
        title = self.title("More date formats", 2)
        phrase = marked("The filing date is 07-JAN-2027.",
                        [("07-JAN-2027", DATE)], size=41)
        self.reveal(phrase)
        self.until(13.6)
        result = next(x for x in DATA["positives"] if x["id"] == "english-041")["occurrences"][0]
        assert result["start"].startswith("2027-01-07")
        date = text("January 7, 2027", 45, weight="SEMIBOLD").move_to([0, -0.9, 0])
        detail = text("All day", 23, MUTED).move_to([0, -1.65, 0])
        self.play(FadeIn(date, UP * 0.08), FadeIn(detail), run_time=1.3)
        self.until(19.4)
        self.play(FadeOut(VGroup(title, phrase, date, detail)), run_time=0.6)

        # 20–30: one continuous date range, including both endpoints.
        title = self.title("Date ranges stay together", 3)
        phrase = marked("The retreat runs June 8-10, 2027.",
                        [("June 8-10, 2027", DATE)], size=41, y=1.1)
        self.reveal(phrase)
        result = next(x for x in DATA["positives"] if x["id"] == "english-045")["occurrences"][0]
        assert result["start"].startswith("2027-06-08") and result["end"].startswith("2027-06-11")
        self.until(23.6)
        month = text("JUNE 2027", 17, MUTED).move_to([0, -0.12, 0])
        dates = VGroup(*[
            text(day, 44, weight="SEMIBOLD").move_to([x, -0.85, 0])
            for day, x in [("8", -2.5), ("9", 0), ("10", 2.5)]
        ])
        band = RoundedRectangle(width=6.2, height=0.78, corner_radius=0.10,
                                stroke_width=0, fill_color=DATE, fill_opacity=1)
        band.move_to([0, -0.85, 0]).set_z_index(-1)
        note = text("One range. All three days.", 23, MUTED).move_to([0, -1.9, 0])
        self.play(FadeIn(month), FadeIn(band),
                  LaggedStart(*[FadeIn(day, UP * 0.07) for day in dates], lag_ratio=0.15),
                  FadeIn(note), run_time=1.5)
        self.until(29.4)
        self.play(FadeOut(VGroup(title, phrase, month, dates, band, note)), run_time=0.6)

        # 30–40: balanced lines keep "long" with the rest of its sentence.
        title = self.title("Fewer false matches", 4)
        first = marked("The film is two hours", [("two hours", DURATION)], size=42, y=1.03)
        second = marked("and ten minutes long.", [("and ten minutes", DURATION)], size=42, y=0.32)
        assert "The film is two hours and ten minutes long." in DATA["negatives"]
        self.play(FadeIn(first[1], UP * 0.06), FadeIn(second[1], UP * 0.06), run_time=1.0)
        self.wait(0.5)
        self.play(FadeIn(first[0]), FadeIn(second[0]), run_time=0.8)
        self.until(33.6)
        result = text("No date returned", 37, weight="SEMIBOLD").move_to([0, -1.1, 0])
        note = text("The sentence describes the film.", 23, MUTED).move_to([0, -1.88, 0])
        self.play(FadeIn(result, UP * 0.07), FadeIn(note), run_time=1.3)
        self.until(39.4)
        self.play(FadeOut(VGroup(title, first, second, result, note)), run_time=0.6)

        # 40–51: a centered column groups the rest of the release.
        title = text("The full update", 43, weight="SEMIBOLD").move_to([0, 2.77, 0])
        features = [
            "Natural phrasing and short date formats",
            "Morning and evening clock times",
            "Dates before or after another date",
            "Shared dates, ranges and time bounds",
            'Monthly schedules and “same time” phrases',
            "Fewer false dates in ordinary text",
            "Two model layers with linked word roles",
            "New English tests and score limits",
        ]
        rows = VGroup()
        for index, feature in enumerate(features):
            y = 1.94 - index * 0.46
            label = text(feature, 25).move_to([0, y, 0])
            rows.add(label)
        self.play(FadeIn(title), run_time=0.6)
        self.play(LaggedStart(*[FadeIn(row, UP * 0.04) for row in rows],
                              lag_ratio=0.08), run_time=1.4)
        score = DATA["metrics"]["authoredEnglish"]
        metric = text(f"{score['before']}/{score['total']} → {score['after']}/{score['total']}"
                      " authored English tests", 23, weight="SEMIBOLD")
        metric.move_to([0, -2.25, 0])
        note = text("Known gap: some duration ranges still miss their end date.", 16, MUTED)
        note.move_to([0, -3.35, 0])
        self.play(FadeIn(metric), FadeIn(note), run_time=0.6)
        self.until(50.4)
        self.play(FadeOut(VGroup(title, rows, metric, note, brand, version)), run_time=0.6)

        source = Path("apps/website/src/components/Logo.astro").read_text()
        mark_path = Path("video/output/release-logo.png")
        subprocess.run(
            ["rsvg-convert", "--width", "1024", "--height", "1024", "-o", str(mark_path)],
            input=source.replace("currentColor", INK), text=True, check=True,
        )
        mark = ImageMobject(str(mark_path)).set_height(1.12)
        wordmark = text("gpu-time", 80, weight="SEMIBOLD")
        logo = Group(mark, wordmark).arrange(RIGHT, buff=0.28).move_to([0, 0.35, 0])
        version = text("v0.2.0", 25, MUTED).move_to([0, -0.6, 0])
        self.play(FadeIn(logo, UP * 0.05), FadeIn(version), run_time=0.8)
        self.until(53.5)
        self.play(FadeOut(Group(logo, version)), run_time=0.5)
