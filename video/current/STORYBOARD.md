# Neural-model walkthrough

This is an adaptation of the original `../launch.py` film, retaining its continuous
word-to-token-to-vector-to-network-to-score transformations. White background,
dark Geist Mono type, blue/teal/violet accents. Duration: 91 seconds, allowing the
current model's additional stages to be explained at the original unhurried pace.

| Seconds | Animation | Current implementation |
| --- | --- | --- |
| 0–5 | Sentence appears word by word | Same weekly example as the original film |
| 5–12 | Original glyphs move into token boxes; source offsets appear | Numbers and meridiems split; whitespace retained internally |
| 12–22 | 32-value embedding grids rise from tokens | Actual summed vectors from the 324-row learned embedding table |
| 22–30 | Context window travels; vector colors change | Five-position depthwise convolution and nearest non-space neighbor mixing |
| 30–40 | Context passes left and right; each state grid updates as the signal arrives | Actual gated forward/backward states, 32 channels |
| 40–48 | Monday moves into the network; connections draw and carry pulses | Combined token state + gated pooled context, 16 head gates, 64 hidden values, 40 role scores + boundary output |
| 48–58 | Scores grow from zero; WEEKDAY wins | Ten highest named-role logits for Monday; five reserved slots omitted from chart; boundary score shown separately |
| 58–64 | Roles land on the original tokens | Actual RECUR, WEEKDAY, RANGE_START, HOUR, MERIDIEM, RANGE_END predictions |
| 64–72 | Words move into frequency/day/window fields | Internal calendar normalization; caller supplies reference/timezone; no public AST |
| 72–80 | Three dates appear; changed UTC times highlighted | Real public occurrences across New York DST |
| 80–85 | Calendar properties appear | Real DTSTART, DTEND, RRULE returned by the current API |
| 85–91 | Original style closing lockup | 24,761 parameters; local CPU/WebGPU; experimental status |

`export-data.ts` uses the production CPU diagnostic trace, verifies every token
label against the tagger, and independently reconstructs the head to verify all
role logits. Full values and source/checkpoint hashes are stored in `data.json`.
All 32 embedding channels are shown as a four-by-eight grid. Each scene has one short title; formulas and secondary headings do not compete with the diagrams. Other node counts and connections are
sampled and labeled as such. No synthetic scores, accuracy, or speed claims.

Narration is generated afresh, with the original stock synthetic Kokoro af_heart
voice. The original music and effect synthesis is adapted to this duration and
new render-derived event timings, including forward/backward scans.
