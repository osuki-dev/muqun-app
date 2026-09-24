import { useSurfaceBackground } from '@/hooks/use-surface-background';
// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { Bot, ChevronRight, SquareTerminal } from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { agentStatusWord } from '@/i18n/labels';
import { feedback } from '@/lib/feedback';
import { homeServerModel } from '@/lib/home-server-model';
import { PRESS, timing } from '@/lib/motion';
import type { ServerAgent, ServerAgentsSnapshot } from '@/lib/server-agents';
import type { ServerReachability } from '@/lib/server-reachability';
import { useAppSettings } from '@/stores/app-settings';

/**
 * The rows start at the card's own edge.
 *
 * A theme accent and bot icon identify agents; ordinary panes use neutral
 * text and a terminal icon. These communicate kind, not live status. The
 * caption and accessibility label retain status, and stale snapshots dim
 * both kinds consistently. Distinct icons preserve meaning without color.
 */

/**
 * How far the press band reaches past the row's own box, into the card's
 * padding. A pressed row is a band across the card rather than a pill floating
 * inside it; the card clips it back to its own corner radius.
 */
const ROW_BLEED = 8;

/**
 * The agents a server was last running, as a list under it.
 *
 * Every row the current `serverCardPanes` setting (Settings > "Panes on
 * server cards") admits gets drawn: the snapshot itself always holds every
 * pane (`mirroredServerPanes`, `lib/server-agents.ts`), and this component is
 * where "agents" mode is answered, by filtering to `agent.hasAgent` right
 * here rather than upstream in what gets written. Reading the setting here
 * means a change made in Settings is on screen the moment this re-renders --
 * no visit to a server screen required to rewrite the mirror in the newly
 * chosen shape, which is what the old write-side branch cost. There used to
 * be a cap and a `+N more` tail below the (then unfiltered) list, and the
 * tail was the wrong answer twice over: it hid the agent you were looking for
 * behind a row that only re-opened the same server, and it made the card's
 * height a lie about how much was running on the machine. A card that grows
 * with its agents is the honest shape, and the mirror already caps what it
 * stores at `MAX_SERVER_AGENTS`, so the list has a bound without the screen
 * inventing one.
 *
 * There is no live connection behind any of it, so nothing here claims to be
 * one: a snapshot past its freshness window is dimmed, labelled with its age,
 * and has its status colours taken away, and a server the app has never opened
 * renders nothing at all rather than an empty frame promising something that is
 * not coming.
 */
export function ServerAgentRows({
  serverId,
  snapshot,
  reachability,
  rowMinHeight,
  onOpenAgent,
  selectedPaneId,
  showsPressBackground = true,
  compactLabels = false,
  style,
  // Only a fallback: the list passes one clock down so every card ages against
  // the same instant. Nothing is rendered from the value read here -- it only
  // decides whether a snapshot reads as stale.
  // oxlint-disable-next-line react/purity -- deliberate: see above.
  nowMs = Date.now(),
}: {
  serverId: string;
  snapshot: ServerAgentsSnapshot | undefined;
  reachability: ServerReachability;
  /**
   * How tall a one-line row stands. A floor rather than a fixed box, so a name
   * that wraps grows its row instead of being clipped by it. The home list gets
   * this from `homeServerListLayout`, which is where density is decided.
   */
  rowMinHeight: number;
  /** Opens the agent's own pane. */
  onOpenAgent: (agent: ServerAgent) => void;
  /** Optional detail selection for persistent Pad rails. */
  selectedPaneId?: string | null;
  /**
   * Keeps the phone list's existing pressed tint by default. Persistent Pad
   * rails can disable it so selection is carried by the accent treatment
   * without leaving a filled row behind.
   */
  showsPressBackground?: boolean;
  /**
   * Persistent Pad rails trade the card's two-line detail for a one-line
   * navigator label. The cwd remains in the accessibility label, so compacting
   * the visual list does not discard the fact that distinguishes two shells.
   */
  compactLabels?: boolean;
  /**
   * Whatever separates this list from what sits above it. The component renders
   * nothing at all when there are no panes, so a gap carried here disappears
   * with the list instead of being left behind by a spacer that does not know
   * the list is empty.
   */
  style?: StyleProp<ViewStyle>;
  nowMs?: number;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();

  // The setting the mirror no longer decides for itself -- see the module
  // doc above. `snapshot.agents` always holds every pane; this is the one
  // read that turns "agents" mode from a promise into what actually renders.
  const serverCardPanes = useAppSettings((state) => state.serverCardPanes);

  const presentation = homeServerModel({
    serverId,
    snapshot,
    reachability,
    paneMode: serverCardPanes,
    nowMs,
  });

  if (presentation.rows.length === 0) return null;
  if (!presentation.age) return null;

  // One message per unit rather than a template with a unit letter in a hole:
  // "5m ago" is English's abbreviation, and a translator needs the whole
  // sentence to write their own.
  const age = presentation.age;
  const seenLabel =
    age.unit === 'now'
      ? t`Seen just now`
      : age.unit === 'minute'
        ? t`Seen ${age.value}m ago`
        : age.unit === 'hour'
          ? t`Seen ${age.value}h ago`
          : t`Seen ${age.value}d ago`;

  return (
    <View collapsable={false} style={[style, presentation.stale ? styles.stale : null]}>
      {presentation.rows.map((row) => {
        const { agent } = row;
        const selected = Boolean(agent.paneId && agent.paneId === selectedPaneId);
        const status = _(agentStatusWord[agent.status ?? ''] ?? agentStatusWord.unknown);
        // Blocked is the one status that is asking for something -- everything
        // else the dot's colour already says (working blue, done green, idle
        // and unknown the same quiet grey, because that is what they share:
        // neither tells the reader anything they can act on). So it is the
        // only status that still earns a word, and that word moves under the
        // name as a caption rather than sitting beside it competing for the
        // row's width.
        const showStatusCaption = row.caption?.kind === 'status';
        // A plain pane has no status worth a word -- it is not blocked on
        // anything, and "Unknown" under a shell's name would read as a fault
        // rather than as the honest answer "there is no agent here". Where it
        // sits is what identifies it instead, and only when its name has not
        // already said so -- see `paneLocationCaption`.
        const caption =
          row.caption?.kind === 'status'
            ? status
            : row.caption?.kind === 'location'
              ? row.caption.text
              : undefined;
        const visibleCaption = showStatusCaption || !compactLabels ? caption : undefined;
        // Compact rails remove the visual status word, not its meaning. A
        // screen reader cannot infer Working or Done from the dot's colour, so
        // recognised agents keep their current status in the spoken label.
        const spokenCaption =
          row.spokenCaption?.kind === 'status'
            ? status
            : row.spokenCaption?.kind === 'location'
              ? row.spokenCaption.text
              : undefined;
        return (
          <AgentRow
            key={row.key}
            // Not a sentence: a name and a caption, both already in the active
            // locale, joined the way a list reads them out. The caption stays
            // in the accessibility label even where it has no line on screen
            // -- a screen reader still gets the fact a sighted reader now
            // gets from the dot's colour.
            accessibilityLabel={spokenCaption ? `${agent.name}, ${spokenCaption}` : agent.name}
            accessibilityHint={t`Opens this agent's terminal`}
            testID={`server-agent-${agent.paneId ?? agent.id}`}
            minHeight={rowMinHeight}
            selected={selected}
            showsPressBackground={showsPressBackground}
            compact={compactLabels}
            onPress={() => onOpenAgent(agent)}>
            <View style={styles.kindIcon} accessible={false} pointerEvents="none">
              {agent.hasAgent ? (
                <Bot size={16} color={theme.colors.primary} strokeWidth={2} />
              ) : (
                <SquareTerminal size={16} color={theme.colors.textMuted} strokeWidth={2} />
              )}
            </View>
            <View style={styles.nameColumn}>
              {/* Keep the title on one line; the full name remains in the
                  row's accessibility label. Row placement is owned by Yoga. */}
              <Text
                variant="bodySmall"
                weight={selected ? 'semibold' : undefined}
                color={selected || agent.hasAgent ? theme.colors.primary : theme.colors.text}
                numberOfLines={1}>
                {agent.name}
              </Text>
              {visibleCaption ? (
                <Text
                  variant="caption"
                  color={showStatusCaption ? theme.colors.warning : theme.colors.textSubtle}
                  numberOfLines={1}>
                  {visibleCaption}
                </Text>
              ) : null}
            </View>
          </AgentRow>
        );
      })}

      {presentation.stale ? (
        <Text variant="caption" color={theme.colors.textSubtle} style={styles.age}>
          {seenLabel}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One pane, as a row.
 *
 * The press state is a background tint rather than the app's usual scale: on a
 * row this wide, `PressableScale`'s 1.5% shrink moves the edge by half a point
 * and reads as nothing at all. The tint answers a finger the way a list row
 * should, and the chevron slides the way the row is about to go.
 */
function AgentRow({
  accessibilityHint,
  accessibilityLabel,
  testID,
  children,
  minHeight,
  selected,
  showsPressBackground,
  compact,
  onPress,
}: {
  accessibilityHint: string;
  accessibilityLabel: string;
  testID: string;
  children: React.ReactNode;
  minHeight: number;
  selected: boolean;
  showsPressBackground: boolean;
  compact: boolean;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const pressed = useSharedValue(0);

  const tintStyle = useAnimatedStyle(() => ({ opacity: pressed.value }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pressed.value * CHEVRON_NUDGE }],
  }));

  return (
    // A stable native parent keeps row offsets relative to the pane list.
    // Entrance/layout animations must not take ownership of these frames as
    // a refreshed snapshot adds rows or changes their height under the header.
    <View collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        accessibilityState={{ selected }}
        onPressIn={() => {
          void feedback('selection');
          pressed.set(withTiming(1, timing(PRESS.in)));
        }}
        onPressOut={() => {
          pressed.set(withTiming(0, timing(PRESS.out)));
        }}
        onPress={onPress}
        style={[styles.row, compact ? styles.compactRow : null, { minHeight }]}>
        {showsPressBackground ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.tint,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              tintStyle,
            ]}
          />
        ) : null}
        {children}
        <Animated.View style={chevronStyle}>
          <ThemeIcon
            name="home.arrow"
            fallback={ChevronRight}
            size={15}
            color={selected ? theme.colors.primary : theme.colors.textMuted}
            strokeWidth={2}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}

/** How far the chevron leans toward the screen the row is about to open. */
const CHEVRON_NUDGE = 3;

const styles = StyleSheet.create({
  // Dimmed as a whole rather than per row: it is the snapshot that is old, not
  // any one agent in it.
  stale: { opacity: 0.6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // `minHeight`, not `height`: a wrapped two-line name has to be able to
    // grow the row rather than being clipped by a box sized for one line. The
    // vertical padding is what keeps a wrapped name from reading as more
    // cramped than a one-line row was -- without it the row shrinks to fit
    // the text exactly, and the two-line case loses the breathing room the
    // fixed height used to give it for free.
    paddingVertical: 5,
  },
  compactRow: {
    paddingVertical: 3,
  },
  tint: {
    position: 'absolute',
    left: -ROW_BLEED,
    right: -ROW_BLEED,
    top: 0,
    bottom: 0,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  // The name and its optional caption, stacked -- the column is what takes
  // the row's flex space, not the name `Text` itself, so a caption below it
  // does not also try to grow sideways.
  nameColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  kindIcon: {
    width: 24,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  age: {
    marginTop: 6,
  },
});
