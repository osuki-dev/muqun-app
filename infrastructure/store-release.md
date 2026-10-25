# Store builds and Hot Updater channels

Run these commands from the App checkout containing the reviewed commit. Android
requires the Android SDK/JDK; local iOS builds require macOS and Xcode. Authenticate
with EAS and configure the existing Expo-managed signing and store submission
credentials first. Never generate replacement signing identities.

Keep `.env.hotupdater` local and ignored. Native builds and submissions pass only its
public `EXPO_PUBLIC_HOT_UPDATER_API_KEY` to EAS, which evaluates app configuration
for both commands. Native builds use the committed OTA public signing key.
Provider credentials and the private OTA signing key are for OTA publishing only.
Both native release channels enable Hot Updater explicitly.

## Build and upload

| Destination               | Preview channel                         | Production channel                         |
| ------------------------- | --------------------------------------- | ------------------------------------------ |
| Play internal testing     | `bun run release:android:local preview` | `bun run release:android:local production` |
| TestFlight (run on macOS) | `bun run release:ios:local preview`     | `bun run release:ios:local production`     |

Each release command builds locally, freezes the existing signing credentials, and
submits **only that invocation's artifact**. It waits for EAS submission to finish.
A failed build or missing/ambiguous artifact stops submission. Private build and
submission logs are deleted because EAS failures can contain signing credentials.
The artifact and native `fingerprint.json` remain together in a unique directory
under `dist/eas-builds/`. A submission failure never triggers a rebuild or retry;
check its status in Expo before submitting the retained artifact again.

Local Android builds use a per-invocation temporary directory under
`~/.cache/muqun-store-builds` for EAS and Java. It must stay outside the checkout:
EAS copies the project into its own temporary directory, which fails when that
directory is inside the project. The home filesystem is used instead of the system
temporary filesystem, which may be a small tmpfs. The wrapper preserves existing
`_JAVA_OPTIONS`, appends the Java temporary path, and disables reusable Gradle
daemons for that build. Temporary files are removed when the command finishes;
ensure that filesystem has build space.

For build-only, use the same command with `build` instead of `release`:

```sh
bun run build:android:local preview
bun run build:android:local production
bun run build:ios:local preview
bun run build:ios:local production
```

To upload a previously verified artifact without rebuilding, supply its exact path:

```sh
bun run submit:android preview --path /path/to/preview.aab
bun run submit:android production --path /path/to/production.aab
bun run submit:ios preview --path /path/to/preview.ipa
bun run submit:ios production --path /path/to/production.ipa
```

Choose the channel that was baked into that artifact. A submit command does not
change its channel or infer it from its filename. No command selects the newest
artifact from a shared folder. `submit:android:latest` has been removed.

Both Android channels upload to the existing **internal** Play track with a completed
release, ready for testing after Google processing. Both iOS channels upload to
**TestFlight**, subject to Apple's processing and test review. Neither command
publishes a public store release. The channel is independent of the store track:
it chooses which Hot Updater updates the installed binary accepts. For a public
release, test a **production-channel** binary first, then promote that same build
in Play Console or App Store Connect. Do not promote a preview-channel binary to
public production; moving store tracks does not change its embedded OTA channel.
Android variants share the same app identity and require increasing versionCodes.

There are six store commands: `build:<platform>:local`, `release:<platform>:local`,
and `submit:<platform>`, where platform is `android` or `ios`. Each requires an
explicit `preview` or `production` argument; there is no default channel. Old
cloud-build, channel-specific aliases, and implicit-latest helpers are removed.
`release:android:local` and `release:ios:local` keep their names, but now require
the channel argument instead of silently selecting production.

Android store distribution uses AAB only. APKs remain an implementation detail of Android
development builds or local bundletool extraction for emulator checks. Play testing
validates the uploaded AAB; promote the same tested production-channel build for a
public release instead of rebuilding it.

## Publish a JavaScript update

Successful local builds automatically record their native OTA target in
`.hot-updater/native-builds/<channel>/<platform>.json`. Each channel/platform has
an independent, atomically written record containing the complete fingerprint,
artifact filename, SHA-256 and recording time. Failed builds do not replace it.
The original fingerprint also stays beside its artifact under `dist/eas-builds/`.
Build-only commands register targets too: built does not mean submitted or installed.
Install and test that exact binary before publishing an update for it.

Update commands automatically select the explicit channel/platform record, without
searching artifacts or using an unrelated root fingerprint. Missing or mismatched
records stop publication. Native source/dependencies must still match the binary;
the CLI compatibility check remains enabled. The wrapper temporarily supplies the
selected fingerprint to the CLI and restores the original root file after success
or failure. A per-checkout lock rejects concurrent deployments.

After a killed process, verify no deployment is running before restoring
`.hot-updater/native-deploy.lock/fingerprint.backup` to the root fingerprint
(or removing the root fingerprint if there was no backup), then remove the lock.
Never automatically retry an ambiguous publication.

Records are ignored by Git and EAS. When moving to another checkout or machine,
copy the exact channel/platform record too. Fingerprint sources can contain local
build paths; do not commit them. OTA does not require the large artifact to remain.
Configure the ignored provider credentials
and private signing-key path in `.env.hotupdater`. The scripts explicitly select
the channel and enable OTA; stale channel settings in that file cannot redirect them.

Keep localized OTA note manifests local and ignored under `release-notes/`;
never commit them. Versioned `vX.Y.Z.md` release notes remain repository documents.

```sh
bun run update:preview android release-notes/ota-notes.json
bun run update:preview ios release-notes/ota-notes.json
bun run update:production android release-notes/ota-notes.json
bun run update:production ios release-notes/ota-notes.json
bun run update:preview both release-notes/ota-notes.json
bun run update:production both release-notes/ota-notes.json
```

`both` composes the official `{ ios, android, inputs }` fingerprint from each
platform's completed native build. It requires both records and matching input
configuration. Channel metadata lives outside that official format: a fingerprint
is a compatibility identity, not a channel, and two channels can share one hash.
The CLI builds/uploads both platforms and commits both disabled releases in one
transaction. Both releases' localized notes are verified before either is enabled.
Enablement uses separate guarded policy writes; if the second fails, the first
may already be enabled. The command reports exact release IDs and stops without
retrying. Do not launch competing commands in the same checkout; use `both`.

Hot Updater also supports promoting a tested preview update to production with
`hot-updater bundle promote <source-id> --target production`. Promotion reuses the
uploaded artifact and keeps its platform/fingerprint; verify the production
native target matches. It creates a new enabled release with 100% rollout, so
review policy and localized release-note handling before using the direct CLI.
It does not switch an installed app's native channel.

References: [fingerprint format](https://hot-updater.dev/docs/guides/update-strategies/fingerprint),
[dual-platform deploy](https://hot-updater.dev/docs/guides/deploy), and
[promotion](https://hot-updater.dev/docs/guides/console#promote).

These publish OTA updates, not store binaries. Native dependency/configuration
changes require a new store build first. Preserve each native build's fingerprint;
do not generate a new one just to make an incompatible update deploy. Production
updates are separate from preview even when both binaries are tested through
Play internal testing or TestFlight.
