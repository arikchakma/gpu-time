#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f video/output/silent.mp4 ]; then
  bash video/render.sh
fi
uv pip install --quiet --python video/.venv/bin/python -r video/voice-requirements.txt
mkdir -p video/output/tts-models
for model_file in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ ! -s "video/output/tts-models/$model_file" ]; then
    curl -fLsS --retry 2 \
      "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/$model_file" \
      -o "video/output/tts-models/$model_file"
  fi
done
video/.venv/bin/python video/voiceover.py
video/.venv/bin/python video/music.py
video/.venv/bin/python video/mix.py
