#!/usr/bin/env bash
# Local iOS release: build with EAS locally, prove the IPA is whole, then submit.
#
# Why the checks: React Native 0.86 decides whether to use its prebuilt
# ReactNativeDependencies with a single `curl -I` against Maven, and on any
# non-200 it silently compiles them from source while React core and Expo's
# frameworks keep expecting the separate prebuilt copy. The IPA then ships
# without `ReactNativeDependencies.framework` and aborts on launch before any
# JavaScript runs (TestFlight build 27, 2026-10-04, when the proxy path to
# repo1.maven.org blinked). So: refuse to start when Maven is unreachable, and
# refuse to submit an IPA that lacks the framework.
set -euo pipefail

cd "$(dirname "$0")/.."

rn_version=$(node -p "require('react-native/package.json').version")
artifact="https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${rn_version}/react-native-artifacts-${rn_version}-reactnative-dependencies-release.tar.gz"
echo "Checking prebuilt ReactNativeDependencies ${rn_version} on Maven…"
status=$(curl -sIL -o /dev/null -w '%{http_code}' --max-time 30 "$artifact" || true)
if [ "$status" != "200" ]; then
  echo "Maven answered ${status:-nothing} for ${artifact}" >&2
  echo "React Native would silently build the dependencies from source and the IPA would be missing" >&2
  echo "ReactNativeDependencies.framework. Fix the network (proxy) and run again." >&2
  exit 1
fi

export RCT_USE_RN_DEP=1
export RCT_USE_PREBUILT_RNCORE=1
export NODE_USE_ENV_PROXY=1
workdir=$(mktemp -d "${TMPDIR:-/tmp}/muqun-eas-ios.XXXXXX")
artifacts_dir="$PWD/dist/eas-builds"
mkdir -p "$artifacts_dir"

EAS_LOCAL_BUILD_WORKINGDIR="$workdir" EAS_LOCAL_BUILD_ARTIFACTS_DIR="$artifacts_dir" \
  eas build --platform ios --profile production --local

ipa=$(ls -t "$artifacts_dir"/*.ipa | head -1)
echo "Checking $ipa…"
if ! unzip -l "$ipa" | grep -q 'Frameworks/ReactNativeDependencies.framework/ReactNativeDependencies$'; then
  echo "The IPA has no ReactNativeDependencies.framework; it would crash on launch. Not submitting." >&2
  echo "Look for '[ReactNativeDependencies] Building from source: true' in the pod install log." >&2
  exit 1
fi
if ! unzip -l "$ipa" | grep -q 'Frameworks/React.framework/React$'; then
  echo "The IPA has no React.framework; refusing to submit." >&2
  exit 1
fi

echo "Submitting $ipa"
eas submit --platform ios --profile production --path "$ipa"
