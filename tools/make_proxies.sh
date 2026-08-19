#!/usr/bin/env bash
# Generate the 480p proxies the demo plays.
#
# The demo never ships the source media: a proxy is a quarter the size, and the
# frames the agent actually saw are shipped separately as JPEGs anyway. Video-MME
# clips are public, but shipping a downscaled, audio-stripped excerpt is the
# lighter-touch choice for a research illustration.
#
# Usage: bash tools/make_proxies.sh [output_dir]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SRC="/home/video-code-harness/video-agent-harness-phase0/data/working/videos"
OUT="${1:-app/public/video}"
mkdir -p "$OUT"

for f in "$SRC"/*.mp4; do
  id="$(basename "$f" .mp4)"
  dest="$OUT/$id.480p.mp4"
  if [ -f "$dest" ]; then echo "  skip  $id (exists)"; continue; fi
  ffmpeg -y -loglevel error -i "$f" \
    -vf "scale=-2:480" -c:v libx264 -crf 30 -preset veryfast \
    -movflags +faststart -an "$dest"
  printf "  ok    %-16s %6s KB\n" "$id" "$(( $(stat -c%s "$dest") / 1024 ))"
done
echo "total: $(du -sh "$OUT" | cut -f1)"
