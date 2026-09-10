#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

video_source="${1:-video/output/gpu-time-launch.mp4}"
video/.venv/bin/python video/music.py "$video_source"
video/.venv/bin/python video/mux-music.py "$video_source"
