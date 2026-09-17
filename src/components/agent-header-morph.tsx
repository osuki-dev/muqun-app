import { useThemeTokens, Text } from '@osuki-dev/ui';
import { ChevronDown, FolderGit2, Plus, Square } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { StatusDot } from '@/components/status-dot';
import { PRESET, timing } from '@/lib/motion';

/**
 * The two morphs the agent header is built from.
 *
 * Both were written inline in `src/app/agent.tsx`. They are reusable controls
 * rather than screen furniture -- the SSH and server headers want the same
 * pair -- so they live here next to `nav-header.tsx`, and the screen keeps only
 * the wiring.
 *
 * Both follow the same rule, which is the one `workspace-title-switcher.tsx`
 * established: the state that is leaving clears before the state arriving
 * commits. Out on `dropdown` (the shorter preset), in on `short` after it. A
 * symmetric cross-fade shows both states at half strength through the middle,
 * which reads as two things trading places -- the opposite of what a morph is
 * for.
 */

/**
 * How small a departing layer is allowed to get.
 *
 * It used to be 0.55, which meant the midpoint of the cross-fade showed *two*
 * small glyphs rather than one continuous shape. 0.8 keeps enough of the
 * outgoing form on screen for the eye to follow it into the incoming one.
 */
const MORPH_SCALE_FLOOR = 0.8;

/**
 * `Plus` is four-fold symmetric, so rotating it 90 degrees is a visual no-op --
 * the glyph lands on itself and the rotation was invisible. At 45 the `+` reads
 * as turning into an `x` on its way out, which is the half-beat that sells the
 * change into the filled stop square.
 */
const PLUS_ROTATION_DEGREES = 45;

/** How far the departing title slides, and the arriving one slides in from. */
const PILL_SLIDE_DISTANCE = 6;

/**
 * The `+` that becomes a Stop control while the session is producing output,
 * morphing back once it goes idle. Both icons stay mounted and cross-fade so
 * the switch reads as one control changing, not two trading places.
 */
export function SessionActionIcon({ running }: { running: boolean }) {
  const theme = useThemeTokens();
  const plus = useSharedValue(running ? 0 : 1);
  const stop = useSharedValue(running ? 1 : 0);

  useEffect(() => {
    // Asymmetric on purpose: whichever glyph is leaving goes out on the
    // shorter preset, and the one arriving starts only once it has gone.
    if (running) {
      plus.value = withTiming(0, timing('dropdown'));
      stop.value = withDelay(PRESET.dropdown, withTiming(1, timing('short')));
    } else {
      stop.value = withTiming(0, timing('dropdown'));
      plus.value = withDelay(PRESET.dropdown, withTiming(1, timing('short')));
    }
  }, [running, plus, stop]);

  const plusStyle = useAnimatedStyle(() => ({
    opacity: plus.value,
    transform: [
      { scale: MORPH_SCALE_FLOOR + (1 - MORPH_SCALE_FLOOR) * plus.value },
      { rotate: `${(1 - plus.value) * PLUS_ROTATION_DEGREES}deg` },
    ],
  }));

  const stopStyle = useAnimatedStyle(() => ({
    opacity: stop.value,
    transform: [{ scale: MORPH_SCALE_FLOOR + (1 - MORPH_SCALE_FLOOR) * stop.value }],
  }));

  return (
    <View pointerEvents="none" style={styles.actionIconStack}>
      <Animated.View style={[styles.actionIconLayer, plusStyle]}>
        <Plus size={18} color={theme.colors.text} strokeWidth={2.2} />
      </Animated.View>
      <Animated.View style={[styles.actionIconLayer, stopStyle]}>
        <Square
          size={14}
          color={theme.colors.danger}
          strokeWidth={2.4}
          fill={theme.colors.danger}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The workspace pill's content: the session's title once it has one, the
 * workspace name and path until then, crossfading between the two so the
 * change reads as one pill changing its mind.
 *
 * The title used to be shown only while the agent was producing output. An
 * auto-title lands on the first turn and is then the name of the thing on
 * screen, running or not; hiding it again the moment the turn ended made every
 * idle session anonymous.
 */
export function WorkspacePillContent({
  showSession,
  running = false,
  sessionTitle,
  workspaceName,
  workspacePath,
}: {
  showSession: boolean;
  /** Only a working session's dot pulses; an idle one is still just there. */
  running?: boolean;
  sessionTitle?: string;
  workspaceName: string;
  workspacePath: string;
}) {
  const theme = useThemeTokens();
  const workspace = useSharedValue(showSession ? 0 : 1);
  const session = useSharedValue(showSession ? 1 : 0);

  useEffect(() => {
    if (showSession) {
      workspace.value = withTiming(0, timing('dropdown'));
      session.value = withDelay(PRESET.dropdown, withTiming(1, timing('short')));
    } else {
      session.value = withTiming(0, timing('dropdown'));
      workspace.value = withDelay(PRESET.dropdown, withTiming(1, timing('short')));
    }
  }, [showSession, workspace, session]);

  const workspaceStyle = useAnimatedStyle(() => ({
    opacity: workspace.value,
    transform: [{ translateX: -PILL_SLIDE_DISTANCE * (1 - workspace.value) }],
  }));

  const sessionStyle = useAnimatedStyle(() => ({
    opacity: session.value,
    transform: [{ translateX: PILL_SLIDE_DISTANCE * (1 - session.value) }],
  }));

  return (
    <View pointerEvents="none" style={styles.pillStackViewport}>
      <Animated.View style={[styles.pillStack, workspaceStyle]}>
        <FolderGit2 size={15} color={theme.colors.primary} />
        <Text
          variant="bodySmall"
          weight="bold"
          numberOfLines={1}
          color={theme.colors.text}
          style={styles.workspacePillName}>
          {workspaceName}
        </Text>
        <Text
          variant="caption"
          numberOfLines={1}
          color={theme.colors.textMuted}
          style={styles.workspacePillPath}>
          {workspacePath}
        </Text>
        <ChevronDown size={13} color={theme.colors.textMuted} />
      </Animated.View>
      <Animated.View style={[styles.pillStack, sessionStyle]}>
        <StatusDot
          color={running ? theme.colors.primary : theme.colors.success}
          filled
          pulse={running}
          size={7}
        />
        <Text
          variant="bodySmall"
          weight="bold"
          numberOfLines={1}
          color={theme.colors.text}
          style={styles.workspacePillName}>
          {sessionTitle}
        </Text>
        <ChevronDown size={13} color={theme.colors.textMuted} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionIconStack: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillStackViewport: {
    flex: 1,
    minWidth: 0,
    height: '100%',
  },
  pillStack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  workspacePillName: {
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
  },
  workspacePillPath: {
    fontSize: 11,
    flexShrink: 1,
    includeFontPadding: false,
  },
});
