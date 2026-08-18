#!/usr/bin/env bash
#
# Run the Maestro end-to-end suite against one connected device and write a
# JUnit report.
#
#   bash scripts/e2e.sh              # every flow tagged `full`
#   bash scripts/e2e.sh --smoke      # only the `smoke` subset
#   bash scripts/e2e.sh --device X   # pick the device explicitly
#   E2E_DEV_CLIENT_URL='muqun://expo-development-client/?url=...' \
#     bash scripts/e2e.sh --device X # reconnect a cleared dev client to Metro
#
# This is the single entry point: the checks reference it, and so
# should CI. It exits non-zero if any flow fails, which is what makes it usable
# as a gate.
#
# The flows drive the app through offline demo mode, so no gateway, no network
# and no pairing are needed -- but the app itself must already be installed on
# the device, and for a dev build Metro must be running. A release or preview
# build embeds the JS bundle and needs neither.
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly report_dir="${E2E_REPORT_DIR:-${repo_root}/dist/e2e-reports}"

maestro_bin="${MAESTRO_BIN:-}"
if [[ -z "${maestro_bin}" ]]; then
  if command -v maestro >/dev/null 2>&1; then
    maestro_bin="$(command -v maestro)"
  elif [[ -x "${HOME}/.maestro/bin/maestro" ]]; then
    # Maestro's installer does not touch a non-interactive shell's PATH, which
    # is how this script is usually reached.
    maestro_bin="${HOME}/.maestro/bin/maestro"
  else
    echo "e2e: maestro is not installed. See https://maestro.dev/getting-started" >&2
    exit 127
  fi
fi

tag="full"
device="${MAESTRO_DEVICE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke) tag="smoke"; shift ;;
    --full) tag="full"; shift ;;
    --device) device="${2:-}"; shift 2 ;;
    --device=*) device="${1#*=}"; shift ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "e2e: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

# Device selection. An explicit --device always wins; otherwise take the single
# booted device, and refuse to guess when there is more than one -- picking one
# at random makes a failing run impossible to reproduce.
select_device() {
  local -a candidates=()

  if command -v adb >/dev/null 2>&1; then
    while read -r serial state _; do
      [[ "${state}" == "device" ]] && candidates+=("${serial}")
    done < <(adb devices | tail -n +2)
  fi

  if command -v xcrun >/dev/null 2>&1; then
    while read -r udid; do
      [[ -n "${udid}" ]] && candidates+=("${udid}")
    done < <(xcrun simctl list devices booted 2>/dev/null \
      | sed -n 's/.*(\([0-9A-Fa-f-]\{36\}\)).*/\1/p')
  fi

  if [[ ${#candidates[@]} -eq 0 ]]; then
    echo "e2e: no booted Android emulator or iOS simulator found." >&2
    echo "e2e: start one, install the app, then re-run." >&2
    exit 1
  fi

  if [[ ${#candidates[@]} -gt 1 ]]; then
    echo "e2e: more than one device is connected:" >&2
    printf 'e2e:   %s\n' "${candidates[@]}" >&2
    echo "e2e: choose one with --device <id> (or MAESTRO_DEVICE=<id>)." >&2
    exit 1
  fi

  printf '%s' "${candidates[0]}"
}

if [[ -z "${device}" ]]; then
  device="$(select_device)"
fi

readonly report="${report_dir}/junit-${tag}.xml"
readonly artifacts="${report_dir}/${tag}"
readonly dev_client_url="${E2E_DEV_CLIENT_URL:-muqun://expo-development-client-disabled}"
reconnect_dev_client=false
if [[ -n "${E2E_DEV_CLIENT_URL:-}" ]]; then
  reconnect_dev_client=true
fi
mkdir -p "${report_dir}"
rm -rf "${artifacts}"

echo "e2e: device  ${device}"
echo "e2e: tag     ${tag}"
echo "e2e: report  ${report}"
echo "e2e: dev client reconnect  ${reconnect_dev_client}"

# Flows run one after another against the single selected device; sharding is
# deliberately not used, because two flows sharing an emulator fight over the
# same app state.
set +e
"${maestro_bin}" --device "${device}" test \
  "${repo_root}/maestro" \
  --env "E2E_RECONNECT_DEV_CLIENT=${reconnect_dev_client}" \
  --env "E2E_DEV_CLIENT_URL=${dev_client_url}" \
  --include-tags "${tag}" \
  --format junit \
  --output "${report}" \
  --test-output-dir "${artifacts}" \
  --test-suite-name "muqun-e2e-${tag}" \
  --no-ansi
status=$?
set -e

if [[ ${status} -ne 0 ]]; then
  echo "e2e: FAILED (exit ${status}). Report: ${report}" >&2
  echo "e2e: screenshots and hierarchies: ${artifacts}" >&2
  exit "${status}"
fi

echo "e2e: passed. Report: ${report}"
