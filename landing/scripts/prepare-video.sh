#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source_video="../video/current/output/gpu-time-launch-voiceover.mp4"
mkdir -p public/media
cp "$source_video" public/media/gpu-time-neural.mp4
node scripts/prepare-thumbnail.mjs
printf 'WEBVTT\n\n' > public/media/captions.vtt
sed -E 's/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/\1.\2/g' \
  ../video/current/output/gpu-time-voiceover.srt >> public/media/captions.vtt
