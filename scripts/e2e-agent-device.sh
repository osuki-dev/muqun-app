#!/usr/bin/env bash
#
# Replay an agent-device `.ad` flow against whichever Metro and whichever
# device this machine actually has.
#
#   bash scripts/e2e-agent-device.sh                       # ssh-demo.ad, the defaults
#   bash scripts/e2e-agent-device.sh --test                # ... with a JUnit report
#   bash scripts/e2e-agent-device.sh e2e/agent-device/ssh-demo.android.ad
#   E2E_AD_METRO_PORT=8112 E2E_AD_DEVICE=my-sim \
#     bash scripts/e2e-agent-device.sh                     # someone else's Metro
#
# Environment (all optional; every default is what the committed script says):
#
#   E2E_AD_SCRIPT       flow to run           default e2e/agent-device/ssh-demo.ad
#   E2E_AD_METRO_HOST   Metro host            default: the script's own
#   E2E_AD_METRO_PORT   Metro port            default: the script's own
#   E2E_AD_DEVICE       simulator/emulator    default: the script's `context device=`
#   E2E_AD_PLATFORM     ios|android           default: the script's `context platform=`
#   E2E_AD_TIMEOUT      ms                    default 300000
#   AGENT_DEVICE_BIN    agent-device binary   default: whatever is on PATH
#
# Why a runner rather than parameters in the `.ad` file
# ----------------------------------------------------
# Two of the three knobs are already overridable and one is not, and the one
# that is not is the reason this file exists.
#
#   * `--device` and `--platform` are replay/test *command* flags and they win
#     over the `context` line, which is recorded metadata. A script whose
#     `context` says `device="muqun-home"` replays happily on another
#     simulator when `--device` names it. Verified on agent-device 0.20.10.
#   * `--metro-host` / `--metro-port` are also replay command flags, but they
#     are session hints that do *not* reach a scripted `open`: the port that
#     is written into the simulator's React Native debug-server prefs is the
#     one on the `open` line inside the script. Passing `--metro-port` to
#     `replay` while the script's own `open` carries a different port launches
#     the app against the script's port. Verified the same way: the app came
#     up on "No script URL provided" with the flag set and no port on the
#     `open` line.
#   * agent-device's own `${NAME}` interpolation (`--env NAME=value`) is for
#     `fill`/`type` *values* -- the secret-safe `--record-as` mechanism. It is
#     not applied to command flags: `--metro-port "${METRO_PORT}"` with
#     `--env METRO_PORT=8112` reaches the daemon unresolved and the launch
#     falls back to no script URL at all. Also verified.
#
# So the port has to be in the file at replay time, and the only honest way to
# have both a committed default and an override is to render the file. That is
# all this does: a one-line `sed` on the `open` line, into a temp copy, which
# `replay`/`test` then read (script paths resolve on the caller's machine, so
# a temp copy is a first-class input). The committed `.ad` keeps its literal
# `8098`, so `agent-device replay e2e/agent-device/ssh-demo.ad --platform ios
# --device "muqun-home"` still works exactly as the README says.
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly report_dir="${E2E_REPORT_DIR:-${repo_root}/dist/e2e-reports}/agent-device"

agent_device_bin="${AGENT_DEVICE_BIN:-}"
if [[ -z "${agent_device_bin}" ]]; then
  if command -v agent-device >/dev/null 2>&1; then
    agent_device_bin="$(command -v agent-device)"
  else
    echo "e2e-agent-device: agent-device is not on PATH." >&2
    echo "e2e-agent-device: set AGENT_DEVICE_BIN to its absolute path." >&2
    exit 127
  fi
fi

mode="replay"
script="${E2E_AD_SCRIPT:-e2e/agent-device/ssh-demo.ad}"
extra=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --test) mode="test"; shift ;;
    --replay) mode="replay"; shift ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; extra+=("$@"); break ;;
    -*) extra+=("$1"); shift ;;
    *) script="$1"; shift ;;
  esac
done

[[ "${script}" = /* ]] || script="${repo_root}/${script}"
if [[ ! -f "${script}" ]]; then
  echo "e2e-agent-device: no such flow: ${script}" >&2
  exit 2
fi

# The `context` line is the script's own record of what it was authored
# against, and it is where the defaults come from when the caller names none.
context_value() {
  # `context platform=ios device="muqun-home" kind=simulator ...`
  sed -n '1,5p' "${script}" |
    grep -m1 '^context ' |
    sed -n "s/.*[[:space:]]$1=\"\{0,1\}\([^\"[:space:]]*\)\"\{0,1\}.*/\1/p"
}

platform="${E2E_AD_PLATFORM:-$(context_value platform)}"
device="${E2E_AD_DEVICE:-$(context_value device)}"
timeout_ms="${E2E_AD_TIMEOUT:-300000}"

if [[ -z "${platform}" ]]; then
  echo "e2e-agent-device: no platform on the script's context line; set E2E_AD_PLATFORM." >&2
  exit 2
fi
if [[ -z "${device}" ]]; then
  echo "e2e-agent-device: no device on the script's context line; set E2E_AD_DEVICE." >&2
  exit 2
fi

# Render the flow only when a Metro override was actually asked for, so an
# unmodified run replays the committed bytes and nothing else.
flow="${script}"
rendered=""
if [[ -n "${E2E_AD_METRO_HOST:-}" || -n "${E2E_AD_METRO_PORT:-}" ]]; then
  if ! grep -q -- '--metro-port' "${script}"; then
    echo "e2e-agent-device: ${script} has no --metro-port on its open line;" >&2
    echo "e2e-agent-device: nothing to override. Add one, or unset E2E_AD_METRO_*." >&2
    exit 2
  fi
  # A directory, so the copy can keep the `.ad` name the parser expects.
  render_dir="$(mktemp -d "${TMPDIR:-/tmp}/muqun-ad-XXXXXX")"
  rendered="${render_dir}/$(basename "${script}")"
  trap 'rm -f "${rendered}"; rmdir "${render_dir}" 2>/dev/null || true' EXIT
  cp "${script}" "${rendered}"
  if [[ -n "${E2E_AD_METRO_PORT:-}" ]]; then
    sed -i '' -e "s/--metro-port [0-9][0-9]*/--metro-port ${E2E_AD_METRO_PORT}/" "${rendered}" \
      2>/dev/null ||
      sed -i -e "s/--metro-port [0-9][0-9]*/--metro-port ${E2E_AD_METRO_PORT}/" "${rendered}"
  fi
  if [[ -n "${E2E_AD_METRO_HOST:-}" ]]; then
    sed -i '' -e "s/--metro-host [^ ]*/--metro-host ${E2E_AD_METRO_HOST}/" "${rendered}" \
      2>/dev/null ||
      sed -i -e "s/--metro-host [^ ]*/--metro-host ${E2E_AD_METRO_HOST}/" "${rendered}"
  fi
  flow="${rendered}"
fi

echo "e2e-agent-device: ${mode} $(basename "${script}") on ${platform}/${device}"
grep -m1 '^open ' "${flow}" | sed 's/^/e2e-agent-device:   /'

# Deliberately not `exec`: replacing the process image would skip the EXIT
# trap, and the rendered copy would be left behind in the temp directory.
if [[ "${mode}" == "test" ]]; then
  mkdir -p "${report_dir}"
  "${agent_device_bin}" test "${flow}" \
    --platform "${platform}" --device "${device}" --timeout "${timeout_ms}" \
    --artifacts-dir "${report_dir}" \
    --reporter "junit:${report_dir}/junit.xml" \
    "${extra[@]+"${extra[@]}"}"
else
  "${agent_device_bin}" replay "${flow}" \
    --platform "${platform}" --device "${device}" --timeout "${timeout_ms}" \
    "${extra[@]+"${extra[@]}"}"
fi
