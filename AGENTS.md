# Contributing to Muqun

- Read the [Expo SDK 58 documentation](https://docs.expo.dev/versions/v58.0.0/)
  before changing code.
- Write repository documentation, release notes, and bundled skill instructions
  in English. UI localization is separate.
- Work on a branch. Complete development and the checks below before opening a
  ready pull request; report failures or unavailable checks accurately.
- Never commit credentials, private logs, personal paths, or workstation setup.
- Use the latest stable Bun; do not pin an older tool version in `package.json`
  or `eas.json`. Use the installed toolchain without automatically upgrading it
  during installation, builds, tests, or deployment. EAS uses its environment's
  Bun version; update toolchains separately when requested.
  Keep dependency versions governed by the committed `bun.lock`.

## Validation

Run focused tests during development, then these checks on the final candidate:

```sh
npx tsc --noEmit
bun run lint
bun run format:check
bun test src
bash scripts/e2e.sh
```

Lint uses oxlint with warnings denied; formatting uses oxfmt. Use
`// oxlint-disable-next-line <rule> -- <reason>` only for a justified exception.

Tests: only core modules need unit tests. Those are wire and protocol
contracts (transport envelopes, pairing, sockets and streams, agent and task
ledger shapes, upload bodies, OTA metadata, route parameters), security rules
(who gets which credential, what is refused, path and URL fences) and logic
with real failure modes (history paging and cursors, ordering and dedupe,
state machines, timeline compaction, diff parsing). Do not write tests for
constants, layout numbers, labels, one-line helpers, rendering or catalogs;
the end-to-end suite is the device acceptance for those. A reviewer may delete
a test that does not meet this rule.

Native tests use the latest stable agent-device and the existing `.ad` runner.
Do not require an exact agent-device version or reject newer releases solely
because their version differs. Record the actual version in test reports and
validate command/output compatibility with the runner. Add new
surface coverage to `e2e/agent-device/suite.json` with the `full` tag. Use
`bash scripts/e2e.sh --check` for syntax validation, `--list` for flows, and
`--tag <domain>` or `--flow <name>` for focused runs. A smoke or domain run does
not replace the complete suite. Quote actual results in the PR; reports under
`dist/e2e-reports/` are uncommitted output.

Use a dedicated, unpaired QA device with the app installed and English selected.
Never automate a user's device or paired workspace. Reuse available QA devices,
serialize access, and verify device identity before every run. Pass explicit
`--device ID --platform android|ios` to the runner and `--serial` or `--udid` to
all direct agent-device commands. Run `agent-device --version` and read
`agent-device help workflow` plus the relevant debugging help first. Resolve
installed tooling first; installing or updating to the latest stable release is
allowed when needed. Do not downgrade solely to match an old version pin. For
React Native development builds, set `E2E_AD_METRO_HOST` and
`E2E_AD_METRO_PORT` as needed. Claim platform coverage only for tested platforms.

## Agent integration

Detect optional Gateway capabilities rather than guessing from versions.
Collaboration requires `agent_collaboration` and a connected Herdr 0.9.0+
backend; preserve ordinary terminal use and explain missing capabilities.
Bind assignments to opaque agent instance identities, not reusable pane IDs.
Idle status is not completion, and progress must not be fabricated. Historical
assignments remain manageable offline without stopping agents. New output must
not replace snapshots or move the reader's viewport until they refresh.

Startup or delivery changes also require a real paired App-to-Gateway-to-agent
check in an isolated session: existing-agent assignment, new-agent startup,
follow-up, returned output, and status changes without stealing terminal focus.
Ask before answering agent trust/approval prompts. Never retry ambiguous
prompt delivery automatically.

## React Compiler and native rendering

Every component and hook must pass the `muqun/react-compiler` lint rule, which
uses the build's Lingui and React Compiler pipeline.

- Use Reanimated `.set()` for writes and `.get()` in callbacks/worklets. Keep
  render-time `.value` reads reactive; store function values with `.set(() => fn)`.
- Build gestures and their relations together in `useMemo`.
- Use `compiler-safe-control-flow` helpers for unsupported control flow.
- Use `useStableHandler`, `useLatestReader`, or carry-forward helpers for
  render-time ref patterns; do not disable dependency checks to hide them.
- Use `useEffectEvent` for effect reads that must not trigger the effect.
- Limit `'use no memo'` to documented escape hatches with a reason beside them.

Measure performance in Release builds on the same QA device and state, with at
least two runs per side. Profiling builds use `MUQUN_RELEASE_PROFILER=1` at
native build time and `EXPO_PUBLIC_RELEASE_PROFILER=1` at bundle time; store
builds must contain neither profiling module nor profiling JS. Clear the native
flag and rerun pod installation before an iOS store build.

Skia is `react-native-skia` 3.x with Graphite (Android Vulkan, minSdk 26).
Paths are immutable: use `Skia.PathBuilder` and `detach()`. Rerun `pod install`
after dependency installation when Skia's prebuilt iOS libraries are missing.

## Generated assets and dependency patches

Do not hand-edit `assets/themes/cover-courier/` or
`src/theme/builtin-theme.generated.ts`. Run `bun scripts/sync-builtin-theme.ts`
and commit its validated output. Sources come from `$MUQUN_THEMES_DIR`, a
sibling themes checkout, or the checksum-verified published pack.

Bun applies `patchedDependencies` from `patches/`; each patch must explain its
purpose and removal condition. Keep generated build files out of patches.
The postinstall RaTeX check must pass before an iOS build; rerun the dependency's
postinstall if its vendored files are incomplete.

## Releases

Release only when requested, from a reviewed, tested `vX.Y.Z` commit. Write
human-readable `release-notes/vX.Y.Z.md` covering user-visible changes,
compatibility, and upgrade steps before tagging. Do not publish or submit to a
store incidentally during development.

Preserve `dev.osuki.muqun`, the Expo project, and existing signing identity.
Credentials are managed through Expo; `EXPO_TOKEN` authenticates EAS and is not
an Android signing key. Never generate or rotate a keystore to bypass a build
failure. Treat build logs as sensitive; never print signing payloads.

Use the explicit preview/production commands in
`infrastructure/store-release.md`: local EAS builds produce Android AAB or iOS
IPA artifacts, then EAS Submit uploads the exact artifact. Validate Android
through Play internal testing and promote the tested production-channel binary.
Store-track changes do not change the embedded Hot Updater channel. Keep
versionCodes increasing; upload and Play distribution certificates differ.
There is no separate APK distribution or tag-triggered binary build.

Successful local native builds register OTA targets under
`.hot-updater/native-builds/<channel>/<platform>.json`; keep these generated
records out of Git and EAS uploads. Use `update:preview` or `update:production`
with `android`, `ios`, or `both` and a localized notes manifest. The wrapper
selects the matching native records; do not manually replace the root fingerprint,
guess from the newest artifact, or regenerate a fingerprint to bypass compatibility.
Use `both` for one dual-platform deployment instead of concurrent commands in the
same checkout. Fingerprints identify native compatibility, not channels; preserve
the official fingerprint schema. Promoting OTA bytes from preview to production
requires matching production native compatibility and verified release notes;
promotion does not switch a binary's embedded channel. See the release runbook
for partial-publication handling and interrupted-deployment recovery.
