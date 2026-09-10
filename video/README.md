# Archived gpu-time launch film

These assets depict the retired 19,599-parameter parser, including its public AST.
They do not describe the current library in `src/` or the latest playground.
They are preserved for editing and reference, not as current launch claims.
Rendering uses the frozen `data.json` snapshot; the original exporter is retained
as historical source in `legacy/export-data.ts.txt`.

A 62-second, silent, 1920×1080 / 60 fps film made with [3b1b's ManimGL](https://github.com/3b1b/manim).
The supplied reference inspired the black canvas, monospace typography, thin connections, blue activation marks, and continuous data transformations. The story and animations are original to gpu-time.

## Render

Requires `uv`, FFmpeg, Python 3.13, the project's npm dependencies, and the Geist Mono font.
The render script installs the pinned ManimGL dependencies into an isolated environment under `video/.venv`.

```sh
bash video/render.sh
```

Final video: `video/output/gpu-time-launch.mp4`.
The Manim scene is `launch.py`; `custom_config.yml` controls resolution, frame rate, and background.
Do not pass `--fps` to ManimGL 1.7.2: that CLI option is parsed as a string. Set the integer frame rate in the YAML config.

## Story

| Time  | Scene                                                                    |
| ----- | ------------------------------------------------------------------------ |
| 00–05 | Type “every Monday from 8pm to 10pm”                                     |
| 05–10 | Separate tokens while preserving source offsets                          |
| 10–17 | Build word, character-pair, and neighboring-word features                |
| 17–24 | Show the 800 → 24 → 15 neural network and WebGPU execution               |
| 24–31 | Reveal all 15 actual logits for “Monday” and highlight the winning label |
| 31–36 | Apply predicted types to each original token                             |
| 36–43 | Assemble a typed recurring schedule with deterministic code              |
| 43–51 | Expand three Mondays across New York's daylight-saving change            |
| 51–56 | Reveal actual DTSTART, DTEND, and RRULE property fragments               |
| 56–62 | gpu-time title and local-inference features                              |

## Data and accuracy

The archived exporter produced `data.json` with actual token labels, sparse-feature values, hidden activations, raw logits, AST, occurrences, and recurrence properties from the legacy parser.
It reconstructed that model's dense reference equations and checked their winning labels against that runtime. `_provenance` identifies the legacy Git revision. The active renderer no longer imports the current parser to regenerate this old snapshot.
There are no fabricated model scores or speed claims.

The feature-column view samples nonzero features, and the network drawing samples connections. Both are labeled as simplified views.
The example uses an explicit reference of October 24, 2026 in `America/New_York`.
The three occurrences are October 26, November 2, and November 9, all at 20:00–22:00 local time.
Their UTC start times change from 00:00Z to 01:00Z on the following UTC dates.

The film is intentionally silent, matching the supplied reference's lack of an audio track.
The virtual environment, reference stills, and rendered output are ignored by Git. No parser or application code is changed.

## Motion revision

The revised scene keeps glyph shapes intact while moving words, then crossfades when a label changes meaning. Large token moves take 1.4–2 seconds. Network connections draw progressively, and score bars grow from the zero axis. Moving text stays above destination-box fills. Headings and captions fade out before their replacements appear.

Manim records animation intervals in `video/output/motion-timeline.json`.
For a normal-speed Chrome playback check, run:

```sh
node video/check-playback.mjs
```

This starts a temporary video-only server on an available port, checks decoding and dropped frames in the key motion sequences, and saves `video/output/review/playback.json`. It does not depend on the playground's URL or file layout. It complements visual frame-sequence inspection; a 60fps file alone does not establish smooth animation.

## Music version

`music.py` composes an original ambient score with soft electric-keyboard tones, wide pads, and rounded bass. There are no free-running percussion clicks or hi-hats. The music and effects use separate buses, with the music lowered briefly around visual cues. No sampled recordings or third-party music are used.

```sh
bash video/add-music.sh
```

Output: `video/output/gpu-time-launch-with-music.mp4`. The script copies the video stream unchanged and adds 48 kHz stereo AAC audio at 256 kbps. `mux-music.py` measures the completed mix and only attenuates it, keeping true peaks below -1.5 dBTP. It never boosts integrated loudness, which would raise the deliberately quiet background again. The original silent video remains available.

The current standalone mix keeps a continuous music bed, with only about 1.5 dB of movement around cues. The earlier deep-ducking preset has been removed. The music has less sub-bass and high-frequency content so it leaves more room for the effects.

Sound cues come from named events in the rendered `motion-timeline.json`, including the actual child timings of staggered reveals. Movement textures follow the same easing envelope as the visuals. Confirmation transients peak on the frame where the relevant animation completes; staggered reveal taps target each item's half-opacity frame. If animation timing changes, run `bash video/render.sh` before rebuilding the soundtrack.

The cue sheet is `video/output/sound-cues.json`. Separate stems are saved as `gpu-time-music-bed.wav` and `gpu-time-effects.wav`. Mastering measurements are saved in `audio-mastering.json`. Timing and levels can be checked programmatically; musical taste and perceived timbre still require a listening review.

## Narrated version

```sh
bash video/render-voiceover.sh
```

Output: `video/output/gpu-time-launch-voiceover.mp4`.
The stock synthetic English narrator is Kokoro's `af_heart` voice, generated locally with [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx). The Kokoro model is Apache-2.0 licensed; the runtime is MIT licensed. These models are video-production tools and are not included in the parser.

Edit `narration.json` to change the script and scene windows. The generator checks that every complete utterance fits its window, and exports `gpu-time-voiceover.srt` plus `voiceover-timing.json`. Voice speed stays at 0.92 unless a segment needs a small adjustment; excessively long text is rejected rather than rushed or cut off.

The narrated mix uses continuous music at a base target of -25.5 LUFS and a centered voice at -17 LUFS. Under speech, music changes gently by at most 2.5 dB, with a long release. It is never gated or repeatedly cut out for effects. Voice peaks are controlled before mixing, and sound effects remain below the narrator. Measurements are saved in `narrated-mix-report.json`.
