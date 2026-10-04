#!/usr/bin/env bash
# Builds public/sounds/*.m4a from Kenney's CC0 sound packs (kenney.nl: Impact Sounds, Casino Audio,
# RPG Audio). The packs aren't kept in the repo: download and unzip them, then
#
#   tools/make-sounds.sh path/to/folder-with-the-unzipped-packs
#
# Each clip is trimmed of leading silence, peak-normalised and saved as small mono AAC, which every
# browser (including Safari on iPhone) can play.
set -euo pipefail
SRC="${1:?folder with the unzipped Kenney packs}"
OUT="$(dirname "$0")/../public/sounds"
mkdir -p "$OUT"

clip() { # clip <output name> <source file name> [max seconds]
  local in
  in="$(find "$SRC" -name "$2" | head -1)"
  [ -n "$in" ] || { echo "missing $2" >&2; exit 1; }
  local peak
  peak="$(ffmpeg -hide_banner -i "$in" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB/\1/p')"
  local gain
  gain="$(echo "-1 - ($peak)" | bc)" # bring the peak to -1 dB
  ffmpeg -hide_banner -loglevel error -y -i "$in" \
    -af "silenceremove=start_periods=1:start_threshold=-55dB,volume=${gain}dB" \
    ${3:+-t "$3"} -ac 1 -ar 44100 -c:a aac -b:a 64k "$OUT/$1.m4a"
  echo "$1.m4a  ←  $2"
}

clip clack-1 impactMetal_light_000.ogg
clip clack-2 impactMetal_light_001.ogg
clip clack-3 impactMetal_light_002.ogg
clip cup-1 impactPlate_light_000.ogg
clip cup-2 impactPlate_light_001.ogg
clip cup-3 impactPlate_light_002.ogg
clip flick chip-lay-1.ogg
clip keep chips-stack-1.ogg
clip floor-1 impactMetal_medium_000.ogg
clip floor-2 impactMetal_medium_001.ogg
clip win handleCoins.ogg
