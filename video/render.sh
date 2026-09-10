#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x video/.venv/bin/python ]; then
  uv venv video/.venv --python 3.13
fi
uv pip install --quiet --python video/.venv/bin/python -r video/requirements.txt
test -s video/data.json
echo "Rendering archived video data, not the current parser. See video/README.md." >&2
mkdir -p video/output
video/.venv/bin/manimgl video/launch.py Launch -w --hd \
  --config_file video/custom_config.yml \
  --video_dir video/output --file_name gpu-time-master
ffmpeg -hide_banner -loglevel error -y -i video/output/gpu-time-master.mp4 \
  -c copy -movflags +faststart video/output/gpu-time-launch.mp4
ffmpeg -hide_banner -loglevel error -y -ss 30 -i video/output/gpu-time-launch.mp4 \
  -frames:v 1 video/output/gpu-time-launch-poster.jpg
