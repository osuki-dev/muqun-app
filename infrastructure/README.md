# Muqun OTA updates on Cloudflare

This integration uses Hot Updater, pinned with its adapters in `package.json`. EAS still
builds and signs the native apps. The Expo project ID, `dev.osuki.muqun`, Android
keystore, Apple team and app-store identities are unchanged. Native loader changes
require a store build.

## Activation configuration

OTA is **disabled unless `EXPO_PUBLIC_HOT_UPDATER_ENABLED=1` is explicitly supplied**.
Unconfigured local and EAS builds continue to launch and make no update requests.
Enabling it requires a registered client API key and a checked-in RSA public key;
configuration fails before the build if either is missing or invalid. Disabling
OTA is a build-time decision, not a remote kill switch for installed binaries.

The client origin is `https://updates.muqun.dev`. Verify deployed resources and
native delivery using the checks below; generating the local scaffold does not
provision infrastructure or establish release readiness.

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
Adopting a new release for the already-running artifact is silent and retains
normal periodic checks; it does not display a misleading restart notice.
Checks and download failures leave the current app usable; request details and
credentials are not logged. There is no extra settings page or analytics plugin.

Before presenting the consent prompt (including mandatory updates), the app asks
`GET /release-notes/<release-id>?locale=<active-ui-locale>` with its existing
public client API key. The server returns one Markdown note: exact locale, then
language, then English. It never sends a translation map or changes the shared
catalog for a locale. A missing endpoint or network failure retains the catalog's
English `message`. The existing Markdown preview, measured progress and verified
restart behavior remain the same. Notes are retained for the current update
prompt, including download/restart retries; locale selection occurs at discovery.

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

The preparation command then selects the committed
[`ota-notes/worker.ts`](ota-notes/worker.ts) entry point, adds the same
`localized_release_notes` plugin to the generated tooling server and CLI, and
copies its additive migration as `0002_localized_release_notes.sql`. Wrangler
bundles this source using the pinned root dependencies rather than deploying
the upstream prebuilt Worker. Apply both migrations before deploying this Worker
and before publishing any release with localized notes. Its client route uses
the existing API-key authentication; no administrative routes are exposed.
The generated Worker package uses the latest Wrangler CLI, invoked with
`bunx wrangler`; Hot Updater and its adapters use the root package pins. If the
scaffold already has older Wrangler dependencies installed, rerun `bun install`
after preparation before checking the CLI version or starting local validation.

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

OTA signing is separate from native app signing. Preserve any existing OTA signer;
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
HOT_UPDATER_CHANNEL=preview
```

The `play-preview` and `testflight` EAS profiles embed `preview`; `production`
embeds `production`. Local development builds default to `development`. Use the
explicit preview [store release commands](store-release.md) for the first native
acceptance build. Changing channel, trust anchor or native dependencies requires
rebuilding the binary.

Both client and CLI use `fingerprint`. The Expo plugin generates and embeds the
hash during prebuild. Extra sources explicitly cover app config, config plugins,
the app-owned native theme transport and dependency patches. Before adopting a
release hash, verify that editing a native Kotlin/Swift file causes a stale
fingerprint report, then restore it. Do not include generated manifest/plist
hash fields in extra sources, which would make the hash self-referential.

Successful local native builds register their exact compatibility records by
channel and platform. OTA publishing selects those records automatically; do not
manually replace the root fingerprint or regenerate one to bypass a mismatch.
Native-input changes require a new binary first. See [store and OTA release
commands](store-release.md) for record locations, compatibility checks and recovery.

## Deploy only after native acceptance

Deployment is an explicit local operator action; there is no push-triggered OTA
workflow. Use the [store and OTA release commands](store-release.md) for
single-platform or combined Android/iOS publication. The wrappers require real
provider credentials, enabled/signed app configuration and compatible native
records for every selected platform.

The notes file is a reviewed JSON object mapping locale tags to Markdown strings.
English (`en`) is required; other locales are optional. For example:

```json
{
  "en": "## Fixed\n- Restored drafts after reconnecting.",
  "en-GB": "## Fixed\n- Restored drafts after reconnecting."
}
```

Validation occurs before any build or remote mutation: 1–32 unique locales,
nonempty Markdown, and at most 16,000 characters per note. Locale tags are stored
case-insensitively. The wrapper deploys **disabled** with the English catalog
message, reads the pinned CLI's exact commit receipt for each selected platform,
and checks each release's disabled state, channel, platform and native fingerprint. It then
uploads immutable `(release_id, locale)` rows with provider-backed server tooling,
reads every translation back through the authenticated Worker endpoint, and
verifies all selected releases before enabling their expected revisions. Enablement
is sequential, not an atomic cross-platform transaction: inspect every reported
release after a failure before retrying. A known disabled release's notes can
be read with the client key for this check; it is still absent from the release
catalog. A missing or outdated Worker endpoint leaves publication disabled.
Provider credentials remain on the deployment machine; the app receives only
its public client key and one resolved note. Captured build/provider output stays
in a private temporary file (mode `0600`, inside a `0700` directory). Successful
runs delete it. Failed runs, including provider cleanup failures, retain the log
and print only its path and fixed failure labels, so the operator can inspect
the cause privately. Never paste these logs into shared reports or commit them.

A notes upload/readback failure does not enable the release. There is no automatic
retry, latest-release lookup or automatic cleanup of ambiguous writes. If a deploy
receipt or enablement response is lost, inspect the exact release and catalog
before any retry. Replacing published notes requires a new release; direct CLI or
console enablement bypasses this wrapper's notes gate and must not be used for
the localized publishing workflow.

## Native artifact acceptance

Build, submit, artifact storage and signing-environment details are maintained in
[store release commands](store-release.md). Native packaging uses only the public
OTA trust anchor and client credential; provider credentials and the private OTA
signer belong only on the publishing machine. Preserve the exact native records.

Before handing off a Play preview AAB, verify its JAR signature with `jarsigner
-verify` and compare the certificate SHA-256 from `keytool -printcert -jarfile`
against an existing signed release AAB. Use official bundletool's `dump manifest`
to verify package ID, increased versionCode, `com.hotupdater.CHANNEL=preview`,
`com.hotupdater.FINGERPRINT_HASH` matching the archived `fingerprint.json`, and
the configured public key.
These checks prove the upload artifact's identity. Final upgrade acceptance uses
the Play-distributed app, which is signed with Google's Play App Signing
distribution certificate rather than the AAB's upload certificate.

## Acceptance before enabling for users

1. Run TypeScript, lint, format, unit tests and the complete native E2E suite.
2. Use the preview [store release commands](store-release.md) to build and upload
   an Android AAB to Play internal testing and an iOS IPA to TestFlight with the
   registered client key, public trust anchor and fingerprint. Keep existing app
   signing identities and install each test build through its store testing channel.
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
8. Before a public release, repeat acceptance with a production-channel candidate
   in Play internal testing or TestFlight, then promote that exact tested build
   through Play Console or App Store Connect.

## References

- [Installation](https://hot-updater.dev/docs/get-started/installation)
- [Expo adapter and native plugin](https://hot-updater.dev/docs/build-adapters/expo)
- [App setup](https://hot-updater.dev/docs/get-started/app-setup)
- [Cloudflare infrastructure templates](https://hot-updater.dev/docs/guides/agent-infrastructure)
- [Fingerprint compatibility](https://hot-updater.dev/docs/guides/update-strategies/fingerprint)
- [Bundle signing](https://hot-updater.dev/docs/guides/bundle-signing)
- [Automatic rollback](https://hot-updater.dev/docs/concepts/automatic-rollback)
- [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/)

Use the installed SDK/plugin types and generated scaffold when upstream examples
differ from the pinned version.
