#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
bun video/current/export-data.ts
mkdir -p video/current/output
video/.venv/bin/manimgl video/current/film.py CurrentFilm -w --hd \
  --config_file video/current/config.yml --video_dir video/current/output --file_name silent
video/.venv/bin/python - <<'PY'
import json, subprocess
info = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json',
    'video/current/output/silent.mp4'
]))
assert 91 <= float(info['format']['duration']) < 91.1, 'The render did not complete'
PY
