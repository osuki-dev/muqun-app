# Expo HAS CHANGED

Write all repository documentation, architecture notes, release notes, and
bundled agent skill instructions in English. UI localization is separate.

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Working on this

Branch, work, run the checks below, open a pull request. That is the whole
process.

The maintainers use a card tracker and a branch tool of their own, and its
configuration is not in this repository. Nothing about it is needed to
contribute here, and nothing in this file assumes you have it.

Complete local development and all five checks below before opening a PR.
If a check is blocked or fails, report it and continue fixing it; do not open
a PR claiming the change is ready.

## Releases and Android signing

- Release from a reviewed, tested commit using a `vX.Y.Z` tag. Do not create or
  push a release tag unless the user requested a release.
- Every GitHub Release must include human-written release notes: user-visible
  changes, fixes, compatibility requirements (App/Gateway/Herdr), and upgrade
  instructions. Commit them at `release-notes/vX.Y.Z.md` before tagging. An APK
  attachment or an automatically generated commit list is not sufficient.
- Android and iOS signing credentials are managed in Expo. The team's current
  workflow builds locally with EAS `--local` and uses EAS Submit for submission.
  GitHub CI should run the same local APK build on its runner using the
  `production-apk` profile and existing Expo-managed credentials. `EXPO_TOKEN`
  authenticates CI; it is not a replacement signing key.
- Preserve `dev.osuki.muqun`, the Expo project, and the existing Android
  keystore. Never generate or rotate a keystore to make CI pass. Missing
  credentials are a configuration problem to report, not permission to create
  new signing identity. Never commit or print private signing credentials.
- APK and Play builds share the package name and must not become separate
  apps. Cross-channel in-place upgrades additionally require the same signing
  certificate and increasing versionCode. Verify the actual Play App Signing
  certificate against the APK certificate before claiming this works; an
  upload key is not necessarily Google's distribution signing key.
- Run `.github/workflows/android-apk.yml` on version tags. Attach the APK and
  its SHA-256 checksum to the matching GitHub Release, built from that exact
  tag. A manual run without a tag is build-only. Do not submit to Play or
  publish a release as an incidental part of developing a feature.

## Installing behind a proxy

```sh
NODE_USE_ENV_PROXY=1 bun install
```

The variable is not belt-and-braces, and "behind a proxy" is not on its own
the explanation. `curl`, `git` and `bun`'s own registry client read
`http_proxy` / `https_proxy` and go through the proxy. Node's global `fetch`
does not read them at all unless `NODE_USE_ENV_PROXY=1` is set. Measured here
on Node v26.8.1, with the proxy up and the variables exported, against the
RaTeX release asset the postinstall wants:

```
node -e "fetch(<url>, {method:'HEAD'})"                    # hangs; no answer in 15s
NODE_USE_ENV_PROXY=1 node -e "fetch(<url>, {method:'HEAD'})"  # status 200
```

So a proxy that works for everything else still leaves every `fetch`-based
postinstall reaching for the open internet. `vendor-ratex.mjs` in
`react-native-enriched-markdown` is one of those: it pulls RaTeX in two pieces
-- the prebuilt XCFramework, then the tarball holding the four Swift sources
and the KaTeX fonts -- and both go through `fetch`.

It does not fail the install. The postinstall warns and exits zero when a
vendor step fails, so `bun install` reports success over an incomplete tree.
The podspec then decides whether to compile math by checking for the
XCFramework _only_, so a tree with the framework and not the sources compiles
a Swift bridge whose types are missing, and the whole thing surfaces hundreds
of lines into an Xcode build as

```
ENRMRaTeXBridge.swift:18:25: error: cannot find type 'RaTeXRenderer' in scope
```

Filed upstream as software-mansion/enriched-markdown#745.

`scripts/check-vendored-ratex.ts` runs on `postinstall` and turns that into a
sentence naming the missing files, at install time rather than at build time.
If it fires, the recovery is one command:

```sh
NODE_USE_ENV_PROXY=1 node node_modules/react-native-enriched-markdown/postinstall.mjs
```

The same variable belongs on any `bunx expo prebuild` or CI install step that
runs behind a proxy.

## End-to-end test gate

Optional Gateway features use capability detection, not a guessed Gateway version.
Agent collaboration requires `agent_collaboration` and a connected Herdr 0.9.0+
backend for the selected session. An older Gateway or Herdr must retain ordinary
terminal use and show an actionable upgrade explanation for collaboration.
Agent status is not proof of task completion; never display fabricated progress
percentages or treat an idle agent as a successfully completed assignment.
Bind current assignments to the Gateway's opaque agent instance identity, not a
reusable pane id. Keep earlier assignments as history; marking or removing history
must work offline and must not stop an agent. New output must not move the reader's
viewport or replace the snapshot until they choose to refresh it.

Changes to agent startup or task delivery also need a real, paired App-to-Gateway-to-agent
check; offline demo fixtures alone cannot prove delivery. Use an isolated Herdr session
and a dedicated test device, never a user's active workspace. On the development Mac,
enable `proxy_on` in a new terminal before launching AI agents. Verify existing-agent
assignment, new-agent startup, follow-up delivery, actual returned output, and status
changes without automatic terminal navigation. Ask before answering agent trust or
approval prompts, and never retry an ambiguous delivery automatically.

Finishing a feature means the whole app still works, not just the screen that was touched.

- Every change that touches app code runs the full end-to-end suite before it lands: `bash scripts/e2e.sh`.
  It needs a dedicated, unpaired emulator or simulator with the app installed and English selected; the flows drive offline demo
  mode, so no gateway, no network and no pairing.
- `bash scripts/e2e.sh --smoke` is the fast subset (`demo-tour` only). It is for iterating, not for
  closing a card.
- Reports land in `dist/e2e-reports/` (JUnit XML plus the run's screenshots, native command results and view hierarchies).
  The directory is build output and is not committed.
- A flow that covers a new surface belongs in `e2e/agent-device/` as native `.ad` actions, registered
  with the `full` tag in `suite.json` in the same change as the feature. A flow without that tag is
  not enforced by the gate. Use agent-device 0.20.10 and the native runner; do not introduce another
  test-driver format. `bash scripts/e2e.sh --check` validates native syntax and manifest references
  without driving a device. The runner's own tests run before the device suite.
- The suite relaunches the app without erasing user data. Never run it on a simulator with real
  paired servers or SSH hosts. Pass `--device ID --platform ios|android` when several devices exist.
  For development builds, set `E2E_AD_METRO_HOST` and `E2E_AD_METRO_PORT`. Test full suites on each
  supported platform before claiming platform-specific coverage.
- Run `bash scripts/e2e.sh` and quote the result in the pull request. The gate is the suite
  passing, not a tool remembering that it did.

## The checks

These five are the gate, in this order. The first four are fast enough to run on every change;
the fifth is the feature gate above.

```sh
npx tsc --noEmit
bun run lint          # oxlint --deny-warnings: a warning fails the run
bun run format:check  # oxfmt --check; `bun run format` rewrites
bun test src
bash scripts/e2e.sh
```

Linting is `oxlint` and formatting is `oxfmt` (the same pair as the org's `kit` repo), configured in
`.oxlintrc.json` and `.oxfmtrc.json`. There is no ESLint in this tree any more: a suppression is
`// oxlint-disable-next-line <rule> -- <reason>`, and the rule names are oxlint's (`react/refs`,
`typescript/no-require-imports`, ...). `bun run lint` fails on warnings deliberately, so the gate
cannot quietly grow a new baseline the way it did before card #611.

## agent-device

Reuse the existing Android QA AVD `muqun_collaboration_qa` and iOS simulator
`muqun-collaboration-tests`. Do not create a simulator or AVD for each feature
unless the user explicitly asks. Serialize access to a shared QA device, discover
its current port or UDID on every run, and never use the user's own devices or
paired sessions for automation.

Carry the explicit Android `--serial` or iOS `--udid` on every direct agent-device
command. A session name alone is not device identity: the suite closes sessions,
and a later capture or open may create a new session on another running device.
After a suite or close, verify the returned device identity before any install or
UI action; never let automatic device discovery choose a user's device.

Use agent-device only for app/device automation tasks. Before planning commands, run `agent-device --version` and read `agent-device help workflow`. For TV, Fire TV, or Vega OS tasks, read `agent-device help tv`. For exploratory QA, read `agent-device help dogfood`. For logs, network, audio, traces, or runtime failures, read `agent-device help debugging`. For React Native component trees, props/state/hooks, slow renders, or rerenders, read `agent-device help react-devtools`. For React Native JavaScript heap growth, heap snapshots, or retained-object leaks, read `agent-device help cdp`. For React Native apps, overlays, Metro/Fast Refresh blockers, and routing to React DevTools or debugging evidence, read `agent-device help react-native`.

Use MCP tools or the CLI in the integrated terminal. If `agent-device` is not on PATH but the user installed it globally in another shell, resolve the command the same way the user would from a normal terminal session and run that absolute path instead. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the agent process `PATH` is the user's `PATH`. Do not silently fall back to `npx -y agent-device@latest`; ask or use an exact version. MCP exposes structured tools backed by the agent-device client; it does not expose generic shell execution. Prefer `open -> snapshot -i -> act -> re-snapshot -> verify -> close` where the target supports capture and selectors; otherwise follow target-specific help. Use current refs such as `@e3` for exploration and selectors for durable replay. Keep mutating commands against one session serial. Capture screenshots, logs, network, audio, perf, traces, recordings, and `.ad` replay scripts only when they add evidence.
