import { useEffect, useMemo, useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { PressableScale } from '@/components/pressable-scale';
import { AgentMark } from '@/components/agent-mark';
import { useSelectedAgent } from '@/hooks/use-agent-features';
import { useHomeCommands } from '@/hooks/use-home-commands';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useServerCapabilities } from '@/stores/server-capabilities';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { withAlpha } from '@/lib/color';
import {
  checkAgentServer,
  refreshAgentServerDiscovery,
  type AgentReadiness,
} from '@/lib/home-agent-readiness';
import type { HomeAgentEntry } from '@/lib/agent-discovery';
import { MAX_AGENT_TILES, agentDisplayName, projectLaunchAgents } from '@/lib/home-launch-model';
import { useAgents } from '@/stores/agents';
import { INSTANT, SHEEN_MOTION, fadeIn, fadeOut, listLayout } from '@/lib/motion';

/** How long the "ready" label stays visible before settling to the compact icon. */
const READY_ANNOUNCEMENT_MS = 3800;

/** Set of servers that have already completed their "ready" announcement this session. */
const announcedServers = new Set<string>();

export function NewTaskAction({
  server,
  serverId,
  label,
}: {
  server?: GatewayRecord;
  serverId: string;
  label: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const router = useRouter();
  const { openAgent } = useHomeCommands();
  const capabilities = useServerCapabilities((s) => s.byServer[serverId]);

  const [isReady, setIsReady] = useState(false);
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  /**
   * Which agent to open on this server. A gateway that drives more than one
   * ready agent gets a small menu on tap; every other gateway keeps the one
   * tap it always had. The mirror this reads is written by the readiness
   * probe below, so the menu appears once the server has answered.
   */
  const agentChoice = useSelectedAgent(serverId);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const hasAgentSessions = Boolean(capabilities?.includes('agent_sessions'));
  // Through this server's own endpoint: the card is not necessarily the
  // connected gateway, and its answer must land under its own id.
  useEffect(() => {
    if (hasAgentSessions && server) void refreshAgentServerDiscovery(server);
  }, [hasAgentSessions, server]);

  // What the card offers is what the gateway lists. One agent keeps the one
  // button this card always had; two or three get a button each; more fall
  // back to the one button and its menu.
  const mirrored = useAgents((state) => state.index.servers[serverId]);
  const lastUsedAgentId = useAgents((state) => state.index.lastUsed[serverId]);
  const offered = projectLaunchAgents(mirrored, lastUsedAgentId);
  const soleAgentId = offered.length === 1 ? offered[0]?.id : undefined;
  const agentRow = offered.length > 1 && offered.length <= MAX_AGENT_TILES;
  const agentName = agentDisplayName([...offered], soleAgentId ?? agentChoice.selected);
  const agentKind = (offered.length === 1 ? offered[0]?.kind : undefined) ?? 'opencode';

  /**
   * The live entry: a band of light crosses the button, the glyph swells a
   * little as it passes, and then both rest.
   *
   * This button is the only thing on a server card that leads to something
   * running on its own -- an agent that answers -- and it was drawn exactly
   * like the inert controls beside it. One value drives both the band and the
   * glyph, on the UI thread, and only while OpenCode has answered. Reduced
   * motion gets the still button.
   */
  const reduceMotion = useReducedMotion();
  const sheen = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(sheen);
    sheen.value = 0;
    if (!isReady || reduceMotion) return;
    sheen.value = withRepeat(
      withSequence(
        withDelay(
          SHEEN_MOTION.restMs,
          withTiming(1, { duration: SHEEN_MOTION.sweepMs, easing: Easing.inOut(Easing.quad) })
        ),
        withTiming(0, INSTANT)
      ),
      -1
    );
    return () => cancelAnimation(sheen);
  }, [isReady, reduceMotion, sheen]);
  const sheenStyle = useAnimatedStyle(() => ({
    // From fully off the leading edge to fully off the trailing one, in units
    // of the band's own width, so the pill and the square travel alike.
    opacity: sheen.value === 0 ? 0 : 1,
    transform: [{ translateX: -60 + sheen.value * 220 }, { rotate: '18deg' }],
  }));
  const glyphStyle = useAnimatedStyle(() => {
    // A bump centred on the middle of the crossing: 0 at both ends, 1 half way.
    const bump = 1 - Math.abs(sheen.value * 2 - 1);
    return { transform: [{ scale: 1 + (SHEEN_MOTION.swell - 1) * bump }] };
  });
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Readiness is shared with Editorial's New OpenCode command and the guide
  // route. The card only renders the result; it does not register a probe for
  // another component to call later.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- retryTimer and announcementTimer are cleared on unmount in cleanup below.
  useEffect(() => {
    if (!capabilities?.includes('agent_sessions')) {
      return () => {};
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let announcementTimer: ReturnType<typeof setTimeout> | null = null;

    const checkReady = async (isRetry = false): Promise<boolean> => {
      const result = await checkAgentServer(server, soleAgentId);
      if (cancelled) return result.status === 'ready';

      setReadiness(result);
      setHasChecked(true);
      setIsReady(result.status === 'ready');
      if (result.capabilities.length > 0) {
        void useServerCapabilities.getState().record(serverId, result.capabilities);
      }

      if (result.status === 'ready') {
        if (!announcedServers.has(serverId)) {
          announcedServers.add(serverId);
          setShowAnnouncement(true);
          if (announcementTimer) clearTimeout(announcementTimer);
          if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
          announcementTimer = setTimeout(() => {
            setShowAnnouncement(false);
          }, READY_ANNOUNCEMENT_MS);
          announcementTimerRef.current = announcementTimer;
        }
        return true;
      }

      if (!isRetry && !cancelled) {
        retryTimer = setTimeout(() => {
          void checkReady(true);
        }, 10000);
      }
      return false;
    };

    void checkReady();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (announcementTimer) clearTimeout(announcementTimer);
      if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
    };
  }, [capabilities, server, serverId, soleAgentId]);

  // The card belongs to one server, and the screen it opens must be that
  // server's. This used to fire the selection and push the route in the same
  // tick, so the agent screen mounted on whichever server was selected a
  // moment ago -- with two servers on Home, the first card's button opened the
  // second server's OpenCode. The switch is awaited, and the route carries the
  // server id so the screen can refuse to mount on any other.
  const handlePress = () => {
    if (agentChoice.offersChoice) {
      setAgentMenuOpen((open) => !open);
      return;
    }
    // Opening the existing entry is intentionally separate from the genuine
    // new-session command. The workbench resumes its remembered session.
    void openAgent(serverId, undefined, undefined, undefined, soleAgentId);
  };
  const agentMenuItems = useMemo<AgentActionMenuItem[]>(
    () =>
      agentChoice.ready.map((agent) => ({
        id: agent.id,
        label: agent.name,
        testID: `server-agent-pick-${agent.id}`,
        onPress: () => {
          setAgentMenuOpen(false);
          agentChoice.select(agent.id);
          void openAgent(serverId, undefined, undefined, undefined, agent.id);
        },
      })),
    [agentChoice, openAgent, serverId]
  );

  if (!capabilities?.includes('agent_sessions')) {
    return null;
  }

  if (agentRow) {
    return (
      <Animated.View layout={listLayout()} entering={fadeIn()} exiting={fadeOut()}>
        <View style={styles.agentRow}>
          {offered.map((agent) => (
            <AgentRowButton
              key={agent.id}
              agent={agent}
              label={label}
              onOpen={() => void openAgent(serverId, undefined, undefined, undefined, agent.id)}
              onSetup={() =>
                router.push({
                  pathname: '/agent-guide',
                  params: {
                    serverId,
                    label,
                    agentId: agent.id,
                    ...(agent.readiness === 'not-installed' || agent.readiness === 'needs-setup'
                      ? { status: agent.readiness }
                      : { status: 'offline', cause: 'service' }),
                    intent: 'existing',
                  },
                })
              }
            />
          ))}
        </View>
      </Animated.View>
    );
  }

  // If probe completed and the agent's service is offline / timed out:
  // Render warning button opening the guide sheet
  if (!isReady) {
    if (!hasChecked) return null;
    return (
      <>
        <Animated.View layout={listLayout()} entering={fadeIn()} exiting={fadeOut()}>
          <PressableScale
            testID="server-opencode-offline-action"
            accessibilityRole="button"
            accessibilityLabel={
              readiness?.status === 'unsupported'
                ? t`${agentName} sessions are not supported. Tap for details`
                : readiness?.status === 'not-installed'
                  ? t`${agentName} was not found. Tap for installation instructions`
                  : readiness?.status === 'needs-setup'
                    ? t`${agentName} needs setup. Tap for setup instructions`
                    : t`${agentName} service offline. Tap for setup instructions`
            }
            onPress={() =>
              router.push({
                pathname: '/agent-guide',
                params: {
                  serverId,
                  label,
                  agentId: soleAgentId ?? readiness?.agentId ?? agentChoice.selected,
                  status: readiness?.status ?? 'offline',
                  ...(readiness?.status === 'offline' ? { cause: readiness.cause } : {}),
                  intent: 'existing',
                },
              })
            }
            style={[
              styles.button,
              {
                backgroundColor: surfaceBackground(withAlpha(theme.colors.warning, 0.12)),
                borderColor: withAlpha(theme.colors.warning, 0.4),
              },
            ]}>
            <View style={styles.offlineIconWrapper}>
              <AgentMark kind={agentKind} size={16} color={theme.colors.warning} />
              <View style={[styles.offlineDot, { backgroundColor: theme.colors.warning }]} />
            </View>
          </PressableScale>
        </Animated.View>
      </>
    );
  }

  // react-doctor-disable-next-line react-hooks-js/todo -- lingui t macro; the lingui babel plugin compiles the template away
  const openAgentLabel = t`Open ${agentName} Agent on ${label}`;
  const readyLabel = t`${agentName} ready`;
  const actionLabel = showAnnouncement ? `${readyLabel}. ${openAgentLabel}` : openAgentLabel;

  return (
    <Animated.View layout={listLayout()} entering={fadeIn()} exiting={fadeOut()}>
      <View style={styles.actionRow}>
        <PressableScale
          testID="server-opencode-action"
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={handlePress}
          style={[
            styles.button,
            {
              backgroundColor: surfaceBackground(theme.colors.primarySubtle),
              borderColor: surfaceBackground(theme.colors.border),
            },
          ]}>
          {/* The light first, so the glyph is drawn over it. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sheen,
              { backgroundColor: withAlpha(theme.colors.primary, 0.22) },
              sheenStyle,
            ]}
          />
          <Animated.View style={glyphStyle}>
            <AgentMark kind={agentKind} size={18} color={theme.colors.primary} />
          </Animated.View>
        </PressableScale>
        {agentMenuOpen ? (
          <View style={styles.agentMenu}>
            <AgentActionMenu testID="server-agent-picker" items={agentMenuItems} />
          </View>
        ) : null}
        {showAnnouncement ? (
          <Animated.View
            entering={fadeIn()}
            exiting={fadeOut()}
            layout={listLayout()}
            style={styles.announcementLane}>
            <Text
              variant="caption"
              weight="semibold"
              color={theme.colors.primary}
              numberOfLines={2}
              style={styles.announcementText}>
              {readyLabel}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

/**
 * One agent's button on a card that lists several: its own mark, and the
 * warning dot the single button wears when the agent is not answering.
 */
function AgentRowButton({
  agent,
  label,
  onOpen,
  onSetup,
}: {
  agent: HomeAgentEntry;
  label: string;
  onOpen: () => void;
  onSetup: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const ready = agent.readiness === 'ready';
  const name = agent.name;
  const description = ready
    ? t`Open ${name} Agent on ${label}`
    : agent.readiness === 'not-installed'
      ? t`${name} was not found. Tap for installation instructions`
      : agent.readiness === 'needs-setup'
        ? t`${name} needs setup. Tap for setup instructions`
        : t`${name} service offline. Tap for setup instructions`;
  return (
    <PressableScale
      testID={`server-agent-action-${agent.id}`}
      accessibilityRole="button"
      accessibilityLabel={description}
      onPress={ready ? onOpen : onSetup}
      style={[
        styles.button,
        ready
          ? {
              backgroundColor: surfaceBackground(theme.colors.primarySubtle),
              borderColor: surfaceBackground(theme.colors.border),
            }
          : {
              backgroundColor: surfaceBackground(withAlpha(theme.colors.warning, 0.12)),
              borderColor: withAlpha(theme.colors.warning, 0.4),
            },
      ]}>
      {ready ? (
        <AgentMark kind={agent.kind} size={18} color={theme.colors.primary} />
      ) : (
        <View style={styles.offlineIconWrapper}>
          <AgentMark kind={agent.kind} size={16} color={theme.colors.warning} />
          <View style={[styles.offlineDot, { backgroundColor: theme.colors.warning }]} />
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionRow: {
    width: 44,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    // The sheen is wider than the button and must not be seen leaving it.
    overflow: 'hidden',
  },
  sheen: {
    position: 'absolute',
    top: -12,
    bottom: -12,
    left: 0,
    width: 22,
  },
  offlineIconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  announcementLane: {
    width: 44,
    maxWidth: 44,
  },
  agentMenu: {
    position: 'absolute',
    top: 48,
    right: 0,
    zIndex: 10,
    minWidth: 180,
  },
  announcementText: {
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});
