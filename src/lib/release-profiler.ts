/**
 * Hermes sampling profiles, from a Debug build or a dedicated Release build.
 *
 * `react-native-release-profiler` turns on Hermes' sampling profiler and writes
 * a `.cpuprofile`. A Release build is where JS cost should be measured -- a
 * Debug build compiles from source -- but the control is also available in
 * development for a quick look.
 *
 * Nothing of this reaches a store build:
 *
 * - The native module is linked into iOS Debug only by default, and into
 *   anything else only with `MUQUN_RELEASE_PROFILER=1` at build time (see
 *   react-native.config.js).
 * - The control, this module and the library's JS are pulled in by one
 *   `require` in the root layout behind `__DEV__ ||
 *   process.env.EXPO_PUBLIC_RELEASE_PROFILER === '1'`. Both are inlined when a
 *   Release bundle is built, so the condition folds to `false` and Metro drops
 *   the `require` before it collects dependencies.
 * - The control only appears where the native half is actually linked.
 *
 * A Release profiling build sets both switches:
 *
 *     MUQUN_RELEASE_PROFILER=1 EXPO_PUBLIC_RELEASE_PROFILER=1 <release build>
 *
 * Then press ●, do the thing, and press ■. On iOS the file is in the app's
 * Caches directory. On Android it is also copied to Downloads, which is how a
 * non-debuggable build hands it over. `react-native-release-profiler --local
 * <file>` or `--fromDownload --appId dev.osuki.muqun` turns it into a trace
 * Perfetto or SpeedScope opens.
 */
import { NativeModules, Platform } from 'react-native';
import { startProfiling, stopProfiling } from 'react-native-release-profiler';

/** Whether the native half is in this binary. */
export function isReleaseProfilerLinked(): boolean {
  return NativeModules.ReleaseProfiler != null;
}

export function startReleaseProfile(): void {
  startProfiling();
}

/** Stops the session and returns the path the profile was written to. */
export async function stopReleaseProfile(): Promise<string> {
  return stopProfiling(Platform.OS === 'android');
}
