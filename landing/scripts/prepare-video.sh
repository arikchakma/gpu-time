#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source_video="../video/output/gpu-time-launch-voiceover.mp4"
mkdir -p public/media
# Invert luminance and rotate hue back, retaining color identities on white.
# This is a presentation-only derivative of the frozen legacy film.
ffmpeg -y -i "$source_video" -vf 'negate,hue=h=180,eq=brightness=0.025' \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a copy \
  -movflags +faststart public/media/gpu-time-light.mp4
ffmpeg -y -ss 23 -i public/media/gpu-time-light.mp4 -frames:v 1 -update 1 public/media/poster.jpg
printf 'WEBVTT\n\n' > public/media/captions.vtt
sed -E 's/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/\1.\2/g' \
  ../video/output/gpu-time-voiceover.srt >> public/media/captions.vtt
