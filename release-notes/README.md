# Release notes

Before pushing a version tag, commit `vX.Y.Z.md` here. The APK workflow requires
that exact file and uses it as the GitHub Release description.

Describe user-visible improvements, fixes, required Gateway/Herdr versions and
upgrade steps. Include the APK installation instructions and any verified
cross-channel signing restrictions. Do not substitute a commit list for a
description of what changed.

APK CI compiles on GitHub's runner with EAS `--local`, `production-apk`, and
Expo-managed credentials. `EXPO_TOKEN` is the existing Actions secret. Keep the
same Expo project, package name and keystore as local builds. EAS environment
variables marked Secret are not downloaded for local builds; supply any needed
ones through Actions secrets. Never generate replacement signing credentials.

In GitHub, keep `EXPO_TOKEN` in **Settings → Secrets and variables → Actions**.
The token must belong to an Expo account with access to the existing
`osukis-team/muqun` project. No separate keystore secret or Play submission
credential is needed by this APK workflow. A missing managed keystore must be
resolved in the existing Expo project, without generating a new identity.

When a release is requested, set `app.json`'s `expo.version` to `X.Y.Z`, commit
the matching notes, complete the local checks, and release the reviewed commit
with tag `vX.Y.Z`. CI checks out that tag, builds the APK, and attaches
`muqun.apk` and `muqun.apk.sha256` to its Release. A manual run with an empty
`tag` input only stores build artifacts on the Actions run, even if the run
itself targets a tag. A nonempty input must name an existing `vX.Y.Z` tag and
publishes to that release. Neither mode submits to Play.

The APK profile inherits production's remote versionCode auto-increment. Local
builds and CI use that same Expo counter; coordinate releases so an older build
is not published after a newer one. APK output currently targets ARM64 devices,
as configured in `app.json`.

To verify APK/Play in-place updates, compare the public signing certificate
SHA-256 of the APK with Play Console's **App signing key certificate** (not its
upload certificate), and ensure versionCode increases. Matching package names
prevent two separate apps; matching certificates are also needed to update an
existing installation. Credentials being stored in Expo alone does not prove
that Play uses the same distribution signing certificate.

Use Android SDK's `apksigner verify --print-certs path/to/muqun.apk` to inspect
the APK's public certificate. Confirm its versionCode with
`apkanalyzer manifest version-code path/to/muqun.apk`, then test an upgrade on a
device with the Play-distributed app already installed. If the certificates
differ, stop and resolve the distribution strategy before promising seamless
switching; changing CI runners or creating another keystore will not fix it.
