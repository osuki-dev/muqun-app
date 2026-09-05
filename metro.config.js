// The app previously had no metro.config.js and relied on Expo's implicit
// defaults. `getDefaultConfig` below *is* that default, so everything except
// the one resolver rule underneath it is unchanged.
//
// The rule drops a 963 KB font the app cannot reach.
//
// `expo-router` reaches Material Symbols through a chain of unconditional
// static imports, measured from the release bundle's own module graph:
//
//   layouts/withLayoutContext.js          <- Drawer, Stack and Tabs all use it
//     -> native-tabs/NativeTabTrigger.js
//       -> native-tabs/utils/optionsIconConverter.android.js
//         -> native-tabs/utils/materialIconConverter.android.js
//           -> expo-symbols
//             -> @expo-google-fonts/material-symbols/400Regular  (963,776 bytes)
//
// Nothing in that chain is conditional, so Metro -- which does not tree-shake --
// walks all of it the moment a layout is imported, and `withLayoutContext` is
// imported by `Drawer` and `Stack`, which this app does use. The font then rides
// into the APK as `res/raw/...materialsymbols_400regular.ttf`, 0.41 MiB of the
// download, for glyphs nothing can draw: Material Symbols are rendered only by
// `NativeTabs`, and this app has no native tabs. Its navigation is a drawer over
// a stack (`src/app/_layout.tsx`, `src/app/(drawer)/_layout.tsx`).
//
// The font is safe to cut rather than merely unused because nothing dereferences
// it at import time. `expo-symbols/build/utils.js` exports `getFont()`, and its
// only two callers -- `SymbolView`'s render and
// `unstable_getMaterialSymbolSourceAsync` -- run inside a component or an async
// function. An empty module here therefore changes nothing until a Material
// Symbol is actually drawn, which is exactly the case this app never reaches.
//
// If native tabs are ever adopted, delete this rule. That is the whole undo, and
// the symptom of forgetting it would be a native tab bar with missing icons --
// so it is written to be found by anyone grepping for the font.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const previousResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@expo-google-fonts/material-symbols')) {
    return { type: 'empty' };
  }
  return (previousResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
