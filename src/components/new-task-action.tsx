import { useCallback, useEffect, useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { OpenCodeIcon } from '@/components/opencode-icon';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { effectiveGatewayBaseUrl } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
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
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- retryTimer and announcementTimer are cleared on unmount in cleanup below.
  useEffect(() => {
    if (!capabilities?.includes('agent_sessions')) {
      setIsReady(false);
      return () => {};
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let announcementTimer: ReturnType<typeof setTimeout> | null = null;

    const checkReady = async (isRetry = false) => {
      try {
        const endpoint = endpointUrl ? { url: endpointUrl, token: endpointToken } : undefined;
        const [catalog, projects] = await Promise.all([
          getAgentCatalog(undefined, endpoint),
          getAgentProjects(undefined, endpoint),
        ]);
        if (cancelled) return;
        const ready =
          (Array.isArray(catalog?.models) && catalog.models.length > 0) ||
          (Array.isArray(catalog?.agents) && catalog.agents.length > 0) ||
          (Array.isArray(projects) && projects.length > 0);

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
        } else {
          setIsReady(false);
          if (!isRetry && !cancelled) {
            retryTimer = setTimeout(() => {
              void checkReady(true);
            }, 10000);
          }
        }
      } catch {
        if (!cancelled) {
          setIsReady(false);
          if (!isRetry) {
            retryTimer = setTimeout(() => {
              void checkReady(true);
            }, 10000);
          }
        }
      }
    };

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

  if (!capabilities?.includes('agent_sessions') || !isReady) {
    return null;
  }

  return (
    <Animated.View layout={listLayout()} entering={fadeIn()} exiting={fadeOut()}>
      <PressableScale
        testID="server-opencode-action"
        accessibilityRole="button"
        accessibilityLabel={
          showAnnouncement
            ? `${t`OpenCode ready`}. ${t`Open OpenCode Agent on ${label}`}`
            : t`Open OpenCode Agent on ${label}`
        }
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
              variant="label"
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
  announcementContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  announcementText: {
    letterSpacing: 0.2,
  },
});
