#!/usr/bin/env bash
# Captures every ScreenshotScene (FantasyReel/App/ScreenshotScenes.swift) on one
# booted simulator, for PR review. Used by .github/workflows/ios.yml and locally.
#
#   scripts/capture-screenshots.sh <udid> <app> <out-dir> [options]
#
# Options:
#   --appearances "light dark"   which appearances to capture (default both)
#   --display outer|inner        iPhone Duo only: which screen to capture. The
#                                device must already be closed (outer) or
#                                open (inner); the script only picks the
#                                screen. Files are prefixed "duo-<display>-".
#
# Run from apps/ios. A capture taken before the first frame is drawn is a blank
# page that compresses to almost nothing; the scene is relaunched and waited
# on longer, up to three times. Scenes that stay blank are listed in
# <out-dir>/blank-screenshots.txt.
set -euo pipefail

UDID=$1 APP=$2 OUT=$3
shift 3
APPEARANCES="light dark"
DISPLAY_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --appearances) APPEARANCES=$2; shift 2 ;;
    --display) DISPLAY_NAME=$2; shift 2 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done

# The Duo has two screens. `simctl io enumerate` lists them as class-0
# framebuffers; the outer one has the smaller panel (1398 × 2034 px), the
# inner one the larger.
DISPLAY_ARGS=()
PREFIX=""
if [ -n "$DISPLAY_NAME" ]; then
  PORTS=$(xcrun simctl io "$UDID" enumerate | python3 -c '
import re, sys
ports, cur = [], {}
for line in sys.stdin:
    line = line.strip()
    if line == "Port:":
        cur = {}; ports.append(cur)
    elif ":" in line:
        k, v = line.split(":", 1); cur.setdefault(k.strip(), v.strip())
screens = [p for p in ports if p.get("Display class") == "0"]
screens.sort(key=lambda p: int(p["Default width"]) * int(p["Default height"]))
print(" ".join(p["UUID"] for p in screens))')
  read -r OUTER INNER <<<"$PORTS"
  case "$DISPLAY_NAME" in
    outer) DISPLAY_ARGS=(--display="$OUTER") ;;
    inner) DISPLAY_ARGS=(--display="${INNER:?this simulator has only one screen}") ;;
    *) echo "--display must be outer or inner" >&2; exit 2 ;;
  esac
  PREFIX="duo-$DISPLAY_NAME-"
fi

BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl install "$UDID" "$APP"
mkdir -p "$OUT"
CHECK_DIR=$(mktemp -d)
CHECK=$CHECK_DIR/check.png
SCENES=$(sed -n 's/^    case \([a-zA-Z]*\)$/\1/p' FantasyReel/App/ScreenshotScenes.swift)
for appearance in $APPEARANCES; do
  xcrun simctl ui "$UDID" appearance "$appearance"
  for scene in $SCENES; do
    FILE="$OUT/$PREFIX$scene-$appearance.png"
    for attempt in 1 2 3; do
      SIMCTL_CHILD_FR_SCREENSHOT="$scene" xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE_ID" >/dev/null
      sleep $((2 + attempt * 2))
      xcrun simctl io "$UDID" screenshot ${DISPLAY_ARGS[@]+"${DISPLAY_ARGS[@]}"} "$FILE" >/dev/null 2>&1
      sips --resampleWidth 600 "$FILE" --out "$CHECK" >/dev/null
      if [ "$(stat -f%z "$CHECK")" -gt 60000 ]; then break; fi
      echo "::warning::$PREFIX$scene ($appearance) looked blank on attempt $attempt"
      if [ "$attempt" = 3 ]; then echo "$PREFIX$scene-$appearance" >> "$OUT/blank-screenshots.txt"; fi
    done
  done
done
rm -rf "$CHECK_DIR"
