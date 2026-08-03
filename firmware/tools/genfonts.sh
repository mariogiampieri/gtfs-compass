#!/usr/bin/env bash
#
# genfonts.sh — regenerate the LVGL font faces in firmware/components/ui/fonts/.
#
# The generated .c files ARE committed (so the firmware builds without node);
# run this only when the ramp, weights, or glyph ranges change.
#
# Faces: IBM Plex Sans (OFL 1.1) at the design handoff's true type ramp, 4 bpp,
# uncompressed. Plex digits are tabular by default (600/1000 em advance on all
# ten digits in every weight — verified with fontTools), so no feature-freeze
# step is needed. The 15/16/20 px faces additionally merge U+21C5 (⇅) from
# DejaVu Sans (public-domain-style license) because Plex has no glyph there.
#
# Sources (pinned):
#   IBM Plex Sans static TTFs — github.com/IBM/plex release @ibm/plex-sans@1.1.0
#   DejaVu Sans 2.37          — github.com/dejavu-fonts release version_2_37
# Downloads land in firmware/tools/.fontcache/ (gitignored).
#
# Requires: node (npx), curl, unzip.

set -euo pipefail

# Run from firmware/tools/ with relative paths so the "Opts:" header baked
# into each generated .c is identical on every machine (stable diffs).
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
OUT="../components/ui/fonts"
CACHE=".fontcache"
mkdir -p "$OUT" "$CACHE"

LV_FONT_CONV="npx --yes lv_font_conv@1.5.3"

PLEX_URL="https://github.com/IBM/plex/releases/download/%40ibm/plex-sans%401.1.0/ibm-plex-sans.zip"
DEJAVU_URL="https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip"

PLEX_DIR="$CACHE/ibm-plex-sans/fonts/complete/ttf"
DEJAVU="$CACHE/dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf"

if [ ! -f "$PLEX_DIR/IBMPlexSans-Regular.ttf" ]; then
  echo "Fetching IBM Plex Sans (@ibm/plex-sans@1.1.0)..."
  curl -sL -o "$CACHE/ibm-plex-sans.zip" "$PLEX_URL"
  unzip -o -q "$CACHE/ibm-plex-sans.zip" -d "$CACHE"
fi
if [ ! -f "$DEJAVU" ]; then
  echo "Fetching DejaVu Sans 2.37 (for the U+21C5 merge)..."
  curl -sL -o "$CACHE/dejavu.zip" "$DEJAVU_URL"
  unzip -o -q "$CACHE/dejavu.zip" -d "$CACHE"
fi

REGULAR="$PLEX_DIR/IBMPlexSans-Regular.ttf"   # 400
SEMIBOLD="$PLEX_DIR/IBMPlexSans-SemiBold.ttf" # 600
BOLD="$PLEX_DIR/IBMPlexSans-Bold.ttf"         # 700 (Plex has no 800/ExtraBold)

# Printable ASCII plus the non-ASCII glyphs the UI actually draws:
# ° 0xB0 (compass tags), · 0xB7 (chip separator), — 0x2014 (placeholders),
# … 0x2026 (loading chip), ‹ 0x2039 (back affordance).
TEXT_RANGE="0x20-0x7E,0xB0,0xB7,0x2014,0x2026,0x2039"
# 84 px hero is digits-only: 0-9, colon, hyphen, em-dash (KTD-5).
HERO_RANGE="0x2D,0x30-0x3A,0x2014"

gen() { # gen <size> <ttf> [extra lv_font_conv args...]
  local size="$1" ttf="$2"
  shift 2
  echo "gc_plex_${size} <- $(basename "$ttf") $*"
  $LV_FONT_CONV --format lvgl --bpp 4 --no-compress --lv-include "lvgl.h" \
    --size "$size" -o "$OUT/gc_plex_${size}.c" \
    --font "$ttf" -r "$TEXT_RANGE" "$@"
}

ARROW=(--font "$DEJAVU" -r 0x21C5) # ⇅ flip-direction glyph, absent from Plex

gen 14 "$REGULAR"              # sub/hint/unit          14/400
gen 15 "$SEMIBOLD" "${ARROW[@]}" # pill & legend        15/600 (+⇅)
gen 16 "$SEMIBOLD" "${ARROW[@]}" # chip / caps labels   16/600 (+⇅)
gen 17 "$REGULAR"              # body / detail headsign 17/400
gen 18 "$REGULAR"              # headsign               18/400
gen 20 "$SEMIBOLD" "${ARROW[@]}" # detail direction     20/600 (+⇅)
gen 24 "$BOLD"                 # station name (2-line)  24/700
gen 25 "$BOLD"                 # rail bullet label      25/700
gen 27 "$BOLD"                 # station name (mid)     27/700
gen 30 "$BOLD"                 # station name (short)   30/700
gen 36 "$BOLD"                 # board countdown        36/700
gen 40 "$BOLD"                 # detail countdown       40/700

# 84 px bike hero — handoff says 84/800, but IBM Plex Sans tops out at
# Bold 700; digits-only subset keeps it small.
echo "gc_plex_84 <- $(basename "$BOLD") (digits subset)"
$LV_FONT_CONV --format lvgl --bpp 4 --no-compress --lv-include "lvgl.h" \
  --size 84 -o "$OUT/gc_plex_84.c" \
  --font "$BOLD" -r "$HERO_RANGE"

echo "Done. Generated $(ls "$OUT"/gc_plex_*.c | wc -l | tr -d ' ') faces in $OUT"
