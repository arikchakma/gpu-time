"""Generate the edge-case film narration and score with the original voice."""
from pathlib import Path
import json
import subprocess
import wave
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import butter, resample_poly, sosfilt


root = Path("video/output")
segments = json.loads(Path("video/edge-cases-narration.json").read_text())
duration = 54.0
rate = 48000
voice = np.zeros(round(duration * rate), dtype=np.float64)
kokoro = Kokoro(root / "tts-models/kokoro-v1.0.onnx", root / "tts-models/voices-v1.0.bin")
manifest = []
(root / "edge-cases-narration").mkdir(exist_ok=True)

for index, segment in enumerate(segments):
    speed = 0.88
    budget = segment["end"] - segment["start"] - 0.12
    samples, sample_rate = kokoro.create(
        segment["text"], voice="af_heart", speed=speed, lang="en-us",
        sentence_pause=0.35, clause_pause=0.12,
    )
    length = len(samples) / sample_rate
    if length > budget:
        raise ValueError(f"Shorten narration segment {index + 1}: {length:.2f}s exceeds {budget:.2f}s")
    active = np.abs(samples) > 0.012
    rms = np.sqrt(np.mean(samples[active] ** 2)) if active.any() else 0
    if not rms:
        raise ValueError("Silent TTS output")
    samples *= np.clip(0.12 / rms, 0.55, 1.6)
    sf.write(root / f"edge-cases-narration/{index + 1:02d}.wav", samples, sample_rate)
    samples = resample_poly(samples, 2, 1)
    start = round(segment["start"] * rate)
    stop = start + len(samples)
    if stop > len(voice):
        raise ValueError("Narration exceeds the movie")
    voice[start:stop] += samples
    manifest.append({**segment, "spoken_end": stop / rate, "duration": length, "speed": speed})

voice_path = root / "gpu-time-edge-cases-voiceover.wav"
sf.write(voice_path, voice, rate, subtype="PCM_24")


def stamp(value):
    milliseconds = round(value * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


(root / "gpu-time-edge-cases.srt").write_text("\n\n".join(
    f"{index + 1}\n{stamp(item['start'])} --> {stamp(item['spoken_end'])}\n{item['text']}"
    for index, item in enumerate(manifest)
) + "\n")

# Reuse the original score's warm chord palette, rebuilt to the new duration.
size = len(voice)
bed = np.zeros((size, 2), dtype=np.float64)
chords = [([50, 54, 57, 61, 64], 38), ([47, 50, 54, 57, 61], 35),
          ([43, 47, 50, 54, 57], 31), ([45, 49, 52, 57, 59], 33)]


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def envelope(time, attack, release):
    return np.sin(np.pi / 2 * np.clip(time / attack, 0, 1)) ** 2 * np.sin(
        np.pi / 2 * np.clip((time[-1] - time) / release, 0, 1)
    ) ** 2


def place(signal, start, level=1, pan=0):
    offset = round(start * rate)
    skip = max(0, -offset)
    offset = max(0, offset)
    count = min(len(signal) - skip, size - offset)
    if count <= 0:
        return
    signal = signal[skip:skip + count]
    angle = (pan + 1) * np.pi / 4
    bed[offset:offset + count, 0] += signal * level * np.cos(angle)
    bed[offset:offset + count, 1] += signal * level * np.sin(angle)


for block in range(int(np.ceil(duration / 5))):
    start = block * 5
    notes, bass = chords[block % len(chords)] if start < duration - 7 else chords[0]
    length = min(7.2, duration - start + 0.3)
    time = np.arange(round(length * rate)) / rate
    pad = np.zeros_like(time)
    for note in notes:
        pad += (np.sin(2 * np.pi * hz(note) * time) + 0.1 * np.sin(4 * np.pi * hz(note) * time)) / len(notes)
    place(pad * envelope(time, 1.45, 2.0), start - 0.3, 0.055)
    bass_time = np.arange(round(min(3.5, length) * rate)) / rate
    bass_tone = np.sin(2 * np.pi * hz(bass) * bass_time) * envelope(bass_time, 0.16, 1.2)
    place(bass_tone, start + 0.05, 0.025)

bed = sosfilt(butter(2, 90, btype="highpass", fs=rate, output="sos"), bed, axis=0)
bed = sosfilt(butter(2, 3200, fs=rate, output="sos"), bed, axis=0)
time = np.arange(size) / rate
fade = np.sin(np.pi / 2 * np.clip(time / 1.2, 0, 1)) ** 2 * np.sin(
    np.pi / 2 * np.clip((duration - time) / 2.0, 0, 1)
) ** 2
bed *= fade[:, None]

# Keep speech in front while preserving the original film's gentle bed.
speech = np.zeros(size)
for segment in manifest:
    start, end = segment["start"], segment["spoken_end"]
    a, b = max(0, round((start - 0.35) * rate)), min(size, round((end + 0.8) * rate))
    speech[a:b] = 1
bed *= (1 - 0.28 * speech)[:, None]
voice_stereo = np.repeat(voice[:, None], 2, axis=1) / np.sqrt(2)
mix = voice_stereo + bed
peak = max(float(np.max(np.abs(mix))), 1e-9)
mix *= min(10 ** (4 / 20), 10 ** (-1 / 20) / peak)
mix_path = root / "gpu-time-edge-cases-mix.wav"
sf.write(mix_path, mix, rate, subtype="PCM_24")

destination = root / "gpu-time-v0.2-release-logo.mp4"
subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-i", str(root / "edge-cases-silent.mp4"), "-i", str(mix_path),
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
    "-b:a", "256k", "-ar", str(rate), "-shortest", "-movflags", "+faststart",
    str(destination),
], check=True)

(root / "edge-cases-audio-report.json").write_text(json.dumps({
    "voice": "Kokoro af_heart (synthetic)",
    "duration": duration,
    "sampleRate": rate,
    "segments": manifest,
    "peakDbfs": float(20 * np.log10(np.max(np.abs(mix)))),
}, indent=2))
print(json.dumps({"file": str(destination), "duration": duration, "voice": "af_heart"}, indent=2))
