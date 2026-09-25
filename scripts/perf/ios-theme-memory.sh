#!/usr/bin/env bash
# Theme-switch memory scenario on an iOS simulator.
#
#   bash scripts/perf/ios-theme-memory.sh --udid <QA simulator UDID> [--label before] [--switches 4]
#
# Cold launch -> demo -> Settings -> N built-in theme changes -> 15 s idle ->
# back. Prints phys_footprint (and the categories that moved) at each step.
# Use a Release build on a dedicated, unpaired QA simulator: it relaunches the
# app and switches themes, and never touches a paired device.
set -euo pipefail

udid=""
label="run"
switches=4
while [[ $# -gt 0 ]]; do
  case "$1" in
    --udid) udid="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --switches) switches="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$udid" ]] || { echo "--udid is required" >&2; exit 2; }

app=dev.osuki.muqun
ad() { agent-device "$@" --udid "$udid" --platform ios --session perf-theme-ios; }
quiet() { "$@" >/dev/null 2>&1 || true; }
trap 'quiet ad close' EXIT

pid() { pgrep -f "$udid.*Muqun.app/Muqun$"; }
footprint_mb() { footprint "$(pid)" | grep -oE 'Footprint: [0-9]+ MB' | grep -oE '[0-9]+'; }
category() { footprint "$(pid)" | awk -v c="$1" '$0 ~ c {print $1 " " $2; exit}'; }

quiet ad close
quiet xcrun simctl terminate "$udid" "$app"
xcrun simctl launch "$udid" "$app" >/dev/null
sleep 20
quiet ad open "$app"
quiet ad wait stable 800 8000
echo "$label cold_home=$(footprint_mb)MB"

if ad is visible 'label="Try the demo"' >/dev/null 2>&1; then quiet ad press 'label="Try the demo"'; fi
quiet ad wait stable 800 8000
sleep 10
echo "$label demo=$(footprint_mb)MB"

quiet ad press 'label="Settings"'
quiet ad wait stable 800 8000
current=$(ad snapshot -i | grep -oE '"Theme, [^"]+"' | head -1 | sed 's/"Theme, //; s/"//')
for i in $(seq 1 "$switches"); do
  if [[ "$current" == "Osuki" ]]; then next=Dracula; else next=Osuki; fi
  quiet ad press "label=\"Theme, $current\""
  quiet ad wait stable 500 6000
  quiet ad press 'label="Built-in"'
  quiet ad wait stable 300 4000
  ad press "role=button label=\"$next\"" >/dev/null 2>&1 || echo "$label could not pick $next"
  quiet ad wait stable 1000 10000
  current=$next
  echo "$label switch $i -> $next: $(footprint_mb)MB"
done

sleep 15
echo "$label settings_idle15s=$(footprint_mb)MB CGRaster=$(category 'CG Raster') Untagged=$(category 'Untagged')"
quiet ad press 'role=button label="Go back"'
quiet ad wait stable 800 8000
sleep 15
echo "$label home_after=$(footprint_mb)MB CGRaster=$(category 'CG Raster') MallocSmall=$(category 'Malloc Small')"
