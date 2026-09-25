import { ThemeIcon } from '@/components/theme-icon';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
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
import { fadeIn, PRESET, timing } from '@/lib/motion';
import { AGENT_TYPE } from '@/constants/agent-type';

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
      plus.set(withTiming(0, timing('dropdown')));
      stop.set(withDelay(PRESET.dropdown, withTiming(1, timing('short'))));
    } else {
      stop.set(withTiming(0, timing('dropdown')));
      plus.set(withDelay(PRESET.dropdown, withTiming(1, timing('short'))));
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
        <ThemeIcon
          name="chrome.create"
          fallback={Plus}
          size={18}
          color={theme.colors.text}
          strokeWidth={2.2}
        />
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
  worktreeName,
  workspaceName,
  workspacePath,
}: {
  showSession: boolean;
  /** Only a working session's dot pulses; an idle one is still just there. */
  running?: boolean;
  sessionTitle?: string;
  /**
   * The worktree this session sits in, and nothing when it sits in the project.
   *
   * A second checkout of the same repository is the one fact about a session
   * that changes what its work *means* and is invisible everywhere else: the
   * title is the same, the model is the same, and the path is the one run the
   * pill has never had room for. It is drawn under the title rather than
   * beside it because the title is the thing being read and this qualifies it
   * -- and quietly, in `textSubtle`, because a session in the project it
   * belongs to says nothing at all and the two states must not swap sizes.
   *
   * The pill's height does not change either way: it is a 46pt control, and a
   * title line plus this one is 30.
   */
  worktreeName?: string;
  workspaceName: string;
  workspacePath: string;
}) {
  const theme = useThemeTokens();
  const workspace = useSharedValue(showSession ? 0 : 1);
  const session = useSharedValue(showSession ? 1 : 0);

  useEffect(() => {
    if (showSession) {
      workspace.set(withTiming(0, timing('dropdown')));
      session.set(withDelay(PRESET.dropdown, withTiming(1, timing('short'))));
    } else {
      session.set(withTiming(0, timing('dropdown')));
      workspace.set(withDelay(PRESET.dropdown, withTiming(1, timing('short'))));
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
        {/* Keyed on the title, so a rename -- or the auto-title landing on the
            first turn -- fades in where the old name was rather than replacing
            it between two frames. The same beat the strip's chips use. */}
        <Animated.View
          key={sessionTitle}
          entering={fadeIn('short')}
          style={styles.workspacePillTitle}>
          <Text
            variant="bodySmall"
            weight="bold"
            numberOfLines={1}
            color={theme.colors.text}
            style={styles.workspacePillName}>
            {sessionTitle}
          </Text>
          {worktreeName ? (
            // Keyed on the name, so a move fades the new worktree in where the
            // old one was -- the same beat the title above it uses when an
            // auto-title lands, and never an abrupt swap.
            <Animated.View key={worktreeName} entering={fadeIn('short')}>
              <Text
                variant="caption"
                numberOfLines={1}
                color={theme.colors.textSubtle}
                style={styles.workspacePillWorktree}>
                {worktreeName}
              </Text>
            </Animated.View>
          ) : null}
        </Animated.View>
        {/* No chevron. It trailed the title, so it stood somewhere different
            for every session name and jumped when an auto-title landed; the
            owner's call was pin it or drop it, and pinned to the trailing edge
            it would sit on the swipe mark that already lives there. The pill
            is the only thing in the header that is not a round button, which
            is affordance enough, and its accessibility label says what a tap
            does. */}
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
  workspacePillTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  workspacePillWorktree: {
    fontSize: AGENT_TYPE.micro.size,
    lineHeight: AGENT_TYPE.micro.lineHeight,
    includeFontPadding: false,
  },
  // No `fontWeight` here, and that is the whole of the fix: both places that
  // wear this style already pass the kit's `weight="bold"` prop, and the kit
  // puts the caller's `style` *after* its own resolved font style, so a `'700'`
  // written here won the argument. On Android 700 is the one weight that
  // discards the reader's interface font -- `expo-font` registers a face under
  // `Typeface.NORMAL` only, `ReactFontManager` rounds 700 to BOLD, finds
  // nothing, and ends on `Typeface.create(family, style)`, a lookup against the
  // system list -- so the workspace name and the session title in the header
  // were drawn in Roboto with the path directly beside them in the reader's
  // face. The prop goes through the registry, which resolves bold down to 600.
  workspacePillName: {
    fontSize: AGENT_TYPE.meta.size,
    includeFontPadding: false,
  },
  workspacePillPath: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
    includeFontPadding: false,
  },
});
