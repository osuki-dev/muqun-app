# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Working on this

Branch, work, run the checks below, open a pull request. That is the whole
process.

The maintainers use a card tracker and a branch tool of their own, and its
configuration is not in this repository. Nothing about it is needed to
contribute here, and nothing in this file assumes you have it.

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

These four are the gate, in this order. The first three are fast enough to run on every change;
the fourth is the feature gate above.

```sh
npx tsc --noEmit
bun run lint          # expo lint --max-warnings 0: a warning fails the run
bun test src
bash scripts/e2e.sh
```

`bun run lint` fails on warnings deliberately, so the gate cannot quietly grow a new baseline the
way it did before card #611.

## agent-device

Use agent-device only for app/device automation tasks. Before planning commands, run `agent-device --version` and read `agent-device help workflow`. For TV, Fire TV, or Vega OS tasks, read `agent-device help tv`. For exploratory QA, read `agent-device help dogfood`. For logs, network, audio, traces, or runtime failures, read `agent-device help debugging`. For React Native component trees, props/state/hooks, slow renders, or rerenders, read `agent-device help react-devtools`. For React Native JavaScript heap growth, heap snapshots, or retained-object leaks, read `agent-device help cdp`. For React Native apps, overlays, Metro/Fast Refresh blockers, and routing to React DevTools or debugging evidence, read `agent-device help react-native`.

Use MCP tools or the CLI in the integrated terminal. If `agent-device` is not on PATH but the user installed it globally in another shell, resolve the command the same way the user would from a normal terminal session and run that absolute path instead. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the agent process `PATH` is the user's `PATH`. Do not silently fall back to `npx -y agent-device@latest`; ask or use an exact version. MCP exposes structured tools backed by the agent-device client; it does not expose generic shell execution. Prefer `open -> snapshot -i -> act -> re-snapshot -> verify -> close` where the target supports capture and selectors; otherwise follow target-specific help. Use current refs such as `@e3` for exploration and selectors for durable replay. Keep mutating commands against one session serial. Capture screenshots, logs, network, audio, perf, traces, recordings, and `.ad` replay scripts only when they add evidence.
