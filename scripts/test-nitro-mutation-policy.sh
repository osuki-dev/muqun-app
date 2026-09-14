#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
cronet_api_aar=${CRONET_API_AAR:-}
if [[ -z "$cronet_api_aar" ]]; then
  gradle_cache=${GRADLE_USER_HOME:-"$HOME/.gradle"}
  cronet_api_aar=$(rg --files "$gradle_cache/caches/modules-2/files-2.1/org.chromium.net/cronet-api/143.7445.0" | rg '/cronet-api-143\.7445\.0\.aar$' | head -n 1)
fi
if [[ ! -f "$cronet_api_aar" ]]; then
  echo 'Set CRONET_API_AAR to the pinned Cronet 143.7445.0 API AAR after Android dependency resolution.' >&2
  exit 1
fi
scratch=$(mktemp -d "${TMPDIR:-/tmp}/muqun-mutation-policy.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
unzip -p "$cronet_api_aar" classes.jar > "$scratch/cronet-api.jar"
# Compile the installed patched helper that the actual Android build consumes.
javac -cp "$scratch/cronet-api.jar" -d "$scratch/classes" \
  "$repo_dir/node_modules/react-native-nitro-fetch/android/src/main/java/com/margelo/nitro/nitrofetch/MutationUploadPolicy.java" \
  "$repo_dir/tests/native/MutationUploadPolicyTest.java"
java -cp "$scratch/classes:$scratch/cronet-api.jar" MutationUploadPolicyTest
