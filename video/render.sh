#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x video/.venv/bin/python ]; then
  uv venv video/.venv --python 3.13
fi
uv pip install --quiet --python video/.venv/bin/python -r video/requirements.txt

npx tsx --import ./packages/core/scripts/register.mjs video/export-data.ts
mkdir -p video/output
video/.venv/bin/manimgl video/gpu_time_pipeline.py GpuTimePipeline -w --hd \
  --config_file video/custom_config.yml --video_dir video/output --file_name silent
video/.venv/bin/python - <<'PY'
import json, subprocess
info = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json',
    'video/output/silent.mp4'
]))
assert 91 <= float(info['format']['duration']) < 91.1, 'The render did not complete'
PY
