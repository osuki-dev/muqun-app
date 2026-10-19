# Dependency patch notes

## @osuki-dev/ui 2.0.0-beta.4

The patch file keeps its beta.3 name because its content is unchanged and
`patches/*.patch` is an OTA fingerprint input: renaming it would move the
fingerprint away from installed builds. Rename it with the next native build.

The source-only icon patch removes the optional Lucide runtime loader and its
fallback lookup. Muqun supplies semantic Nano glyphs through `IconProvider`;
Kit's built-in controls are translated at `src/icons/kit-resolver.tsx`.
This keeps Metro from resolving an unused SVG peer. No generated library
output is patched. Remove the patch when Kit supports disabling its optional
Lucide lookup or ships a resolver-only icon implementation.

## @hot-updater/react-native 1.1.0

Call `ReactRootView.getRootViewTag()` explicitly in Android recovery attribution.
React Native 0.88 exposes this method in a way Kotlin does not resolve through
the synthetic `rootViewTag` property, which prevents release compilation.
This preserves the same root identifier and recovery behavior. Remove this
source-only patch when Hot Updater includes the explicit getter call upstream.
