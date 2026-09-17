import { useCallback, useEffect, useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { OpenCodeIcon } from '@/components/opencode-icon';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useOpenCodeGuideStore } from '@/stores/opencode-guide';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { effectiveGatewayBaseUrl } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { withAlpha } from '@/lib/color';
import {
  buildAgentCacheKey,
  getAgentCatalog,
  getAgentProjects,
  getCachedAgentCatalogSync,
  getCachedAgentProjectsSync,
} from '@/lib/agent-session';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';

/** How long the "OpenCode ready" label stays visible before settling to the compact icon. */
const READY_ANNOUNCEMENT_MS = 3800;

/** Probe timeout for determining whether OpenCode service is reachable. */
const PROBE_TIMEOUT_MS = 5000;

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
  const { selectRecord } = useGatewayRecord();
  const capabilities = useServerCapabilities((s) => s.byServer[serverId]);

  const endpointUrl = server ? effectiveGatewayBaseUrl(server) : undefined;
  const endpointToken = server?.token;

  const [isReady, setIsReady] = useState(() => {
    if (!capabilities?.includes('agent_sessions')) return false;
    const cacheKeyCat = buildAgentCacheKey('catalog', endpointUrl);
    const cacheKeyProj = buildAgentCacheKey('projects', endpointUrl);
    const cachedCat = getCachedAgentCatalogSync(cacheKeyCat);
    const cachedProj = getCachedAgentProjectsSync(cacheKeyProj);
    return Boolean(
      (Array.isArray(cachedCat?.models) && cachedCat.models.length > 0) ||
      (Array.isArray(cachedCat?.agents) && cachedCat.agents.length > 0) ||
      (Array.isArray(cachedProj) && cachedProj.length > 0)
    );
  });
  const [hasChecked, setHasChecked] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Probe OpenCode readiness on mount / config change
  const checkReadyRef = useRef<(isRetry?: boolean) => Promise<boolean>>(async () => false);

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- retryTimer and announcementTimer are cleared on unmount in cleanup below.
  useEffect(() => {
    if (!capabilities?.includes('agent_sessions')) {
      return () => {};
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let announcementTimer: ReturnType<typeof setTimeout> | null = null;

    const checkReady = async (isRetry = false): Promise<boolean> => {
      try {
        const endpoint = endpointUrl ? { url: endpointUrl, token: endpointToken } : undefined;
        const probePromise = Promise.all([
          getAgentCatalog(undefined, endpoint),
          getAgentProjects(undefined, endpoint),
        ]);
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)
        );

        const result = await Promise.race([probePromise, timeoutPromise]);
        if (cancelled) return false;

        if (!result) {
          // Timeout reached
          setHasChecked(true);
          setIsReady(false);
          return false;
        }

        const [catalog, projects] = result;
        const ready =
          (Array.isArray(catalog?.models) && catalog.models.length > 0) ||
          (Array.isArray(catalog?.agents) && catalog.agents.length > 0) ||
          (Array.isArray(projects) && projects.length > 0);

        setHasChecked(true);
        if (ready) {
          setIsReady(true);
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
        } else {
          setIsReady(false);
          if (!isRetry && !cancelled) {
            retryTimer = setTimeout(() => {
              void checkReady(true);
            }, 10000);
          }
          return false;
        }
      } catch {
        if (!cancelled) {
          setHasChecked(true);
          setIsReady(false);
          if (!isRetry) {
            retryTimer = setTimeout(() => {
              void checkReady(true);
            }, 10000);
          }
        }
        return false;
      }
    };

    checkReadyRef.current = checkReady;
    void checkReady();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (announcementTimer) clearTimeout(announcementTimer);
      if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
    };
  }, [capabilities, endpointUrl, endpointToken, serverId]);

  const handlePress = useCallback(() => {
    void selectRecord(serverId);
    router.push('/agent');
  }, [selectRecord, serverId, router]);

  /**
   * The setup sheet is a route now, so "check again" runs over there and this
   * card's probe has to be reachable from it. Registered per server -- several
   * cards are on screen at once -- and cleared when this one goes away, so a
   * dismissed card can never answer for a live one.
   */
  useEffect(() => {
    const store = useOpenCodeGuideStore.getState();
    store.registerProbe(serverId, () => checkReadyRef.current(true));
    return () => {
      useOpenCodeGuideStore.getState().clearProbe(serverId);
    };
  }, [serverId]);

  // The sheet cannot dismiss itself and land on the agent screen in one
  // gesture, so it writes where the reader asked to go; this reads it and
  // clears it, the way the server screen reads a panel pick.
  const openAgentFor = useOpenCodeGuideStore((state) => state.openAgentFor);
  useEffect(() => {
    if (openAgentFor !== serverId) return;
    useOpenCodeGuideStore.getState().clearOpenAgent();
    handlePress();
  }, [openAgentFor, serverId, handlePress]);

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
            accessibilityLabel={t`OpenCode service offline. Tap for setup instructions`}
            onPress={() =>
              router.push({ pathname: '/opencode-guide', params: { serverId, label } })
            }
            style={[
              styles.button,
              styles.square,
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
      <PressableScale
        testID="server-opencode-action"
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={handlePress}
        style={[
          styles.button,
          showAnnouncement ? styles.pill : styles.square,
          {
            backgroundColor: surfaceBackground(theme.colors.primarySubtle),
            borderColor: surfaceBackground(theme.colors.border),
          },
        ]}>
        <OpenCodeIcon size={18} color={theme.colors.primary} />
        {showAnnouncement ? (
          <Animated.View
            entering={fadeIn()}
            exiting={fadeOut()}
            layout={listLayout()}
            style={styles.announcementContainer}>
            <Text
              variant="caption"
              weight="semibold"
              color={theme.colors.primary}
              numberOfLines={1}
              style={styles.announcementText}>
              {t`OpenCode ready`}
            </Text>
          </Animated.View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
  },
  square: {
    width: 36,
  },
  pill: {
    paddingHorizontal: 10,
    gap: 6,
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
  announcementContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  announcementText: {
    letterSpacing: 0.2,
  },
});
