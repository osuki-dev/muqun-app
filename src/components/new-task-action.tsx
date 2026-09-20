import { useCallback, useEffect, useRef, useState } from 'react';
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

import { PressableScale } from '@/components/pressable-scale';
import { OpenCodeIcon } from '@/components/opencode-icon';
import { useHomeCommands } from '@/hooks/use-home-commands';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useServerCapabilities } from '@/stores/server-capabilities';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { withAlpha } from '@/lib/color';
import { checkOpenCodeServer, type OpenCodeReadiness } from '@/lib/home-opencode-readiness';
import { INSTANT, SHEEN_MOTION, fadeIn, fadeOut, listLayout } from '@/lib/motion';

/** How long the "OpenCode ready" label stays visible before settling to the compact icon. */
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
  const { openOpenCode } = useHomeCommands();
  const capabilities = useServerCapabilities((s) => s.byServer[serverId]);

  const [isReady, setIsReady] = useState(false);
  const [readiness, setReadiness] = useState<OpenCodeReadiness | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);

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
      const result = await checkOpenCodeServer(server);
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
  }, [capabilities, server, serverId]);

  // The card belongs to one server, and the screen it opens must be that
  // server's. This used to fire the selection and push the route in the same
  // tick, so the agent screen mounted on whichever server was selected a
  // moment ago -- with two servers on Home, the first card's button opened the
  // second server's OpenCode. The switch is awaited, and the route carries the
  // server id so the screen can refuse to mount on any other.
  const handlePress = useCallback(() => {
    // Opening the existing entry is intentionally separate from the genuine
    // new-session command. The workbench resumes its remembered session.
    void openOpenCode(serverId);
  }, [openOpenCode, serverId]);

  if (!capabilities?.includes('agent_sessions')) {
    return null;
  }

  // If probe completed and OpenCode service is offline / timed out:
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
                ? t`OpenCode sessions are not supported. Tap for details`
                : t`OpenCode service offline. Tap for setup instructions`
            }
            onPress={() =>
              router.push({
                pathname: '/opencode-guide',
                params: {
                  serverId,
                  label,
                  status: readiness?.status === 'unsupported' ? 'unsupported' : 'offline',
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
              <OpenCodeIcon size={16} color={theme.colors.warning} />
              <View style={[styles.offlineDot, { backgroundColor: theme.colors.warning }]} />
            </View>
          </PressableScale>
        </Animated.View>
      </>
    );
  }

  // react-doctor-disable-next-line react-hooks-js/todo -- lingui t macro; the lingui babel plugin compiles the template away
  const openAgentLabel = t`Open OpenCode Agent on ${label}`;
  const readyLabel = t`OpenCode ready`;
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
            <OpenCodeIcon size={18} color={theme.colors.primary} />
          </Animated.View>
        </PressableScale>
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
              {t`OpenCode ready`}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
  announcementText: {
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});
