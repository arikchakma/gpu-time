"""Generate a stock synthetic narrator locally with Kokoro, aligned to the film."""
from pathlib import Path
import json
import subprocess
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from kokoro_onnx import Kokoro

root = Path("video/output")
segments = json.loads(Path("video/narration.json").read_text())
duration = float(json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json",
    str(root / "gpu-time-launch.mp4")
]))["format"]["duration"])
rate = 48000
voice = np.zeros(round(duration*rate), dtype=np.float64)
kokoro = Kokoro(str(root/"tts-models/kokoro-v1.0.onnx"), str(root/"tts-models/voices-v1.0.bin"))
manifest = []
(root/"narration").mkdir(exist_ok=True)
for i, segment in enumerate(segments):
    speed = 0.92
    budget = segment["end"]-segment["start"]-.12
    for attempt in range(3):
        samples, sr = kokoro.create(segment["text"], voice="af_heart", speed=speed,
                                    lang="en-us", sentence_pause=.20, clause_pause=.08)
        length = len(samples)/sr
        if length <= budget:
            break
        speed *= length/budget*1.01
        if speed > 1.12:
            raise ValueError(f"Shorten narration segment {i+1}; it would need rushed speech")
    else:
        raise ValueError(f"Narration segment {i+1} does not fit")
    # Match section levels without altering the speaker's internal phrasing.
    active = np.abs(samples) > .012
    rms = np.sqrt(np.mean(samples[active]**2)) if active.any() else 0
    if not rms:
        raise ValueError("Silent TTS output")
    samples = samples * np.clip(.12/rms, .55, 1.6)
    sf.write(root/f"narration/{i+1:02d}.wav", samples, sr)
    samples = resample_poly(samples, 2, 1)
    start = round(segment["start"]*rate)
    stop = start+len(samples)
    if stop > len(voice):
        raise ValueError("Narration exceeds the movie")
    voice[start:stop] += samples
    item = {**segment, "spoken_end": stop/rate, "duration": length, "speed": speed}
    manifest.append(item)
    print(json.dumps({"segment": i+1, "start": segment["start"], "spoken_end": stop/rate, "speed": speed}), flush=True)
sf.write(root/"gpu-time-voiceover.wav", voice, rate, subtype="PCM_24")
(root/"voiceover-timing.json").write_text(json.dumps({"engine": "Kokoro v1.0", "voice": "af_heart",
    "synthetic": True, "sample_rate": rate, "segments": manifest}, indent=2))

def stamp(value):
    ms = round(value*1000)
    h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"
(root/"gpu-time-voiceover.srt").write_text("\n\n".join(
    f"{i+1}\n{stamp(s['start'])} --> {stamp(s['spoken_end'])}\n{s['text']}" for i,s in enumerate(manifest)
)+"\n")
