#!/usr/bin/env bash
# One native flow, with the same reporting and runtime binding as the full gate.
set -euo pipefail
readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -gt 0 && "$1" != -* ]]; then
  script="$1"
  shift
  exec bash "${repo_root}/scripts/e2e.sh" --script "${script}" "$@"
fi
if [[ $# -eq 0 ]]; then
  exec bash "${repo_root}/scripts/e2e.sh" --flow ssh
fi
exec bash "${repo_root}/scripts/e2e.sh" "$@"
