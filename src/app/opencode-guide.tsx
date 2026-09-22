import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OpenCodeGuideSheet } from '@/components/opencode-guide-sheet';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { checkOpenCodeServer, type OpenCodeReadiness } from '@/lib/home-opencode-readiness';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';

/**
 * The OpenCode setup sheet's route owns the re-check. That keeps Editorial's
 * command path independent from whichever server card happens to be mounted
 * and lets a successful check replace this route with the exact server and
 * original new-session intent.
 */
export default function OpenCodeGuideScreen() {
  const router = useRouter();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const params = useLocalSearchParams<{
    serverId?: string;
    label?: string;
    directory?: string;
    intent?: string;
    status?: string;
    cause?: string;
  }>();
  const serverId = params.serverId;
  const selectedRecord = useGatewayConnectionStore((state) => state.record);
  const records = useGatewayConnectionStore((state) => state.records);
  const server =
    serverId && selectedRecord?.serverId === serverId
      ? selectedRecord
      : serverId
        ? records.find((record) => record.serverId === serverId)
        : undefined;
  const [readiness, setReadiness] = useState<OpenCodeReadiness>(() =>
    params.status === 'unsupported'
      ? { status: 'unsupported', capabilities: [] }
      : params.status === 'not-installed'
        ? { status: 'not-installed', capabilities: [] }
        : {
            status: 'offline',
            capabilities: [],
            cause:
              params.cause === 'service' || params.cause === 'catalog' ? params.cause : 'health',
          }
  );

  const checkAgain = async (): Promise<OpenCodeReadiness> => {
    const result = await checkOpenCodeServer(server);
    setReadiness(result);
    if (serverId && result.capabilities.length > 0) {
      void useServerCapabilities.getState().record(serverId, result.capabilities);
    }
    return result;
  };

  const openAgent = () => {
    if (!serverId) return;
    router.replace({
      pathname: '/agent',
      params: {
        server: serverId,
        ...(params.directory ? { directory: params.directory } : {}),
        ...(params.intent === 'new' ? { intent: 'new' } : {}),
      },
    });
  };

  if (!serverId) {
    return (
      <View style={[styles.notice, { backgroundColor: surfaceBackground(theme.colors.surface) }]}>
        <Text selectable variant="bodySmall" color={theme.colors.danger}>
          {t`This server is no longer paired.`}
        </Text>
      </View>
    );
  }

  return (
    <OpenCodeGuideSheet
      serverLabel={params.label || t`Server`}
      onClose={() => router.back()}
      readiness={readiness}
      onCheckAgain={checkAgain}
      onOpenAgent={openAgent}
    />
  );
}

const styles = StyleSheet.create({
  // Tall enough that `fitToContents` does not draw a sheet the height of one
  // line, which reads as a glitch rather than as a message.
  notice: {
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
});
