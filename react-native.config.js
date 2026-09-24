// react-native-release-profiler is a devDependency, but Expo autolinks a
// project's top-level devDependencies as well, and the profiler's Android
// manifest adds WRITE_EXTERNAL_STORAGE. It must never reach a store build.
//
// - Default: linked into Debug only -- the iOS Debug configuration and the
//   Android debug build type -- so a Release archive or APK does not contain
//   it. Android's generated PackageList still names the package in release;
//   plugins/with-release-profiler-stub.js gives release an empty stand-in.
// - MUQUN_RELEASE_PROFILER=1: linked into every configuration, for a Release
//   profiling build.
//
// The JS side is stripped from Release bundles separately; see
// src/lib/release-profiler.ts.
const profiling = process.env.MUQUN_RELEASE_PROFILER === '1';

module.exports = {
  dependencies: profiling
    ? {}
    : {
        'react-native-release-profiler': {
          platforms: {
            ios: { configurations: ['Debug'] },
            android: { buildTypes: ['debug'] },
          },
        },
      },
};
