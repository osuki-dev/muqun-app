/**
 * The Open a web service sheet's route.
 *
 * Thin, and thinner than the New task route on purpose: that one has to select
 * and await a connection because everything it does is a gateway call. This
 * sheet never talks to the gateway at all -- it reads an address out of a
 * paired record and hands a URL to the browser -- so there is nothing to
 * connect to and nothing to wait for. All a route knows here is which server
 * was meant.
 */
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OpenWebServiceSheet } from '@/components/open-web-service-sheet';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

export default function WebServiceScreen() {
  const router = useRouter();
  const theme = useThemeTokens();
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  const { t } = useLingui();
  const params = useLocalSearchParams<{ serverId: string }>();

  const records = useGatewayConnectionStore((state) => state.records);
  const current = useGatewayConnectionStore((state) => state.record);
  // The selected record is consulted too, so that the demo -- which is never
  // written to the paired list -- still resolves rather than reading as an
  // unpaired server. The entry that opens this sheet is gated before then.
  const record =
    records.find((entry) => entry.serverId === params.serverId) ??
    (current?.serverId === params.serverId ? current : undefined);

  if (!record) {
    return (
      <View style={[styles.notice, { backgroundColor: theme.colors.surface }]}>
        <Text selectable variant="bodySmall" color={theme.colors.danger}>
          {t`This server is no longer paired.`}
        </Text>
      </View>
    );
  }

  return (
    <OpenWebServiceSheet
      serverId={record.serverId}
      label={record.label}
      gatewayUrl={record.url}
      onClose={() => router.back()}
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
