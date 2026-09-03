# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Working on this

Branch, work, run the checks below, open a pull request. That is the whole
process.

The maintainers use a card tracker and a branch tool of their own, and its
configuration is not in this repository. Nothing about it is needed to
contribute here, and nothing in this file assumes you have it.

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

Finishing a feature means the whole app still works, not just the screen that was touched.

- Every change that touches app code runs the full end-to-end suite before it lands: `bash scripts/e2e.sh`.
  It needs one booted emulator or simulator with the app installed; the flows drive offline demo
  mode, so no gateway, no network and no pairing.
- `bash scripts/e2e.sh --smoke` is the fast subset (`demo-tour` only). It is for iterating, not for
  closing a card.
- Reports land in `dist/e2e-reports/` (JUnit XML plus the run's screenshots and view hierarchies).
  The directory is build output and is not committed.
- A flow that covers a new surface belongs in `maestro/flows/` with the `full` tag, added in the
  same change as the feature. An untagged flow is a flow the gate does not enforce.
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

Use agent-device only for app/device automation tasks. Before planning commands, run `agent-device --version` and read `agent-device help workflow`. For TV, Fire TV, or Vega OS tasks, read `agent-device help tv`. For exploratory QA, read `agent-device help dogfood`. For logs, network, audio, traces, or runtime failures, read `agent-device help debugging`. For React Native component trees, props/state/hooks, slow renders, or rerenders, read `agent-device help react-devtools`. For React Native JavaScript heap growth, heap snapshots, or retained-object leaks, read `agent-device help cdp`. For React Native apps, overlays, Metro/Fast Refresh blockers, and routing to React DevTools or debugging evidence, read `agent-device help react-native`.

Use MCP tools or the CLI in the integrated terminal. If `agent-device` is not on PATH but the user installed it globally in another shell, resolve the command the same way the user would from a normal terminal session and run that absolute path instead. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the agent process `PATH` is the user's `PATH`. Do not silently fall back to `npx -y agent-device@latest`; ask or use an exact version. MCP exposes structured tools backed by the agent-device client; it does not expose generic shell execution. Prefer `open -> snapshot -i -> act -> re-snapshot -> verify -> close` where the target supports capture and selectors; otherwise follow target-specific help. Use current refs such as `@e3` for exploration and selectors for durable replay. Keep mutating commands against one session serial. Capture screenshots, logs, network, audio, perf, traces, recordings, and `.ad` replay scripts only when they add evidence.
