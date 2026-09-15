# Dependency refresh — September 15, 2026

All direct runtime and development dependencies were checked against their published stable releases, including exact version pins and the `react-native-screens` override. The lockfile also refreshes transitive dependencies within their parents' constraints.

## Native updates

- Expo 57.0.20 → 57.0.22 and updated SDK 57 modules, including Router, Updates, UI, Device, Sharing, notifications, image pickers, and storage.
- `@osuki-dev/react-native-ssh` 0.2.0 → 0.3.0.
- Gesture Handler 3.2.1 → 3.3.0.
- Keyboard Controller 1.22.4 → 1.22.5.
- Nitro Fetch 1.6.3 → 1.7.0.
- Screens 4.27.0 → 4.28.0, including the override.
- Worklets 0.12.1 → 0.12.2, retaining the 0.12.x family required by Reanimated 4.6.0.

Other updates include Lingui 6.7.0, Lucide 1.46.0, Zod 4.6.5, FormatJS, Legend List, Oxlint 1.83.0, and Oxfmt 0.68.0. Packages already at the latest stable release remain unchanged.

## TypeScript 7

The project compiler is TypeScript 7.0.2. `bun run typecheck` explicitly invokes its installed entry point to avoid ambiguity with the API alias binary: `npx tsc --version` and `npx tsc --noEmit` use the native compiler.

TypeScript 7 does not export the legacy JavaScript compiler API from its root module. Existing AST audits and source-contract tests import APIs such as `createSourceFile` and `forEachChild`. A development-only alias, `typescript-compiler-api` (`npm:typescript@6.0.3`), supplies that API. The `typescript` entry in `tsconfig.json` paths directs those imports to the alias; Bun honors that mapping. This does not redirect the `tsc` executable or downgrade the compiler. Test files remain unchanged.

Keep the alias until those consumers migrate together to a stable replacement API. Do not remove it merely because the CLI type check succeeds. Verify both `npx tsc --version` and `bun test src` after changing this arrangement. The alias is not imported by the App runtime.

TypeScript is explicitly excluded from Expo's older compiler-version recommendation after validating the new compiler. See [Microsoft's TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) for the programmatic API transition.

## Deliberate compatibility holds

React Native 0.86.3, React/React DOM 19.2.8, and React types 19.2.x remain together. The current stable Expo SDK is 57; SDK 58 is a preview. A blanket latest update installed RN 0.87.1 and React 19.3.0, which do not match the stable SDK's supported runtime combination. These were restored rather than suppressing the SDK warning or shipping a renderer mismatch. See [Expo SDK 57](https://expo.dev/changelog/sdk-57).

## Script cleanup

Removed `scripts/reset-project.js` and its package command. It was an unused starter-template reset that moved or deleted the application's source and scripts.

Retained the translation audit and helpers, vendored RaTeX check, asset generation, theme authoring export, mock server, APK server, and terminal diagnostics. These have distinct current uses. Test and E2E files were not modified.

## Verification and release

- TypeScript 7, lint, formatting, and existing unit tests pass.
- Expo Doctor: 21/21 checks pass.
- Translation audit passes.
- Android and iOS production JS/Hermes exports pass.
- Web static rendering currently fails in Worklets `flushUIQueue` because Node has no `requestAnimationFrame`. Mobile exports pass independently; do not claim a successful Web static export.
- An isolated Android ARM64 debug native build passed after regenerating stale CMake/autolinking output. iOS native compilation was not run locally.
- App and package versions are aligned at 3.0.0; the existing app-version runtime policy separates this native update from 2.0.0 OTA updates.
- Device E2E remains delegated to the testing agent. No device install or store submission is part of this change.
- Native dependencies require fresh Android and iOS builds; a JS-only OTA update is insufficient. Preserve existing signing identities.
