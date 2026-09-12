#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x video/.venv/bin/python ]; then
  uv venv video/.venv --python 3.13
fi
uv pip install --quiet --python video/.venv/bin/python -r video/requirements.txt
uv pip install --quiet --python video/.venv/bin/python -r video/voice-requirements.txt

npx tsx --import ./packages/core/scripts/register.mjs video/export-edge-cases.ts
mkdir -p video/output video/output/tts-models
video/.venv/bin/manimgl video/gpu_time_edge_cases.py GpuTimeEdgeCases -w --hd \
  --config_file video/custom_config.yml --video_dir video/output --file_name edge-cases-silent

for model_file in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ ! -s "video/output/tts-models/$model_file" ]; then
    curl -fLsS --retry 2 \
      "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/$model_file" \
      -o "video/output/tts-models/$model_file"
  fi
done
video/.venv/bin/python video/edge_cases_audio.py

video/.venv/bin/python - <<'PY'
import json
import subprocess

info = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries", "format=duration",
    "-show_entries", "stream=width,height,r_frame_rate", "-of", "json",
    "video/output/gpu-time-v0.2-release-logo.mp4",
]))
duration = float(info["format"]["duration"])
video = next(stream for stream in info["streams"] if "width" in stream)
assert 53.9 <= duration < 54.1, f"Unexpected duration: {duration}"
assert (video["width"], video["height"], video["r_frame_rate"]) == (1920, 1080, "60/1")
print("Edge-case film verified: 1920x1080, 60 fps, under one minute.")
PY
