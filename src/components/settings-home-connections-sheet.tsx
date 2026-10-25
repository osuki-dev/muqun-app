import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import {
  SheetScene,
  SheetSceneRow,
  SheetSceneAction,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  sheetSceneStyles,
} from './sheet-scene';
import { Toggle } from './toggle';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeSummary } from '@/stores/home-summary';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { HOME_COLLECTOR_CAPABILITY } from '@/lib/home-summary';
import { isDemoRecord } from '@/lib/demo-gateway';
import { provisionHomeSummary, revokeHomeSummary } from '@/lib/home-summary-setup';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';

export function SettingsHomeConnectionsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const insets = useSafeAreaInsets();
  const records = useGatewayConnectionStore((state) => state.records).filter(
    (record) => !isDemoRecord(record)
  );
  const config = useHomeSummary((state) => state.config);
  const collectorId = useHomeSummary((state) => state.collectorId);
  const capabilities = useServerCapabilities((state) => state.byServer);
  const configure = useHomeSummary((state) => state.configure);
  const candidates = records.filter((record) => !record.sshTunnel);
  const [combined, setCombined] = useState(Boolean(config.preferred));
  const [computer, setComputer] = useState(config.preferred ?? candidates[0]?.serverId ?? null);
  const [backups, setBackups] = useState(config.preferred ? config.collectors.length > 1 : true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const desired = combined ? computer : null;
  const changed =
    desired !== config.preferred ||
    (combined && (backups !== config.collectors.length > 1 || config.overview !== true));
  const currentName = records.find((record) => record.serverId === collectorId)?.label;
  const unsupported =
    computer !== null &&
    capabilities[computer] !== undefined &&
    !capabilities[computer]?.includes(HOME_COLLECTOR_CAPABILITY);

  async function apply() {
    if (busy) return;
    if (!changed && (config.preferred || config.collectors.length === 0)) {
      onClose();
      return;
    }
    setBusy(true);
    setMessage('');
    await settleAfter(
      () =>
        recoverWith(
          async () => {
            if (
              desired &&
              config.overview === true &&
              config.preferred &&
              backups === config.collectors.length > 1 &&
              config.collectors.some((entry) => entry.serverId === desired)
            ) {
              configure({ ...config, preferred: desired });
              onClose();
              return;
            }
            configure({ ...config, preferred: null });
            const remaining = await revokeHomeSummary(records, config);
            configure(remaining);
            if (remaining.collectors.length) {
              setMessage(
                t`Stopped sharing. Reconnect your computers and try again to finish removing access.`
              );
              return;
            }
            if (desired)
              configure(await provisionHomeSummary(records, desired, backups, configure));
            onClose();
          },
          () =>
            setMessage(
              t`Could not save. Check that your computers are online and their Gateways are up to date.`
            )
        ),
      () => setBusy(false)
    );
  }

  return (
    <SheetScene
      fitsContent
      title={t`Home connections`}
      caption={t`Choose how Home gets updates from your computers.`}
      testID="settings-home-connections-sheet">
      <ScrollView
        style={sheetSceneStyles.fitScroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        contentInsetAdjustmentBehavior="never">
        <SheetSceneRow
          title={t`Connect separately`}
          caption={t`Your phone connects to each computer.`}
          selected={!combined}
          disabled={busy}
          testID="home-summary-direct"
          onPress={() => setCombined(false)}
        />
        <SheetSceneRow
          title={t`Use one computer`}
          caption={t`One computer gathers task updates for your phone.`}
          selected={combined}
          disabled={busy || candidates.length === 0}
          testID="home-summary-combined"
          onPress={() => setCombined(true)}
        />
        {combined ? (
          <>
            <SheetSceneGroupHeading title={t`Which computer?`} />
            {candidates.map((record) => {
              const unavailable =
                capabilities[record.serverId] !== undefined &&
                !capabilities[record.serverId]?.includes(HOME_COLLECTOR_CAPABILITY);
              return (
                <SheetSceneRow
                  key={record.serverId}
                  title={record.label}
                  selected={computer === record.serverId}
                  disabled={busy || unavailable}
                  disabledCaption={
                    unavailable ? t`Update Gateway on this computer first.` : undefined
                  }
                  testID={`home-summary-prefer-${record.serverId}`}
                  onPress={() => setComputer(record.serverId)}
                />
              );
            })}
            <View style={styles.option}>
              <View style={styles.copy}>
                <Text variant="bodySmall">{t`Switch automatically`}</Text>
                <Text
                  variant="caption"
                  color={colors.textMuted}>{t`Use another computer if this one disconnects.`}</Text>
              </View>
              <Toggle
                value={backups}
                onValueChange={setBackups}
                disabled={busy}
                accessibilityLabel={t`Switch automatically`}
                testID="home-summary-backups"
              />
            </View>
            <Text variant="caption" color={colors.textMuted} style={styles.note}>
              {backups
                ? t`Shares Home summaries (tasks, sessions and terminals) with this computer and backups. Conversations stay directly connected.`
                : t`Shares Home summaries (tasks, sessions and terminals) with this computer. Conversations stay directly connected.`}
            </Text>
          </>
        ) : null}
        {currentName ? (
          <Text
            variant="caption"
            color={colors.textMuted}
            style={styles.note}>{t`Currently using ${currentName}`}</Text>
        ) : null}
        {message ? (
          <Text variant="caption" accessibilityRole="alert" style={styles.note}>
            {message}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.actions}>
        <SheetSceneAction
          label={
            busy
              ? t`Saving…`
              : changed || (!config.preferred && config.collectors.length > 0)
                ? t`Apply`
                : t`Done`
          }
          busy={busy}
          disabled={combined && (!computer || unsupported)}
          testID="home-summary-apply"
          onPress={() => void apply()}
        />
      </View>
      <SheetSceneFooter bottomInset={insets.bottom} contentSized />
    </SheetScene>
  );
}
const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 16,
  },
  copy: { flex: 1, gap: 4 },
  note: { marginTop: 12 },
  actions: { marginHorizontal: 20, marginTop: 16 },
});
