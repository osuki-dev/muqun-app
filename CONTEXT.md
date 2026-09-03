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
- `maestro/`: end-to-end flows and reusable subflows.
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

Maestro reports and evidence are written under `dist/e2e-reports/` and are not committed. The checks are `npx tsc --noEmit`, `bun run lint`, `bun run format:check` and `bun test src`; a change that touches app code also runs the end-to-end suite.

## Errors and Logging

Network and domain services throw contextual errors for callers to present or recover from. Screen-level faults are caught by `AppErrorBoundary`. Expected platform fallbacks are caught locally, while development-only diagnostics use `console.warn` or the render tally. Temporary logging must not be committed.

## Configuration and Deployment

`app.json` defines Expo SDK/native configuration, permissions, schemes, plugins, EAS project identity, and platform-specific privacy settings. `package.json` pins Expo SDK 57 packages and exposes EAS build, submit, and update commands. Releases use EAS builds for native binaries and EAS Update for compatible JavaScript changes.

## Documentation and Operations

This repository holds the app and nothing else. The store listing copy, the App Review notes, the screenshot-rendering project and the submission runbooks are not here: they carry the App Review contact and a great deal of rendered artwork, and they live with the maintainers instead. `README.md` is the front page, this file is the longer map, and `AGENTS.md` is what a coding agent working in this tree is told. There is no dedicated on-call runbook in this repository. This is the only `CONTEXT.md` currently in the tree.

## Sharp Edges

- Read the exact Expo SDK 57 versioned documentation before code changes.
- A feature is not complete until the full offline end-to-end suite passes with one booted simulator or emulator and the app installed.
- The theme picker must remain scrollable: the registry now contains thirty-two paired packs.
- Form sheets have native layout constraints; `ScrollScreen` must remain the sheet root.
- SecureStore survives Maestro `clearState`, so flows restore persistent preferences explicitly.
- OTA code can reach binaries that do not contain newly added native modules; guarded imports are intentional.
- Use FizzyX for branches, readiness, synchronization, and promotion; do not merge protected branches manually.
