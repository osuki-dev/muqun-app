# Release notes

Before an authorized version tag, commit `vX.Y.Z.md` here from the reviewed,
tested commit. Use it as the GitHub Release description. Include user-visible
improvements, fixes, required App/Gateway/Herdr versions, and store upgrade steps;
an automated commit list is not a substitute.

The next native release is [v4.0.0](v4.0.0.md). It includes the work originally
planned for 3.1; there is no separate 3.1 release-notes document.

Android distribution uses AAB through Play; iOS uses IPA through TestFlight and
App Store Connect. There is no separate APK publication or tag-triggered binary
build. The shared [store release commands](../infrastructure/store-release.md) build locally
with EAS and preserve the existing Expo project, package identity, and signing
credentials. Missing credentials must be resolved without generating replacements.

Use preview-channel builds for ongoing testing. For a public release, build a
production-channel candidate, validate that exact binary in Play internal testing
or TestFlight, then promote it in the store console. Do not rebuild after acceptance
or promote a preview-channel binary: store track changes do not change OTA channels.
Preserve the candidate's checksum and native fingerprint with its build record.

EAS manages the shared Android versionCode and iOS buildNumber counters. Coordinate
builds so an older candidate is not submitted after a newer one. Final Android
upgrade acceptance uses the Play-distributed app; an APK extracted for an emulator
does not prove Play App Signing compatibility or store delivery.

When a release is requested, set `app.json`'s `expo.version` and `package.json`'s
`version` together. The Expo version is the native marketing version;
`app.config.ts` forwards it and EAS increments the build counters separately.
Write matching notes, complete the repository checks and store acceptance, then
tag that reviewed commit. A marketing-version or native-input change requires
a new store build and its own archived fingerprint; an OTA cannot rename an
already submitted binary or adopt its fingerprint for a different native build.
Store submission and public release are explicit actions, never side effects of
committing or tagging.
