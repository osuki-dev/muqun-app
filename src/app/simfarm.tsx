/**
 * The simulator preview sheet's route.
 *
 * Thin, and thin for the same reason `web-service.tsx` is: nothing here talks to
 * the gateway. It reads an address out of a paired record and the preview builds
 * a URL from it, so there is no connection to select and nothing to await. All a
 * route knows is which server was meant.
 *
 * The port comes from the mirror when one has been found before and is otherwise
 * left to the preview's own default -- the probe is what decides, and it writes
 * back through `remember` so the second visit skips the look.
 */
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { SimfarmPreview } from '@/components/simfarm-preview';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerSimfarm } from '@/stores/server-simfarm';

export default function SimfarmScreen() {
  const theme = useThemeTokens();
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  const { t } = useLingui();
  const params = useLocalSearchParams<{ serverId: string; allowed?: string }>();

  const records = useGatewayConnectionStore((state) => state.records);
  const current = useGatewayConnectionStore((state) => state.record);
  // The selected record is consulted too, so the demo -- which is never written
  // to the paired list -- resolves rather than reading as an unpaired server.
  const record =
    records.find((entry) => entry.serverId === params.serverId) ??
    (current?.serverId === params.serverId ? current : undefined);

  const ports = useServerSimfarm((state) => state.byServer);
  const hydrate = useServerSimfarm((state) => state.hydrate);
  const remember = useServerSimfarm((state) => state.remember);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const serverId = record?.serverId;
  const onPortFound = useCallback(
    (port: number) => {
      if (serverId) void remember(serverId, port);
    },
    [remember, serverId]
  );

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
    <SimfarmPreview
      gatewayUrl={record.url}
      allowed={params.allowed === '1'}
      initialPort={ports[record.serverId]}
      onPortFound={onPortFound}
    />
  );
}

const styles = StyleSheet.create({
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
