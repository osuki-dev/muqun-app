// react-native-release-profiler is a devDependency, but Expo autolinks a
// project's top-level devDependencies as well, and the profiler's Android
// manifest adds WRITE_EXTERNAL_STORAGE. It must never reach a store build.
//
// - iOS: linked into the Debug configuration only, or into every
//   configuration with MUQUN_RELEASE_PROFILER=1 at `pod install` time (the
//   Podfile re-runs autolinking on every install).
// - Android: always the debug build type here. Gradle caches this file's
//   result keyed on its contents, not on the environment, so the release side
//   is decided in Gradle instead: plugins/with-release-profiler-stub.cjs adds
//   the real module to release with MUQUN_RELEASE_PROFILER=1, and an empty
//   stand-in for the package React Native's shared PackageList names
//   otherwise.
//
// The JS side is stripped from Release bundles separately; see
// src/lib/release-profiler.ts.
const profiling = process.env.MUQUN_RELEASE_PROFILER === '1';

module.exports = {
  dependencies: {
    'react-native-release-profiler': {
      platforms: {
        ios: { configurations: profiling ? [] : ['Debug'] },
        android: { buildTypes: ['debug'] },
      },
    },
  },
};
