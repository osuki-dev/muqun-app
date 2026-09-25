#!/usr/bin/env bash
# Record one Hermes CPU profile per interaction on an Android Release profiling
# build, and summarise each with analyze-profile.py.
#
#   bash scripts/perf/android-profile-scenarios.sh --serial <QA emulator serial> \
#     --map android/app/build/generated/sourcemaps/react/release/index.android.bundle.map \
#     --out <dir> [--only <scenario>]
#
# The installed app must be a Release build made with MUQUN_RELEASE_PROFILER=1
# and EXPO_PUBLIC_RELEASE_PROFILER=1, so the ●/■ control is present, and the
# source map must come from that same build. Run it on a dedicated QA emulator
# only: it relaunches the app, enters the demo and changes the theme.
set -euo pipefail

serial=""
map=""
out=""
only=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial) serial="$2"; shift 2 ;;
    --map) map="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --only) only="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$serial" && -n "$map" && -n "$out" ]] || { echo "--serial, --map and --out are required" >&2; exit 2; }
map=$(cd "$(dirname "$map")" && pwd)/$(basename "$map")
mkdir -p "$out"
out=$(cd "$out" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)

app=dev.osuki.muqun
ad() { agent-device "$@" --serial "$serial" --platform android --session perf-profile; }
quiet() { "$@" >/dev/null 2>&1 || true; }
settle() { quiet ad wait stable "${1:-600}" 8000; }
trap 'quiet ad close' EXIT

record() {
  local name=$1
  shift
  if [[ -n "$only" && "$only" != "$name" ]]; then return; fi
  ad press 'id=release-profiler-start' >/dev/null
  sleep 1
  "$@"
  # A sheet's dismissal can still be animating; wait for the control rather
  # than pressing back again, which would leave the demo.
  if ! ad wait 'id=release-profiler-stop' 5000 >/dev/null 2>&1; then
    quiet ad back --system
    quiet ad wait 'id=release-profiler-stop' 5000
  fi
  ad press 'id=release-profiler-stop' >/dev/null
  sleep 3
  local before
  before=$(ls "$root"/*-converted.json 2>/dev/null || true)
  (cd "$root" && ANDROID_SERIAL="$serial" node_modules/.bin/react-native-release-profiler \
    --fromDownload --appId "$app" --sourcemap-path "$map" >/dev/null 2>&1)
  local converted
  converted=$(ls -t "$root"/*-converted.json 2>/dev/null | head -1)
  if [[ -z "$converted" || "$converted" == "$before" ]]; then
    echo "$name: no trace produced" >&2
    return
  fi
  mv "$converted" "$out/$name.json"
  echo "$name: $out/$name.json"
}

home_idle() { sleep 10; }
terminal_idle() { sleep 10; }
switch_panes() {
  for target in "Switch to nvim" "Switch to zsh" "Switch to Claude Code" "Switch to nvim" "Switch to Claude Code"; do
    quiet ad press "label=\"$target\""
    settle 400
  done
}
files_sheet() {
  quiet ad press 'label="Open files"'
  settle
  quiet ad scroll down --pixels 600 --duration-ms 400
  quiet ad scroll up --pixels 600 --duration-ms 400
  quiet ad back --system
  settle
}
settings_scroll() {
  quiet ad press 'label="Settings"'
  settle
  quiet ad scroll down --pixels 900 --duration-ms 500
  quiet ad scroll up --pixels 900 --duration-ms 500
  quiet ad press 'label="Go back"'
  settle
}
theme_switch() {
  quiet ad press 'label="Settings"'
  settle
  local current next
  for _ in 1 2; do
    current=$(ad snapshot -i | grep -oE '"Theme, [^"]+"' | head -1 | sed 's/"Theme, //; s/"//')
    if [[ "$current" == "Dracula" ]]; then next=Osuki; else next=Dracula; fi
    quiet ad press "label=\"Theme, $current\""
    settle 500
    quiet ad press 'label="Built-in"'
    settle 300
    quiet ad press "role=button label=\"$next\""
    settle 1000
  done
  quiet ad press 'label="Go back"'
  settle
}
workbench() {
  quiet ad press 'label="Workbench"'
  settle
  quiet ad press 'label="Demo workspace, Online"'
  settle
}
typing() {
  quiet ad press 'label="Send a message"'
  quiet ad type "Please summarise the failing tests and suggest a fix" --delay-ms 60
  settle 400
  quiet ad keyboard dismiss
}

quiet ad close
adb -s "$serial" shell am force-stop "$app"
quiet ad open "$app" --relaunch
settle 1500
sleep 8
if ad snapshot -i | grep -q '"Try the demo"'; then
  # The unpaired home screen first, then the demo workspace.
  record home-idle home_idle
  quiet ad press 'label="Try the demo"'
  settle 1000
  sleep 5
fi
record terminal-idle terminal_idle
record switch-panes switch_panes
record files-sheet files_sheet
record settings-scroll settings_scroll
record theme-switch theme_switch
record workbench workbench
record typing typing

for trace in "$out"/*.json; do
  echo
  echo "##### $(basename "$trace" .json)"
  python3 "$root/scripts/perf/analyze-profile.py" "$trace" --top 12
done
