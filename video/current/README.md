# Current gpu-time neural-model film

A 91-second, 1920×1080 / 60 fps adaptation of the original explanatory animation.
See `STORYBOARD.md`. It follows words through the actual current model, then into
dates and recurrence rules. The original renderer and frozen data remain intact.

Run from the repository root:

```sh
bash video/current/render.sh
video/.venv/bin/python video/current/voiceover.py
video/.venv/bin/python video/current/music.py
video/.venv/bin/python video/current/mix.py
npm run prepare:video --prefix landing
```

Requires Bun, FFmpeg, Geist Mono, and the existing `video/.venv` ManimGL/Kokoro
environment. Stock synthetic Kokoro af_heart model files are reused from
`video/output/tts-models/`. Narration, music, and effects are newly rendered.
Speech segments must fit their scene windows; event effects follow the render's
motion timeline. The mixer measures speech levels, gently ducks a continuous
music bed, and limits the final peak without boosting the whole mix.

`data.json` contains actual embeddings, recurrent states, classification-head
activations, all logits, public outputs, and model/source hashes. The exporter
checks the diagnostic labels against the production tagger and independently
reconstructs the head to validate its logits. The current architecture has
24,761 parameters, 324 embedding rows, 32 state channels, 16 head gates,
64 head hidden values, 40 role-output slots (35 named, five reserved), and one
separate clause-boundary output. CPU f32 traces are shown. The same trained model
also runs on WebGPU; the animation is a schematic, not GPU profiling footage.

Final video: `output/gpu-time-launch-voiceover.mp4`. English captions use measured
speech endpoints. The source film is white; no inversion/color filter is applied.
