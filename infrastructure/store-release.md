# Store builds and Hot Updater channels

Run these commands from the App checkout containing the reviewed commit. Android
requires the Android SDK/JDK; local iOS builds require macOS and Xcode. Authenticate
with EAS and configure the existing Expo-managed signing and store submission
credentials first. Never generate replacement signing identities.

Keep `.env.hotupdater` local and ignored. Native builds read only its public
`EXPO_PUBLIC_HOT_UPDATER_API_KEY`; they use the committed OTA public signing key.
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

Use the corresponding native build's `fingerprint.json` at the project root and
its matching source/dependency state. Configure the ignored provider credentials
and private signing-key path in `.env.hotupdater`. The scripts explicitly select
the channel and enable OTA; stale channel settings in that file cannot redirect them.

```sh
bun run update:preview android
bun run update:preview ios
bun run update:production android
bun run update:production ios
```

These publish OTA updates, not store binaries. Native dependency/configuration
changes require a new store build first. Preserve each native build's fingerprint;
do not generate a new one just to make an incompatible update deploy. Production
updates are separate from preview even when both binaries are tested through
Play internal testing or TestFlight.
