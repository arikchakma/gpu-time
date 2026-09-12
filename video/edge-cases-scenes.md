# v0.2.0 release update

The film lasts 54 seconds. Four features receive ten seconds each.
A centered vertical list covers the remaining changes before the closing logo.

The website provides the typography and highlight colors. Headings use SF Pro
Display Semibold. Sentences use SF Pro Text with normal spacing. Dates use
`#cfe3fd`, times use `#fde8b4`, and lengths of time use `#cfefd8`.
The text remains dark over these backgrounds.

The closing screen uses the SVG from `apps/website/src/components/Logo.astro`
beside the product name. `rsvg-convert` renders it for the video without changing
the source SVG.

| Time          | Feature                   | Example                                                |
| ------------- | ------------------------- | ------------------------------------------------------ |
| 0–10 seconds  | More natural English      | Tomorrow morning at 8, unlock the office.              |
| 10–20 seconds | More date formats         | The filing date is 07-JAN-2027.                        |
| 20–30 seconds | Date ranges stay together | The retreat runs June 8-10, 2027.                      |
| 30–40 seconds | Fewer false matches       | The film is two hours and ten minutes long.            |
| 40–51 seconds | The full update           | Eight groups of changes appear in one centered column. |
| 51–54 seconds | The release name          | gpu-time v0.2.0                                        |

The first three examples come from authored English cases 049, 041, and 045.
The film-length example is non-time case 140. The exporter compares the saved
results with the current parser before each render.

Each result stays visible for about four seconds after its entrance.
The complete feature list stays visible for eight seconds.
The film sentence uses two balanced lines: “The film is two hours” and
“and ten minutes long.” No word appears alone on a line.

Kokoro uses the original synthetic voice, `af_heart`, at a fixed speed of 0.88.
The generator refuses speech that exceeds its time slot. It never speeds up a
line to fit.

Run `bash video/render-edge-cases.sh` to rebuild the film.
The output is `video/output/gpu-time-v0.2-release-logo.mp4`.
The script also writes captions and a report of the speech timings.
