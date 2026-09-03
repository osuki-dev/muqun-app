# Dependency upgrade, September 2026

Date: 2026-09-03. Branch: `chore/deps-and-oxc`. This is the record of the dependency pass over the
Expo SDK 57 / React Native 0.86 app: which packages moved, which were deliberately held back and why,
and what had to change in the app to absorb the bumps. Every step was gated on `npx tsc --noEmit`,
`bun run lint` (oxlint, warnings fail), `bun run format:check` (oxfmt), `bun test src`, and native Debug
builds for iOS and Android. The before/after column comes from `git diff 99b2bca..HEAD -- package.json`.

## Version table

| package                                    | before   | after    | note                                                                          |
| ------------------------------------------ | -------- | -------- | ----------------------------------------------------------------------------- |
| **Expo SDK**                               |          |          |                                                                               |
| Expo SDK                                   | 57       | 57       | held: 57.0.19 is `latest`; 58 exists only as `58.0.0-canary-*`                |
| expo                                       | ~57.0.9  | ~57.0.19 | patch line of SDK 57                                                          |
| expo-router                                | ~57.0.9  | ~57.0.18 | screen error boundaries, `Stack.unstable_nativeProps`                         |
| @expo/ui                                   | ~57.0.8  | ~57.0.15 | SDK patch                                                                     |
| expo-asset                                 | ~57.0.8  | ~57.0.16 | SDK patch                                                                     |
| expo-build-properties                      | ~57.0.8  | ~57.0.16 | SDK patch                                                                     |
| expo-constants                             | ~57.0.8  | ~57.0.17 | SDK patch                                                                     |
| expo-file-system                           | ~57.0.1  | ~57.0.6  | SDK patch                                                                     |
| expo-font                                  | ~57.0.1  | ~57.0.3  | SDK patch                                                                     |
| expo-haptics                               | ~57.0.1  | ~57.0.2  | SDK patch                                                                     |
| expo-image                                 | ~57.0.1  | ~57.0.4  | SDK patch                                                                     |
| expo-image-manipulator                     | ~57.0.7  | ~57.0.15 | SDK patch                                                                     |
| expo-image-picker                          | ~57.0.7  | ~57.0.15 | SDK patch                                                                     |
| expo-linking                               | ~57.0.4  | ~57.0.9  | SDK patch                                                                     |
| expo-notifications                         | ~57.0.8  | ~57.0.16 | SDK patch                                                                     |
| expo-screen-capture                        | ~57.0.1  | ~57.0.2  | SDK patch                                                                     |
| expo-screen-orientation                    | ~57.0.1  | ~57.0.2  | SDK patch                                                                     |
| expo-secure-store                          | ^57.0.1  | ^57.0.3  | SDK patch                                                                     |
| expo-splash-screen                         | ~57.0.5  | ~57.0.8  | SDK patch                                                                     |
| expo-symbols                               | ~57.0.1  | ~57.0.2  | SDK patch                                                                     |
| expo-system-ui                             | ~57.0.2  | ~57.0.3  | SDK patch                                                                     |
| expo-updates                               | ~57.0.11 | ~57.0.21 | SDK patch                                                                     |
| expo-widgets                               | ~57.0.7  | ~57.0.16 | SDK patch                                                                     |
| **React Native core**                      |          |          |                                                                               |
| react-native                               | 0.86.2   | 0.86.3   | SDK 57 pin; held: 0.87.1 tried and rejected (see Held back)                   |
| react                                      | 19.2.8   | 19.2.8   | held: already latest (SDK pins 19.2.3)                                        |
| react-dom                                  | 19.2.8   | 19.2.8   | held: already latest                                                          |
| react-native-web                           | ~0.21.0  | ~0.21.2  | patch                                                                         |
| react-native-safe-area-context             | ~5.8.1   | ~5.9.1   | ahead of SDK pin (~5.7.0)                                                     |
| react-native-screens                       | 4.26.2   | 4.27.0   | `overrides` entry updated in step                                             |
| **Nitro**                                  |          |          |                                                                               |
| react-native-nitro-modules                 | 0.36.5   | 0.37.1   | view props moved into nitro core; `CachedProp` kept deprecated                |
| react-native-nitro-fetch                   | 1.5.4    | 1.6.3    | peer widened to `>=0.36.1`; Android uses root `ndkVersion`                    |
| react-native-nitro-image                   | ^0.15.1  | ^0.15.2  | regenerated with nitrogen 0.37; requires nitro-modules >= 0.37                |
| react-native-nitro-text-decoder            | 0.2.0    | 0.2.0    | held: already latest; peer `^0.35.2` was already unmet, compiles              |
| @osuki-dev/react-native-ssh                | 0.1.1    | 0.1.1    | unchanged; generated for 0.36.5, compiles on 0.37 via deprecated `CachedProp` |
| **Animation / gesture / Skia**             |          |          |                                                                               |
| react-native-reanimated                    | 4.5.3    | 4.6.0    | requires worklets 0.12.x                                                      |
| react-native-worklets                      | 0.11.3   | 0.12.1   | paired with reanimated 4.6                                                    |
| react-native-gesture-handler               | ~3.1.0   | ~3.2.1   | `Pressable` rebuilt on `Touchable`; links worklets natively                   |
| react-native-keyboard-controller           | 1.22.2   | 1.22.4   | fixes only                                                                    |
| @shopify/react-native-skia                 | 2.10.1   | 2.11.2   | Skia m152; typeface refcount fix relevant to the terminal                     |
| **UI kit and app libraries**               |          |          |                                                                               |
| @osuki-dev/ui                              | ^0.0.1   | ^1.0.0   | no API change for app imports; toast `maxWidth` patch carried over            |
| react-native-enriched-markdown             | ^0.7.4   | ^1.0.2   | Expo config plugin removed; config now in package.json                        |
| react-native-webview                       | 13.16.1  | 14.0.1   | Android minSdk 24 (already satisfied)                                         |
| @legendapp/list                            | ^3.3.3   | ^3.3.10  | patch                                                                         |
| highlight.js                               | ^11.11.1 | ^11.12.0 | minor                                                                         |
| lucide-react-native                        | ^1.28.0  | ^1.39.0  | icons only                                                                    |
| react-native-android-widget                | ^0.21.0  | ^0.22.1  | minor                                                                         |
| react-native-quick-crypto                  | ^1.1.6   | ^1.1.7   | patch                                                                         |
| react-native-vision-camera                 | ^5.2.1   | ^5.2.3   | patch                                                                         |
| react-native-vision-camera-barcode-scanner | ^5.2.2   | ^5.2.3   | patch                                                                         |
| zustand                                    | ^5.0.14  | ^5.0.15  | patch                                                                         |
| **Tooling**                                |          |          |                                                                               |
| typescript                                 | ~6.0.3   | ~6.0.3   | held: 7.0.2 tried and rejected (see Held back)                                |
| eslint                                     | ^9.0.0   | removed  | replaced by oxlint                                                            |
| eslint-config-expo                         | ~57.0.1  | removed  | replaced by oxlint                                                            |
| oxlint                                     | -        | ^1.81.0  | `bun run lint` = `oxlint --deny-warnings`                                     |
| oxfmt                                      | -        | ^0.66.0  | `bun run format` / `format:check`                                             |

Other package.json changes in the same diff: `overrides["react-native-screens"]` 4.26.2 → 4.27.0;
new `"enriched-markdown": { "enableMath": false }` block; new `expo.install.exclude` list; `patchedDependencies`
key `@osuki-dev/ui@0.0.1` → `@osuki-dev/ui@1.0.0`; `react-native-enriched-markdown` added to `trustedDependencies`;
`lint` script `expo lint --max-warnings 0` → `oxlint --deny-warnings`, plus new `format` and `format:check` scripts.

## Core packages: what changed

### expo 57.0.9 → 57.0.19

What changed (`packages/expo/CHANGELOG.md`, `sdk-57` branch; dist-tags: latest = next = 57.0.19, canary = 58.0.0-canary-20260902):

- 57.0.11: `expo/fetch` iOS streaming race (empty 200 body / dropped chunks) fixed; abort now rejects reads with
  `AbortError` instead of hanging; `import()` via `asyncRequireModule` returns a full promise; DOM components no
  longer drop prop updates while the WebView is still loading.
- 57.0.13: iOS `ExpoBundleConfiguration` derives `RCTBundleConfiguration` from the normalized bundle URL; bare
  projects resolve the Metro port from `RCTMetroPort`; macOS build fix; `TextDecoder` rewritten for speed.
- 57.0.16: bumps `@expo/metro@56.0.2`, `metro@0.84.5`.
- 57.0.19: iOS Hermes JSI crash on reload when two overlapping `RCTHost` runtime callbacks shared the
  `EXReactNativeFactory` app-context ivar.
- `bundledNativeModules.json` for 57.0.19 pins react 19.2.3, react-native 0.86.3, gesture-handler ~2.32.0,
  reanimated 4.5.1, worklets 0.10.1, screens ~4.26.0, safe-area-context ~5.7.0, webview 13.16.1,
  keyboard-controller 1.21.9, skia 2.6.2, expo-router ~57.0.18.

Breaking: none. Patch-level only; no native requirement changes.

Action taken: bumped `expo` and every `expo-*` module to the SDK 57 patch line. The packages this app runs ahead
of the SDK pins are listed in `expo.install.exclude` so `npx expo install --check` and expo-doctor stay quiet
(expo-doctor passes 21/21).

### expo-router 57.0.9 → 57.0.18

What changed (`packages/expo-router/CHANGELOG.md`, `sdk-57`):

- 57.0.12: splash screen hidden when the built-in `+not-found` screen renders.
- 57.0.13: iOS long-press on a `Link` with a menu released before the context menu presents no longer corrupts
  navigation state.
- 57.0.15: `Stack` exposes `unstable_nativeProps`; better standard-navigation types for `createProps`;
  `nativeContainerStyle` unset for transparent presentations; testing-library packages moved to devDependencies.
- 57.0.17: screen error boundaries.

Breaking: none.

Action taken: bumped to ~57.0.18. No source change.

### react-native 0.86.2 → 0.86.3

What changed (facebook/react-native releases):

- 0.86.3 (2026-08-24): Hermes V1 250829098.0.17; EventEmitter use-after-free race fix; `<Modal>` and nested root
  host views report `parentNode`/`parentElement` so capture/bubble events reach ancestors; deterministic
  Podfile.lock SPEC CHECKSUMS; Android `getInitialURL` ConcurrentModificationException fix; custom fonts with an
  explicit `fontWeight` no longer render at the heaviest weight on New Arch. Toolchain unchanged (min iOS 15.1,
  Xcode 16.1, minSdk 24 / compileSdk 36 / Kotlin 2.1.20).
- 0.87.0 (2026-08-11) / 0.87.1 (2026-08-26), for reference: strict TypeScript API by default, Metro 0.87,
  experimental SwiftPM, AGP 9; requires Node >= 22.13, Kotlin >= 2.0, template compileSdk 37; removes
  `InteractionManager`, `Modal.animated`, several `StatusBar` props, `NativeMethods`, `PublicScrollViewInstance`,
  and the legacy-arch C++/ObjC.

Breaking: none in 0.86.3. 0.87 is breaking and not supported by any stable Expo SDK.

Action taken: moved to 0.86.3 (the SDK 57 pin). 0.87.1 was tried and reverted; see Held back.

### react 19.2.8 / react-dom 19.2.8

What changed: nothing. `npm view react dist-tags`: latest = 19.2.8 (2026-07-21); the only newer tags are
19.3.0 canaries. 19.2.4 → 19.2.8 were React Server Components fixes only.

Breaking: none.

Action taken: none; already latest. `react` and `react-dom` are in `expo.install.exclude` because SDK 57
pins 19.2.3 and `react-native@0.86.x` accepts `react ^19.2.3`.

### react-native-nitro-modules 0.36.5 → 0.37.1 (with nitro-fetch 1.5.4 → 1.6.3 and nitro-image 0.15.1 → 0.15.2)

What changed:

- 0.37.0 (2026-08-20) https://github.com/margelo/nitro/releases/tag/v0.37.0 — `Props` and
  `react::ComponentDescriptor` for Hybrid Views move out of generated code into nitro core as C++ templates
  (`ViewComponentDescriptor<T>`, `ViewPropsHolderState<T>`); `CachedProp<T>` rewritten and renamed `ReactProp<T>`,
  with the legacy `CachedProp<T>` re-added byte-for-byte and marked `[[deprecated]]` (#1517); view fixes
  (immutable prop snapshots, native prop defaults preserved, recycling resets, dangling props ref); nitrogen keeps
  `| undefined` on array elements / Record values (#1478); template libs mark the nitro-modules peer optional.
- 0.37.1 (2026-08-27) https://github.com/margelo/nitro/releases/tag/v0.37.1 — hide React Native version checks
  from public headers (fixes modular-header / static-framework builds, #1521); report native `ArrayBuffer`
  memory pressure to the JS GC (#1523).
- Podspec adds four public headers (`RawPropsCompat.hpp`, `ReactProp.hpp`, `ViewComponentDescriptor.hpp`,
  `ViewPropsHolderState.hpp`); no Gradle/CMake/min-iOS/NDK changes. Peer deps unchanged.
- nitro-fetch 1.6.0 https://github.com/margelo/react-native-nitro-fetch/releases/tag/v1.6.0 — tvOS support,
  opt-out of dev-tools reporting, prefetch cache registration made atomic, iOS shares URLCache across transports,
  Android stops sending fabricated `Sec-WebSocket-Protocol`/`Origin`.
- nitro-fetch 1.6.1 https://github.com/margelo/react-native-nitro-fetch/releases/tag/v1.6.1 — cache directives
  honoured for streaming requests; internal `prefetchKey` header no longer sent; WebSocket crash when closed
  during handshake; auto-prefetch queue encrypted at rest.
- nitro-fetch 1.6.2 https://github.com/margelo/react-native-nitro-fetch/releases/tag/v1.6.2 — `reader.cancel()`
  cancels the native request; use-after-free in WebSocket callbacks during teardown; nitro-modules peer widened
  from `^0.36.1` to `>=0.36.1` (the caret would have rejected 0.37).
- nitro-fetch 1.6.3 https://github.com/margelo/react-native-nitro-fetch/releases/tag/v1.6.3 — Android reads
  `ndkVersion` from the root project (fixes `__cxa_init_primary_exception` link errors, #179).
- nitro-image 0.15.2 (2026-08-20) https://github.com/mrousavy/react-native-nitro-image/releases/tag/v0.15.2 —
  regenerated with nitrogen 0.37 (`HybridNitroImageViewComponent.hpp` includes the new `ReactProp` /
  `ViewComponentDescriptor` / `ViewPropsHolderState` headers); fixes R/B channel swap in Android raw pixels,
  iOS pixel-format label, 24-bit RGB/BGR on iOS, full view-state reset in `prepareForRecycle()`.

Breaking:

- nitro-image 0.15.2 hard-requires nitro-modules >= 0.37.0 (the headers do not exist in 0.36.5).
- nitro-modules 0.37.x stays backward compatible with code generated by nitrogen <= 0.36 because the deprecated
  `CachedProp<T>` ABI is kept; non-view modules (nitro-fetch, text-decoder) are unaffected by the view rewrite.
- Nitro throws at startup if the JS and native versions differ ("Nitro was installed twice"), so exactly one
  copy of react-native-nitro-modules must resolve in the lockfile.

Action taken: bumped react-native-nitro-modules to 0.37.1 for the app and every nitro package together:
nitro-fetch 1.6.3, nitro-image 0.15.2 (which requires 0.37), and @osuki-dev/react-native-ssh 0.1.1, whose
generated code targets 0.36.5 and relies on 0.37 keeping the deprecated `CachedProp` ABI. Native build result is
recorded under Native verification.

### react-native-reanimated 4.5.3 → 4.6.0

What changed:

- 4.6.0 (2026-08-21) https://github.com/software-mansion/react-native-reanimated/releases/tag/4.6.0 — React Native
  0.87 support; CSS animation/transition lifecycle callbacks now fire on iOS/Android (`onCSSAnimationStart/End/
Iteration/Cancel`, `onCSSTransitionRun/Start/End/Cancel`); `contrastColor()` worklet utility; experimental
  Android platform-driven `opacity` transitions (off by default); fixes for pseudo-selectors, layout-animation
  crashes/deadlocks, stale values after app pause, `useAnimatedKeyboard` Android crash, Strict-API-compatible
  types; Android build config compileSdk 37 + Kotlin 2.2.0.
- Peer deps: `react-native: 0.83 - 0.87`, `react-native-worklets: 0.12.x` (was `0.10.x - 0.11.x`). Android
  default `compileSdk` 36 → 37 only when the app does not set `compileSdkVersion`; AGP 9 built-in Kotlin handled.

Breaking: worklets must move to 0.12.x at the same time; 0.11.x is rejected by the peer range.

Action taken: bumped to 4.6.0 together with react-native-worklets 0.12.1. RN 0.86 is inside the supported range,
so no RN bump was needed. Listed in `expo.install.exclude` (SDK pin is 4.5.1).

### react-native-worklets 0.11.3 → 0.12.1

What changed:

- 0.12.0 (2026-08-11) https://github.com/software-mansion/react-native-reanimated/releases/tag/worklets-0.12.0 —
  `WeakRef` on worklet runtimes (Hermes microtask queue per runtime); Bundle Mode mmaps local bundles / streams
  dev-server bundles; `enableLocking` option on `createWorkletRuntime`; removed the deprecated C++ `WorkletRuntime`
  sync API (`runGuarded`, `runAsyncGuarded`, `executeSync` overloads; JS API unchanged); fixes for
  `RetainingSerializable` race, UI loop pause on background, autorelease drain.
- 0.12.1 (2026-08-18) https://github.com/software-mansion/react-native-reanimated/releases/tag/worklets-0.12.1 —
  `UIScheduler::isOnUIThread` extraction.
- Peer deps: `react-native: 0.83 - 0.87`. Same Gradle changes as reanimated (compileSdk default 37, AGP 9).

Breaking: pairs only with reanimated 4.6.x. The C++ sync API removal affects only native callers of
`WorkletRuntime::executeSync`/`runGuarded`; nitro-fetch uses the JS `createWorkletRuntime` + `runOnRuntimeAsync`
(both still present) and RNGH is unaffected.

Action taken: bumped to 0.12.1 with reanimated 4.6.0. Listed in `expo.install.exclude` (SDK pin is 0.10.1).

### @shopify/react-native-skia 2.10.1 → 2.11.2

Source of truth: GitHub release bodies, `npm view`, and the `v2.10.1...v2.11.2` compare (30 commits). No release
in the range declares a breaking change; it is one minor (feature + Skia m152 binary bump) plus bug-fix patches.

What changed:

- 2.10.2 (2026-08-05) https://github.com/Shopify/react-native-skia/releases/tag/v2.10.2 — rename the leftover
  `rnwgpu` C++ namespace to `RNJsi` to fix an ODR clash with `react-native-webgpu` (#3991). Pure internal C++
  rename; the app does not link webgpu.
- 2.11.0 (2026-08-06) https://github.com/Shopify/react-native-skia/releases/tag/v2.11.0 — `select(sharedValue,
key)` drives multiple animated props from one shared value whose `.value` is an object; adds
  `SharedValueSelector<T>` and widens `AnimatedProp<T>`; existing shared-value-as-prop and `useDerivedValue`
  behaviour unchanged. Skia upgraded to m152 (#3993) by bumping the prebuilt `react-native-skia-android` /
  `react-native-skia-apple-*` binaries 150.0.0 → 152.0.0; no podspec, Gradle, CMake, min-iOS or NDK changes.
  Chore #3995 removes the deprecated `Skia.Context(surface, width, height)` / `SkiaContext` type and the native
  `makeContextFromNativeSurface` hook (not used in `src/`).
- 2.11.1 (2026-08-23) https://github.com/Shopify/react-native-skia/releases/tag/v2.11.1 — all fixes:
  `Font.setSubpixel`/`setEmbolden` accept booleans (#4011); `<Mask>` applies `srcIn` once per group (#4022);
  inner shadow from shape outline (#4023); Group/CTM no longer emits a restore for a CTM that never saved
  (#4013; `Visitor.ts` records a CTM command only when `clip`/`transform`/`matrix`/`layer` is set);
  SavePaint keeps the paint/opacity stack balanced and pushes `paint` as a frame-scoped copy (#4021);
  Android view snapshots restore overflow clipping (#4004); `SkMatrix.scale(x)` scales uniformly when `y` is
  omitted (#4016); skew axes swapped to the correct order (#4015, #4020); Path trims before stroking (#4018);
  ImageShader uses `makeShaderOptions` for non-cubic sampling (#4017).
- 2.11.2 (2026-09-01) https://github.com/Shopify/react-native-skia/releases/tag/v2.11.2 — all fixes: web
  framerate fix (#4035, N/A); `isEdge` compares against the far edges of the rect (#4028); shipped
  `JsiInstance.d.ts` declares `/// <reference lib="esnext.disposable" preserve="true" />` so `SkJSIInstance
extends Disposable` is self-contained (#4031; needs TS >= 5.5); the declarative renderer's implicit paint
  (`SavePaintCmd` fresh paint, pooled `DrawingContext` paint after `reset()`) now defaults `antiAlias = true`
  like `Skia.Paint()` (#4024); `SkFont.getTypeface()` refcount fix (#4025, closes #3983) — the native accessor
  built an `sk_sp<SkTypeface>` from the borrowing getter, so every JS call stole one reference when the wrapper
  was GC'd and the typeface could be destroyed while `SkFont`s still pointed at it, crashing in
  `SkTypeface::getBounds` / `textToGlyphs`; Android video frames preserved before disposal (#4019); runtime
  lifecycle fix (#4037, closes #4003) — `StaticRuntimeAwareCache` keys prototype caches on an install
  generation instead of the `jsi::Runtime*` address, so an in-process runtime recreation (expo-updates
  `reloadAsync`, `DevSettings.reload`, fast refresh) that reuses the freed address no longer hands objects of a
  dead runtime to the new one.
- Peer dependencies identical in 2.10.1 and 2.11.2: `react >=19.0`, `react-native >=0.78`,
  `react-native-worklets >=0.7.0` (optional), `react-native-reanimated >=4.0.0` (optional). Only the prebuilt
  Skia binary dependencies changed (150.0.0 → 152.0.0). `canvaskit-wasm` and `react-reconciler` unchanged.

Impact on src/components/skia-terminal.tsx. The used API surface was checked against the diff of every
non-test file under `packages/skia/` in the compare range. `Canvas`, `Fill`, `Group` (transform/clip), `Picture`,
`Rect` have no prop or type changes; only rendering internals changed (#4013 CTM balance, #4021 paint stack,
#4024 AA default), and because the app's `<Group>`s always pass `transform`/`clip` and never a `paint` prop,
#4013/#4021 are no-ops for it. `Skia.PictureRecorder` / `beginRecording` / `finishRecordingAsPicture`, `SkPicture`
caching and `dispose()`, `Skia.ParagraphBuilder.Make` / `addText` / `pushStyle` / `build` / `layout` / `paint`,
`SkParagraph.dispose()`, `Skia.TypefaceFontProvider.Make()` / `registerFont`, `Skia.Paint` and its setters,
`PaintStyle.Stroke`, `Skia.Color`, `Skia.Point`, `rect()`, `matchFont`, `useFont`, `FontSlant`/`FontWeight`,
`setLinearMetrics`, `getGlyphIDs`, `getGlyphWidths`, `drawGlyphs` are all untouched. The one behavioural fix that
applies directly is #4025: line 423 does `nerdFont?.getTypeface()` and hands the result to
`provider.registerFont(...)`, and `fontManager` is re-created on every `nerdFont` change (font URI or size), so
under 2.10.1 repeated remounts leaked one unref per call and could eventually free the typeface still held by
`useFont`'s `SkFont` and every cached fallback paragraph, crashing in `getGlyphIDs`/`textToGlyphs` or
`GlyphsCmd::draw`. 2.11.2 fixes this with no code change. #4024 also makes the declarative `<Fill>`/`<Rect>`
nodes get AA=true consistently (the reused pool paint could previously be AA=false on later frames); the
imperative `getSolidPaint` (factory AA default) and `getRectPaint` (explicit `setAntiAlias(false)`) are unchanged.
#4037 is relevant because the app ships expo-updates. `select()` is additive; shared values as props and
`useDerivedValue` transforms (`contentTransform`, `animatedVisibleHeight`) behave as before. `Skia.Context` is not
used anywhere in `src/`. #4031 can only remove a potential lib error under the app's `expo/tsconfig.base`.
Conclusion: none of the used APIs changed signature or semantics; the upgrade brings two fixes that concretely
benefit this file (#4025, #4024) and one runtime-stability fix (#4037).

Breaking: none declared. `Skia.Context` removal is type-level surface removal of an undocumented hook.

Action taken: bumped to 2.11.2, which pulls `react-native-skia-android` / `react-native-skia-apple-ios` 152.0.0
transitively; `pod install` / Gradle sync picks up the new binaries. No source changes in
`src/components/skia-terminal.tsx`; the `builder.dispose?.()` optional call stays. Post-upgrade check: run the app
on both platforms, change the terminal font size (re-creates `fontManager` via `getTypeface()`), and do a dev
reload (exercises #4037). Listed in `expo.install.exclude` (SDK pin is 2.6.2).

### react-native-screens 4.26.2 → 4.27.0

What changed:

- 4.27.0 (2026-08-07) https://github.com/software-mansion/react-native-screens/releases/tag/4.27.0 — React Native
  0.87 support (fixes an iOS runtime crash); experimental `ScrollToTopGuard` (iOS); `Split` component migrated
  Swift → Objective-C, and Swift is fully removed from the pod (`Swift-Bridging.h` gone, no `OTHER_SWIFT_FLAGS`);
  `backTitleVisible` default is now boolean `true` (was the string `'true'`); Android Stack v5 batched updates via
  view command, header height without top inset when disabled, crash when header updates during screen removal,
  FormSheet v4 listener cleanup; iOS Stack v5 header-menu view commands, no VC view swap during transition,
  orientation fallback, tab-bar re-layout after async icon load (iOS 26), framework-style React header imports;
  JS prevents `ViewInstance` type usage. AGP 9 built-in Kotlin handled on Android.

Breaking: none for apps; only a Podfile or patch that referenced RNScreens Swift files would need updating.

Action taken: bumped to 4.27.0 and updated the matching `overrides["react-native-screens"]` entry in the same
step so transitive copies resolve to the same version. Listed in `expo.install.exclude` (SDK pin is ~4.26.0).

### react-native-gesture-handler 3.1.0 → 3.2.1

What changed:

- 3.2.0 (2026-08-13) https://github.com/software-mansion/react-native-gesture-handler/releases/tag/v3.2.0 — AGP 9
  support (#4263); `Pressable` reimplemented on `Touchable` (#4411) and no longer relies on `GestureDetector`;
  hover callbacks on `Touchable`; fix for `Cannot read property 'translationX' of undefined` on events without
  `allTouches`; `uiRuntime` taken directly from react-native-worklets (#4276), `makeMutable` replaced by
  `createShareable`, deprecated Reanimated APIs dropped in favour of Worklets; Strict TS API types;
  `PressableEvent` exported; imperative testing API; hitSlop normalisation moved to JS; many Android/iOS/macOS
  gesture fixes.
- 3.2.1 (2026-08-14) https://github.com/software-mansion/react-native-gesture-handler/releases/tag/v3.2.1 —
  forward press handlers as `testOnly_*` in `PressableWithTouchable`; update `Pressable` props.
- Native: when a stable `react-native-worklets >= 0.8.0` is installed, RNGH now links against it
  (`-DRNGH_USE_WORKLETS`, Gradle `implementation(project(':react-native-worklets'))`, podspec
  `s.dependency "RNWorklets", ">= 0.8.0"`). Peer deps unchanged.

Breaking: `Pressable` internals changed (pressed state derived from `testOnly_pressed`); custom Pressable usages
and tests should be re-checked. Otherwise none; worklets 0.12.1 satisfies the new native link.

Action taken: bumped to ~3.2.1. Listed in `expo.install.exclude` (SDK pin is ~2.32.0).

### react-native-keyboard-controller 1.22.2 → 1.22.4

What changed:

- 1.22.3 (2026-08-05) https://github.com/kirillzyusko/react-native-keyboard-controller/releases/tag/1.22.3 —
  `KeyboardChatScrollView` overscroll during interactive dismissal and crash on unmount; Android
  `IllegalStateException`; iOS crash on unpaired UTF-16 surrogate in `onTextChangedHandler`; focused-input
  events inside `Modal` use the propagation view `surfaceId`; react-native-strict-api compatibility; `rounded`
  prop on `KeyboardEffects`.
- 1.22.4 (2026-08-17) https://github.com/kirillzyusko/react-native-keyboard-controller/releases/tag/1.22.4 —
  old-`turbo` package compat; `KeyboardExtender` recycling on iOS; consistent codegen import; reanimated 3.0
  compat; stale `keyboardLayoutGuide` stuck animations; keep `StatusBar` proxy alive on RN 0.87; skip
  `kotlin-android` under AGP 9 built-in Kotlin; initialise `_props` in Fabric view constructors.
- Peer deps and podspec unchanged.

Breaking: none.

Action taken: bumped to 1.22.4. Listed in `expo.install.exclude` (SDK pin is 1.21.9).

### @osuki-dev/ui 0.0.1 → 1.0.0

What changed (osuki-dev/kit `packages/ui`; versions 0.0.1, 0.2.0, 0.3.0, 1.0.0):

- 0.3.0 (2026-08-11): adds `PressableScale`, `ChoiceRow` + `ChoiceList`, `InlineActivity`; `Spinner` sizes moved
  to shared `spinner-size.ts` (`SpinnerSize` still exported); adds `docs/`.
- 1.0.0 (2026-08-12): dependency-only — drops `react-native-worklets` from peerDependencies; relaxes peers to
  `@expo/ui >=57.0.4`, `expo-font >=57.0.0`, `expo-router >=57.0.4`, `react-native-safe-area-context >=5.7.0`.
- Exports map unchanged (`.`, `./theme`, `./components`, `./fonts`); the `react-native` condition still resolves
  to `src/index.ts`, while the `types` entry now points at `lib/`.
- All 24 symbols the app imports across 69 sites (Button, Card, Colors, createThemePreset, Dialog, Icon, IconName,
  Input, KeyboardToolbar, motion, PressableCard, ScrollScreen, SearchInput, SegmentedControl, Skeleton, Spinner,
  Stack, Tabs, Tag, Text, Textarea, ThemeOverride, useThemeMode, useThemeTokens, useToast) are present in 1.0.0.
  Per-file diffs of every changed component are formatting/refactor only; `*Props` interfaces are identical.

Breaking: none at source level. `ToastProvider` still does not accept `maxWidth` and the viewport has no
`alignItems: "flex-end"`, so `src/app/_layout.tsx` (`<ToastProvider maxWidth={480}>`) still needs the local patch.

Action taken: bumped to ^1.0.0. The toast `maxWidth` patch is carried over as
`patches/@osuki-dev%2Fui@1.0.0.patch` (the `patchedDependencies` key is version-specific), with an extra hunk for
`lib/components/toast.d.ts` because 1.0.0's `types` entry now points at `lib/` while the `react-native` export
condition still resolves to `src/` — both copies need the prop for `tsc` and Metro to agree.

## Other packages

- react-native-webview 13.16.1 → 14.0.1: 14.0.0 is a breaking major only for Android — minSdk 24 required
  (`getReactNativeWebViewMinSdkVersion()` = max(app minSdk, 24)); the RN 0.86 / SDK 57 template is already
  minSdk 24, and there are no JS API changes. 13.16.2 thread-safe decision manager; 13.17.0 iOS
  `removeIosKeyboardObserver` prop; 14.0.1 moves `@typescript/native-preview` back to devDependencies. Only
  consumer is `src/components/simfarm-preview.tsx`. In `expo.install.exclude` (SDK pin 13.16.1); do not take the
  `next` tag (16.0.0).
- react-native-enriched-markdown 0.7.4 → 1.0.2: 1.0.0 is a large feature release (block editing, headings/lists,
  GFM code blocks with tree-sitter highlighting, `md4cFlags`, strikethrough/underline, jest mock) with no
  documented breaks; 1.0.1 vendors tree-sitter grammars / RaTeX via a `postinstall.mjs` download; 1.0.2 removes
  the Expo config plugin and `@expo/config-plugins` peer. The `["react-native-enriched-markdown", { "enableMath":
false }]` entry was removed from `app.json` plugins and replaced by the package.json
  `"enriched-markdown": { "enableMath": false }` block (read at `pod install` / Gradle time; keys are `enableMath`,
  `enableCodeHighlight`, `codeHighlightLanguages`). The package is added to `trustedDependencies` so bun runs the
  postinstall, which needs network access to npm and GitHub at install time (EAS / CI included). `EnrichedMarkdownText`
  and `MarkdownStyle` are still exported.
- react-native-safe-area-context ~5.8.1 → ~5.9.1: minor; ahead of the SDK pin (~5.7.0), in `expo.install.exclude`.
- react-native-web ~0.21.0 → ~0.21.2: patch.
- @legendapp/list ^3.3.3 → ^3.3.10, react-native-quick-crypto ^1.1.6 → ^1.1.7, zustand ^5.0.14 → ^5.0.15,
  react-native-vision-camera ^5.2.1 → ^5.2.3, react-native-vision-camera-barcode-scanner ^5.2.2 → ^5.2.3: patch
  bumps, no action.
- highlight.js ^11.11.1 → ^11.12.0, lucide-react-native ^1.28.0 → ^1.39.0, react-native-android-widget ^0.21.0 →
  ^0.22.1: minor bumps, no action.
- Tooling: ESLint (`eslint ^9.0.0`, `eslint-config-expo ~57.0.1`, `expo lint`) was replaced by oxlint 1.81.0 and
  oxfmt 0.66.0 in separate commits. `bun run lint` is now `oxlint --deny-warnings` (a warning fails the run),
  `bun run format` / `format:check` are oxfmt, configured in `.oxlintrc.json` and `.oxfmtrc.json`; suppressions use
  `// oxlint-disable-next-line <rule> -- <reason>` with oxlint rule names. Details are in AGENTS.md.
- `expo.install.exclude` lists the packages this app deliberately runs ahead of the SDK 57 pins (react, react-dom,
  gesture-handler, keyboard-controller, reanimated, safe-area-context, svg, webview, worklets, skia, screens) so
  `expo install --check` and expo-doctor pass (21/21).

## Held back

- react-native stays 0.86.3 (SDK 57 pin). 0.87.1 was tried: `npx tsc --noEmit` fails because 0.87's strict
  TypeScript API removes `TextInputKeyPressEventData`, `TextInputSelectionChangeEventData`, `TextLayoutEventData`
  and changes the ScrollView/TextInput instance types (errors in `src/hooks/use-composer-popup.ts`,
  `src/components/agent-markdown-output.tsx`, `src/components/server-terminal-workspace.tsx` and in @osuki-dev/ui's
  `otp-input.tsx` / `text.tsx`), and no stable Expo SDK supports 0.87 (only the 58 canary pins 0.87.0). Revisit
  with Expo SDK 58.
- typescript stays 6.0.3. 7.0.2 (the Go compiler) exports only `version`/`versionMajorMinor` from the
  `typescript` package — no `createSourceFile`/`forEachChild` — so `scripts/i18n-audit.ts` (the AST walk behind
  `src/i18n/__tests__/user-facing-strings.test.ts`) throws `TypeError: undefined is not an object (evaluating
'ts.ScriptTarget.Latest')` and that test fails (1 fail). `tsc --noEmit` itself is fine on 7.0.2 and no tsconfig
  option in use is rejected. Revisit when the audit script is ported to oxc-parser or the TS 7 API package.
- Expo SDK stays 57. `npm view expo dist-tags`: latest = next = 57.0.19; 58 exists only as
  `58.0.0-canary-20260902`.
- react 19.2.8 / react-dom 19.2.8 were already latest (19.3 exists only as canaries).
- react-native-nitro-text-decoder 0.2.0 is already latest. Its peer range `react-native-nitro-modules ^0.35.2`
  was already unmet on 0.36.5 and stays unmet on 0.37.1; it is a non-view module generated with nitrogen 0.35 and
  compiles, so the existing peer-range warning persists unchanged.

## Native verification

Debug builds of the upgraded tree, both from `expo prebuild` (no `--clean`), driven with agent-device 0.20.10
against a Metro on port 8095 serving this worktree.

iOS (simulator "muqun-deps", iPhone 17, iOS 26.5):

- `bunx expo prebuild --platform ios` used the prebuilt React Native Core / dependencies (`Building from source:
false`), installed NitroModules 0.37.1 and the `@osuki-dev/react-native-ssh` 0.1.1 pod; `xcodebuild` (Debug,
  iphonesimulator) finished without errors — the nitrogen-0.36-generated SSH code compiles against nitro 0.37.1.
- Home renders (what's-new sheet, SSH / scan / settings header, "Try the demo").
- "Try the demo" opens the demo workspace; the Skia terminal draws the transcript (coloured diff, box-drawn table,
  ANSI colours, cursor). Scrolling up draws scrollback with the "Latest" pill; scrolling down returns to the tail.
- Settings → Text size → Large re-creates the font manager (the `getTypeface()` path #4025 fixed) and the
  terminal redraws at the larger scale, in both the demo workspace and the SSH demo shell.
- SSH → "Open Demo shell" → "Disconnect from Demo shell" / "Connected to demo@demo.invalid" chrome; the demo
  shell terminal draws and "Send Enter" echoes a new prompt line.
- `bun test src/terminal` (777 tests, 19 files) and `src/terminal/__tests__/picture-cache.test.ts` (11) pass.
- `agent-device test e2e/agent-device/ssh-demo.ad --device "muqun-deps" --metro-port 8095`: passes (junit: tests=1 failures=0, 15.9s). Two caveats
  about how it was run: the script's own `open` line carries `--metro-port 8093` and wins over the CLI
  `--metro-port` hint, so the suite ran on a byte-identical copy with `8093` → `8095` and the `context` device
  name swapped to `muqun-deps` (nothing else changed); and the test daemon cannot take the simulator while an
  interactive session's runner is still warm — `close` the session and wait for the runner to idle (~5 min)
  rather than `daemon stop --clean`, which would also kill other sessions on the machine.

Android (emulator-5554, "Pixel 10 Pro", arm64-v8a only):

- `bunx expo prebuild --platform android` then `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`:
  BUILD SUCCESSFUL (855 tasks). The APK installs and launches to the home screen (server list) with the bundle
  from this tree. Note for anyone repeating this: the emulator's default dev host is `10.0.2.2:8081`, and another
  Metro on this machine was listening there, so the app first loaded a foreign bundle and threw
  `[Worklets] Mismatch between JavaScript part and native part of Worklets (0.11.3 vs 0.12.1)`; writing
  `debug_http_host=10.0.2.2:8095` into the app's default shared preferences (`shared_prefs/dev.osuki.muqun_preferences.xml`, via `run-as`) fixed
  it. That mismatch is a symptom of the wrong Metro, not of the upgrade.

Known dev-only noise after the upgrade:

- reanimated 4.6.0 now warns on native when a dependency array is passed to `useAnimatedStyle`,
  `useAnimatedReaction`, `useHandler`, `useDerivedValue` (`[Reanimated] dependencies should only be used in web
implementation.`). It is emitted per render, `__DEV__` only, and the arrays are ignored on native. Sources in
  this tree: react-native-keyboard-controller 1.22.4 (most of the volume: `useHandler` in its hooks,
  KeyboardAwareScrollView, KeyboardChatScrollView, ScrollViewWithBottomPadding), react-native-gesture-handler
  3.2.1 (ReanimatedSwipeable, ReanimatedDrawerLayout), and five `useAnimatedReaction` calls in
  `src/components/skia-terminal.tsx` (lines ~1185-1235 and ~1830). Left as-is pending an upstream
  keyboard-controller release; the app's five sites can drop their third argument if the noise matters.
- Metro warns that `@formatjs/intl-*/polyfill-force` is not in those packages' `exports` (pre-existing; the
  @formatjs packages did not change).
