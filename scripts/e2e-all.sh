#!/usr/bin/env bash
# Run the full native gate on all four dedicated QA devices in parallel.
#
# Devices are discovered by name on every run; UDIDs and emulator serials are
# never hardcoded. A device that is not booted is booted; a device is never
# created. Sessions and report directories are per-device so parallel runs
# cannot steal each other's session or overwrite each other's evidence.
#
# A device with paired servers or saved SSH hosts is skipped, loudly: the
# suite must never run against real user data, and a skip fails the gate so
# partial coverage cannot pass as full coverage.
#
# Usage:
#   bash scripts/e2e-all.sh [--smoke|--full|--tag <tag>] [--flow <name>]
set -euo pipefail
readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tag_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --smoke | --full | --tag | --flow)
      if [ "$1" = "--tag" ] || [ "$1" = "--flow" ]; then
        tag_args+=("$1" "$2")
        shift 2
      else
        tag_args+=("$1")
        shift
      fi
      ;;
    --help | -h)
      echo "bash scripts/e2e-all.sh [--smoke|--full|--tag <tag>] [--flow <name>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v agent-device >/dev/null 2>&1; then
  echo "agent-device is not on PATH" >&2
  exit 1
fi
# Portable timeout: the suite's agent-device calls must never hang the gate.
run_timeout() {
  local secs="$1"
  shift
  python3 - "$secs" "$@" <<'PYEOF'
import subprocess, sys
try:
    sys.exit(subprocess.run(sys.argv[2:], timeout=float(sys.argv[1])).returncode)
except subprocess.TimeoutExpired:
    sys.exit(124)
PYEOF
}
# NOTE: no `grep -q` in pipelines in this script: under `pipefail` its early
# pipe close SIGPIPEs the writer and the check misfires. `case` matches instead.
case "$(agent-device --version 2>/dev/null)" in
*"0.21.12"*) ;;
*)
  echo "This suite requires agent-device 0.21.12" >&2
  exit 1
  ;;
esac

# Prints "<udid> <state>" for the booted-or-bootable simulator with the given name.
find_ios_sim() {
  xcrun simctl list devices --json 2>/dev/null | python3 -c "
import json, sys
want = sys.argv[1]
devices = json.load(sys.stdin)['devices']
for runtime, entries in devices.items():
    for entry in entries:
        if entry.get('name') == want and entry.get('isAvailable', True):
            print(entry['udid'], entry['state'])
" "$1" | head -1
}

# Prints the ADB serial whose AVD name matches, or empty when not running.
# NOTE: macOS awk is BSD awk and does not understand \s; use [[:space:]].
find_android_serial() {
  for serial in $(adb devices 2>/dev/null | awk '/[[:space:]]device$/ {print $1}'); do
    name=$(adb -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')
    if [ "$name" = "$1" ]; then
      echo "$serial"
      return 0
    fi
  done
  return 0
}

emu_binary() {
  if command -v emulator >/dev/null 2>&1; then
    command -v emulator
  elif [ -x "${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator" ]; then
    echo "${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator"
  else
    echo ""
  fi
}

ensure_ios_booted() {
  local udid="$1" name="$2"
  local state
  state=$(xcrun simctl list devices --json 2>/dev/null | python3 -c "
import json, sys
for entries in json.load(sys.stdin)['devices'].values():
    for entry in entries:
        if entry.get('udid') == sys.argv[1]:
            print(entry['state'])
" "$udid")
  if [ "$state" != "Booted" ]; then
    echo "e2e-all: booting $name ($udid)"
    xcrun simctl boot "$udid"
    open -a Simulator >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
      state=$(xcrun simctl list devices --json 2>/dev/null | python3 -c "
import json, sys
for entries in json.load(sys.stdin)['devices'].values():
    for entry in entries:
        if entry.get('udid') == sys.argv[1]:
            print(entry['state'])
" "$udid")
      [ "$state" = "Booted" ] && break
      sleep 5
    done
    [ "$state" = "Booted" ] || {
      echo "e2e-all: $name did not boot" >&2
      return 1
    }
  fi
}

ensure_android_booted() {
  local avd="$1"
  if [ -z "$(find_android_serial "$avd")" ]; then
    local emu
    emu=$(emu_binary)
    [ -n "$emu" ] || {
      echo "e2e-all: emulator binary not found for $avd" >&2
      return 1
    }
    echo "e2e-all: booting $avd"
    nohup "$emu" -avd "$avd" -no-snapshot-load -no-boot-anim >/tmp/"$avd".log 2>&1 &
    for _ in $(seq 1 60); do
      serial=$(find_android_serial "$avd")
      if [ -n "$serial" ] && [ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
        break
      fi
      sleep 5
    done
    [ -n "$(find_android_serial "$avd")" ] || {
      echo "e2e-all: $avd did not boot" >&2
      return 1
    }
  fi
}

# The gate is an offline gate: demo fixtures only, and custom-themes asserts
# the catalogue's offline failure UI. A QA emulator with a working route must
# not reach that assertion online, so Wi-Fi and mobile data go off here. This
# persists on the dedicated QA AVDs (documented in the e2e README) and never
# touches the host Mac or any other device. agent-device drives over ADB, so
# the control channel is unaffected.
ensure_android_offline() {
  local serial="$1" name="$2"
  adb -s "$serial" shell "svc wifi disable; svc data disable" >/dev/null 2>&1
  # NOTE: ping writes its verdicts to stderr on the emulator; keep it. No
  # `grep -q` here: under `pipefail` its early pipe close SIGPIPEs adb and the
  # check misfires. Consume all output and test for emptiness instead.
  if [ -z "$(adb -s "$serial" shell "ping -c1 -W4 8.8.8.8" 2>&1 | grep -iE "unreachable|100% .*loss|0 received")" ]; then
    echo "e2e-all: SKIP $name: emulator still has a network route" >&2
    return 1
  fi
}

# Fails when the app on the device shows paired servers instead of the
# first-run / demo entry points. Read-only: opens, snapshots, closes.
# Retries the snapshot: a cold start after reinstall can take a few seconds
# before the first readable capture.
preflight_unpaired() {
  local session="$1"
  shift
  if [ -n "${E2E_AD_METRO_HOST:-}" ]; then
    run_timeout 120 agent-device open dev.osuki.muqun --relaunch --session "$session" \
      --metro-host "$E2E_AD_METRO_HOST" --metro-port "${E2E_AD_METRO_PORT:-8081}" "$@" >/dev/null 2>&1 || true
  else
    run_timeout 120 agent-device open dev.osuki.muqun --relaunch --session "$session" "$@" >/dev/null 2>&1 || true
  fi
  local snapshot="" attempt
  for attempt in 1 2 3 4 5 6; do
    snapshot=$(run_timeout 90 agent-device snapshot --force-full --session "$session" "$@" 2>/dev/null || true)
    # A fresh install can still be launching: a handful of chrome nodes and
    # no content is "not yet", not "dirty". Only a settled screen decides.
    case "$snapshot" in
    *"Try the demo"*)
      run_timeout 60 agent-device close --session "$session" "$@" >/dev/null 2>&1 || true
      return 0
      ;;
    esac
    sleep 5
  done
  run_timeout 60 agent-device close --session "$session" "$@" >/dev/null 2>&1 || true
  echo "$snapshot" >"$report_root/$session-snapshot.txt"
  echo "$snapshot" | grep -E "@e[0-9]+ .*Open .*|No servers paired yet" | head -5
  return 1
}

report_root="$repo_root/dist/e2e-reports"
rm -f "$report_root/.e2e-all-skips" "$report_root/.e2e-all-pids"
# Optional: E2E_ALL_ONLY="android-phone android-tablet" restricts the run.

# name | platform | ios sim name | android avd name
devices="
iphone|ios|Muqun iPhone 17 Pro|
ipad|ios|muqun-ipad-qa|
android-phone|android||Pixel_10_Pro
android-tablet|android||muqun_tablet_qa
"

# A here-string keeps the loop in this shell (a pipeline would fork a
# subshell whose background jobs the final `wait` could not reap).
while IFS='|' read -r name platform sim avd; do
  [ -z "$name" ] && continue
  if [ -n "${E2E_ALL_ONLY:-}" ]; then
    case " $E2E_ALL_ONLY " in
    *" $name "*) ;;
    *) continue ;;
    esac
  fi
  echo "--- e2e-all: preparing $name ---"
  device_id=""
  if [ "$platform" = "ios" ]; then
    found=$(find_ios_sim "$sim")
    [ -n "$found" ] || {
      echo "e2e-all: SKIP $name: simulator '$sim' not found (not creating one)" >&2
      echo "SKIP $name" >>"$report_root/.e2e-all-skips"
      continue
    }
    device_id=$(echo "$found" | awk '{print $1}')
    ensure_ios_booted "$device_id" "$sim" || {
      echo "SKIP $name" >>"$report_root/.e2e-all-skips"
      continue
    }
    flags="--udid $device_id --platform ios"
  else
    ensure_android_booted "$avd" || {
      echo "SKIP $name" >>"$report_root/.e2e-all-skips"
      continue
    }
    device_id=$(find_android_serial "$avd")
    ensure_android_offline "$device_id" "$name" || {
      echo "SKIP $name" >>"$report_root/.e2e-all-skips"
      continue
    }
    if [ -n "${E2E_AD_METRO_PORT:-}" ]; then
      adb -s "$device_id" reverse "tcp:$E2E_AD_METRO_PORT" "tcp:$E2E_AD_METRO_PORT" || {
        echo "e2e-all: SKIP $name: could not connect Metro" >&2
        echo "SKIP $name" >>"$report_root/.e2e-all-skips"
        continue
      }
    fi
    flags="--serial $device_id --platform android"
  fi
  # shellcheck disable=SC2086
  if ! preflight_unpaired "muqun-e2e-$name-preflight" $flags; then
    echo "e2e-all: SKIP $name: device shows paired servers; refusing to run the suite against real user data" >&2
    echo "SKIP $name" >>"$report_root/.e2e-all-skips"
    continue
  fi
  echo "e2e-all: starting $name ($device_id)"
  # macOS bash is 3.2: an empty array under `set -u` cannot expand, so branch.
  if [ "${#tag_args[@]}" -gt 0 ]; then
    env E2E_AD_SESSION="muqun-e2e-$name" E2E_REPORT_DIR="$report_root/$name" \
      bash "$repo_root/scripts/e2e.sh" "${tag_args[@]}" --platform "$platform" --device "$device_id" \
      >"$report_root/$name-run.log" 2>&1 &
  else
    env E2E_AD_SESSION="muqun-e2e-$name" E2E_REPORT_DIR="$report_root/$name" \
      bash "$repo_root/scripts/e2e.sh" --platform "$platform" --device "$device_id" \
      >"$report_root/$name-run.log" 2>&1 &
  fi
  echo "$! $name" >>"$report_root/.e2e-all-pids"
done <<<"$devices"

echo "e2e-all: waiting for device runs..."
failures=0
started=0
[ -f "$report_root/.e2e-all-pids" ] || touch "$report_root/.e2e-all-pids"
while read -r pid name; do
  started=$((started + 1))
  if wait "$pid"; then
    echo "e2e-all: PASS $name"
  else
    echo "e2e-all: FAIL $name (see $report_root/$name-run.log)"
    failures=$((failures + 1))
  fi
done <"$report_root/.e2e-all-pids"
rm -f "$report_root/.e2e-all-pids"

if [ -f "$report_root/.e2e-all-skips" ]; then
  cat "$report_root/.e2e-all-skips" >&2
  rm -f "$report_root/.e2e-all-skips"
  failures=$((failures + 1))
fi

echo "e2e-all: done with $failures failing/skipped device(s) out of $started started"
[ "$started" -gt 0 ] && [ "$failures" = "0" ]
