/**
 * The start/stop button for a Release profiling build.
 *
 * Required only by a Debug bundle or a Release profiling bundle (see
 * src/lib/release-profiler.ts), and drawn only where the native module is
 * linked, so no reader of a store build ever sees it. It is a measuring instrument, not
 * a feature, pinned to a corner where it covers as little of what is being
 * measured as possible. It carries no words: ● starts, ■ stops, and a device
 * driver presses it by `testID` (`release-profiler-start` /
 * `release-profiler-stop`). The saved file's path appears under it as
 * `release-profiler-result`.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import {
  isReleaseProfilerLinked,
  startReleaseProfile,
  stopReleaseProfile,
} from '@/lib/release-profiler';

type State =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'saved'; path: string }
  | { kind: 'error'; message: string };

const INK = '#ffffff';

export function ReleaseProfilerControl() {
  // Android links the module only on request, so a Debug build may lack it.
  return isReleaseProfilerLinked() ? <Control /> : null;
}

function Control() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const recording = state.kind === 'recording';

  const toggle = async () => {
    try {
      if (recording) {
        const path = await stopReleaseProfile();
        console.log(`[release-profiler] saved ${path}`);
        setState({ kind: 'saved', path });
      } else {
        startReleaseProfile();
        setState({ kind: 'recording' });
      }
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <Pressable
        accessibilityRole="button"
        onPress={toggle}
        style={[styles.button, recording && styles.recording]}
        testID={recording ? 'release-profiler-stop' : 'release-profiler-start'}>
        <Text color={INK} variant="caption">
          {recording ? '■' : '●'}
        </Text>
      </Pressable>
      {state.kind === 'saved' || state.kind === 'error' ? (
        <View style={styles.note}>
          <Text color={INK} numberOfLines={2} testID="release-profiler-result" variant="caption">
            {state.kind === 'saved' ? state.path : state.message}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: 320,
    zIndex: 20_000,
    elevation: 20_000,
  },
  button: {
    alignSelf: 'flex-start',
    minWidth: 32,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#202020cc',
  },
  recording: { backgroundColor: '#b3261ecc' },
  note: { marginTop: 4, padding: 4, backgroundColor: '#202020cc' },
});
