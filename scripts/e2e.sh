#!/usr/bin/env bash
# Full native agent-device gate; --smoke runs only demo-tour.
# E2E_AD_METRO_HOST / E2E_AD_METRO_PORT bind development builds to Metro.
set -euo pipefail
readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bun test "${repo_root}/scripts/__tests__/e2e-native.test.ts"
exec bun "${repo_root}/scripts/e2e-native-cli.ts" "$@"
