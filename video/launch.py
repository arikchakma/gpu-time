"""gpu-time launch film, rendered with 3b1b's ManimGL (not Manim Community)."""
from manimlib import *
from pathlib import Path
import json
import numpy as np

DATA = json.loads(Path(__file__).with_name("data.json").read_text())
INK = "#EEF1F5"
MUTED = "#929AA8"
FAINT = "#313944"
BLUE = "#639FFF"
TEAL = "#79D3CC"
VIOLET = "#B9A0F5"
BG = "#050607"
COLORS = {"repeat": VIOLET, "weekday": BLUE, "range": MUTED, "time": TEAL}


def txt(value, size=28, color=INK, **kwargs):
    return Text(str(value), font="Geist Mono", font_size=size, **kwargs).set_color(color)


def pill(value, color=INK, size=28, width=None):
    label = txt(value, size, color)
    box = RoundedRectangle(
        width=width or label.get_width() + 0.40,
        height=0.62,
        corner_radius=0.10,
        stroke_color=FAINT,
        stroke_width=1.3,
        fill_color=BG,
        fill_opacity=1,
    )
    return VGroup(box, label)


def line(a, b, color=FAINT, width=1.3):
    return Line(a, b, stroke_color=color, stroke_width=width)


class Smoke(Scene):
    def construct(self):
        self.play(FadeIn(txt("gpu-time", 64)), run_time=0.5)
        self.wait(0.5)


class Launch(Scene):
    def play(self, *animations, **kwargs):
        start = self.time
        cue = kwargs.pop("cue", None)
        result = super().play(*animations, **kwargs)
        record = {"start": start, "end": self.time,
                  "animations": [type(a).__name__ for a in animations]}
        if cue:
            record["cue"] = cue
            group = next((a for a in animations if isinstance(a, LaggedStart)), None)
            if group is not None and group.max_end_time:
                scale = (self.time - start) / group.max_end_time
                record["children"] = [{"start": start + a * scale, "end": start + b * scale}
                                      for _, a, b in group.anims_with_timings]
        self.motion_log.append(record)
        return result

    def title(self, value, step):
        title = txt(value, 32).move_to([0, 3.12, 0])
        index = txt(f"{step:02d} / 08", 16, MUTED).move_to([6.10, 3.65, 0])
        if hasattr(self, "heading"):
            self.play(FadeOut(self.heading), FadeOut(self.index), run_time=0.25)
            self.play(FadeIn(title, UP * 0.05), FadeIn(index), run_time=0.4)
        else:
            self.play(FadeIn(title), FadeIn(index), run_time=0.6)
        self.heading, self.index = title, index

    def caption(self, value):
        new = txt(value, 20, MUTED).move_to([0, -3.35, 0])
        if hasattr(self, "foot"):
            self.play(FadeOut(self.foot), run_time=0.2)
            self.play(FadeIn(new), run_time=0.3)
        else:
            self.play(FadeIn(new), run_time=0.35)
        self.foot = new

    def until(self, t):
        if self.time < t:
            self.wait(t - self.time)

    def construct(self):
        self.motion_log = []
        # 00–05: the phrase, typed rather than revealed as a slide.
        brand = txt("gpu-time", 17, MUTED).move_to([-5.95, 3.65, 0])
        self.add(brand)
        self.title("Start with a sentence.", 1)
        sentence = txt(DATA["text"], 43).move_to([0, 0.25, 0])
        intro_words = [sentence.get_part_by_text(t["text"]).copy() for t in DATA["model"]]
        self.play(LaggedStart(*[FadeIn(word, UP * 0.10) for word in intro_words], lag_ratio=0.18), run_time=2.2)
        self.remove(*intro_words)
        self.add(sentence)
        self.caption("A recurring window, written in plain English.")
        self.until(5)

        # 05–10: preserve identity and offsets through tokenization.
        self.title("Keep the words. Keep their positions.", 2)
        tokens = VGroup(*[pill(t["text"], size=28) for t in DATA["model"]])
        tokens.arrange(RIGHT, buff=0.18).move_to([0, 0.2, 0])
        words = [sentence.get_part_by_text(t["text"]).copy().set_z_index(10) for t in DATA["model"]]
        self.remove(sentence)
        self.add(*words)
        self.play(*[word.animate.set_width(p[1].get_width()).move_to(p[1])
                    for word, p in zip(words, tokens)],
                  *[FadeIn(p[0]) for p in tokens], run_time=1.4, cue="tokenize")
        self.remove(*words)
        self.add(tokens)
        spans = VGroup(*[
            txt(f"{t['start']}:{t['end']}", 17, MUTED).next_to(p, DOWN, buff=0.22)
            for t, p in zip(DATA["model"], tokens)
        ])
        self.play(LaggedStart(*[FadeIn(s, UP * 0.12) for s in spans], lag_ratio=0.13), run_time=0.9)
        self.caption("Tokenization runs on the CPU. Source offsets survive.")
        self.until(10)

        # 10–17: real sparse features, simplified visual sampling.
        self.title("Give each word its context.", 3)
        self.play(FadeOut(spans), tokens.animate.move_to([0, -1.85, 0]), run_time=1.4)
        columns = VGroup()
        for t, p in zip(DATA["model"], tokens):
            active = [(i, v) for i, v in enumerate(t["features"]) if v]
            values = [v for _, v in active[:12]]
            cells = VGroup(*[
                Rectangle(width=0.20, height=0.115, stroke_width=0,
                          fill_color=BLUE, fill_opacity=0.25 + min(v, 1) * 0.70)
                for v in values
            ]).arrange(UP, buff=0.075)
            cells.next_to(p, UP, buff=0.34)
            columns.add(cells)
        context = SurroundingRectangle(VGroup(*tokens[:3]), buff=0.12, stroke_color=BLUE, stroke_width=1.8)
        feature_text = txt("word + character pairs + neighboring words", 22, MUTED).move_to([0, 1.8, 0])
        dims = txt("800 features / token", 26, BLUE).move_to([0, 2.3, 0])
        self.play(ShowCreation(context), FadeIn(feature_text), FadeIn(dims), run_time=0.65)
        self.play(LaggedStart(*[FadeIn(c, UP * 0.20) for c in columns], lag_ratio=0.07), run_time=1.6, cue="features")
        self.play(context.animate.surround(VGroup(*tokens[2:5]), buff=0.12), run_time=1.35, cue="context_scan")
        self.caption("Only nonzero features are processed. Selected features shown.")
        self.until(17)

        # 17–24: the architecture is 800 → 24 → 15, with sampled connections.
        self.title("A small model. A parallel calculation.", 4)
        self.play(FadeOut(context), FadeOut(columns), FadeOut(feature_text), FadeOut(dims),
                  tokens.animate.scale(0.8).move_to([0, -2.65, 0]), run_time=1.2)
        monday = pill("Monday", BLUE, 30).move_to([-5.3, 0.1, 0])
        input_nodes = VGroup(*[
            Square(side_length=0.13, fill_color=BLUE, fill_opacity=0.55 + 0.04 * (i % 5), stroke_width=0)
            .move_to([-3.3, 1.55 - i * 0.28, 0]) for i in range(12)
        ])
        hidden_values = DATA["model"][1]["hidden"]
        hidden_nodes = VGroup(*[
            Dot([-0.5, 1.9 - i * 0.16, 0], radius=0.047).set_color(BLUE)
            .set_opacity(0.22 + 0.78 * min(v / max(hidden_values), 1))
            for i, v in enumerate(hidden_values)
        ])
        score_nodes = VGroup(*[
            Rectangle(width=0.35, height=0.10, fill_color=BLUE, fill_opacity=0.55, stroke_width=0)
            .move_to([2.5, 1.65 - i * 0.235, 0]) for i in range(15)
        ])
        links1 = VGroup(*[
            line(node.get_right(), hidden_nodes[(i * 2 + j * 7) % 24].get_center(), "#283D5B", 0.7)
            for i, node in enumerate(input_nodes) for j in range(3)
        ])
        links2 = VGroup(*[
            line(node.get_center(), score_nodes[(i + j * 5) % 15].get_left(), "#283D5B", 0.7)
            for i, node in enumerate(hidden_nodes) for j in range(2)
        ])
        headings = VGroup(
            txt("800 inputs", 21, MUTED).move_to([-3.3, 2.25, 0]),
            txt("24 hidden", 21, MUTED).move_to([-0.5, 2.5, 0]),
            txt("15 scores", 21, MUTED).move_to([2.5, 2.25, 0]),
        )
        engine = VGroup(txt("WebGPU", 24, BLUE), txt("two compute kernels", 18, MUTED)).arrange(DOWN, buff=0.16).move_to([5.0, 0.1, 0])
        word = tokens[1][1].copy().set_z_index(10)
        self.add(word)
        self.play(word.animate.set_width(monday[1].get_width()).move_to(monday[1]).set_color(BLUE),
                  FadeIn(monday[0]), FadeIn(headings),
                  LaggedStart(*[FadeIn(n) for n in input_nodes], lag_ratio=0.03), run_time=2.0, cue="network_focus")
        self.remove(word)
        self.add(monday)
        self.play(LaggedStart(*[ShowCreation(edge) for edge in links1], lag_ratio=0.012),
                  LaggedStart(*[FadeIn(n) for n in hidden_nodes], lag_ratio=0.025), run_time=1.0, cue="network_encode")
        self.play(LaggedStart(*[ShowCreation(edge) for edge in links2], lag_ratio=0.010),
                  LaggedStart(*[FadeIn(n) for n in score_nodes], lag_ratio=0.03), FadeIn(engine), run_time=1.0, cue="network_classify")
        self.play(LaggedStart(*[
            ShowPassingFlash(edge.copy().set_stroke(BLUE, 1.4), time_width=0.25, rate_func=linear)
            for edge in [*links1[::9], *links2[::12]]
        ], lag_ratio=0.055), run_time=0.9, cue="network_flow")
        self.caption("19,599 parameters. Same model on CPU. Connections simplified.")
        self.until(24)

        # 24–31: actual logits, a signed axis and a visibly winning score.
        self.title("The raw output is numbers.", 5)
        self.play(FadeOut(VGroup(input_nodes, hidden_nodes, links1, links2, headings, engine)),
                  monday.animate.move_to([-4.8, 0.4, 0]), run_time=1.0)
        values = DATA["model"][1]["logits"]
        zero_x = 2.8
        labels, bars, numbers = VGroup(), VGroup(), VGroup()
        for i, (name, value) in enumerate(zip(DATA["labels"], values)):
            y = 2.04 - i * 0.28
            color = BLUE if name == "weekday" else MUTED
            label = txt(name, 18, color).move_to([-0.9, y, 0], aligned_edge=RIGHT)
            length = abs(value) * 0.20
            bar = Rectangle(width=max(length, 0.02), height=0.105, stroke_width=0,
                            fill_color=BLUE if name == "weekday" else "#566171", fill_opacity=1)
            bar.move_to([zero_x + (length / 2 if value >= 0 else -length / 2), y, 0])
            number = txt(f"{value:+.3f}", 18, color).move_to([5.70, y, 0], aligned_edge=RIGHT)
            labels.add(label); bars.add(bar); numbers.add(number)
        axis = line([zero_x, -2.12, 0], [zero_x, 2.28, 0], FAINT, 1)
        zero = txt("0", 15, MUTED).move_to([zero_x, -2.26, 0])
        raw = VGroup(txt("15 raw scores", 25), txt("one per label", 20, MUTED)).arrange(DOWN, buff=0.2).move_to([-4.8, -0.7, 0])
        seeds = VGroup(*[bar.copy().stretch(0.01, 0, about_point=[zero_x, bar.get_y(), 0]) for bar in bars])
        self.play(*[Transform(node, seed) for node, seed in zip(score_nodes, seeds)],
                  FadeIn(labels), FadeIn(axis), FadeIn(zero), FadeIn(raw), run_time=1.15, cue="score_transfer")
        self.play(LaggedStart(*[Transform(node, bar) for node, bar in zip(score_nodes, bars)], lag_ratio=0.025),
                  FadeIn(numbers), run_time=1.45, cue="score_grow")
        self.remove(score_nodes)
        self.add(bars)
        winner = SurroundingRectangle(VGroup(labels[3], bars[3], numbers[3]), buff=0.085,
                                      stroke_color=BLUE, stroke_width=1.5)
        self.play(ShowCreation(winner), run_time=0.85, cue="score_winner")
        self.caption("Actual model logits for “Monday”. The highest score wins.")
        self.until(31)

        # 31–36: numbers become labels; tokens themselves stay exact.
        self.title("Scores become token labels.", 5)
        self.play(FadeOut(VGroup(labels, bars, numbers, axis, zero, raw, winner, monday)),
                  tokens.animate.scale(1.25).move_to([0, -0.15, 0]), run_time=1.55)
        token_labels = VGroup()
        for token, p in zip(DATA["model"], tokens):
            color = COLORS[token["label"]]
            label = txt(token["label"], 20, color).next_to(p, UP, buff=0.28)
            token_labels.add(label)
        self.play(LaggedStart(*[
            AnimationGroup(FadeIn(label, DOWN * 0.15), p[0].animate.set_stroke(COLORS[t["label"]], 1.6), p[1].animate.set_color(COLORS[t["label"]]))
            for label, p, t in zip(token_labels, tokens, DATA["model"])
        ], lag_ratio=0.13), run_time=1.35, cue="labels")
        self.caption("The model identifies roles. It does not calculate dates.")
        self.until(36)

        # 36–43: a deterministic compiler assembles a real schedule tree.
        self.title("Build a schedule with deterministic code.", 6)
        self.play(FadeOut(token_labels), tokens.animate.scale(0.75).move_to([0, 2.2, 0]), run_time=1.6)
        root = pill("recurring schedule", INK, 26).move_to([0, 0.95, 0])
        leaves = VGroup(
            pill("WEEKLY", VIOLET, 26, 2.65).move_to([-4.1, -0.65, 0]),
            pill("MO", BLUE, 26, 2.65).move_to([0, -0.65, 0]),
            pill("20:00–22:00", TEAL, 26, 3.1).move_to([4.1, -0.65, 0]),
        )
        names = VGroup(*[txt(name, 18, MUTED).next_to(node, DOWN, buff=0.18)
                         for name, node in zip(["frequency", "day", "time window"], leaves)])
        branches = VGroup(*[line(root.get_bottom(), n.get_top(), FAINT, 1.5) for n in leaves])
        zone = txt("America/New_York", 23, MUTED).move_to([0, -2.1, 0])
        flying = VGroup(*[tokens[i][1].copy() for i in [0, 1, 3, 5]]).set_z_index(10)
        self.add(flying)
        destinations = [leaves[0][1].get_center(), leaves[1][1].get_center(),
                        leaves[2][1].get_center() + LEFT * 0.6,
                        leaves[2][1].get_center() + RIGHT * 0.6]
        self.play(*[FadeIn(leaf[0]) for leaf in leaves],
                  *[word.animate.move_to(point) for word, point in zip(flying, destinations)],
                  run_time=1.65, cue="ast_move")
        self.play(FadeOut(flying), *[FadeIn(leaf[1]) for leaf in leaves], FadeIn(names), run_time=0.65, cue="ast_resolve")
        self.add(leaves)
        self.play(FadeIn(root), LaggedStart(*[ShowCreation(edge) for edge in branches], lag_ratio=0.15), run_time=0.85)
        self.play(FadeIn(zone), run_time=0.45)
        self.caption("Typed AST: recurrence, local time, timezone, and source text.")
        self.until(43)

        # 43–51: real occurrences straddling the daylight-saving transition.
        self.title("Same local time. Even when clocks change.", 7)
        self.play(FadeOut(VGroup(tokens, root, branches, leaves, names, zone)), run_time=0.9)
        column_titles = VGroup(
            txt("MONDAY", 18, MUTED).move_to([-4.2, 1.98, 0]),
            txt("LOCAL WINDOW", 18, MUTED).move_to([-0.4, 1.98, 0]),
            txt("UTC · NEXT DAY", 18, MUTED).move_to([4.0, 1.98, 0]),
        )
        rows = VGroup()
        for i, item in enumerate(DATA["expansion"]["occurrences"]):
            y = 1.1 - i * 1.17
            day = txt(item["start"][:10], 29, BLUE).move_to([-4.2, y, 0])
            local = txt("20:00 → 22:00", 30, TEAL).move_to([-0.4, y, 0])
            utc = txt(item["instant"][11:16] + "Z", 29, INK).move_to([4.0, y, 0])
            rule = line([-5.65, y - 0.46, 0], [5.65, y - 0.46, 0], FAINT, 1)
            rows.add(VGroup(day, local, utc, rule))
        zone = txt("America/New_York", 22, MUTED).move_to([0, -2.35, 0])
        self.play(FadeIn(column_titles), FadeIn(zone), run_time=0.4)
        self.play(LaggedStart(*[FadeIn(row, UP * 0.12) for row in rows], lag_ratio=0.32), run_time=2.4, cue="calendar_rows")
        outline = SurroundingRectangle(VGroup(rows[1][2], rows[2][2]), buff=0.22, stroke_color=BLUE, stroke_width=1.5)
        self.play(ShowCreation(outline), run_time=0.9, cue="dst_highlight")
        self.caption("Daylight saving ends November 1. The local schedule stays at 8pm.")
        self.until(51)

        # 51–56: real exported calendar properties, not a fabricated API.
        self.title("Ready for your calendar.", 8)
        self.play(FadeOut(VGroup(column_titles, rows, zone, outline)), run_time=0.85)
        properties = DATA["rules"][0]
        rule_lines = VGroup(
            txt(properties["dtstart"], 24, MUTED),
            txt(properties["dtend"], 24, MUTED),
            txt(properties["rrule"], 28, BLUE),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.34).move_to([0, 0.05, 0])
        if rule_lines.get_width() > 12.4:
            rule_lines.set_width(12.4)
        self.play(LaggedStart(*[FadeIn(t, UP * 0.08) for t in rule_lines], lag_ratio=0.22), run_time=1.6, cue="calendar_export")
        self.caption("Calendar property fragments, generated from the same schedule.")
        self.until(56)

        # 56–62: a quiet launch lockup, with accurate local-inference claims.
        self.play(FadeOut(VGroup(rule_lines, self.heading, self.index, self.foot, brand)), run_time=0.85)
        logo = txt("gpu-time", 84).move_to([0, 0.9, 0])
        underline = line([-0.6, 0.12, 0], [0.6, 0.12, 0], BLUE, 3)
        tagline = txt("Plain English. Precise schedules.", 30).move_to([0, -0.55, 0])
        facts = txt("Runs locally  ·  WebGPU + CPU  ·  19,599 parameters", 22, MUTED).move_to([0, -1.45, 0])
        status = txt("Experimental English time parser", 18, MUTED).move_to([0, -2.5, 0])
        self.play(FadeIn(logo, UP * 0.1), ShowCreation(underline), run_time=1.2, cue="logo")
        self.play(FadeIn(tagline), run_time=0.55)
        self.play(FadeIn(facts), FadeIn(status), run_time=0.55)
        self.until(61.4)
        self.play(FadeOut(VGroup(logo, underline, tagline, facts, status)), run_time=0.6, cue="fade_out")
        Path("video/output/motion-timeline.json").write_text(json.dumps(self.motion_log, indent=2))
