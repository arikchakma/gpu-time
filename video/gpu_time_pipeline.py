"""gpu-time launch film, rendered with 3b1b's ManimGL (not Manim Community)."""
from manimlib import *
from pathlib import Path
import json
import numpy as np

DATA = json.loads(Path(__file__).with_name("data.json").read_text())
INK = "#171717"
MUTED = "#737985"
FAINT = "#CFD5DF"
BLUE = "#2563EB"
TEAL = "#087F83"
VIOLET = "#7956B6"
BG = "#FFFFFF"
COLORS = {"RECUR": VIOLET, "WEEKDAY": BLUE, "RANGE_START": MUTED, "RANGE_END": MUTED, "HOUR": TEAL, "MERIDIEM": TEAL}


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


class GpuTimePipeline(Scene):
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
        if hasattr(self, "foot"):
            self.play(FadeOut(self.foot), run_time=.15)
            del self.foot
        title = txt(value, 26).move_to([0, 3.12, 0])
        index = txt(f"{step:02d} / 10", 16, MUTED).move_to([6.10, 3.65, 0])
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
        self.title("Start with a Sentence", 1)
        self.caption("A recurring window, written in plain English.")
        sentence = txt(DATA["text"], 43).move_to([0, .25, 0])
        intro_words = VGroup(*[
            sentence[
                sentence.substr_to_path_count(DATA["text"][:token["start"]]):
                sentence.substr_to_path_count(DATA["text"][:token["end"]])
            ].copy()
            for token in DATA["model"]
        ])
        assert all(len(word) for word in intro_words), "Missing opening token glyphs"
        self.play(LaggedStart(*[FadeIn(word, UP*.10) for word in intro_words],lag_ratio=.18),run_time=2.2)
        self.until(5)

        # 05–12: preserve identity and offsets through tokenization.
        self.title("Keep Each Token’s Position", 2)
        self.caption("Words, numbers and AM/PM split apart. Spaces retained internally.")
        tokens = VGroup(*[pill(t["text"], size=28) for t in DATA["model"]])
        tokens.arrange(RIGHT, buff=0.18).move_to([0, 0.2, 0])
        words = [word.copy().set_z_index(10) for word in intro_words]
        self.remove(intro_words)
        self.remove(*intro_words)
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
        self.until(12)

        # 12–22: actual learned embeddings, not the old sparse feature model.
        self.title("Learned Token Vectors", 3)
        self.caption("Each grid holds 32 learned values, summed from token-feature embeddings.")
        self.play(FadeOut(spans), tokens.animate.move_to([0,-2.1,0]),run_time=1.4)
        columns = VGroup()
        for t,p in zip(DATA["model"],tokens):
            values=t["embedded"]
            peak=max(abs(v) for v in values) or 1
            cells=VGroup(*[
                Square(side_length=.13,stroke_width=0,fill_color=BLUE if v>=0 else VIOLET,
                    fill_opacity=.18+.82*abs(v)/peak).move_to([(i%4)*.16,-(i//4)*.16,0])
                for i,v in enumerate(values)
            ])
            cells.move_to([p.get_x(),.15,0])
            columns.add(cells)
        self.wait(.65)
        self.play(LaggedStart(*[FadeIn(c,UP*.20) for c in columns],lag_ratio=.10),run_time=1.8,cue="features")
        focus=SurroundingRectangle(columns[1],buff=.13,stroke_color=BLUE,stroke_width=1.6)
        self.play(ShowCreation(focus),run_time=.8)
        self.until(22)

        # Local convolution and nearest-word mixing retain the same token vectors.
        self.title("Mix Nearby Context",4)
        self.caption("A five-position filter mixes nearby features. Spaces are hidden in this view.")
        self.play(FadeOut(focus),run_time=.5)
        context=SurroundingRectangle(VGroup(columns[0],columns[1],columns[2]),buff=.13,stroke_color=BLUE,stroke_width=1.5)
        self.play(ShowCreation(context),run_time=.8,cue="context_scan")
        encoded=VGroup()
        for t,col in zip(DATA["model"],columns):
            values=t["encoded"]; peak=max(abs(v) for v in values) or 1
            new=col.copy()
            for cell,v in zip(new,values): cell.set_fill(BLUE if v>=0 else VIOLET,opacity=.18+.82*abs(v)/peak)
            encoded.add(new)
        self.play(LaggedStart(*[Transform(col,new) for col,new in zip(columns,encoded)],lag_ratio=.12),run_time=2.0,cue="local_mix")
        self.play(context.animate.surround(VGroup(*columns[3:6]),buff=.13),run_time=1.5)
        self.until(30)

        # Bidirectional gated recurrence is the central difference from the old MLP.
        self.title("Context from Both Sides",5)
        self.caption("Each token’s 32 state values update as context arrives from either direction.")
        self.play(FadeOut(context),
            *[column.animate.move_to([column.get_x(),-.45,0]) for column in columns],
            run_time=1.4)
        forward=VGroup(*[Dot([col.get_x(),1.65,0],radius=.065).set_color(BLUE) for col in columns])
        backward=VGroup(*[Dot([col.get_x(),.95,0],radius=.065).set_color(VIOLET) for col in columns])
        arrows=VGroup(*[line(forward[i].get_center(),forward[i+1].get_center(),BLUE,1.5) for i in range(len(forward)-1)])
        back_arrows=VGroup(*[line(backward[i+1].get_center(),backward[i].get_center(),VIOLET,1.5) for i in range(len(backward)-1)])
        directions=VGroup(txt("forward →",18,BLUE).move_to([-5.2,1.65,0]),txt("← backward",18,VIOLET).move_to([-5.2,.95,0]))
        self.play(FadeIn(directions),FadeIn(forward),FadeIn(backward),run_time=.6)
        for stage,color,indices,rail,edges in [
            ("forward",BLUE,list(range(len(columns))),forward,arrows),
            ("backward",VIOLET,list(reversed(range(len(columns)))),backward,back_arrows),
        ]:
            updates=[]
            for i in indices:
                col=columns[i];values=DATA["model"][i][stage]
                peak=max(abs(v) for v in values) or 1
                target=col.copy()
                for cell,v in zip(target,values):cell.set_fill(color,opacity=.15+.85*abs(v)/peak)
                edge_index=i-1 if stage=="forward" else i
                pulse=Line(rail[i].get_center(),col.get_top()+UP*.12,stroke_color=color,stroke_width=2)
                change=[Transform(col,target),ShowPassingFlash(pulse,time_width=.5)]
                if 0<=edge_index<len(edges):change.insert(0,ShowCreation(edges[edge_index]))
                updates.append(AnimationGroup(*change))
            self.play(LaggedStart(*updates,lag_ratio=.35),run_time=2.4,cue=stage+"_scan")
        self.until(40)

        # Classification head: true dimensionality, sampled connections.
        self.title("From Context to Scores",6)
        self.caption("Token context + pooled sentence context. Actual activations; nodes / links sampled.")
        self.play(FadeOut(VGroup(columns,forward,backward,arrows,back_arrows,directions)),
            tokens.animate.scale(.8).move_to([0,-2.65,0]),run_time=1.2)
        monday=pill("Monday",BLUE,30).move_to([-5.55,0,0])
        t=DATA["model"][1]
        def nodes(values,x,count,height=3.3):
            selected=np.linspace(0,len(values)-1,count,dtype=int)
            peak=max(abs(v) for v in values) or 1
            return VGroup(*[Dot([x,height/2-i*height/(count-1),0],radius=.042).set_color(BLUE if values[k]>=0 else VIOLET).set_opacity(.2+.8*abs(values[k])/peak) for i,k in enumerate(selected)])
        input_nodes=nodes(t["combined"]+t["context"],-3.45,12)
        gate_nodes=nodes(t["headGate"],-1.25,16,2.4)
        hidden_nodes=nodes(t["headHidden"],1.1,24)
        score_nodes=nodes(t["logits"]+[t["boundaryLogit"]],3.45,15)
        layers=[input_nodes,gate_nodes,hidden_nodes,score_nodes]
        links=VGroup()
        # Head hidden takes combined/context directly as well as 16 gate outputs.
        for left,right in [(input_nodes,gate_nodes),(input_nodes,hidden_nodes),(gate_nodes,hidden_nodes),(hidden_nodes,score_nodes)]:
            links.add(VGroup(*[line(node.get_center(),right[(i*3+j*7)%len(right)].get_center(),FAINT,.65) for i,node in enumerate(left) for j in range(2)]))
        headings=VGroup(txt("32 + 32",18,MUTED).move_to([-3.45,2.2,0]),txt("16 gates",18,MUTED).move_to([-1.25,2.2,0]),txt("64 hidden",18,MUTED).move_to([1.1,2.2,0]),txt("40 + 1",18,MUTED).move_to([3.45,2.2,0]))
        engine=VGroup(txt("WebGPU",20,BLUE),txt("32 lanes",16,MUTED),txt("CPU too",16,MUTED)).arrange(DOWN,buff=.12).move_to([5.6,0,0])
        word=tokens[1][1].copy().set_z_index(10);self.add(word)
        self.play(word.animate.set_width(monday[1].get_width()).move_to(monday[1]).set_color(BLUE),FadeIn(monday[0]),FadeIn(headings),FadeIn(input_nodes),run_time=2.0,cue="network_focus")
        self.remove(word);self.add(monday)
        self.play(LaggedStart(*[ShowCreation(edge) for edge in links[0]],lag_ratio=.008),FadeIn(gate_nodes),run_time=.7)
        self.play(FadeIn(links[1]),FadeIn(links[2]),FadeIn(hidden_nodes),run_time=.7,cue="network_encode")
        self.play(LaggedStart(*[ShowCreation(edge) for edge in links[3]],lag_ratio=.008),FadeIn(score_nodes),FadeIn(engine),run_time=.8,cue="network_classify")
        self.play(LaggedStart(*[ShowPassingFlash(edge.copy().set_stroke(BLUE,1.4),time_width=.25,rate_func=linear) for group in links for edge in group[::12]],lag_ratio=.035),run_time=.9,cue="network_flow")
        self.until(48)

        # The largest ten scores are a readable slice of the full forty-slot output.
        self.title("Role Scores",7)
        self.caption("10 highest named-role scores shown. 5 reserved slots omitted; boundary is separate.")
        self.play(FadeOut(VGroup(input_nodes,gate_nodes,hidden_nodes,links,headings,engine)),monday.animate.move_to([-4.8,.4,0]),run_time=1.0)
        values=DATA["model"][1]["logits"]
        indices=sorted(range(DATA["architecture"]["namedRoles"]),key=lambda i:values[i],reverse=True)[:10]
        labels,bars,numbers=VGroup(),VGroup(),VGroup()
        zero_x=2.1
        scale=2.1/max(abs(values[i]) for i in indices)
        for rank,i in enumerate(indices):
            name=DATA["labels"][i];value=values[i];y=1.95-rank*.36
            color=BLUE if name=="WEEKDAY" else MUTED
            labels.add(txt(name,18,color).move_to([-.45,y,0],aligned_edge=RIGHT))
            length=abs(value)*scale
            bar=Rectangle(width=max(length,.02),height=.13,stroke_width=0,fill_color=color,fill_opacity=1)
            bar.move_to([zero_x+(length/2 if value>=0 else -length/2),y,0]);bars.add(bar)
            numbers.add(txt(f"{value:+.3f}",18,color).move_to([5.7,y,0],aligned_edge=RIGHT))
        axis=line([zero_x,-1.5,0],[zero_x,2.2,0],FAINT,1)
        zero=txt("0",15,MUTED).move_to([zero_x,-1.7,0])
        raw=VGroup(txt("40 role scores",23),txt("10 named roles shown",17,MUTED)).arrange(DOWN,buff=.2).move_to([-4.8,-.7,0])
        seeds=VGroup(*[bar.copy().stretch(.01,0,about_point=[zero_x,bar.get_y(),0]) for bar in bars])
        self.play(FadeOut(score_nodes),FadeIn(seeds),FadeIn(labels),FadeIn(axis),FadeIn(zero),FadeIn(raw),run_time=1.0,cue="score_transfer")
        self.play(LaggedStart(*[Transform(seed,bar) for seed,bar in zip(seeds,bars)],lag_ratio=.035),FadeIn(numbers),run_time=1.45,cue="score_grow")
        self.remove(seeds);self.add(bars)
        winner=SurroundingRectangle(VGroup(labels[0],bars[0],numbers[0]),buff=.085,stroke_color=BLUE,stroke_width=1.5)
        self.play(ShowCreation(winner),run_time=.85,cue="score_winner")
        boundary=txt(f"separate boundary score: {t['boundaryLogit']:+.3f} < {DATA['architecture']['boundaryThreshold']}  →  no new clause",18,MUTED).move_to([0,-2.08,0])
        self.play(FadeIn(boundary),run_time=.5)
        self.until(58)

        # 58–64: numbers become labels; tokens themselves stay exact.
        self.title("Give Each Token a Role", 7)
        self.caption("The model identifies roles. It does not calculate dates.")
        self.play(FadeOut(VGroup(labels, bars, numbers, axis, zero, raw, winner, monday, boundary)),
                  tokens.animate.scale(1.25).move_to([0, -0.15, 0]), run_time=1.55)
        token_labels = VGroup()
        for token, p in zip(DATA["model"], tokens):
            color = COLORS[token["label"]]
            label = txt(token["label"], 14, color).next_to(p, UP, buff=0.28)
            token_labels.add(label)
        self.play(LaggedStart(*[
            AnimationGroup(FadeIn(label, DOWN * 0.15), p[0].animate.set_stroke(COLORS[t["label"]], 1.6), p[1].animate.set_color(COLORS[t["label"]]))
            for label, p, t in zip(token_labels, tokens, DATA["model"])
        ], lag_ratio=0.13), run_time=1.35, cue="labels")
        self.until(64)

        # 64–72: visualize internal calendar normalization, not a public AST.
        self.title("Resolve the Schedule", 8)
        self.caption("Internal calendar normalization. The public API returns dates and rules directly.")
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
        zone = txt("caller: reference date + America/New_York", 21, MUTED).move_to([0, -2.1, 0])
        flying = VGroup(*[tokens[i][1].copy() for i in [0, 1, 3, 6]]).set_z_index(10)
        self.add(flying)
        destinations = [leaves[0][1].get_center(), leaves[1][1].get_center(),
                        leaves[2][1].get_center() + LEFT * 0.6,
                        leaves[2][1].get_center() + RIGHT * 0.6]
        self.play(*[FadeIn(leaf[0]) for leaf in leaves],
                  *[word.animate.move_to(point) for word, point in zip(flying, destinations)],
                  run_time=1.65, cue="ast_move")
        self.play(FadeOut(flying), run_time=0.25)
        self.play(*[FadeIn(leaf[1]) for leaf in leaves], FadeIn(names), run_time=0.4, cue="ast_resolve")
        self.add(leaves)
        self.play(FadeIn(root), LaggedStart(*[ShowCreation(edge) for edge in branches], lag_ratio=0.15), run_time=0.85)
        self.play(FadeIn(zone), run_time=0.45)
        self.until(72)

        # 72–80: real occurrences straddling the daylight-saving transition.
        self.title("Keep the Local Time", 9)
        self.caption("Daylight saving ends November 1. The local schedule stays at 8pm.")
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
        self.until(80)

        # 80–85: real exported calendar properties, not a fabricated API.
        self.title("Return Dates and Rules", 10)
        self.caption("Calendar property fragments, generated from the same schedule.")
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
        self.until(85)

        # 85–91: a quiet launch lockup, with accurate local-inference claims.
        self.play(FadeOut(VGroup(rule_lines, self.heading, self.index, self.foot, brand)), run_time=0.85)
        logo = txt("gpu-time", 84).move_to([0, 0.9, 0])
        underline = line([-0.6, 0.12, 0], [0.6, 0.12, 0], BLUE, 3)
        tagline = txt("Plain English. Precise Schedules.", 30).move_to([0, -0.55, 0])
        facts = txt("Runs locally  ·  WebGPU + CPU  ·  24,761 parameters", 22, MUTED).move_to([0, -1.45, 0])
        status = txt("Experimental English time parser", 18, MUTED).move_to([0, -2.5, 0])
        self.play(FadeIn(logo, UP * 0.1), ShowCreation(underline), run_time=1.2, cue="logo")
        self.play(FadeIn(tagline), run_time=0.55)
        self.play(FadeIn(facts), FadeIn(status), run_time=0.55)
        self.until(90.4)
        self.play(FadeOut(VGroup(logo, underline, tagline, facts, status)), run_time=0.6, cue="fade_out")
        Path("video/output/motion-timeline.json").write_text(json.dumps(self.motion_log, indent=2))
