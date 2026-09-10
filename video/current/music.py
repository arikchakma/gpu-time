"""Original soft electronic score and event-synchronized sound design."""
from pathlib import Path
import json
import subprocess
import sys
import wave
import numpy as np
from scipy.signal import butter, sosfilt

RATE, FPS = 48000, 60
SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "video/current/output/silent.mp4")
duration = float(json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(SOURCE)
]))["format"]["duration"])
size = round(duration * RATE)
bed = np.zeros((size, 2), dtype=np.float64)
fx = np.zeros_like(bed)
rng = np.random.default_rng(20260911)
timeline = json.loads(Path("video/current/output/motion-timeline.json").read_text())
events = {item["cue"]: item for item in timeline if item.get("cue")}
required = {"tokenize", "features", "context_scan", "network_focus", "network_encode",
            "network_classify", "network_flow", "score_transfer", "score_grow", "score_winner",
            "labels", "ast_move", "ast_resolve", "calendar_rows", "dst_highlight", "calendar_export", "logo"}
if not required.issubset(events):
    raise SystemExit("Render the film with named cues first: bash video/render.sh")
if abs(timeline[-1]["end"] - duration) > 1/FPS:
    raise SystemExit("The motion timeline does not match this video's duration")
chords = [([50, 54, 57, 61, 64], 38), ([47, 50, 54, 57, 61], 35),
          ([43, 47, 50, 54, 57], 31), ([45, 49, 52, 57, 59], 33)]
cues = []


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def env(t, attack, release):
    return np.sin(np.pi/2 * np.clip(t/attack, 0, 1))**2 * np.sin(np.pi/2 * np.clip((t[-1]-t)/release, 0, 1))**2


def chord_at(time):
    return chords[int(max(0, time)//5) % 4] if time < duration-7 else chords[0]


def place(bus, signal, start, level=1, pan=0):
    offset = round(start * RATE)
    skip = max(0, -offset)
    offset = max(0, offset)
    n = min(len(signal)-skip, size-offset)
    if n <= 0:
        return
    signal = signal[skip:skip+n]
    if signal.ndim == 1:
        angle = (pan+1)*np.pi/4
        bus[offset:offset+n, 0] += signal*level*np.cos(angle)
        bus[offset:offset+n, 1] += signal*level*np.sin(angle)
    else:
        bus[offset:offset+n] += signal*level


def keys(note, length=2.8):
    t = np.arange(round(length*RATE))/RATE
    f = hz(note)
    phase = 2*np.pi*f*t + 0.28*np.exp(-t*5)*np.sin(2*np.pi*2*f*t)
    signal = (np.sin(phase)*np.exp(-t*1.6) + 0.13*np.sin(2*phase)*np.exp(-t*3.5))
    return signal*env(t, 0.035, 0.65)


# Warm, continuous harmony with slower felt-key phrases; no unrelated clicks or hats.
for block in range(int(np.ceil(duration/5))):
    start = block*5
    notes, bass = chord_at(start)
    length = min(7.2, duration-start+0.3)
    t = np.arange(round(length*RATE))/RATE
    pad = np.zeros((len(t), 2))
    for j, note in enumerate(notes):
        for channel, cents in enumerate([-2.0, 2.0]):
            phase = 2*np.pi*hz(note)*2**(cents/1200)*t+j*0.8
            pad[:, channel] += (np.sin(phase)+0.10*np.sin(2*phase))/len(notes)
    pad *= env(t, 1.45, 2.0)[:, None]
    place(bed, pad, start-0.30, 0.15 if start < duration-19 else 0.17)
    for i, offset in enumerate([0.75, 2.0, 3.25]):
        if start+offset > duration-7:
            break
        note = notes[[2, 4, 1][i]]+12
        signal = keys(note)
        pan = [-0.3, 0.3, -0.1][i]
        place(bed, signal, start+offset, 0.048, pan)
        place(bed, signal, start+offset+0.47, 0.009, -pan)
    bt = np.arange(round(3.5*RATE))/RATE
    tone = np.sin(2*np.pi*hz(bass)*bt)*env(bt, 0.16, 1.2)
    place(bed, tone, start+0.05, 0.060)


# All transient effects peak at a named visual event, quantized to its video frame.
def point(name, time, kind="tap", level=0.055, pan=0, note=None):
    target = round(time*FPS)/FPS
    notes, _ = chord_at(target)
    note = note if note is not None else notes[2]+12
    length = 0.13 if kind == "tap" else 0.85 if kind == "confirm" else 2.1
    t = np.arange(round(length*RATE))/RATE
    if kind == "tap":
        noise = sosfilt(butter(2, [450, 2500], btype="bandpass", fs=RATE, output="sos"), rng.normal(size=len(t)))
        signal = (0.70*np.sin(2*np.pi*hz(note)*t)*np.exp(-t*42)+0.20*noise*np.exp(-t*65))*env(t, 0.007, 0.05)
    else:
        pitches = [note, note+7] if kind == "confirm" else [62, 66, 69, 73]
        signal = np.zeros_like(t)
        for p in pitches:
            f = hz(p)
            signal += (np.sin(2*np.pi*f*t)+0.12*np.sin(4*np.pi*f*t))*np.exp(-t*(4.0 if kind == "confirm" else 1.9))/len(pitches)
        signal *= env(t, 0.014 if kind == "confirm" else 0.035, 0.25 if kind == "confirm" else 0.7)
    signal = sosfilt(butter(2, 5200, fs=RATE, output="sos"), signal)
    signal /= max(float(np.max(np.abs(signal))), 1e-9)
    peak_sample = int(np.argmax(np.abs(signal)))
    offset = round(target*RATE)-peak_sample
    place(fx, signal, offset/RATE, level, pan)
    # Only a faint tail follows the direct, frame-aligned transient.
    if kind != "tap":
        place(fx, signal, offset/RATE+0.115, level*0.10, -pan)
    cues.append({"name": name, "kind": kind, "visual_time": time,
                 "visual_frame": round(time*FPS), "audio_peak_time": (offset+peak_sample)/RATE,
                 "frame_alignment_error_ms": ((offset+peak_sample)/RATE-time)*1000})


def motion(name, level=0.012, pan=0, tonal=False):
    event = events[name]
    start, end = event["start"], event["end"]
    t = np.arange(round((end-start)*RATE))/RATE
    u = np.linspace(0, 1, len(t))
    # This is the velocity envelope of the scene's quintic easing curve.
    velocity = 16*u*u*(1-u)*(1-u)
    if tonal:
        f = hz(chord_at((start+end)/2)[0][2]+12)
        phase = 2*np.pi*(f*0.5*t + (f*0.5)/(2*(end-start))*t*t)
        signal = np.sin(phase)*velocity
    else:
        signal = sosfilt(butter(2, [650, 2400], btype="bandpass", fs=RATE, output="sos"), rng.normal(size=len(t)))*velocity
    signal /= max(float(np.max(np.abs(signal))), 1e-9)
    place(fx, signal, start, level*1.5, pan)
    cues.append({"name": name, "kind": "motion", "start": start, "end": end,
                 "envelope_peak_time": (start+end)/2})


def reveals(name, level=0.033):
    event = events[name]
    children = event.get("children")
    if not children:
        raise ValueError(f"Missing render-derived child timings: {name}")
    for i, child in enumerate(children):
        # FadeIn's symmetric easing crosses half opacity at the interval midpoint.
        time = (child["start"]+child["end"])/2
        point(f"{name}.{i+1}", time, level=level, pan=-0.35+0.70*i/max(1, len(children)-1),
              note=chord_at(time)[0][i % 5]+12)


motion("tokenize", 0.010)
point("tokens settled", events["tokenize"]["end"], level=0.042)
reveals("features", 0.018)
motion("context_scan", 0.008, 0.15)
motion("local_mix", 0.008)
motion("forward_scan", 0.010, -0.2, tonal=True)
motion("backward_scan", 0.010, 0.2, tonal=True)
motion("network_focus", 0.011, -0.2)
point("model input arrived", events["network_focus"]["end"], level=0.032, pan=-0.3)
motion("network_encode", 0.014, -0.1, tonal=True)
motion("network_classify", 0.014, 0.2, tonal=True)
motion("network_flow", 0.008, tonal=True)
motion("score_transfer", 0.008)
motion("score_grow", 0.012, tonal=True)
point("winning label highlighted", events["score_winner"]["end"], "confirm", 0.075, 0.1)
reveals("labels", 0.025)
motion("ast_move", 0.012)
point("schedule fields resolved", events["ast_resolve"]["end"], "confirm", 0.058)
reveals("calendar_rows", 0.047)
point("daylight-saving result highlighted", events["dst_highlight"]["end"], "confirm", 0.053, 0.2)
reveals("calendar_export", 0.027)
point("calendar rule ready", events["calendar_export"]["end"], "confirm", 0.048)
motion("logo", 0.011)
point("logo settled", events["logo"]["end"], "resolve", 0.090)

# Keep the music behind the effects; reverb is confined to the music bus.
dry = bed.copy()
for delay, gain in [(0.047, .09), (.083, .07), (.139, .045), (.229, .025)]:
    n = round(delay*RATE)
    bed[n:] += dry[:-n, ::-1]*gain
bed = sosfilt(butter(2, 90, btype="highpass", fs=RATE, output="sos"), bed, axis=0)
bed = sosfilt(butter(2, 3200, fs=RATE, output="sos"), bed, axis=0)
continuous_bed = bed.copy()
time = np.arange(size)/RATE
duck = np.ones(size)
for cue in cues:
    if "audio_peak_time" in cue:
        center = cue["audio_peak_time"]
        a, b = max(0, round((center-.5)*RATE)), min(size, round((center+.7)*RATE))
        attenuation = 1-0.80*np.exp(-((time[a:b]-center)/0.25)**2)
        duck[a:b] = np.minimum(duck[a:b], attenuation)
    else:
        start, end = cue["start"], cue["end"]
        a, b = max(0, round((start-.15)*RATE)), min(size, round((end+.35)*RATE))
        attack = np.sin(np.pi/2*np.clip((time[a:b]-start+.15)/.25, 0, 1))**2
        release = np.sin(np.pi/2*np.clip((end+.35-time[a:b])/.35, 0, 1))**2
        duck[a:b] = np.minimum(duck[a:b], 1-0.80*attack*release)
# Gentle movement in level, never a disappearing background.
bed *= ((0.8+0.2*duck)*0.50)[:, None]
fade = np.sin(np.pi/2*np.clip(time/1.2, 0, 1))**2 * np.sin(np.pi/2*np.clip((duration-time)/2.0, 0, 1))**2
bed *= fade[:, None]
continuous_bed *= fade[:, None]
fx *= fade[:, None]*2.0
mix = bed+fx
# One fixed gain preserves synchronization and the intended music/effects balance.
gain = min(3.0, 0.78/max(float(np.max(np.abs(mix))), 1e-9))
for name, data in [("gpu-time-music-bed.wav", bed), ("gpu-time-music-continuous.wav", continuous_bed),
                   ("gpu-time-effects.wav", fx), ("gpu-time-score.wav", mix)]:
    with wave.open("video/current/output/"+name, "wb") as output:
        output.setnchannels(2); output.setsampwidth(2); output.setframerate(RATE)
        output.writeframes((np.clip(data*gain, -1, 1)*32767).astype("<i2").tobytes())
report = {"source": str(SOURCE), "duration": duration, "fps": FPS, "sample_rate": RATE,
          "balance": {"music_gain_db": float(20*np.log10(.50)), "effects_gain": 2.0,
                      "maximum_music_duck_db": float(20*np.log10(.84))},
          "cues": cues, "music_peak_dbfs": float(20*np.log10(np.max(np.abs(bed*gain)))),
          "effects_peak_dbfs": float(20*np.log10(np.max(np.abs(fx*gain)))),
          "mix_peak_dbfs": float(20*np.log10(np.max(np.abs(mix*gain))))}
Path("video/current/output/sound-cues.json").write_text(json.dumps(report, indent=2))
print(json.dumps({"duration": duration, "cues": len(cues), "mix_peak_dbfs": report["mix_peak_dbfs"],
                  "max_point_alignment_error_ms": max(abs(c["frame_alignment_error_ms"]) for c in cues if "frame_alignment_error_ms" in c)}, indent=2))
