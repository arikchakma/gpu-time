"""Speech first, continuous music, and subtle effects. No deep gating."""
from pathlib import Path
import json
import subprocess
import numpy as np
import soundfile as sf

root = Path("video/current/output")
rate = 48000

def loudness(path):
    log = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af",
        "loudnorm=I=-17:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, check=True).stderr
    return json.loads(log[log.rfind("{"):log.rfind("}")+1])

def gain(db):
    return 10**(db/20)

voice_path = root/"gpu-time-voiceover-master.wav"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i",
    str(root/"gpu-time-voiceover.wav"), "-af",
    "highpass=f=80,acompressor=threshold=0.10:ratio=3:attack=2:release=90:makeup=1,loudnorm=I=-17:TP=-3.5:LRA=7",
    "-ar", str(rate), "-c:a", "pcm_s24le", str(voice_path)], check=True)
music_path = root/"gpu-time-music-continuous.wav"
voice, sr = sf.read(voice_path)
music, msr = sf.read(music_path)
effects, esr = sf.read(root/"gpu-time-effects.wav")
assert sr == msr == esr == rate
assert len(music) == len(effects)
# Loudness analysis can flush a short tail; retain the film's exact length.
voice = np.pad(voice[:len(music)], (0, max(0, len(music)-len(voice))))
vm, mm = loudness(voice_path), loudness(music_path)
vg = min(-17-float(vm["input_i"]), -3.5-float(vm["input_tp"]))
mg = -25.5-float(mm["input_i"])
fg = -13-float(20*np.log10(np.max(np.abs(effects))))
voice = np.repeat(voice[:, None], 2, axis=1)/np.sqrt(2)*gain(vg)
music *= gain(mg)
effects *= gain(fg)
time = np.arange(len(voice))/rate
speech = np.zeros(len(voice))
timing = json.loads((root/"voiceover-timing.json").read_text())
for segment in timing["segments"]:
    start, end = segment["start"], segment["spoken_end"]
    a, b = max(0, round((start-.4)*rate)), min(len(time), round((end+1.0)*rate))
    attack = np.sin(np.pi/2*np.clip((time[a:b]-start+.4)/.55, 0, 1))**2
    release = np.sin(np.pi/2*np.clip((end+1.0-time[a:b])/1.0, 0, 1))**2
    speech[a:b] = np.maximum(speech[a:b], attack*release)
# At least 75% of the music's base amplitude remains under narration.
music *= (1-.25*speech)[:, None]
effects *= (1-.20*speech)[:, None]
mix = voice+music+effects
peak = float(np.max(np.abs(mix)))
master_gain = min(1, gain(-2.0)/peak)
mix *= master_gain
sf.write(root/"gpu-time-narrated-mix.wav", mix, rate, subtype="PCM_24")
destination = root/"gpu-time-launch-voiceover.mp4"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i",
    str(root/"silent.mp4"), "-i", str(root/"gpu-time-narrated-mix.wav"),
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k",
    "-ar", str(rate), "-shortest", "-movflags", "+faststart", str(destination)], check=True)
report = {"voice": "Kokoro af_heart (synthetic)", "voice_target_lufs": -17,
          "voice_master_measured_lufs": float(vm["input_i"]),
          "music_base_target_lufs": -25.5, "maximum_music_reduction_under_speech_db": float(20*np.log10(.75)),
          "effects_peak_target_dbfs": -13, "master_gain_db": float(20*np.log10(master_gain)),
          "sample_peak_dbfs": float(20*np.log10(np.max(np.abs(mix)))), "segments": timing["segments"]}
(root/"narrated-mix-report.json").write_text(json.dumps(report, indent=2))
print(json.dumps({"file": str(destination), "peak_dbfs": report["sample_peak_dbfs"],
                  "max_music_dip_db": report["maximum_music_reduction_under_speech_db"]}, indent=2))
