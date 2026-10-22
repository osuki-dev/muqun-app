# Muqun Codebase Context

## Purpose

Muqun is an Expo/React Native mobile client for monitoring and controlling developer-agent terminal sessions through a user-operated Herdr Gateway. It supports iOS, Android, iPad layouts, static web output, push notifications, local authentication, demo mode, and Android/iOS widgets. The product intentionally has no Muqun account, hosted relay, analytics, or ad network.

## Architecture

The app is a client-side layered monolith:

- Expo Router owns navigation and native sheet/modal presentation.
- React components and hooks render the UI and coordinate screen behavior.
- Zustand stores own persisted and session state.
- `src/lib` contains application services such as pairing, encrypted gateway transport, notifications, widgets, compatibility checks, and terminal helpers.
- `src/api` contains lower-level request utilities.
- The terminal subsystem parses remote output and renders it through Skia.
- Native projects and config plugins supply platform capabilities that cannot be delivered as JavaScript alone.

## Directory Map

- `src/app/`: Expo Router routes and the root provider/navigation tree.
- `src/components/`: reusable screens, sheets, terminal UI, and controls.
- `src/hooks/`: stateful adapters between stores/services and components.
- `src/stores/`: Zustand state, hydration, and persistence boundaries.
- `src/lib/`: gateway, pairing, crypto transport, notifications, widgets, and pure domain helpers.
- `src/api/`: shared HTTP request primitives.
- `src/terminal/`: terminal palette, parsing, and rendering support.
- `src/constants/`: design tokens, theme packs, and stable configuration.
- `src/i18n/`: Lingui setup and locale catalogs.
- `e2e/agent-device/`: native `.ad` flows and an explicit suite manifest; `scripts/e2e-native.ts` owns conditional setup, exact assertions, and scroll guards.
- `scripts/`: test, demo gateway, build, store, and automation scripts.
- `plugins/`: Expo config plugins for native project customization.
- `ios/`, `android/`: generated/customized native projects and widget targets.
- `assets/`, `native-locales/`: bundled media, fonts, and native metadata translations.
- `patches/`: package-manager patches applied to dependencies.

## Data and Flow

The principal local models are paired gateway records, app settings, server capabilities, agent/pane state, terminal frames, approvals, and widget snapshots. Pairing records and sensitive settings use SecureStore; high-frequency non-secret preferences may use MMKV. External payloads are normalized or validated at their service boundary.

A typical live request flows from a route/component through a hook or Zustand action, into `gateway-client` and the encrypted transport, to the paired Gateway. Responses update store or hook state and re-render the route. Server-sent events drive live pane and agent updates. Demo mode substitutes bundled fixtures so the product and end-to-end suite work offline.

Theme selection flows from the persisted `themePack` setting through `useThemePack`, into the root Osuki theme provider and the terminal palette adapter. Every pack carries paired light/dark UI tokens and ANSI terminal colors.

## Patterns

- File-based routes are deliberately thin; larger UI behavior lives in components.
- Pure helpers hold parsing and state-transition logic so Bun tests can run without native modules.
- Capability gates preserve compatibility with older Gateway releases.
- Native-module imports that may be absent from an older binary are guarded for OTA safety.
- Accessibility labels and test IDs are treated as stable automation contracts.
- Theme packs are registry data with source attribution and executable shape/contrast audits.

## Testing and Quality Gates

- Type checking: `npx tsc --noEmit`
- Linting: `bun run lint` (oxlint)
- Formatting: `bun run format:check` (oxfmt; `bun run format` rewrites)
- Unit tests: `bun test src`
- Full offline end-to-end gate: `bash scripts/e2e.sh`
- Smoke iteration only: `bash scripts/e2e.sh --smoke`

Native agent-device reports and evidence are written under `dist/e2e-reports/` and are not committed. The checks are `npx tsc --noEmit`, `bun run lint`, `bun run format:check` and `bun test src`; a change that touches app code also runs the end-to-end suite.

## Errors and Logging

Network and domain services throw contextual errors for callers to present or recover from. Screen-level faults are caught by `AppErrorBoundary`. Expected platform fallbacks are caught locally, while development-only diagnostics use `console.warn` or the render tally. Temporary logging must not be committed.

## Configuration and Deployment

`app.json` defines Expo SDK/native configuration, permissions, schemes, plugins, EAS project identity, and platform-specific privacy settings. `package.json` pins Expo SDK 58 packages and exposes EAS build, submit, and update commands. Releases use local EAS builds for native binaries and Hot Updater for compatible JavaScript changes. See [store and OTA release commands](infrastructure/store-release.md); native compatibility records are selected by channel and platform.

## Documentation and Operations

This repository holds the app and nothing else. The store listing copy, the App Review notes, the screenshot-rendering project and private store submission notes are not here: they carry the App Review contact and a great deal of rendered artwork, and they live with the maintainers instead. `README.md` is the front page, this file is the longer map, and `AGENTS.md` is what a coding agent working in this tree is told. The repository maintains build and OTA operations in `infrastructure/store-release.md`. This is the only `CONTEXT.md` currently in the tree.

## Sharp Edges

- Read the exact Expo SDK 58 versioned documentation before code changes.
- A feature is not complete until the full offline end-to-end suite passes with one booted simulator or emulator and the app installed.
- The theme picker must remain scrollable as installed theme packs change.
- Form sheets have native layout constraints; `ScrollScreen` must remain the sheet root.
- The native suite uses process relaunches and restores persistent preferences explicitly. Run it only on dedicated, unpaired test devices; it never erases user data.
- OTA code can reach binaries that do not contain newly added native modules; guarded imports are intentional.
- Work on a branch, pass the local checks, then open a pull request. No external tracker or branch tool is required; do not merge protected branches manually.

## Terminal keyboard

The shared `VirtualKeyboard` emits characters or validated named keys; Gateway and
SSH workspaces own dispatch. Contextual combinations and nvim actions share one
shortcut strip. Modifier state and key sequences are implemented in `src/components/virtual-keyboard.tsx`
and validated by the terminal flows in `e2e/agent-device/`.

## Linked checkout changes

The terminal Changes route passes the explicit `git_worktrees` capability to
`GitDiffView`. Its inventory comes from the pane's authenticated `git/worktrees`
route, with canonical `current` and `worktrees` (`path`, `branch`, `head`,
`detached`). The App validates the response and offers only inventory entries.
Selected reads add `worktree` to `git/status` and `git/diff`; Gateway revalidates
Git membership and common-directory identity on every read.

Other checkouts use the existing paged Changes adapter, without Discard, Lazygit
or default-branch comparison. Changing the checkout remounts `ChangesSheet` to
drop prior listings and patches. A removed selection fails explicitly until
the reader chooses again; refreshing the inventory never silently changes it.
Agent-session runtime-managed worktree context remains a separate contract.

## Encrypted transport negotiation

Paired traffic negotiates envelope v2 through an authenticated, read-only `/health`
probe (`transport_versions`), followed by an authenticated read-only v2 proof.
A device-only minimum-version pin is persisted after that proof and before
application operations are sent. The existing token, key family, HKDF, and transport marker stay
unchanged. V2 authenticates `muqun-transport-v2\n<timestamp_ms>\n<existing AAD>`;
responses must match the request version. Pinned credentials never fall back to
v1. SSE/WebSocket opening envelopes use the same negotiation; stream records and
pairing bootstrap remain compatible. See `gateway-transport.ts` and
`transport-negotiation.ts` for the protocol and upgrade boundaries.
