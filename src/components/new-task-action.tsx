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
import { getAgentCatalog, getAgentProjects } from '@/lib/agent-session';
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

  const [isReady, setIsReady] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endpointUrl = server ? effectiveGatewayBaseUrl(server) : undefined;
  const endpointToken = server?.token;

  useEffect(() => {
    if (!capabilities?.includes('agent_sessions')) {
      setIsReady(false);
      return;
    }

    let cancelled = false;

    const checkReady = async () => {
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
            if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
            announcementTimerRef.current = setTimeout(() => {
              setShowAnnouncement(false);
            }, READY_ANNOUNCEMENT_MS);
          }
        } else {
          setIsReady(false);
        }
      } catch {
        if (!cancelled) setIsReady(false);
      }
    };

    void checkReady();
    const interval = setInterval(() => {
      void checkReady();
    }, 6000);

    return () => {
      cancelled = true;
      clearInterval(interval);
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
