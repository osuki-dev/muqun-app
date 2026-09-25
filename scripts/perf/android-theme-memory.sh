#!/usr/bin/env bash
# Theme-switch memory and frame scenario on an Android emulator.
#
#   bash scripts/perf/android-theme-memory.sh --serial <QA emulator serial> [--label before] [--switches 4]
#
# Cold launch -> demo -> Settings -> N built-in theme changes -> 15 s idle ->
# back. Prints TOTAL PSS and the native heap at each step, then the frame health
# of the switches. Use a Release build on a dedicated QA emulator only.
set -euo pipefail

serial=""
label="run"
switches=4
while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial) serial="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --switches) switches="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$serial" ]] || { echo "--serial is required" >&2; exit 2; }

app=dev.osuki.muqun
ad() { agent-device "$@" --serial "$serial" --platform android --session perf-theme-android; }
quiet() { "$@" >/dev/null 2>&1 || true; }
trap 'quiet ad close' EXIT

mem() {
  adb -s "$serial" shell dumpsys meminfo "$app" | awk '
    /^ *Native Heap / && !n { heap = $3; n = 1 }
    /TOTAL PSS:/ { total = $3 }
    END { printf "PSS=%dMB NativeHeap=%dMB", total / 1024, heap / 1024 }'
}

quiet ad close
adb -s "$serial" shell am force-stop "$app"
quiet ad open "$app" --relaunch
quiet ad wait stable 800 10000
sleep 15
echo "$label cold_home $(mem)"

if ad is visible 'label="Try the demo"' >/dev/null 2>&1; then quiet ad press 'label="Try the demo"'; fi
quiet ad wait stable 800 10000
sleep 10
echo "$label demo $(mem)"

quiet ad press 'label="Settings"'
quiet ad wait stable 800 8000
current=$(ad snapshot -i | grep -oE '"Theme, [^"]+"' | head -1 | sed 's/"Theme, //; s/"//')
adb -s "$serial" shell dumpsys gfxinfo "$app" reset >/dev/null
for i in $(seq 1 "$switches"); do
  if [[ "$current" == "Dracula" ]]; then next=Osuki; else next=Dracula; fi
  quiet ad press "label=\"Theme, $current\""
  quiet ad wait stable 500 6000
  quiet ad press 'label="Built-in"'
  quiet ad wait stable 300 4000
  ad press "role=button label=\"$next\"" >/dev/null 2>&1 || echo "$label could not pick $next"
  quiet ad wait stable 1000 10000
  current=$next
  echo "$label switch $i -> $next $(mem)"
done
ad perf frames --json | LABEL="$label" python3 -c '
import json, os, sys
fps = json.load(sys.stdin)["data"]["metrics"]["fps"]
worst = max((w["worstFrameMs"] for w in fps.get("worstWindows", [])), default=0)
print("%s frames total=%s dropped=%s (%s%%) worst=%sms" % (os.environ["LABEL"], fps["totalFrameCount"], fps["droppedFrameCount"], fps["droppedFramePercent"], worst))
'

sleep 15
echo "$label settings_idle15s $(mem)"
quiet ad press 'label="Go back"'
quiet ad wait stable 800 8000
sleep 15
echo "$label home_after $(mem)"
