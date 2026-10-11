# Muqun OTA updates on Cloudflare

This integration replaces Expo Updates with Hot Updater **1.0.0**. EAS still
builds and signs the native apps. The Expo project ID, `dev.osuki.muqun`, Android
keystore, Apple team and app-store identities are unchanged. Existing Expo
Updates binaries need a native APK/IPA upgrade; an OTA cannot replace their
native loader.

## Current activation state

OTA is **disabled unless `EXPO_PUBLIC_HOT_UPDATER_ENABLED=1` is explicitly supplied**.
Unconfigured local and EAS builds continue to launch and make no update requests.
Enabling it requires a registered client API key and a checked-in RSA public key;
configuration fails before the build if either is missing or invalid. Disabling
OTA is a build-time decision, not a remote kill switch for installed binaries.

The proposed client origin is `https://updates.muqun.dev`. No Cloudflare resources,
DNS records or releases have been deployed by this change. Template generation is
not proof of a running server. Do not announce OTA availability before the native
delivery and rollback checks below pass.

## Runtime behavior

After the root mounts, the app checks without delaying its splash, fonts, pairing,
terminal or navigation. Returning to the foreground can retry: one minute after
failure, fifteen minutes after a successful no-update check. Concurrent requests
are coalesced. A staged bundle stops further checks for this process.

The existing update banner interpolates measured download progress with the app's
reduced-motion-aware timing. Transfer sizes come from the native progress event's
current file counters, whether an archive or individual/diff artifacts are being
downloaded. Unknown totals stay omitted, and byte counts are never inferred from
the SDK's overall percentage, which also includes verification stages.
A download reaching 100% is not sufficient: the
download helper must confirm successful native verification and staging before
the app restarts automatically. The banner shows the actual release notes as
Markdown and changes to restarting while invoking the SDK's default reload:
a process restart on Android and a React reload on iOS. A failed restart keeps
the verified bundle staged and reports that the user can restart Muqun manually;
it never automatically retries or starts another download in that process.
This immediate restart can interrupt the current screen and unsent in-memory
draft; no new draft persistence or operation-waiting layer is introduced.
Installations running the previous next-launch behavior still need one launch
to adopt this updated behavior.
Adopting a new release for the already-running artifact is silent and retains
normal periodic checks; it does not display a misleading restart notice.
Checks and download failures leave the current app usable; request details and
credentials are not logged. There is no extra settings page or analytics plugin.

Hot Updater's native loader verifies the new bundle's first render and recovers
to the last stable/embedded bundle after a failed startup. This upstream behavior
still needs an actual release-build rollback test; unit tests do not establish it.

## Prepare infrastructure locally

Use Bun 1.4.2 and the committed lockfile:

```sh
bun install --frozen-lockfile
bun run update:prepare
```

This extracts the exact installed version's official Worker bundle, D1 migrations,
client-credential helper, setup instructions and deployment journal into ignored
`infrastructure/hot-updater/`. It chooses Worker name `muqun-updates`, disables
`workers.dev`, and adds the custom domain route `updates.muqun.dev`. It performs no
remote operation. Re-running preserves the scaffold's resource IDs and journal.

Follow its `COMMON.md`, `SETUP.md` and `ENVIRONMENT.md` in order. Verify existing
resources before creation and after ambiguous failures. Use a private R2 bucket
and D1 database named `muqun-updates`. Keep the official `DB`/`BUCKET` bindings,
versioned migrations and Worker runtime together. The Worker needs R2 S3 access
credentials as Worker secrets to sign temporary artifact download URLs; its
public endpoint does not mount administrative bundle-management routes.

Copy `.env.hotupdater.example` to ignored `.env.hotupdater` and fill only real
values. This file is CLI-only, excluded from EAS and never imported by runtime
code. The provider API token and R2 secrets never use `EXPO_PUBLIC_` names.
Provision the managed server's client credential with the generated
`app/provision-client-credential.mjs` helper after migrations. This client key is
an app-distributed access credential, **not** a Cloudflare token, admin key or
signing secret. Do not substitute one for another.

Run the generated verification helper and `hot-updater doctor` against the actual
custom domain after deployment. Verify unauthenticated catalog requests are
rejected, authenticated catalog reads work, and downloaded artifacts validate.

## Signing and native compatibility

OTA signing is separate from APK/IPA signing. Preserve any existing OTA signer;
do not rotate app signing credentials. For a first OTA signer, use the official
`hot-updater keys generate` workflow in a private directory and retain a secure
backup. Keep the private key outside the repository and native build inputs.
Commit only its matching SPKI RSA public key (at least 2048 bits) at
`keys/hot-updater-public.pem`. Set `HOT_UPDATER_SIGNING_PRIVATE_KEY_PATH` only on
the deployment machine. Production OTA signing is always enabled in CLI config.

Supply these **public** values to both native and OTA build environments:

```text
EXPO_PUBLIC_HOT_UPDATER_ENABLED=1
EXPO_PUBLIC_HOT_UPDATER_API_KEY=<registered client credential>
HOT_UPDATER_CHANNEL=ota-test
```

`preview`/`testflight` EAS profiles embed `preview`; `production` and its APK
profile embed `production`. Local builds default to `development`. Choose
`ota-test` explicitly for the first native acceptance build. Changing channel,
trust anchor or native dependencies requires rebuilding the binary.

Both client and CLI use `fingerprint`. The Expo plugin generates and embeds the
hash during prebuild. Extra sources explicitly cover app config, config plugins,
the app-owned native theme transport and dependency patches. Before adopting a
release hash, verify that editing a native Kotlin/Swift file causes a stale
fingerprint report, then restore it. Do not include generated manifest/plist
hash fields in extra sources, which would make the hash self-referential.

Archive `fingerprint.json` from the **actual native release build** alongside its
commit, channel and public-key digest. It is deliberately ignored here because
a local disabled prebuild is not a released compatibility baseline. Restore that
exact file into the OTA checkout before deploying; never regenerate it simply
to bypass a mismatch. A native change requires a new binary first.

## Deploy only after native acceptance

Deployment remains an explicit local operator action; there is no automatic
push-triggered OTA workflow. The wrappers require real provider credentials,
enabled/signed app configuration, matching channel and an existing release
fingerprint before invoking Hot Updater:

```sh
bun run update:preview android
bun run update:preview ios
# After review and native compatibility verification:
bun run update:production android
bun run update:production ios
```

Use one platform at a time and stop after a failure. Never run `eas update` for
this branch. Older Expo Updates installations retain their old update mechanism
until they install the new binary; keep any legacy release operations separate.

## Play preview package

`bun run build:android:local preview` produces a signed store AAB with Hot
Updater explicitly enabled on the `preview` channel. It inherits production's
remote EAS signing credentials and versionCode increment; the application ID and
Expo project stay unchanged. It does not upload, submit, tag or publish anything.
The build uses `--freeze-credentials` and fails rather than generating new signing credentials.
`bun run submit:android preview --path /path/to/verified.aab` submits that exact
artifact to Play internal testing with a completed release. It does not rebuild
or publish to the public production track. See [store release commands](../infrastructure/store-release.md)
for production and iOS equivalents.

The wrapper accepts the registered public `EXPO_PUBLIC_HOT_UPDATER_API_KEY` from
the environment or ignored `.env.hotupdater`. It validates the committed public
trust anchor before starting and excludes provider credentials and the private OTA
signer from the child environment. `HOT_UPDATER_NATIVE_BUILD=1` prevents the config
loader from importing deployment credentials during native packaging. The private
signer is needed only when publishing signed OTA artifacts, not when building a
native application that verifies them.

Artifacts land under a unique `dist/eas-builds/android-preview-*/` directory, together with
the fingerprint generated inside that exact native build. Preserve this fingerprint
for subsequent OTA releases. Raw EAS logs can contain app signing credentials on
failure, so the wrapper captures them privately and deletes them with the temporary
build workspace after success or failure. It never prints the job payload. A failed
build reports only its exit status and fixed phase/error-category labels, never
arbitrary log lines.

Before handing off a Play preview AAB, verify its JAR signature with `jarsigner
-verify` and compare the certificate SHA-256 from `keytool -printcert -jarfile`
against an existing signed release AAB. Use official bundletool's `dump manifest`
to verify package ID, increased versionCode, `com.hotupdater.CHANNEL=preview`,
`com.hotupdater.FINGERPRINT_HASH` matching the archived `fingerprint.json`, and
the configured public key. Confirm no `expo.modules.updates.*` metadata remains.
These checks prove the upload artifact's identity; they do not prove Google's
Play App Signing distribution certificate matches a separately installed APK.

## Acceptance before enabling for users

1. Run TypeScript, lint, format, unit tests and the complete native E2E suite.
2. Build Release APK and IPA with the test channel, registered client key,
   public trust anchor and fingerprint. Keep existing app signing identities.
3. Confirm cold launch and normal terminal use with the server offline; bring it
   online and confirm checks and failed downloads leave the live screen usable.
4. Publish a compatible test bundle with a visible text and asset change. Verify
   verified download, automatic restart and unchanged persisted pairing/session data.
5. Interrupt a download and retry; reject a tampered/wrongly signed artifact and
   a mismatched native fingerprint. The previously working app must remain usable.
6. Test a deliberately failing startup bundle on dedicated QA and verify native
   recovery. Disable/roll back that release through the authenticated operator
   workflow. Never clear crash history as a normal retry mechanism.
7. Repeat on iOS; Android evidence cannot claim iOS native compatibility.

## Sources checked

- [Installation](https://hot-updater.dev/docs/get-started/installation)
- [Expo adapter and native plugin](https://hot-updater.dev/docs/build-adapters/expo)
- [App setup](https://hot-updater.dev/docs/get-started/app-setup)
- [Cloudflare infrastructure templates](https://hot-updater.dev/docs/guides/agent-infrastructure)
- [Fingerprint compatibility](https://hot-updater.dev/docs/guides/update-strategies/fingerprint)
- [Bundle signing](https://hot-updater.dev/docs/guides/bundle-signing)
- [Automatic rollback](https://hot-updater.dev/docs/concepts/automatic-rollback)
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)

The current Cloudflare guide still contains some v0 snippets. This implementation
uses the installed **v1.0.0** SDK/plugin types and official v1 scaffold, including
`HotUpdater.init()` and the plugin supplied by `@hot-updater/expo`.
