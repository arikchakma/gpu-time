"""Measure loudness first; mux with a fixed gain and untouched video packets."""
from pathlib import Path
import json
import subprocess
import sys

source = sys.argv[1] if len(sys.argv) > 1 else "video/output/gpu-time-launch.mp4"
score = "video/output/gpu-time-score.wav"
analysis = subprocess.run([
    "ffmpeg", "-hide_banner", "-i", score, "-af",
    "loudnorm=I=-18:TP=-1.5:LRA=8:print_format=json", "-f", "null", "-"
], capture_output=True, text=True, check=True).stderr
measurements = json.loads(analysis[analysis.rfind("{"):analysis.rfind("}")+1])
# Keep the background quiet: integrated-loudness boosting would undo the remix.
gain = min(-2.0, -1.5-float(measurements["input_tp"]))
destination = "video/output/gpu-time-launch-with-music.mp4"
subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", source, "-i", score,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", f"volume={gain:.4f}dB",
    "-ar", "48000", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", destination
], check=True)
Path("video/output/audio-mastering.json").write_text(json.dumps({
    "measurements": measurements, "applied_gain_db": gain,
    "method": "Attenuation only; preserve the foreground-effects balance. No loudness boosting, compression, time stretching, or video re-encoding."
}, indent=2))
print(json.dumps({"file": destination, "gain_db": gain}, indent=2))
