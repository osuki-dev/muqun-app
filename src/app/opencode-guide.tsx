import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OpenCodeGuideSheet } from '@/components/opencode-guide-sheet';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useOpenCodeGuideStore } from '@/stores/opencode-guide';

/**
 * The OpenCode setup sheet's route: which server, and nothing else.
 *
 * "Check again" has to re-run the probe the server card owns -- it is that
 * card's readiness state the answer changes -- and "open the agent" has to
 * leave this sheet and land on a screen. Neither travels as a route param, so
 * both go through `stores/opencode-guide.ts`; see that file for why.
 */
export default function OpenCodeGuideScreen() {
  const router = useRouter();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const params = useLocalSearchParams<{ serverId?: string; label?: string }>();
  const serverId = params.serverId;
  const probe = useOpenCodeGuideStore((state) => (serverId ? state.probes[serverId] : undefined));
  const requestOpenAgent = useOpenCodeGuideStore((state) => state.requestOpenAgent);

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
      // No probe registered means the card that raised this sheet is gone, so
      // there is nothing to re-check and the sheet says so rather than throwing.
      onCheckAgain={async () => (probe ? await probe() : false)}
      onOpenAgent={() => requestOpenAgent(serverId)}
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
